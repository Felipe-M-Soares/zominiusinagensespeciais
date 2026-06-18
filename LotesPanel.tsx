/**
 * ManuaisButton — Botão compacto de Manuais para o header da Index
 * Lista manuais disponíveis com download direto, upload múltiplo para admin
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  BookOpen, Download, Upload, Trash2, ChevronDown,
  Loader2, FileText, Plus, X, CheckCircle2, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const MAX_FILE_SIZE_MB = 20;
const MAX_FILES_AT_ONCE = 20;

function sanitizeFilename(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();
}

function pdfNameToTitle(filename: string): string {
  return filename.replace(/\.pdf$/i, "").trim();
}

interface Manual {
  id: string;
  title: string;
  description: string | null;
  file_path: string;
  file_size: number;
  created_at: string;
}

interface QueuedFile {
  id: string;
  file: File;
  title: string;
  description: string;
  status: "pending" | "uploading" | "done" | "error";
  errorMsg?: string;
}

export function ManuaisButton() {
  const { isAdmin } = useAuth();
  const [manuals, setManuals] = useState<Manual[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Manual | null>(null);

  // Multi-upload queue
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [isUploadingAll, setIsUploadingAll] = useState(false);
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
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchManuals(); }, [fetchManuals]);

  // ── Download ──────────────────────────────────────────────────────────────
  async function handleDownload(manual: Manual) {
    if (downloadingId === manual.id) return;
    setDownloadingId(manual.id);
    try {
      const safeFilename = (manual.title.endsWith(".pdf") ? manual.title : manual.title + ".pdf")
        .replace(/[^a-zA-Z0-9.\-\s]/g, "_");
      const { data, error } = await supabase.storage
        .from("manuals")
        .createSignedUrl(manual.file_path, 300, { download: safeFilename });
      if (error || !data?.signedUrl) { toast.error("Erro ao gerar link de download"); return; }
      const a = document.createElement("a");
      a.href = data.signedUrl; a.download = safeFilename;
      a.target = "_blank"; a.rel = "noopener noreferrer";
      document.body.appendChild(a); a.click();
      setTimeout(() => { if (document.body.contains(a)) document.body.removeChild(a); }, 200);
    } catch {
      toast.error("Erro ao baixar manual");
    } finally {
      setDownloadingId(null);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
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

  // ── Multi-upload ──────────────────────────────────────────────────────────
  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (!selected.length) return;
    const valid: QueuedFile[] = [];
    const skipped: string[] = [];
    for (const f of selected) {
      if (f.type !== "application/pdf") { skipped.push(`${f.name} (não é PDF)`); continue; }
      if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) { skipped.push(`${f.name} (maior que ${MAX_FILE_SIZE_MB}MB)`); continue; }
      valid.push({ id: `${Date.now()}_${Math.random()}`, file: f, title: pdfNameToTitle(f.name), description: "", status: "pending" });
    }
    if (skipped.length > 0) toast.warning(`Arquivos ignorados:\n${skipped.join("\n")}`);
    setQueue(prev => {
      const total = prev.length + valid.length;
      if (total > MAX_FILES_AT_ONCE) { toast.error(`Máximo de ${MAX_FILES_AT_ONCE} arquivos por vez`); return prev; }
      return [...prev, ...valid];
    });
    if (fileRef.current) fileRef.current.value = "";
  };

  const updateQueueItem = (id: string, patch: Partial<QueuedFile>) => {
    setQueue(prev => prev.map(q => q.id === id ? { ...q, ...patch } : q));
  };

  const removeFromQueue = (id: string) => setQueue(prev => prev.filter(q => q.id !== id));

  const uploadOne = async (item: QueuedFile): Promise<boolean> => {
    if (!item.title.trim()) { updateQueueItem(item.id, { status: "error", errorMsg: "Título obrigatório" }); return false; }
    updateQueueItem(item.id, { status: "uploading" });
    try {
      const safeName = sanitizeFilename(item.file.name);
      const filePath = `${Date.now()}_${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("manuals").upload(filePath, item.file, { contentType: "application/pdf" });
      if (uploadError) throw uploadError;
      const { error: dbError } = await supabase.from("manuals").insert({
        title: item.title.trim(), description: item.description.trim() || null,
        file_path: filePath, file_size: item.file.size,
      });
      if (dbError) { await supabase.storage.from("manuals").remove([filePath]); throw dbError; }
      updateQueueItem(item.id, { status: "done" });
      return true;
    } catch {
      updateQueueItem(item.id, { status: "error", errorMsg: "Falha no upload. Tente novamente." });
      return false;
    }
  };

  const handleUploadAll = async () => {
    const pending = queue.filter(q => q.status === "pending" || q.status === "error");
    if (!pending.length) return;
    const emptyTitles = pending.filter(q => !q.title.trim());
    if (emptyTitles.length > 0) {
      toast.error("Preencha o título de todos os arquivos antes de enviar");
      emptyTitles.forEach(q => updateQueueItem(q.id, { status: "error", errorMsg: "Título obrigatório" }));
      return;
    }
    setIsUploadingAll(true);
    let successCount = 0;
    for (const item of pending) { const ok = await uploadOne(item); if (ok) successCount++; }
    setIsUploadingAll(false);
    if (successCount > 0) {
      toast.success(`${successCount} manual${successCount > 1 ? "is" : ""} adicionado${successCount > 1 ? "s" : ""} com sucesso`);
      fetchManuals();
    }
    setQueue(prev => prev.filter(q => q.status !== "done"));
  };

  const handleCloseDialog = () => {
    if (isUploadingAll) return;
    setDialogOpen(false);
    setQueue([]);
  };

  function formatSize(bytes: number) {
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  const pendingCount = queue.filter(q => q.status === "pending" || q.status === "error").length;
  const hasQueue = queue.length > 0;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 px-2 sm:px-3 gap-1 text-xs">
            <BookOpen className="h-4 w-4" />
            <span className="hidden sm:inline">Manuais</span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>

        {/* Dropdown com scroll interno */}
        <DropdownMenuContent align="end" className="w-72 max-h-80 overflow-y-auto">
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
                onSelect={(e) => { e.preventDefault(); handleDownload(m); }}
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
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(m); }}
                    className="h-5 w-5 flex items-center justify-center rounded hover:bg-destructive/10 text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </DropdownMenuItem>
            ))
          )}

          {/* Botão Adicionar dentro do dropdown, só para admin */}
          {isAdmin && (
            <>
              {manuals.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onSelect={(e) => { e.preventDefault(); setDialogOpen(true); }}
                className="gap-2 cursor-pointer text-primary focus:text-primary"
              >
                <Plus className="h-4 w-4" />
                Adicionar manuais
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Dialog de upload múltiplo — menor, com scroll */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) handleCloseDialog(); }}>
        <DialogContent className="max-w-sm max-h-[78vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 pt-4 pb-3 border-b border-border/40 shrink-0">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <BookOpen className="h-4 w-4" />
              Adicionar Manuais
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col flex-1 overflow-hidden px-4 py-3 gap-3 min-h-0">
            {/* Seletor de múltiplos arquivos */}
            <input
              type="file"
              accept=".pdf,application/pdf"
              multiple
              ref={fileRef}
              onChange={handleFilesSelected}
              className="hidden"
            />
            <Button
              variant="outline"
              className="w-full gap-2 border-dashed h-11 text-muted-foreground hover:text-foreground shrink-0 text-xs"
              onClick={() => fileRef.current?.click()}
              disabled={isUploadingAll}
            >
              <Upload className="h-4 w-4 shrink-0" />
              Selecionar PDFs
              <span className="opacity-60">(múltiplos, máx. {MAX_FILE_SIZE_MB}MB cada)</span>
            </Button>

            {/* Fila de arquivos com scroll */}
            {hasQueue && (
              <div className="flex-1 overflow-y-auto space-y-2 pr-0.5 min-h-0">
                {queue.map(item => (
                  <div
                    key={item.id}
                    className={cn(
                      "rounded-lg border p-2.5 space-y-1.5 transition-colors",
                      item.status === "done"    ? "border-green-500/40 bg-green-50/10"
                      : item.status === "error" ? "border-destructive/40 bg-destructive/5"
                      : "border-border bg-card"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {item.status === "uploading" && <Loader2    className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />}
                      {item.status === "done"      && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />}
                      {item.status === "error"     && <AlertCircle  className="h-3.5 w-3.5 text-destructive shrink-0" />}
                      {item.status === "pending"   && <FileText     className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                      <span className="truncate flex-1 text-[11px] text-muted-foreground">{item.file.name}</span>
                      <span className="text-[11px] text-muted-foreground shrink-0">{formatSize(item.file.size)}</span>
                      {item.status !== "uploading" && item.status !== "done" && (
                        <button type="button" onClick={() => removeFromQueue(item.id)}
                          className="shrink-0 text-muted-foreground hover:text-destructive transition-colors">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {item.status !== "done" && (
                      <div className="space-y-1">
                        <Label className="text-[10px]">Título *</Label>
                        <input
                          type="text" value={item.title}
                          onChange={e => updateQueueItem(item.id, {
                            title: e.target.value,
                            status: item.status === "error" ? "pending" : item.status,
                            errorMsg: undefined,
                          })}
                          disabled={item.status === "uploading"}
                          placeholder="Título do manual" maxLength={200}
                          className="w-full rounded-md border border-border bg-background px-2.5 py-1 text-[11px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                        />
                      </div>
                    )}

                    {item.status !== "done" && (
                      <div className="space-y-1">
                        <Label className="text-[10px]">Descrição</Label>
                        <Textarea
                          value={item.description}
                          onChange={e => updateQueueItem(item.id, { description: e.target.value })}
                          disabled={item.status === "uploading"}
                          placeholder="Opcional" rows={1}
                          className="text-[11px] resize-none"
                        />
                      </div>
                    )}

                    {item.status === "error" && item.errorMsg && (
                      <p className="text-[11px] text-destructive">{item.errorMsg}</p>
                    )}
                    {item.status === "done" && (
                      <p className="text-[11px] text-green-600 dark:text-green-400">✓ {item.title}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-border/40 shrink-0">
            <Button variant="outline" size="sm" onClick={handleCloseDialog} disabled={isUploadingAll}>
              {hasQueue && queue.some(q => q.status === "done") ? "Fechar" : "Cancelar"}
            </Button>
            {hasQueue && pendingCount > 0 && (
              <Button size="sm" onClick={handleUploadAll} disabled={isUploadingAll}>
                {isUploadingAll ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Enviando...</>
                ) : (
                  <><Upload className="h-3.5 w-3.5 mr-1.5" />Enviar {pendingCount} arquivo{pendingCount > 1 ? "s" : ""}</>
                )}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão */}
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
