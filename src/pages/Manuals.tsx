import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Upload, Trash2, Download, FileText, Plus, Loader2, X, CheckCircle2, AlertCircle, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { getStoredTheme, applyTheme } from "@/lib/theme";

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

export default function Manuals() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [manuals, setManuals] = useState<Manual[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Manual | null>(null);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [isUploadingAll, setIsUploadingAll] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [isDark, setIsDark] = useState(() => {
    const theme = getStoredTheme();
    if (theme === "system") return window.matchMedia("(prefers-color-scheme: dark)").matches;
    return theme === "dark";
  });
  const toggleTheme = useCallback(() => {
    const next = !isDark;
    setIsDark(next);
    applyTheme(next ? "dark" : "light");
  }, [isDark]);

  const fetchManuals = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("manuals").select("*").order("created_at", { ascending: false });
      if (error) { logger.error("fetchManuals:", error); toast.error("Erro ao carregar manuais"); }
      else setManuals((data as Manual[]) ?? []);
    } catch (err) {
      logger.error("fetchManuals unexpected:", err);
      toast.error("Erro ao carregar manuais");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchManuals(); }, [fetchManuals]);

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

  const removeFromQueue = (id: string) => { setQueue(prev => prev.filter(q => q.id !== id)); };

  const uploadOne = async (item: QueuedFile): Promise<boolean> => {
    if (!item.title.trim()) { updateQueueItem(item.id, { status: "error", errorMsg: "Título obrigatório" }); return false; }
    updateQueueItem(item.id, { status: "uploading" });
    try {
      const safeName = sanitizeFilename(item.file.name);
      const filePath = `${Date.now()}_${safeName}`;
      const { error: uploadError } = await supabase.storage.from("manuals").upload(filePath, item.file, { contentType: "application/pdf" });
      if (uploadError) throw uploadError;
      const { error: dbError } = await supabase.from("manuals").insert({
        title: item.title.trim(), description: item.description.trim() || null,
        file_path: filePath, file_size: item.file.size,
      });
      if (dbError) { await supabase.storage.from("manuals").remove([filePath]); throw dbError; }
      updateQueueItem(item.id, { status: "done" });
      return true;
    } catch (err: unknown) {
      // SECURITY: não exibir mensagem interna do Supabase/storage na UI.
      // Loga para debug mas mostra mensagem genérica ao usuário.
      logger.error("uploadOne error:", item.file.name, err);
      const isPermission = err instanceof Error &&
        (err.message.toLowerCase().includes("unauthorized") ||
         err.message.toLowerCase().includes("row-level security") ||
         err.message.toLowerCase().includes("403"));
      updateQueueItem(item.id, {
        status: "error",
        errorMsg: isPermission
          ? "Sem permissão para enviar. Contate o administrador."
          : "Falha no upload. Verifique o arquivo e tente novamente.",
      });
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
    const failed = queue.filter(q => q.status === "error").length;
    if (failed > 0) toast.error(`${failed} arquivo${failed > 1 ? "s" : ""} falharam. Corrija e tente novamente.`);
    setQueue(prev => prev.filter(q => q.status !== "done"));
  };

  const handleCloseDialog = () => { if (isUploadingAll) return; setDialogOpen(false); setQueue([]); };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const manual = deleteTarget; setDeleteTarget(null);
    try {
      await supabase.storage.from("manuals").remove([manual.file_path]);
      const { error } = await supabase.from("manuals").delete().eq("id", manual.id);
      if (error) { logger.error("Delete DB error:", error); toast.error("Erro ao excluir manual"); return; }
      toast.success("Manual excluído"); fetchManuals();
    } catch (err) { logger.error("handleDeleteConfirm unexpected:", err); toast.error("Erro inesperado ao excluir"); }
  };

  const handleDownload = async (manual: Manual) => {
    if (downloadingId === manual.id) return;
    setDownloadingId(manual.id);
    try {
      const safeFilename = (manual.title.endsWith(".pdf") ? manual.title : manual.title + ".pdf")
        .replace(/[^a-zA-Z0-9.\-\s]/g, "_");
      let signedUrl: string | null = null;
      const { data, error } = await supabase.storage.from("manuals")
        .createSignedUrl(manual.file_path, 300, { download: safeFilename });
      if (!error && data?.signedUrl) {
        signedUrl = data.signedUrl;
      } else {
        logger.warn("createSignedUrl failed:", manual.file_path, error?.message);
        const underscoreIdx = manual.file_path.indexOf("_");
        if (underscoreIdx !== -1) {
          const timestamp = manual.file_path.slice(0, underscoreIdx);
          const rest = manual.file_path.slice(underscoreIdx + 1);
          const sanitizedPath = `${timestamp}_${sanitizeFilename(rest)}`;
          if (sanitizedPath !== manual.file_path) {
            const { data: data2, error: error2 } = await supabase.storage.from("manuals")
              .createSignedUrl(sanitizedPath, 300, { download: safeFilename });
            if (!error2 && data2?.signedUrl) signedUrl = data2.signedUrl;
          }
        }
      }
      if (!signedUrl) {
        const msg = isAdmin
          ? `Arquivo não encontrado. Path: "${manual.file_path}". Exclua e reenvie.`
          : "Arquivo não disponível. Contacte o administrador.";
        toast.error(msg, { duration: 8000 }); return;
      }
      const a = document.createElement("a");
      a.href = signedUrl; a.download = safeFilename; a.target = "_blank"; a.rel = "noopener noreferrer";
      document.body.appendChild(a); a.click();
      setTimeout(() => { if (document.body.contains(a)) document.body.removeChild(a); }, 200);
    } catch (err: unknown) {
      logger.error("Download error:", err); toast.error("Erro inesperado ao baixar o arquivo.");
    } finally { setDownloadingId(null); }
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return "—";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const pendingCount = queue.filter(q => q.status === "pending" || q.status === "error").length;
  const hasQueue = queue.length > 0;

  return (
    <div className="min-h-screen" style={{ background: "hsl(var(--background))" }}>
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

      <header className="border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-10">
        <div className="container mx-auto px-4 py-2.5 flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-sm font-semibold">Manuais</h1>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={toggleTheme}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors"
              title={isDark ? "Modo claro" : "Modo escuro"}
            >
              {isDark
                ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
                : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              }
            </button>
            {isAdmin && (
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setDialogOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Adicionar
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : manuals.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <div className="h-16 w-16 rounded-xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
              <BookOpen className="h-8 w-8 opacity-30" />
            </div>
            <p className="font-medium">Nenhum manual disponível</p>
            <p className="text-xs mt-1 opacity-60">Os manuais em PDF aparecerão aqui</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {manuals.map(m => (
              <div
                key={m.id}
                className="group relative rounded-xl bg-card overflow-hidden transition-all duration-300 hover:-translate-y-1"
                style={{ boxShadow: "0 1px 2px hsl(var(--border) / 0.3), 0 4px 12px -2px hsl(var(--border) / 0.15), inset 0 1px 0 hsl(0 0% 100% / 0.06)" }}
              >
                {/* Top accent bar */}
                <div className="h-0.5 bg-gradient-to-r from-transparent via-brand to-transparent opacity-60 group-hover:opacity-100 transition-opacity" />

                {/* PDF icon header */}
                <div className="px-4 pt-4 pb-3 bg-gradient-to-br from-blue-500/15 to-blue-400/5">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 rounded-xl bg-blue-500/15 flex items-center justify-center shrink-0">
                      <FileText className="h-6 w-6 text-blue-500 dark:text-blue-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-[13px] leading-tight line-clamp-2">{m.title}</p>
                      <p className="text-[11px] text-muted-foreground/60 mt-0.5 font-mono">PDF • {formatSize(m.file_size)}</p>
                    </div>
                  </div>
                </div>

                {/* Description */}
                {m.description && (
                  <div className="px-4 py-2.5 border-t border-border">
                    <p className="text-[11px] text-muted-foreground line-clamp-2">{m.description}</p>
                  </div>
                )}

                {/* Actions footer */}
                <div className={`px-3 pb-3 flex items-center gap-2 ${m.description ? "pt-1" : "pt-2 border-t border-border"}`}>
                  <Button
                    size="sm"
                    className="flex-1 h-8 gap-1.5 text-xs rounded-xl shadow-none"
                    onClick={() => handleDownload(m)}
                    disabled={downloadingId === m.id}
                  >
                    {downloadingId === m.id
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Baixando...</>
                      : <><Download className="h-3.5 w-3.5" />Baixar PDF</>
                    }
                  </Button>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-xl opacity-40 group-hover:opacity-100 transition-opacity hover:bg-destructive/10"
                      onClick={() => setDeleteTarget(m)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {isAdmin && manuals.length > 0 && (
          <p className="text-xs text-muted-foreground mt-6 text-center">
            Se um manual mostrar "Arquivo não encontrado", exclua-o e reenvie o PDF.
          </p>
        )}
      </main>

      <Dialog open={dialogOpen} onOpenChange={open => { if (!open) handleCloseDialog(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Adicionar Manuais</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 overflow-hidden flex flex-col">
            <input type="file" accept=".pdf,application/pdf" multiple ref={fileRef} onChange={handleFilesSelected} className="hidden" />

            <Button
              variant="outline"
              className="w-full gap-2 border-dashed h-16 text-muted-foreground hover:text-foreground shrink-0"
              onClick={() => fileRef.current?.click()}
              disabled={isUploadingAll}
            >
              <Upload className="h-5 w-5 shrink-0" />
              <span className="text-sm">Selecionar PDFs <span className="text-xs opacity-70">(múltiplos, máx. {MAX_FILE_SIZE_MB}MB cada)</span></span>
            </Button>

            {hasQueue && (
              <div className="space-y-2 overflow-y-auto flex-1 pr-1" style={{ maxHeight: "50vh" }}>
                {queue.map(item => (
                  <div
                    key={item.id}
                    className={`rounded-lg border p-3 space-y-2 text-sm transition-colors ${
                      item.status === "done" ? "border-green-500/40 bg-green-50/10"
                      : item.status === "error" ? "border-destructive/40 bg-destructive/5"
                      : "border-border bg-card"}`}
                  >
                    <div className="flex items-center gap-2">
                      {item.status === "uploading" && <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />}
                      {item.status === "done" && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
                      {item.status === "error" && <AlertCircle className="h-4 w-4 text-destructive shrink-0" />}
                      {item.status === "pending" && <FileText className="h-4 w-4 text-muted-foreground shrink-0" />}
                      <span className="truncate flex-1 text-xs text-muted-foreground">{item.file.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{formatSize(item.file.size)}</span>
                      {item.status !== "uploading" && item.status !== "done" && (
                        <button type="button" onClick={() => removeFromQueue(item.id)} className="shrink-0 text-muted-foreground hover:text-destructive transition-colors">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {item.status !== "done" && (
                      <div className="space-y-1">
                        <Label className="text-xs">Título *</Label>
                        <input
                          type="text" value={item.title}
                          onChange={e => updateQueueItem(item.id, { title: e.target.value, status: item.status === "error" ? "pending" : item.status, errorMsg: undefined })}
                          disabled={item.status === "uploading"} placeholder="Título do manual" maxLength={200}
                          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                        />
                      </div>
                    )}
                    {item.status !== "done" && (
                      <div className="space-y-1">
                        <Label className="text-xs">Descrição</Label>
                        <Textarea
                          value={item.description}
                          onChange={e => updateQueueItem(item.id, { description: e.target.value })}
                          disabled={item.status === "uploading"} placeholder="Descrição opcional" rows={1} className="text-xs resize-none"
                        />
                      </div>
                    )}
                    {item.status === "error" && item.errorMsg && <p className="text-xs text-destructive">{item.errorMsg}</p>}
                    {item.status === "done" && <p className="text-xs text-green-600 dark:text-green-400">✓ {item.title}</p>}
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1 shrink-0">
              <Button variant="outline" onClick={handleCloseDialog} disabled={isUploadingAll}>
                {hasQueue && queue.some(q => q.status === "done") ? "Fechar" : "Cancelar"}
              </Button>
              {hasQueue && pendingCount > 0 && (
                <Button onClick={handleUploadAll} disabled={isUploadingAll}>
                  {isUploadingAll
                    ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Enviando...</>
                    : <><Upload className="h-4 w-4 mr-1.5" />Enviar {pendingCount} arquivo{pendingCount > 1 ? "s" : ""}</>
                  }
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
