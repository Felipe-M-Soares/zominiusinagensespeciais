/**
 * AuditLogPanel — Visualizador do audit_log para admins.
 * Usa a tabela audit_log já existente em 20260027000000_estoque.sql.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
import { Search, RefreshCw, Shield, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface AuditEntry {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

const ACTION_COLORS: Record<string, string> = {
  faturar_pedido:    "text-emerald-600 bg-emerald-500/10",
  delete:            "text-destructive bg-destructive/10",
  admin_clear:       "text-orange-600 bg-orange-500/10",
  create:            "text-blue-600 bg-blue-500/10",
  update:            "text-violet-600 bg-violet-500/10",
};

function getActionStyle(action: string) {
  for (const [key, cls] of Object.entries(ACTION_COLORS)) {
    if (action.includes(key)) return cls;
  }
  return "text-muted-foreground bg-muted/50";
}

function fmtDate(iso: string, locale: string) {
  return new Date(iso).toLocaleString(locale, {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export function AuditLogPanel() {
  const { t } = useTranslation();
  const [entries, setEntries]     = useState<AuditEntry[]>([]);
  const [loading, setLoading]     = useState(false);
  const [search, setSearch]       = useState("");
  const [filterAction, setFilter] = useState("");
  const [expanded, setExpanded]   = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("audit_log")
        .select("id,user_id,user_name,action,entity_type,entity_id,details,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (filterAction) query = query.eq("action", filterAction);
      const { data, error } = await query;
      if (error) throw error;
      setEntries((data as AuditEntry[]) ?? []);
    } catch (err) {
      logger.error("AuditLogPanel: erro ao buscar logs", err);
    } finally {
      setLoading(false);
    }
  }, [filterAction]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const filtered = entries.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.action.toLowerCase().includes(q) ||
      (e.user_name ?? "").toLowerCase().includes(q) ||
      (e.entity_type ?? "").toLowerCase().includes(q)
    );
  });

  // Exporta CSV
  function handleExport() {
    const header = "data,usuario,acao,entidade,entity_id\n";
    const rows = filtered.map((e) =>
      [fmtDate(e.created_at, t("auditLogPanel.localeCode")), e.user_name ?? "", e.action, e.entity_type ?? "", e.entity_id ?? ""].join(",")
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toLocaleDateString(t("auditLogPanel.localeCode")).replace(/\//g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const uniqueActions = [...new Set(entries.map((e) => e.action))].sort();

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("auditLogPanel.searchPlaceholder")}
            className="w-full pl-8 pr-3 h-8 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <select
          value={filterAction}
          onChange={(e) => setFilter(e.target.value)}
          className="h-8 px-2 text-xs rounded-lg border border-border bg-background focus:outline-none"
        >
          <option value="">{t("auditLogPanel.allActions")}</option>
          {uniqueActions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <button
          type="button"
          onClick={fetchLogs}
          disabled={loading}
          className="h-8 px-3 rounded-lg border border-border text-xs flex items-center gap-1.5 hover:bg-muted/40 transition-colors"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          {t("auditLogPanel.refresh")}
        </button>
        <button
          type="button"
          onClick={handleExport}
          className="h-8 px-3 rounded-lg border border-border text-xs flex items-center gap-1.5 hover:bg-muted/40 transition-colors"
        >
          <Download className="h-3.5 w-3.5" />
          {t("auditLogPanel.exportCsv")}
        </button>
      </div>

      {/* Contador */}
      <p className="text-[11px] text-muted-foreground">
        {filtered.length} {filtered.length === 1 ? t("auditLogPanel.recordSingular") : t("auditLogPanel.recordPlural")}
        {filtered.length < entries.length && ` ${t("auditLogPanel.ofTotal", { total: entries.length })}`}
      </p>

      {/* Lista */}
      {loading && (
        <div className="flex justify-center py-8">
          <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
          <Shield className="h-8 w-8 opacity-20" />
          <p className="text-sm">{t("auditLogPanel.noRecordsFound")}</p>
        </div>
      )}

      <div className="space-y-1">
        {filtered.map((e) => (
          <div
            key={e.id}
            className="rounded-xl border border-border/40 bg-card overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setExpanded(expanded === e.id ? null : e.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/20 transition-colors"
            >
              <span className={cn("px-2 py-0.5 rounded-md text-[10px] font-semibold shrink-0", getActionStyle(e.action))}>
                {e.action}
              </span>
              <span className="text-[12px] font-medium text-foreground truncate flex-1">
                {e.user_name ?? e.user_id?.slice(0, 8) ?? t("auditLogPanel.system")}
              </span>
              {e.entity_type && (
                <span className="text-[11px] text-muted-foreground shrink-0">{e.entity_type}</span>
              )}
              <span className="text-[10px] text-muted-foreground/60 shrink-0 ml-auto">
                {fmtDate(e.created_at, t("auditLogPanel.localeCode"))}
              </span>
            </button>

            {expanded === e.id && e.details && (
              <div className="px-3 pb-3 pt-0 border-t border-border/30">
                <pre className="text-[10px] text-muted-foreground bg-muted/30 rounded-lg p-2 overflow-x-auto max-h-40">
                  {JSON.stringify(e.details, null, 2)}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
