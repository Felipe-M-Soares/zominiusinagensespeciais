/**
 * ManuaisButton — Botão compacto de Manuais para o header da Index
 * Lista manuais disponíveis com download direto, upload para admin
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { BookOpen, Download, Upload, Trash2, ChevronDown, Loader2, FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const MAX_FILE_SIZE_MB = 20;

function sanitizeFilename(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();
}

function pdfNameToTitle(filename: string): string {
  return filename.replace(/\.pdf$/i, "").replace(/_/g, " ").trim();
}

interface Manual {
  id: string;
  title: string;
  description: string | null;
  file_path: string;
  file_size: number;
  created_at: string;
}

export function ManuaisButton() {
  const { isAdmin } = useAuth();
  const [manuals, setManuals] = useState<Manual[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Manual | null>(null);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchManuals = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("manuals")
        .select("id,title,description,file_path,file_size,created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setManuals((data as Manual[]) ?? []);
    } catch {
      // silently fail — user can still see the dropdown
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchManuals(); }, [fetchManuals]);

  async function handleDownload(manual: Manual) {
    if (downloadingId === manual.id) return;
    setDownloadingId(manual.id);
    try {
      const { data, error } = await supabase.storage
        .from("manuals")
        .download(manual.file_path);
      if (error) throw error;
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = manual.file_path.split("/").pop() ?? `${manual.title}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Erro ao baixar manual");
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleUpload() {
    if (!file || !title.trim()) {
      toast.error("Título e arquivo são obrigatórios");
      return;
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      toast.error(`Arquivo muito grande (máx ${MAX_FILE_SIZE_MB}MB)`);
      return;
    }
    setUploading(true);
    try {
      const safeName = sanitizeFilename(file.name);
      const filePath = `${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("manuals")
        .upload(filePath, file, { upsert: false });
      if (upErr) throw upErr;

      const { error: dbErr } = await supabase.from("manuals").insert({
        title: title.trim(),
        description: description.trim() || null,
        file_path: filePath,
        file_size: file.size,
      });
      if (dbErr) {
        await supabase.storage.from("manuals").remove([filePath]);
        throw dbErr;
      }
      toast.success("Manual adicionado com sucesso");
      setDialogOpen(false);
      setTitle(""); setDescription(""); setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      fetchManuals();
    } catch (e) {
      toast.error("Erro ao enviar manual");
      console.error(e);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(manual: Manual) {
    try {
      await supabase.storage.from("manuals").remove([manual.file_path]);
      const { error } = await supabase.from("manuals").delete().eq("id", manual.id);
      if (error) throw error;
      toast.success("Manual excluído");
      setManuals(prev => prev.filter(m => m.id !== manual.id));
    } catch {
      toast.error("Erro ao excluir manual");
    } finally {
      setDeleteTarget(null);
    }
  }

  function formatSize(bytes: number) {
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5 h-9">
            <BookOpen className="h-4 w-4" />
            <span className="hidden sm:inline">Manuais</span>
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-64">
          {loading ? (
            <div className="flex items-center justify-center py-4 text-muted-foreground text-sm gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando...
            </div>
          ) : manuals.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Nenhum manual cadastrado
            </div>
          ) : (
            manuals.map((m) => (
              <DropdownMenuItem
                key={m.id}
                className="flex items-center gap-2 py-2.5 cursor-pointer group"
                onSelect={(e) => {
                  e.preventDefault();
                  handleDownload(m);
                }}
              >
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{m.title}</p>
                  <p className="text-[10px] text-muted-foreground">{formatSize(m.file_size)}</p>
                </div>
                {downloadingId === m.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                ) : (
                  <Download className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground shrink-0" />
                )}
                {isAdmin && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(m);
                    }}
                    className="h-5 w-5 flex items-center justify-center rounded hover:bg-destructive/10 text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </DropdownMenuItem>
            ))
          )}

          {isAdmin && (
            <>
              {manuals.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onSelect={(e) => { e.preventDefault(); setDialogOpen(true); }}
                className="gap-2 cursor-pointer text-primary focus:text-primary"
              >
                <Plus className="h-4 w-4" />
                Adicionar manual
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Upload dialog (admin) */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Adicionar Manual
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <Label className="text-xs font-medium">Título *</Label>
              <Input
                className="mt-1"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Ex: Manual de Instalação"
              />
            </div>
            <div>
              <Label className="text-xs font-medium">Descrição</Label>
              <Textarea
                className="mt-1 resize-none text-sm"
                rows={2}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Opcional"
              />
            </div>
            <div>
              <Label className="text-xs font-medium">Arquivo PDF *</Label>
              <div className="mt-1">
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.type !== "application/pdf") { toast.error("Apenas PDF"); return; }
                    if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) { toast.error(`Máx ${MAX_FILE_SIZE_MB}MB`); return; }
                    setFile(f);
                    if (!title) setTitle(pdfNameToTitle(f.name));
                  }}
                  className="w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
                />
                {file && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {file.name} · {formatSize(file.size)}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)} disabled={uploading}>
              Cancelar
            </Button>
            <Button className="flex-1 gap-1.5" onClick={handleUpload} disabled={uploading || !file || !title.trim()}>
              {uploading ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" />Enviando...</>
              ) : (
                <><Upload className="h-3.5 w-3.5" />Enviar</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir manual</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir <b>{deleteTarget?.title}</b>? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
