import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Upload, Trash2, Download, FileText, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";

const MAX_FILE_SIZE_MB = 20;

/**
 * Sanitiza o nome do arquivo para uso no Storage.
 * Remove acentos, substitui caracteres especiais por underscore.
 * DEVE ser igual à função usada no upload para que os paths batam.
 */
function sanitizeFilename(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")        // remove diacritics
    .replace(/[^a-zA-Z0-9._-]/g, "_")       // special chars → underscore
    .replace(/_+/g, "_")                     // multiple underscores → one
    .toLowerCase();
}

interface Manual {
  id: string;
  title: string;
  description: string | null;
  file_path: string;
  file_size: number;
  created_at: string;
}

export default function Manuals() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [manuals, setManuals] = useState<Manual[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<Manual | null>(null);

  const fetchManuals = async () => {
    try {
      const { data, error } = await supabase
        .from("manuals").select("*").order("created_at", { ascending: false });
      if (error) { console.error("fetchManuals:", error); toast.error("Erro ao carregar manuais"); }
      else setManuals((data as Manual[]) ?? []);
    } catch (err) {
      console.error("fetchManuals unexpected:", err);
      toast.error("Erro ao carregar manuais");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchManuals(); }, []);

  const handleUpload = async () => {
    if (!file || !title.trim()) { toast.error("Preencha o título e selecione um arquivo PDF"); return; }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) { toast.error(`Arquivo muito grande. Máximo: ${MAX_FILE_SIZE_MB}MB`); return; }
    if (file.type !== "application/pdf") { toast.error("Apenas arquivos PDF são permitidos"); return; }

    setUploading(true);
    try {
      // Sempre sanitiza o nome antes de salvar no storage
      const safeName = sanitizeFilename(file.name);
      const filePath = `${Date.now()}_${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("manuals").upload(filePath, file, { contentType: "application/pdf" });
      if (uploadError) { throw uploadError; }

      const { error: dbError } = await supabase.from("manuals").insert({
        title: title.trim(),
        description: description.trim() || null,
        file_path: filePath,   // salva o path sanitizado — o mesmo usado no storage
        file_size: file.size,
      });
      if (dbError) {
        await supabase.storage.from("manuals").remove([filePath]); // rollback
        throw dbError;
      }

      toast.success("Manual adicionado com sucesso");
      setDialogOpen(false);
      setTitle(""); setDescription(""); setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      fetchManuals();
    } catch (err: any) {
      console.error("Upload error:", err);
      toast.error("Erro ao enviar o manual: " + (err?.message ?? "erro desconhecido"));
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const manual = deleteTarget;
    setDeleteTarget(null);
    await supabase.storage.from("manuals").remove([manual.file_path]);
    const { error } = await supabase.from("manuals").delete().eq("id", manual.id);
    if (error) { toast.error("Erro ao excluir manual"); return; }
    toast.success("Manual excluído");
    fetchManuals();
  };

  /**
   * Download via URL assinada (bucket privado).
   *
   * FIX "Object not found":
   * O erro ocorre quando o file_path no banco não bate com o arquivo no storage.
   * Isso acontece com arquivos enviados antes da sanitização ser implementada
   * (ex: o banco tem "IT-5.2.05-Chave.pdf" mas o storage tem "it_5.2.05_chave.pdf").
   *
   * Estratégia: tenta o file_path original; se falhar, tenta a versão sanitizada.
   * Se ambos falharem, orienta o admin a reenviar o arquivo.
   */
  const handleDownload = async (manual: Manual) => {
    if (downloadingId === manual.id) return;
    setDownloadingId(manual.id);
    try {
      const safeFilename = (manual.title.endsWith(".pdf") ? manual.title : manual.title + ".pdf")
        .replace(/[^a-zA-Z0-9._\-\s]/g, "_");

      // Tenta 1: path exato salvo no banco
      let signedUrl: string | null = null;
      const { data, error } = await supabase.storage
        .from("manuals")
        .createSignedUrl(manual.file_path, 300, { download: safeFilename });

      if (!error && data?.signedUrl) {
        signedUrl = data.signedUrl;
      } else {
        console.warn("createSignedUrl failed for path:", manual.file_path, error?.message);

        // Tenta 2: versão sanitizada do path (para arquivos antigos)
        // Extrai timestamp e sanitiza apenas o nome do arquivo
        const parts = manual.file_path.split("_");
        const timestamp = parts[0];
        const rest = parts.slice(1).join("_");
        const sanitizedPath = `${timestamp}_${sanitizeFilename(rest || manual.file_path)}`;

        if (sanitizedPath !== manual.file_path) {
          const { data: data2, error: error2 } = await supabase.storage
            .from("manuals")
            .createSignedUrl(sanitizedPath, 300, { download: safeFilename });

          if (!error2 && data2?.signedUrl) {
            signedUrl = data2.signedUrl;
            console.info("Download fallback to sanitized path worked:", sanitizedPath);
          } else {
            console.error("Sanitized path also failed:", sanitizedPath, error2?.message);
          }
        }
      }

      if (!signedUrl) {
        const msg = isAdmin
          ? `Arquivo não encontrado no storage. Path no banco: "${manual.file_path}". ` +
            `Exclua este manual e reenvie o arquivo PDF.`
          : "Arquivo não disponível no momento. Contacte o administrador.";
        toast.error(msg, { duration: 8000 });
        return;
      }

      // Abre o download via link <a> — compatível com Safari/iOS
      const a = document.createElement("a");
      a.href = signedUrl;
      a.download = safeFilename;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { if (document.body.contains(a)) document.body.removeChild(a); }, 200);
    } catch (err: any) {
      console.error("Download error:", err);
      toast.error("Erro inesperado ao baixar o arquivo.");
    } finally {
      setDownloadingId(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return "—";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  return (
    <div className="min-h-screen bg-background">
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir manual</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir "{deleteTarget?.title}"? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <header className="border-b border-border/50 bg-card/80 backdrop-blur-md sticky top-0 z-10">
        <div className="container mx-auto px-4 py-2.5 flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Logo className="h-8 object-contain" />
          <h1 className="text-sm font-semibold">Manuais</h1>
          {isAdmin && (
            <Button size="sm" className="ml-auto h-8 gap-1.5 text-xs" onClick={() => setDialogOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Adicionar
            </Button>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-5">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : manuals.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Nenhum manual disponível</p>
          </div>
        ) : (
          <div className="space-y-3">
            {manuals.map(m => (
              <div key={m.id} className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:bg-accent/30 transition-colors">
                <FileText className="h-8 w-8 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{m.title}</p>
                  {m.description && <p className="text-xs text-muted-foreground truncate">{m.description}</p>}
                  <p className="text-xs text-muted-foreground">{formatSize(m.file_size)}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8"
                    onClick={() => handleDownload(m)}
                    disabled={downloadingId === m.id}
                    title="Baixar PDF">
                    {downloadingId === m.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Download className="h-4 w-4" />
                    }
                  </Button>
                  {isAdmin && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDeleteTarget(m)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Aviso para admin sobre arquivos com path inválido */}
        {isAdmin && manuals.length > 0 && (
          <p className="text-xs text-muted-foreground mt-4 text-center">
            Se um manual mostrar "Arquivo não encontrado", exclua-o e reenvie o PDF.
          </p>
        )}
      </main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Adicionar Manual</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Título *</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Manual do Implante HE" />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Descrição opcional" rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label>Arquivo PDF * (máx. {MAX_FILE_SIZE_MB}MB)</Label>
              <input type="file" accept=".pdf,application/pdf" ref={fileRef}
                onChange={e => setFile(e.target.files?.[0] ?? null)} className="hidden" />
              <Button variant="outline" className="w-full gap-2 truncate" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4 shrink-0" />
                <span className="truncate">{file ? file.name : "Selecionar PDF"}</span>
              </Button>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleUpload} disabled={uploading || !file || !title.trim()}>
                {uploading ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Enviando...</> : "Enviar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
