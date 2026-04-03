import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Download, Upload, FileUp, Trash2, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

const MAX_FILE_SIZE_MB = 20;

function sanitizeFilename(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();
}

interface Catalog {
  id: string;
  title: string;
  file_path: string;
  file_size: number;
}

export function CatalogButton() {
  const { isAdmin } = useAuth();
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<Catalog | null>(null);

  const fetchCatalogs = async () => {
    try {
      const { data, error } = await supabase
        .from("catalogs")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) {
        console.error("fetchCatalogs error:", error.message);
        // Não mostra toast aqui — pode ser usuário ainda não aprovado
      } else {
        setCatalogs((data as Catalog[]) ?? []);
      }
    } catch (err) {
      console.error("fetchCatalogs unexpected error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCatalogs(); }, []);

  /**
   * FIX DOWNLOAD PDF:
   * 1. Gera URL assinada (privada, expira em 5 min, com parâmetro download)
   * 2. Cria <a> com href + download e clica — funciona em Safari/iOS/Chrome
   * 3. Não usa fetch() (CORS) nem window.open() assíncrono (Safari bloqueia)
   */
  const handleDownload = async (catalog: Catalog) => {
    if (downloadingId === catalog.id) return;
    setDownloadingId(catalog.id);
    try {
      const safeFilename = (catalog.title.endsWith(".pdf") ? catalog.title : catalog.title + ".pdf")
        .replace(/[^a-zA-Z0-9._\-\s]/g, "_");

      const { data, error } = await supabase.storage
        .from("catalogs")
        .createSignedUrl(catalog.file_path, 300, { download: safeFilename });

      if (error || !data?.signedUrl) {
        console.error("createSignedUrl error:", error?.message);
        // Mensagem específica: ajuda o admin a saber que é problema de storage policy
        toast.error(
          isAdmin
            ? "Erro ao gerar link. Verifique as políticas do bucket 'catalogs' no Supabase Storage."
            : "Erro ao gerar link de download. Contacte o administrador."
        );
        return;
      }

      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = safeFilename;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (document.body.contains(a)) document.body.removeChild(a);
      }, 200);
    } catch (err: any) {
      console.error("Download error:", err);
      toast.error("Erro inesperado ao baixar catálogo.");
    } finally {
      setDownloadingId(null);
    }
  };

  const handleUpload = async () => {
    if (!file || !title.trim()) {
      toast.error("Preencha o título e selecione um arquivo");
      return;
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      toast.error(`Arquivo muito grande. Máximo: ${MAX_FILE_SIZE_MB}MB`);
      return;
    }
    if (file.type !== "application/pdf") {
      toast.error("Apenas arquivos PDF são permitidos");
      return;
    }

    setUploading(true);
    try {
      const safeName = sanitizeFilename(file.name);
      const filePath = `${Date.now()}_${safeName}`;

      // FIX UPLOAD: Tenta o upload primeiro e captura o erro específico do storage.
      // O erro mais comum aqui é falta de política INSERT no bucket "catalogs".
      const { error: uploadError } = await supabase.storage
        .from("catalogs")
        .upload(filePath, file, { contentType: "application/pdf" });

      if (uploadError) {
        console.error("Storage upload error:", uploadError.message, uploadError);
        // Distingue entre erros de permissão e outros
        if (
          uploadError.message?.toLowerCase().includes("unauthorized") ||
          uploadError.message?.toLowerCase().includes("row-level security") ||
          uploadError.message?.toLowerCase().includes("403")
        ) {
          toast.error("Sem permissão para fazer upload. Verifique as políticas do bucket 'catalogs' no Supabase Storage → Policies.");
        } else {
          toast.error("Erro ao enviar arquivo: " + uploadError.message);
        }
        return;
      }

      const { error: dbError } = await supabase.from("catalogs").insert({
        title: title.trim(),
        file_path: filePath,
        file_size: file.size,
      });

      if (dbError) {
        // Rollback: remove o arquivo que já foi enviado
        await supabase.storage.from("catalogs").remove([filePath]);
        console.error("DB insert error:", dbError.message);
        toast.error("Erro ao salvar catálogo: " + dbError.message);
        return;
      }

      toast.success("Catálogo adicionado com sucesso");
      setDialogOpen(false);
      setTitle("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      fetchCatalogs();
    } catch (err: any) {
      console.error("Upload unexpected error:", err);
      toast.error("Erro inesperado ao enviar catálogo.");
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const cat = deleteTarget;
    setDeleteTarget(null);

    // Remove arquivo do storage primeiro
    const { error: storageErr } = await supabase.storage.from("catalogs").remove([cat.file_path]);
    if (storageErr) console.error("Storage delete error:", storageErr.message);

    // Remove registro da tabela
    const { error: dbErr } = await supabase.from("catalogs").delete().eq("id", cat.id);
    if (dbErr) {
      toast.error("Erro ao excluir catálogo: " + dbErr.message);
      return;
    }
    toast.success("Catálogo excluído");
    fetchCatalogs();
  };

  if (loading) return null;
  if (catalogs.length === 0 && !isAdmin) return null;

  // Um catálogo sem admin: botão direto
  if (catalogs.length === 1 && !isAdmin) {
    return (
      <Button
        variant="ghost" size="icon" className="h-8 w-8"
        onClick={() => handleDownload(catalogs[0])}
        disabled={downloadingId === catalogs[0].id}
        title="Baixar Catálogo"
      >
        {downloadingId === catalogs[0].id
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : <Download className="h-4 w-4" />
        }
      </Button>
    );
  }

  return (
    <>
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir catálogo</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir "{deleteTarget?.title}"? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 px-2 sm:px-3 gap-1 text-xs">
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Catálogo</span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {catalogs.length === 0 && isAdmin && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum catálogo cadastrado</div>
          )}
          {catalogs.map((cat) => (
            <DropdownMenuItem
              key={cat.id}
              className="gap-2 cursor-pointer"
              onClick={() => handleDownload(cat)}
              disabled={downloadingId === cat.id}
            >
              {downloadingId === cat.id
                ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                : <Download className="h-3.5 w-3.5 shrink-0" />
              }
              <span className="truncate">{cat.title}</span>
            </DropdownMenuItem>
          ))}

          {isAdmin && (
            <>
              {catalogs.length > 0 && <div className="my-1 border-t border-border" />}
              <DropdownMenuItem
                className="gap-2 cursor-pointer text-primary focus:text-primary"
                onClick={() => setDialogOpen(true)}
              >
                <FileUp className="h-3.5 w-3.5 shrink-0" />
                Adicionar catálogo
              </DropdownMenuItem>
              {catalogs.map((cat) => (
                <DropdownMenuItem
                  key={`del-${cat.id}`}
                  className="gap-2 cursor-pointer text-destructive focus:text-destructive"
                  onClick={() => setDeleteTarget(cat)}
                >
                  <Trash2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Excluir: {cat.title}</span>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Adicionar Catálogo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Título *</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Catálogo 2025"
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Arquivo PDF * (máx. {MAX_FILE_SIZE_MB}MB)</Label>
              <input
                type="file"
                accept=".pdf,application/pdf"
                ref={fileRef}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              <Button variant="outline" className="w-full gap-2 truncate" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4 shrink-0" />
                <span className="truncate">{file ? file.name : "Selecionar PDF"}</span>
              </Button>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setDialogOpen(false); setFile(null); setTitle(""); }}>
                Cancelar
              </Button>
              <Button onClick={handleUpload} disabled={uploading || !file || !title.trim()}>
                {uploading ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Enviando...</> : "Enviar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
