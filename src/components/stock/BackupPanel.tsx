import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  DatabaseBackup, Download, RefreshCw, Calendar,
  CheckCircle2, Clock, User, FileSpreadsheet, Trash2, AlertTriangle,
} from "lucide-react";
import {
  getBackupConfig, saveBackupConfig, runBackup, listBackups, downloadBackup,
  SCHEDULE_LABELS,
} from "@/hooks/useStock";
import type { BackupConfig, BackupSchedule, StockBackup } from "@/hooks/useStock";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";


// ─── Apagar todo o histórico ─────────────────────────────────────────────────
// usa a RPC server-side admin_clear_history que:
// 1. Verifica role admin no banco (não pode ser bypassado pelo frontend)
// 2. Executa todas as deleções em uma única transação atômica
async function clearAllHistory(): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("admin_clear_history");
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

interface Props {
  open: boolean;
  onClose: () => void;
}

// ─── Export Excel (.xlsx via ExcelJS) ────────────────────────────────────────
async function exportExcel() {
  const ExcelJS = (await import("exceljs")).default;
  const { data: items, error } = await supabase
    .from("stock_items")
    .select(`
      quantity, min_quantity, location, notes, updated_at,
      device:devices(model, reference, udi_di, internal_code,
        classification_code, risk_class, primary_material, sterile, single_use)
    `)
    .order("updated_at", { ascending: false });

  if (error || !items) {
    toast.error("Erro ao buscar dados do estoque.");
    return;
  }

  const bool = (v: unknown) => v === true ? "Sim" : v === false ? "Não" : "";

  const dataRows = (items as Record<string, unknown>[]).map((row) => {
    const d = (Array.isArray(row.device) ? row.device[0] : row.device) as Record<string, unknown> | null ?? {};
    return {
      "Modelo":             String(d.model ?? ""),
      "Referência":         String(d.reference ?? ""),
      "UDI-DI":             String(d.udi_di ?? ""),
      "Cód. Interno":       String(d.internal_code ?? ""),
      "Classificação":      String(d.classification_code ?? ""),
      "Classe de Risco":    String(d.risk_class ?? ""),
      "Material":           String(d.primary_material ?? ""),
      "Estéril":            bool(d.sterile),
      "Uso Único":          bool(d.single_use),
      "Quantidade":         Number(row.quantity ?? 0),
      "Estoque Mínimo":     Number(row.min_quantity ?? 0),
      "Localização":        String(row.location ?? ""),
      "Observações":        String(row.notes ?? ""),
      "Última Atualização": row.updated_at
        ? new Date(row.updated_at as string).toLocaleDateString("pt-BR")
        : "",
    };
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Estoque");

  const colWidths = [40, 18, 22, 16, 16, 14, 22, 9, 10, 12, 15, 20, 30, 20];
  const headers = Object.keys(dataRows[0] ?? {});

  ws.columns = headers.map((h, i) => ({ header: h, key: h, width: colWidths[i] ?? 16 }));

  // Estilo do cabeçalho
  ws.getRow(1).eachCell((cell) => {
    cell.font      = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border    = {
      bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
      right:  { style: "thin", color: { argb: "FFCCCCCC" } },
    };
  });
  ws.getRow(1).height = 20;
  ws.views = [{ state: "frozen", ySplit: 1 }];

  // Linhas de dados
  dataRows.forEach((row, rowIdx) => {
    const exRow = ws.addRow(row);
    const isEven = rowIdx % 2 === 0;
    const qty = Number(row["Quantidade"]);
    const min = Number(row["Estoque Mínimo"]);

    exRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber - 1];
      const isNum = key === "Quantidade" || key === "Estoque Mínimo";

      let bgArgb = isEven ? "FFF0F4FA" : "FFFFFFFF";
      let fgArgb = "FF222222";
      let bold   = false;

      if (key === "Quantidade") {
        if (qty === 0)           { bgArgb = "FFFFEAEA"; fgArgb = "FFCC0000"; bold = true; }
        else if (qty <= min)     { bgArgb = "FFFFF7E0"; fgArgb = "FFB45309"; bold = true; }
      }

      cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: bgArgb } };
      cell.font      = { name: "Arial", size: 10, color: { argb: fgArgb }, bold };
      cell.alignment = { horizontal: isNum ? "center" : "left", vertical: "middle" };
      cell.border    = {
        bottom: { style: "thin", color: { argb: "FFE0E0E0" } },
        right:  { style: "thin", color: { argb: "FFE0E0E0" } },
      };
    });
  });

  // Aba Resumo
  const total   = dataRows.length;
  const zerados = dataRows.filter((r) => Number(r["Quantidade"]) === 0).length;
  const baixos  = dataRows.filter((r) => { const q = Number(r["Quantidade"]); const m = Number(r["Estoque Mínimo"]); return q > 0 && q <= m; }).length;
  const ok      = total - zerados - baixos;

  const ws2 = wb.addWorksheet("Resumo");
  ws2.columns = [{ header: "Indicador", key: "Indicador", width: 35 }, { header: "Valor", key: "Valor", width: 20 }];
  [
    { Indicador: "Total de peças no estoque",  Valor: total },
    { Indicador: "Peças com estoque OK",        Valor: ok },
    { Indicador: "Peças com estoque baixo",     Valor: baixos },
    { Indicador: "Peças zeradas (sem estoque)", Valor: zerados },
    { Indicador: "Data de exportação",          Valor: new Date().toLocaleString("pt-BR") },
  ].forEach((r) => ws2.addRow(r));

  // Gera buffer e dispara download
  const buf  = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `estoque-${new Date().toLocaleDateString("pt-BR").replace(/\//g, "-")}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(`${items.length} peça${items.length !== 1 ? "s" : ""} exportada${items.length !== 1 ? "s" : ""} para Excel (.xlsx).`);
}

// ─── Componente ───────────────────────────────────────────────────────────────
export function BackupPanel({ open, onClose }: Props) {
  const { user, isAdmin } = useAuth();
  const displayName: string | null =
    (user?.user_metadata?.display_name as string) ?? user?.email ?? null;

  const [config, setConfig]     = useState<BackupConfig | null>(null);
  const [schedule, setSchedule] = useState<BackupSchedule>("mon_thu");
  const [backups, setBackups]   = useState<StockBackup[]>([]);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [running, setRunning]   = useState(false);
  const [exporting, setExporting] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [deleteBackupsConfirm, setDeleteBackupsConfirm] = useState(false);
  const [deletingBackups, setDeletingBackups] = useState(false);

  async function handleDeleteAllBackups() {
    setDeletingBackups(true);
    const { error } = await supabase
      .from("stock_backups")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    setDeletingBackups(false);
    if (error) { toast.error("Erro ao apagar backups."); return; }
    toast.success("Todos os backups foram apagados.");
    setDeleteBackupsConfirm(false);
    load();
  }

  async function load() {
    setLoading(true);
    const [cfg, list] = await Promise.all([getBackupConfig(), listBackups(15)]);
    if (cfg) { setConfig(cfg); setSchedule(cfg.schedule); }
    setBackups(list);
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    if (open) {
      setLoading(true);
      Promise.all([getBackupConfig(), listBackups(15)]).then(([cfg, list]) => {
        if (cancelled) return;
        if (cfg) { setConfig(cfg); setSchedule(cfg.schedule); }
        setBackups(list);
        setLoading(false);
      }).catch(() => { if (!cancelled) setLoading(false); });
    }
    return () => { cancelled = true; };
  }, [open]);

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

  async function handleExportExcel() {
    setExporting(true);
    await exportExcel();
    setExporting(false);
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
    a.download = `backup-estoque-${new Date(b.created_at).toLocaleDateString("pt-BR").replace(/\//g, "-")}.json`;
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
    <>
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md p-0 rounded-2xl overflow-hidden border-border/30">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-3">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
          <div className="relative">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <DatabaseBackup className="h-4 w-4 text-primary" />
                  Backup e Exportação
                </span>

              </DialogTitle>
            </DialogHeader>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Snapshots e planilha do estoque atual
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
              {/* ── Exportar Excel ────────────────────────────────────────── */}
              <div className="rounded-xl border border-border/40 bg-muted/10 p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-semibold text-foreground flex items-center gap-1.5">
                      <FileSpreadsheet className="h-3.5 w-3.5 text-success" />
                      Exportar Planilha Excel
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Todas as peças com quantidade atual, localização e dados do dispositivo.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-xs rounded-xl shrink-0 border-success/30 hover:bg-success/10 hover:text-success hover:border-success"
                    onClick={handleExportExcel}
                    disabled={exporting}
                  >
                    {exporting
                      ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      : <Download className="h-3.5 w-3.5" />}
                    {exporting ? "Exportando..." : "Baixar .xlsx"}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground/50">
                  Planilha Excel formatada com cabeçalho, cores por status e aba de resumo.
                </p>
              </div>

              {/* ── Agendamento — admin apenas ────────────────────────────── */}
              {isAdmin && (
                <div className="space-y-2.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" /> Backup automático
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(Object.keys(SCHEDULE_LABELS) as BackupSchedule[]).map((key) => (
                      <button key={key} type="button" onClick={() => setSchedule(key)}
                        className={cn(
                          "h-9 px-3 rounded-xl border text-[12px] font-medium transition-all text-left",
                          schedule === key
                            ? "bg-primary/10 border-primary/40 text-primary"
                            : "bg-background border-border text-muted-foreground hover:bg-muted/30"
                        )}>
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
                    <Button variant="outline" size="sm" className="flex-1 h-9 rounded-xl text-xs"
                      onClick={handleSaveSchedule} disabled={saving}>
                      {saving
                        ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-1" />
                        : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                      Salvar agendamento
                    </Button>
                    <Button size="sm" className="flex-1 h-9 rounded-xl text-xs gap-1.5"
                      onClick={handleRunNow} disabled={running}>
                      {running
                        ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        : <RefreshCw className="h-3.5 w-3.5" />}
                      Fazer backup agora
                    </Button>
                  </div>
                </div>
              )}

              {/* ── Lista de backups ──────────────────────────────────────── */}
              {isAdmin && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Backups salvos ({backups.length})
                    </p>
                    {backups.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setDeleteBackupsConfirm(true)}
                        title="Apagar todos os backups"
                        className="h-6 w-6 flex items-center justify-center rounded-lg text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>

                  {backups.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Nenhum backup criado ainda
                    </p>
                  )}

                  <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
                    {backups.map((b) => (
                      <div key={b.id}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border/40 bg-card hover:bg-accent/20 transition-colors">
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
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                          title="Baixar JSON" onClick={() => handleDownload(b)}
                          disabled={downloading === b.id}>
                          {downloading === b.id
                            ? <div className="h-3.5 w-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                            : <Download className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </>
          )}

        </div>
      </DialogContent>
    </Dialog>

    {/* Modal de confirmação — apagar histórico */}
    {clearConfirm && createPortal(
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-2xl bg-card border border-destructive/30 p-5 space-y-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-sm font-bold text-destructive">Apagar todo o histórico?</p>
              <p className="text-[12px] text-muted-foreground mt-1">
                Isso vai apagar <strong>todos os movimentos</strong>, pedidos comerciais e zerar o estoque de todas as peças. Esta ação <strong>não pode ser desfeita</strong>.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setClearConfirm(false)} disabled={clearing}
              className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors">
              Cancelar
            </button>
            <button type="button" disabled={clearing}
              onClick={async () => {
                setClearing(true);
                const result = await clearAllHistory();
                setClearing(false);
                if (result.ok) {
                  toast.success("Histórico apagado com sucesso.");
                  setClearConfirm(false);
                  onClose();
                } else {
                  toast.error(result.error ?? "Erro ao apagar histórico.");
                }
              }}
              className="flex-1 h-9 rounded-xl bg-destructive text-destructive-foreground text-sm font-bold hover:bg-destructive/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
            >
              {clearing
                ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                : <Trash2 className="h-3.5 w-3.5" />}
              Apagar tudo
            </button>
          </div>
        </div>
      </div>
    , document.body)}

    {/* Modal de confirmação — apagar backups */}
    {deleteBackupsConfirm && createPortal(
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-2xl bg-card border border-destructive/30 p-5 space-y-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-sm font-bold text-destructive">Apagar todos os backups?</p>
              <p className="text-[12px] text-muted-foreground mt-1">
                Todos os <strong>{backups.length} backups salvos</strong> serão removidos permanentemente. Esta ação <strong>não pode ser desfeita</strong>.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setDeleteBackupsConfirm(false)} disabled={deletingBackups}
              className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors">
              Cancelar
            </button>
            <button type="button" disabled={deletingBackups} onClick={handleDeleteAllBackups}
              className="flex-1 h-9 rounded-xl bg-destructive text-destructive-foreground text-sm font-bold hover:bg-destructive/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
            >
              {deletingBackups
                ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                : <Trash2 className="h-3.5 w-3.5" />}
              Apagar backups
            </button>
          </div>
        </div>
      </div>
    , document.body)}
    </>
  );
}
