import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  DatabaseBackup, Download, RefreshCw, Calendar, CheckCircle2, Clock, User
} from "lucide-react";
import {
  getBackupConfig, saveBackupConfig, runBackup, listBackups, downloadBackup,
  SCHEDULE_LABELS,
} from "@/hooks/useStock";
import type { BackupConfig, BackupSchedule, StockBackup } from "@/hooks/useStock";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function BackupPanel({ open, onClose }: Props) {
  const { user, isAdmin } = useAuth();
  const displayName: string | null =
    (user?.user_metadata?.display_name as string) ?? user?.email ?? null;

  const [config, setConfig]       = useState<BackupConfig | null>(null);
  const [schedule, setSchedule]   = useState<BackupSchedule>("mon_thu");
  const [backups, setBackups]     = useState<StockBackup[]>([]);
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [running, setRunning]     = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [cfg, list] = await Promise.all([getBackupConfig(), listBackups(15)]);
    if (cfg) { setConfig(cfg); setSchedule(cfg.schedule); }
    setBackups(list);
    setLoading(false);
  }

  useEffect(() => { if (open) load(); }, [open]);

  async function handleSaveSchedule() {
    setSaving(true);
    const result = await saveBackupConfig(schedule);
    setSaving(false);
    if (result.ok) toast.success("Agendamento salvo.");
    else toast.error(result.error ?? "Erro ao salvar.");
    load();
  }

  async function handleRunNow() {
    setRunning(true);
    const result = await runBackup(user?.id ?? null, displayName);
    setRunning(false);
    if (result.ok) { toast.success("Backup criado com sucesso!"); load(); }
    else toast.error(result.error ?? "Erro ao criar backup.");
  }

  async function handleDownload(b: StockBackup) {
    setDownloading(b.id);
    const data = await downloadBackup(b.id);
    setDownloading(null);
    if (!data) { toast.error("Erro ao baixar backup."); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `backup-estoque-${new Date(b.created_at).toLocaleDateString("pt-BR").replace(/\//g,"-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md p-0 rounded-2xl overflow-hidden border-border/30">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-3">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
          <div className="relative">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
                <DatabaseBackup className="h-4 w-4 text-primary" />
                Backup do Estoque
              </DialogTitle>
            </DialogHeader>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Snapshots salvos no banco de dados Supabase
            </p>
          </div>
        </div>

        <div className="px-5 pb-5 space-y-5">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          )}

          {!loading && (
            <>
              {/* Agendamento — apenas admin */}
              {isAdmin && (
                <div className="space-y-2.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" /> Agendamento automático
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(Object.keys(SCHEDULE_LABELS) as BackupSchedule[]).map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSchedule(key)}
                        className={cn(
                          "h-9 px-3 rounded-xl border text-[12px] font-medium transition-all text-left",
                          schedule === key
                            ? "bg-primary/10 border-primary/40 text-primary"
                            : "bg-background border-border text-muted-foreground hover:bg-muted/30"
                        )}
                      >
                        {SCHEDULE_LABELS[key]}
                      </button>
                    ))}
                  </div>

                  {config?.last_backup && (
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      Último backup: {fmtDate(config.last_backup)}
                    </p>
                  )}

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-9 rounded-xl text-xs"
                      onClick={handleSaveSchedule}
                      disabled={saving}
                    >
                      {saving
                        ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-1" />
                        : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                      Salvar agendamento
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1 h-9 rounded-xl text-xs gap-1.5"
                      onClick={handleRunNow}
                      disabled={running}
                    >
                      {running
                        ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        : <RefreshCw className="h-3.5 w-3.5" />}
                      Fazer backup agora
                    </Button>
                  </div>
                </div>
              )}

              {/* Lista de backups */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Backups salvos ({backups.length})
                </p>

                {backups.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Nenhum backup criado ainda
                  </p>
                )}

                <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
                  {backups.map((b) => (
                    <div
                      key={b.id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border/40 bg-card hover:bg-accent/20 transition-colors"
                    >
                      <DatabaseBackup className="h-4 w-4 text-primary/60 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium">{fmtDate(b.created_at)}</p>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span>{b.item_count} peça{b.item_count !== 1 ? "s" : ""}</span>
                          {b.created_name && (
                            <span className="flex items-center gap-0.5">
                              <User className="h-2.5 w-2.5" />{b.created_name}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        title="Baixar JSON"
                        onClick={() => handleDownload(b)}
                        disabled={downloading === b.id}
                      >
                        {downloading === b.id
                          ? <div className="h-3.5 w-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                          : <Download className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
