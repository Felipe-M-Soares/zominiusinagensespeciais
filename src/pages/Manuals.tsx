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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Upload, Trash2, Download, FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";

const MAX_FILE_SIZE_MB = 20;

// BUG-007 FIX: Sanitize filename to avoid broken signed URLs with spaces/accents
function sanitizeFilename(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();
}

interface Manual {
  id: string;
  title: string;
  description: string;
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
  const [downloading, setDownloading] = useState<string | null>(null); // stores the id being downloaded
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // BUG-002 FIX: Replace window.confirm with AlertDialog state
  const [deleteTarget, setDeleteTarget] = useState<Manual | null>(null);

  const fetchManuals = async () => {
    try {
      const { data, error } = await supabase
        .from("manuals")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) {
        console.error("Error fetching manuals:", error);
        toast.error("Erro ao carregar manuais");
      } else {
        setManuals((data as Manual[]) ?? []);
      }
    } catch (err) {
      console.error("fetchManuals unexpected error:", err);
      toast.error("Erro ao carregar manuais");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchManuals(); }, []);

  const handleUpload = async () => {
    if (!file || !title.trim()) {
      toast.error("Preencha o título e selecione um arquivo PDF");
      return;
    }
    // BUG-005 FIX: Validate file size
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      toast.error(`Arquivo muito grande. Máximo: ${MAX_FILE_SIZE_MB}MB`);
      return;
    }
    // BUG-006 FIX: Validate MIME type - accept=".pdf" is client-side only and can be bypassed
    if (file.type !== "application/pdf") {
      toast.error("Apenas arquivos PDF são permitidos");
      return;
    }
    setUploading(true);
    try {
      // BUG-007 FIX: Sanitize filename to avoid broken storage paths
      const safeName = sanitizeFilename(file.name);
      const filePath = `${Date.now()}_${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("manuals")
        .upload(filePath, file, { contentType: "application/pdf" });

      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase.from("manuals").insert({
        title: title.trim(),
        description: description.trim() || null,
        file_path: filePath,
        file_size: file.size,
      });

      if (dbError) {
        await supabase.storage.from("manuals").remove([filePath]);
        throw dbError;
      }

      toast.success("Manual adicionado com sucesso");
      setDialogOpen(false);
      setTitle("");
      setDescription("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      fetchManuals();
    } catch (err: any) {
      console.error("Upload error:", err);
      toast.error("Erro ao enviar o manual");
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const manual = deleteTarget;
    setDeleteTarget(null);
    const { error: storageErr } = await supabase.storage.from("manuals").remove([manual.file_path]);
    if (storageErr) console.error("Storage delete error:", storageErr);
    const { error: dbErr } = await supabase.from("manuals").delete().eq("id", manual.id);
    if (dbErr) {
      toast.error("Erro ao excluir manual");
      return;
    }
    toast.success("Manual excluído");
    fetchManuals();
  };

  // FIX DEFINITIVO: Usar window.open com a URL assinada diretamente.
  // fetch() falha com CORS porque o bucket Supabase não tem o domínio Vercel na allowlist.
  // window.open() com a URL assinada funciona universalmente — o browser segue a URL
  // autenticada e o Supabase retorna o PDF com Content-Disposition: attachment.
  const handleDownload = async (filePath: string, title: string, id: string) => {
    if (downloading === id) return;
    setDownloading(id);
    try {
      const safeFilename = (title.endsWith(".pdf") ? title : title + ".pdf")
        .replace(/[^a-zA-Z0-9._\-\s]/g, "_");

      const { data, error } = await supabase.storage
        .from("manuals")
        .createSignedUrl(filePath, 300, { download: safeFilename });

      if (error || !data?.signedUrl) {
        console.error("createSignedUrl error:", error?.message);
        toast.error("Erro ao gerar link de download. Verifique as permissões do bucket no Supabase.");
        return;
      }

      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = safeFilename;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err: any) {
      console.error("Download error:", err);
      toast.error("Erro inesperado ao baixar o arquivo.");
    } finally {
      setDownloading(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  return (
    <div className="min-h-screen bg-background">
      {/* BUG-002 FIX: AlertDialog replaces window.confirm() */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
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
            {manuals.map((m) => (
              <div key={m.id} className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:bg-accent/30 transition-colors">
                <FileText className="h-8 w-8 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{m.title}</p>
                  {m.description && <p className="text-xs text-muted-foreground truncate">{m.description}</p>}
                  <p className="text-xs text-muted-foreground">{formatSize(m.file_size)}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDownload(m.file_path, m.title, m.id)} disabled={downloading === m.id}>
                    <Download className="h-4 w-4" />
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
      </main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar Manual</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Título *</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Manual do Implante HE" />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição opcional" rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label>Arquivo PDF * (máx. {MAX_FILE_SIZE_MB}MB)</Label>
              <input type="file" accept=".pdf,application/pdf" ref={fileRef} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="hidden" />
              <Button variant="outline" className="w-full gap-2" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4" />
                {file ? file.name : "Selecionar PDF"}
              </Button>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleUpload} disabled={uploading}>{uploading ? "Enviando..." : "Enviar"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
