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
  CheckCircle2, Clock, User, FileSpreadsheet, Trash2, AlertTriangle, ShieldCheck, Upload,
} from "lucide-react";
import {
  getBackupConfig, saveBackupConfig, runBackup, listBackups, downloadBackup, restoreStockBackup,
  SCHEDULE_LABELS,
} from "@/hooks/useStock";
import type { BackupConfig, BackupSchedule, StockBackup } from "@/hooks/useStock";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import i18n from "@/i18n";
import { useTranslation } from "react-i18next";

// ─── Funções de apagar histórico por módulo (admin only via RPC segura) ───────
async function clearStockMovements(): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("admin_clear_stock_movements");
  if (error) return { ok: false, error: error.message };
  const d = data as { ok?: boolean; error?: string } | null;
  return d?.ok === false ? { ok: false, error: d.error } : { ok: true };
}
async function clearComercial(): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("admin_clear_comercial");
  if (error) return { ok: false, error: error.message };
  const d = data as { ok?: boolean; error?: string } | null;
  return d?.ok === false ? { ok: false, error: d.error } : { ok: true };
}
async function clearProducao(): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("admin_clear_producao");
  if (error) return { ok: false, error: error.message };
  const d = data as { ok?: boolean; error?: string } | null;
  return d?.ok === false ? { ok: false, error: d.error } : { ok: true };
}
async function regularizarTodosDevices(): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("admin_regularizar_todos_devices");
  if (error) return { ok: false, error: error.message };
  const d = data as { ok?: boolean; error?: string } | null;
  return d?.ok === false ? { ok: false, error: d.error } : { ok: true };
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

  if (error || !items) { toast.error(i18n.t("backupPanel.toastLoadDataError")); return; }

  const bool = (v: unknown) => v === true ? i18n.t("backupPanel.xlsxHeaders.yes") : v === false ? i18n.t("backupPanel.xlsxHeaders.no") : "";

  const dataRows = (items as Record<string, unknown>[]).map((row) => {
    const d = (Array.isArray(row.device) ? row.device[0] : row.device) as Record<string, unknown> | null ?? {};
    return {
      [i18n.t("backupPanel.xlsxHeaders.model")]:        String(d.model ?? ""),
      [i18n.t("backupPanel.xlsxHeaders.reference")]:    String(d.reference ?? ""),
      "UDI-DI":             String(d.udi_di ?? ""),
      [i18n.t("backupPanel.xlsxHeaders.internalCode")]: String(d.internal_code ?? ""),
      [i18n.t("backupPanel.xlsxHeaders.classification")]: String(d.classification_code ?? ""),
      [i18n.t("backupPanel.xlsxHeaders.riskClass")]:    String(d.risk_class ?? ""),
      [i18n.t("backupPanel.xlsxHeaders.material")]:     String(d.primary_material ?? ""),
      [i18n.t("backupPanel.xlsxHeaders.sterile")]:      bool(d.sterile),
      [i18n.t("backupPanel.xlsxHeaders.singleUse")]:    bool(d.single_use),
      [i18n.t("backupPanel.xlsxHeaders.quantity")]:     Number(row.quantity ?? 0),
      [i18n.t("backupPanel.xlsxHeaders.minStock")]:     Number(row.min_quantity ?? 0),
      [i18n.t("backupPanel.xlsxHeaders.location")]:     String(row.location ?? ""),
      [i18n.t("backupPanel.xlsxHeaders.notes")]:        String(row.notes ?? ""),
      [i18n.t("backupPanel.xlsxHeaders.lastUpdate")]: row.updated_at
        ? new Date(row.updated_at as string).toLocaleDateString(i18n.t("backupPanel.localeCode"))
        : "",
    };
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(i18n.t("backupPanel.xlsxSheetStock"));
  const colWidths = [40, 18, 22, 16, 16, 14, 22, 9, 10, 12, 15, 20, 30, 20];
  const headers = Object.keys(dataRows[0] ?? {});
  ws.columns = headers.map((h, i) => ({ header: h, key: h, width: colWidths[i] ?? 16 }));
  ws.getRow(1).eachCell((cell) => {
    cell.font      = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border    = { bottom: { style: "thin", color: { argb: "FFCCCCCC" } }, right: { style: "thin", color: { argb: "FFCCCCCC" } } };
  });
  ws.getRow(1).height = 20;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  dataRows.forEach((row, rowIdx) => {
    const exRow = ws.addRow(row);
    const isEven = rowIdx % 2 === 0;
    const qty = Number(row[i18n.t("backupPanel.xlsxHeaders.quantity")]);
    const min = Number(row[i18n.t("backupPanel.xlsxHeaders.minStock")]);
    exRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber - 1];
      const isNum = key === i18n.t("backupPanel.xlsxHeaders.quantity") || key === i18n.t("backupPanel.xlsxHeaders.minStock");
      let bgArgb = isEven ? "FFF0F4FA" : "FFFFFFFF";
      let fgArgb = "FF222222";
      let bold   = false;
      if (key === i18n.t("backupPanel.xlsxHeaders.quantity")) {
        if (qty === 0)       { bgArgb = "FFFFEAEA"; fgArgb = "FFCC0000"; bold = true; }
        else if (qty <= min) { bgArgb = "FFFFF7E0"; fgArgb = "FFB45309"; bold = true; }
      }
      cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: bgArgb } };
      cell.font      = { name: "Arial", size: 10, color: { argb: fgArgb }, bold };
      cell.alignment = { horizontal: isNum ? "center" : "left", vertical: "middle" };
      cell.border    = { bottom: { style: "thin", color: { argb: "FFE0E0E0" } }, right: { style: "thin", color: { argb: "FFE0E0E0" } } };
    });
  });
  const total   = dataRows.length;
  const zerados = dataRows.filter((r) => Number(r[i18n.t("backupPanel.xlsxHeaders.quantity")]) === 0).length;
  const baixos  = dataRows.filter((r) => { const q = Number(r[i18n.t("backupPanel.xlsxHeaders.quantity")]); const m = Number(r[i18n.t("backupPanel.xlsxHeaders.minStock")]); return q > 0 && q <= m; }).length;
  const ok      = total - zerados - baixos;
  const ws2 = wb.addWorksheet(i18n.t("backupPanel.xlsxSheetSummary"));
  const indKey = i18n.t("backupPanel.xlsxSummary.indicator");
  const valKey = i18n.t("backupPanel.xlsxSummary.value");
  ws2.columns = [{ header: indKey, key: "Indicador", width: 35 }, { header: valKey, key: "Valor", width: 20 }];
  [
    { Indicador: i18n.t("backupPanel.xlsxSummary.totalPieces"),  Valor: total },
    { Indicador: i18n.t("backupPanel.xlsxSummary.okPieces"),        Valor: ok },
    { Indicador: i18n.t("backupPanel.xlsxSummary.lowPieces"),     Valor: baixos },
    { Indicador: i18n.t("backupPanel.xlsxSummary.zeroPieces"), Valor: zerados },
    { Indicador: i18n.t("backupPanel.xlsxSummary.exportDate"),          Valor: new Date().toLocaleString(i18n.t("backupPanel.localeCode")) },
  ].forEach((r) => ws2.addRow(r));
  const buf  = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `estoque-${new Date().toLocaleDateString(i18n.t("backupPanel.localeCode")).replace(/\//g, "-")}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(i18n.t("backupPanel.toastExportedExcel", { count: items.length, plural: items.length !== 1 ? "s" : "", plural2: items.length !== 1 ? "s" : "" }));
}

// ─── Componente ───────────────────────────────────────────────────────────────
export function BackupPanel({ open, onClose }: Props) {
  const { t } = useTranslation();
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
  const [restoring, setRestoring] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleteBackupsConfirm, setDeleteBackupsConfirm] = useState(false);
  const [deletingBackups, setDeletingBackups] = useState(false);
  const [regularizando, setRegularizando] = useState(false);

  // Estados de confirmação por módulo
  const [confirmModule, setConfirmModule] = useState<null | "estoque" | "comercial" | "producao">(null);
  const [clearingModule, setClearingModule] = useState(false);

  async function handleDeleteAllBackups() {
    setDeletingBackups(true);
    const { error } = await supabase.from("stock_backups").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    setDeletingBackups(false);
    if (error) { toast.error(t("backupPanel.toastDeleteBackupsError")); return; }
    toast.success(t("backupPanel.toastAllBackupsDeleted"));
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
    if (result.ok) toast.success(t("backupPanel.toastScheduleSaved"));
    else toast.error(result.error ?? t("backupPanel.toastSaveError"));
    load();
  }

  async function handleRunNow() {
    setRunning(true);
    const result = await runBackup(user?.id ?? null, displayName);
    setRunning(false);
    if (result.ok) { toast.success(t("backupPanel.toastBackupCreated")); load(); }
    else toast.error(result.error ?? t("backupPanel.toastBackupCreateError"));
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
    if (!data) { toast.error(t("backupPanel.toastDownloadError")); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `backup-estoque-${new Date(b.created_at).toLocaleDateString("pt-BR").replace(/\//g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }


  async function handleUploadBackup(file: File | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json")) {
      toast.error(t("backupPanel.toastUploadJsonOnly"));
      return;
    }
    setRestoring(true);
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as Record<string, unknown>;
      const result = await restoreStockBackup(payload);
      if (result.ok) {
        toast.success(t("backupPanel.toastRestoreSuccess"));
        load();
      } else {
        toast.error(result.error ?? t("backupPanel.toastRestoreError"));
      }
    } catch (_e) {
      toast.error(t("backupPanel.toastInvalidFile"));
    } finally {
      setRestoring(false);
    }
  }

  async function handleClearModule() {
    if (!confirmModule) return;
    setClearingModule(true);
    let result: { ok: boolean; error?: string };
    if (confirmModule === "estoque")   result = await clearStockMovements();
    else if (confirmModule === "comercial") result = await clearComercial();
    else result = await clearProducao();
    setClearingModule(false);
    if (result.ok) {
      const labels: Record<string, string> = {
        estoque: t("backupPanel.moduleLabelsShort.estoque"),
        comercial: t("backupPanel.moduleLabelsShort.comercial"),
        producao: t("backupPanel.moduleLabelsShort.producao"),
      };
      toast.success(t("backupPanel.toastModuleCleared", { module: labels[confirmModule] }));
      setConfirmModule(null);
    } else {
      toast.error(result.error ?? t("backupPanel.toastClearError"));
    }
  }

  async function handleRegularizarTodos() {
    setRegularizando(true);
    const result = await regularizarTodosDevices();
    setRegularizando(false);
    if (result.ok) toast.success(t("backupPanel.toastRegularizeSuccess"));
    else toast.error(result.error ?? t("backupPanel.toastRegularizeError"));
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleString(t("backupPanel.localeCode"), {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  }

  const moduleLabels: Record<string, { title: string; desc: string }> = {
    estoque:   { title: t("backupPanel.clearModuleTitle.estoque"), desc: t("backupPanel.clearModuleDesc.estoque") },
    comercial: { title: t("backupPanel.clearModuleTitle.comercial"),   desc: t("backupPanel.clearModuleDesc.comercial") },
    producao:  { title: t("backupPanel.clearModuleTitle.producao"), desc: t("backupPanel.clearModuleDesc.producao") },
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md p-0 rounded-2xl overflow-hidden border-border/30">
        <div className="relative px-5 pt-5 pb-3">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
          <div className="relative">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <DatabaseBackup className="h-4 w-4 text-primary" />
                  {t("backupPanel.title")}
                </span>
              </DialogTitle>
            </DialogHeader>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {t("backupPanel.subtitle")}
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
              {/* ── Exportar Excel ─────────────────────────────────────── */}
              <div className="rounded-xl border border-border/40 bg-muted/10 p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-semibold text-foreground flex items-center gap-1.5">
                      <FileSpreadsheet className="h-3.5 w-3.5 text-success" />
                      {t("backupPanel.exportExcelTitle")}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {t("backupPanel.exportExcelDesc")}
                    </p>
                  </div>
                  <Button size="sm" variant="outline"
                    className="h-8 gap-1.5 text-xs rounded-xl shrink-0 border-success/30 hover:bg-success/10 hover:text-success hover:border-success"
                    onClick={handleExportExcel} disabled={exporting}>
                    {exporting
                      ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      : <Download className="h-3.5 w-3.5" />}
                    {exporting ? t("backupPanel.exporting") : t("backupPanel.downloadXlsx")}
                  </Button>
                </div>
              </div>

              {/* ── Ações Admin ───────────────────────────────────────── */}
              {isAdmin && (
                <div className="space-y-2.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5" /> {t("backupPanel.adminActions")}
                  </p>


                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[12px] font-semibold text-foreground">{t("backupPanel.uploadBackupTitle")}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {t("backupPanel.uploadBackupDesc")}
                      </p>
                    </div>
                    <label className={cn(
                      "h-8 px-3 rounded-xl border border-primary/30 text-xs font-medium shrink-0 flex items-center gap-1.5 cursor-pointer hover:bg-primary/10 hover:text-primary transition-colors",
                      restoring && "opacity-60 pointer-events-none"
                    )}>
                      {restoring
                        ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        : <Upload className="h-3.5 w-3.5" />}
                      {restoring ? t("backupPanel.restoring") : t("backupPanel.uploadJson")}
                      <input type="file" accept="application/json,.json" className="hidden"
                        onChange={(e) => { handleUploadBackup(e.target.files?.[0] ?? null); e.currentTarget.value = ""; }} />
                    </label>
                  </div>

                  {/* Regularizar todos */}
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[12px] font-semibold text-foreground">{t("backupPanel.regularizeTitle")}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {t("backupPanel.regularizeDesc")}
                      </p>
                    </div>
                    <Button size="sm" variant="outline"
                      className="h-8 gap-1.5 text-xs rounded-xl shrink-0 border-primary/30 hover:bg-primary/10 hover:text-primary"
                      onClick={handleRegularizarTodos} disabled={regularizando}>
                      {regularizando
                        ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        : <ShieldCheck className="h-3.5 w-3.5" />}
                      {t("backupPanel.confirm")}
                    </Button>
                  </div>

                  {/* Apagar histórico por módulo */}
                  <p className="text-[11px] text-muted-foreground font-medium mt-1">{t("backupPanel.clearByModule")}</p>
                  <div className="space-y-1.5">
                    {(["estoque", "comercial", "producao"] as const).map((mod) => (
                      <div key={mod} className="rounded-xl border border-destructive/15 bg-destructive/5 p-2.5 flex items-center justify-between gap-3">
                        <p className="text-[12px] font-medium text-foreground capitalize">{mod === "estoque" ? t("backupPanel.moduleStock") : mod === "comercial" ? t("backupPanel.moduleCommercial") : t("backupPanel.moduleProduction")}</p>
                        <button type="button"
                          onClick={() => setConfirmModule(mod)}
                          className="h-7 px-2.5 rounded-lg border border-destructive/30 text-[11px] text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-1">
                          <Trash2 className="h-3 w-3" /> {t("backupPanel.delete")}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Agendamento backup ────────────────────────────────── */}
              {isAdmin && (
                <div className="space-y-2.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" /> {t("backupPanel.autoBackup")}
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
                        {t(`backupPanel.schedule.${key}`)}
                      </button>
                    ))}
                  </div>
                  {config?.last_backup && (
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {t("backupPanel.lastBackup")} {fmtDate(config.last_backup)}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1 h-9 rounded-xl text-xs"
                      onClick={handleSaveSchedule} disabled={saving}>
                      {saving
                        ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-1" />
                        : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                      {t("backupPanel.saveSchedule")}
                    </Button>
                    <Button size="sm" className="flex-1 h-9 rounded-xl text-xs gap-1.5"
                      onClick={handleRunNow} disabled={running}>
                      {running
                        ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        : <RefreshCw className="h-3.5 w-3.5" />}
                      {t("backupPanel.runNow")}
                    </Button>
                  </div>
                </div>
              )}

              {/* ── Lista de backups ──────────────────────────────────── */}
              {isAdmin && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {t("backupPanel.savedBackups", { count: backups.length })}
                    </p>
                    {backups.length > 0 && (
                      <button type="button" onClick={() => setDeleteBackupsConfirm(true)}
                        title={t("backupPanel.deleteAllBackupsTitle")}
                        className="h-6 w-6 flex items-center justify-center rounded-lg text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  {backups.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">{t("backupPanel.noBackupsYet")}</p>
                  )}
                  <div className="space-y-1.5 max-h-[180px] overflow-y-auto">
                    {backups.map((b) => (
                      <div key={b.id}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border/40 bg-card hover:bg-accent/20 transition-colors">
                        <DatabaseBackup className="h-4 w-4 text-primary/60 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-medium">{fmtDate(b.created_at)}</p>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            <span>{t("backupPanel.recordsCount", { count: b.item_count, plural: b.item_count !== 1 ? "s" : "" })}</span>
                            {b.created_name && (
                              <span className="flex items-center gap-0.5">
                                <User className="h-2.5 w-2.5" />{b.created_name}
                              </span>
                            )}
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                          title={t("backupPanel.downloadJson")} onClick={() => handleDownload(b)}
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

    {/* Modal confirmação — apagar módulo específico */}
    {confirmModule && createPortal(
      <div className="fixed inset-0 z-[10000] pointer-events-auto flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <div className="w-full max-w-sm rounded-2xl bg-card border border-destructive/30 p-5 space-y-4 shadow-2xl pointer-events-auto" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-sm font-bold text-destructive">{moduleLabels[confirmModule].title}</p>
              <p className="text-[12px] text-muted-foreground mt-1">{moduleLabels[confirmModule].desc}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setConfirmModule(null)} disabled={clearingModule}
              className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors">
              {t("backupPanel.cancel")}
            </button>
            <button type="button" disabled={clearingModule} onClick={handleClearModule}
              className="flex-1 h-9 rounded-xl bg-destructive text-destructive-foreground text-sm font-bold hover:bg-destructive/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5">
              {clearingModule
                ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                : <Trash2 className="h-3.5 w-3.5" />}
              {t("backupPanel.delete")}
            </button>
          </div>
        </div>
      </div>
    , document.body)}

    {/* Modal confirmação — apagar backups */}
    {deleteBackupsConfirm && createPortal(
      <div className="fixed inset-0 z-[10000] pointer-events-auto flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <div className="w-full max-w-sm rounded-2xl bg-card border border-destructive/30 p-5 space-y-4 shadow-2xl pointer-events-auto" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-sm font-bold text-destructive">{t("backupPanel.deleteAllBackupsConfirmTitle")}</p>
              <p className="text-[12px] text-muted-foreground mt-1">
                {t("backupPanel.deleteAllBackupsConfirmDesc")} <strong>{backups.length} {t("backupPanel.deleteAllBackupsConfirmStrong")}</strong> {t("backupPanel.deleteAllBackupsConfirmEnd")}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setDeleteBackupsConfirm(false)} disabled={deletingBackups}
              className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors">
              {t("backupPanel.cancel")}
            </button>
            <button type="button" disabled={deletingBackups} onClick={handleDeleteAllBackups}
              className="flex-1 h-9 rounded-xl bg-destructive text-destructive-foreground text-sm font-bold hover:bg-destructive/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5">
              {deletingBackups
                ? <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                : <Trash2 className="h-3.5 w-3.5" />}
              {t("backupPanel.deleteBackupsAction")}
            </button>
          </div>
        </div>
      </div>
    , document.body)}
    </>
  );
}
