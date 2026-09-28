/**
 * AuditLogPanel — Visualizador do audit_log para admins.
 * Usa a tabela audit_log já existente em 20260027000000_estoque.sql.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
import { Search, RefreshCw, Shield, Download } from "lucide-react";
import { cn } from "@/lib/utils";

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

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export function AuditLogPanel() {
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
      [fmtDate(e.created_at), e.user_name ?? "", e.action, e.entity_type ?? "", e.entity_id ?? ""].join(",")
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toLocaleDateString("pt-BR").replace(/\//g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const uniqueActions = [...new Set(entries.map((e) => e.action))].sort();

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por usuário, ação…"
            aria-label="Buscar no log"
            className="w-full pl-9 pr-3 h-11 text-sm rounded-xl border border-input bg-card focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={filterAction}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filtrar por ação"
            className="h-11 min-w-0 flex-1 sm:flex-none sm:max-w-[220px] px-3 text-sm rounded-xl border border-input bg-card focus:outline-none"
          >
            <option value="">Todas as ações</option>
            {uniqueActions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button
            type="button"
            onClick={fetchLogs}
            disabled={loading}
            aria-label="Atualizar"
            title="Atualizar"
            className="h-11 w-11 shrink-0 rounded-xl border border-input bg-card flex items-center justify-center hover:bg-muted/40 transition-colors"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={filtered.length === 0}
            className="h-11 px-3 shrink-0 rounded-xl border border-input bg-card text-sm flex items-center gap-1.5 hover:bg-muted/40 transition-colors disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Exportar</span> CSV
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {filtered.length} {filtered.length === 1 ? "registro" : "registros"}
        {filtered.length < entries.length && ` (de ${entries.length})`} · mostra os 200 mais recentes. Toque num registro para ver os detalhes.
      </p>

      <div className="rounded-2xl border bg-card overflow-hidden">
        {loading && entries.length === 0 ? (
          <div className="flex justify-center py-12">
            <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
            <Shield className="h-8 w-8 opacity-30" />
            <p className="text-sm">Nenhum registro encontrado</p>
          </div>
        ) : (
          <ul className="divide-y">
            {filtered.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  aria-expanded={expanded === e.id}
                  className="w-full grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,14rem)_1fr_auto] items-center gap-x-3 gap-y-1 px-3 sm:px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                >
                  <span className={cn("justify-self-start max-w-full truncate px-2 py-0.5 rounded-full text-xs font-semibold", getActionStyle(e.action))}>
                    {e.action}
                  </span>
                  <span className="text-[11px] text-muted-foreground tabular-nums sm:order-last">{fmtDate(e.created_at)}</span>
                  <span className="col-span-2 sm:col-span-1 text-sm text-foreground truncate">
                    {e.user_name ?? e.user_id?.slice(0, 8) ?? "sistema"}
                    {e.entity_type && <span className="text-muted-foreground"> · {e.entity_type}</span>}
                  </span>
                </button>
                {expanded === e.id && (
                  <div className="px-3 sm:px-4 pb-3">
                    {e.details
                      ? <pre className="text-[11px] text-muted-foreground bg-muted/40 rounded-xl p-3 overflow-x-auto max-h-60">{JSON.stringify(e.details, null, 2)}</pre>
                      : <p className="text-xs text-muted-foreground">Sem detalhes adicionais.</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
