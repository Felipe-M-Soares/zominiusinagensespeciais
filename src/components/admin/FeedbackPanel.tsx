/**
 * FeedbackPanel — Visualizador de feedback/bug reports para admins.
 * Lê via RPC listar_feedback_reports() (nunca SELECT * direto — ver
 * 20260041000000_feedback_reports.sql para o desenho de RLS).
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Bug, Lightbulb, MessageCircleQuestion, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface FeedbackReport {
  id: string;
  user_id: string | null;
  user_name: string | null;
  tipo: "bug" | "sugestao" | "outro";
  mensagem: string;
  pagina: string | null;
  app_version: string | null;
  status: "novo" | "em_analise" | "resolvido" | "arquivado";
  created_at: string;
}

function buildTipoMeta(t: (k: string) => string): Record<FeedbackReport["tipo"], { label: string; Icon: React.ElementType; color: string }> {
  return {
  bug:      { label: t("feedbackPanel.type.bug"),  Icon: Bug,                   color: "text-red-600 bg-red-500/10" },
  sugestao: { label: t("feedbackPanel.type.sugestao"),  Icon: Lightbulb,              color: "text-amber-600 bg-amber-500/10" },
  outro:    { label: t("feedbackPanel.type.outro"),     Icon: MessageCircleQuestion,  color: "text-blue-600 bg-blue-500/10" },
  };
}

function buildStatusLabels(t: (k: string) => string): Record<FeedbackReport["status"], string> {
  return {
  novo: t("feedbackPanel.status.novo"), em_analise: t("feedbackPanel.status.em_analise"), resolvido: t("feedbackPanel.status.resolvido"), arquivado: t("feedbackPanel.status.arquivado"),
  };
}

const STATUS_OPTIONS: FeedbackReport["status"][] = ["novo", "em_analise", "resolvido", "arquivado"];

function fmtDate(iso: string, locale: string) {
  return new Date(iso).toLocaleString(locale, {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export function FeedbackPanel() {
  const { t } = useTranslation();
  const TIPO_META = buildTipoMeta(t);
  const STATUS_LABELS = buildStatusLabels(t);
  const [reports, setReports] = useState<FeedbackReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [search, setSearch] = useState("");

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("listar_feedback_reports", {
        p_status: filterStatus || undefined,
      });
      if (error) throw error;
      setReports((data as FeedbackReport[]) ?? []);
    } catch {
      toast.error(t("feedbackPanel.toastLoadError"));
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  async function handleStatusChange(id: string, status: FeedbackReport["status"]) {
    const { data, error } = await supabase.rpc("atualizar_status_feedback", { p_id: id, p_status: status });
    const result = data as { ok?: boolean; error?: string } | null;
    if (error || result?.ok === false) {
      toast.error(result?.error ?? t("feedbackPanel.toastStatusError"));
      return;
    }
    setReports(prev => prev.map(r => r.id === id ? { ...r, status } : r));
  }

  const filtered = reports.filter(r => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return r.mensagem.toLowerCase().includes(q) || (r.user_name ?? "").toLowerCase().includes(q);
  });

  const countNovo = reports.filter(r => r.status === "novo").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("feedbackPanel.searchPlaceholder")}
            className="w-full h-9 pl-8 pr-3 rounded-lg border border-border bg-background text-[12px] focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="h-9 px-2 rounded-lg border border-border bg-background text-[12px]"
        >
          <option value="">{t("feedbackPanel.allStatuses")}</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <button
          onClick={fetchReports}
          disabled={loading}
          className="h-9 w-9 flex items-center justify-center rounded-lg border border-border hover:bg-muted/40 text-muted-foreground transition-colors"
          title={t("feedbackPanel.refresh")}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
        {countNovo > 0 && (
          <span className="text-[11px] font-semibold text-amber-600 bg-amber-500/10 px-2 py-1 rounded-full">
            {countNovo} {t("feedbackPanel.newSuffix", { plural: countNovo !== 1 ? "s" : "" })}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {loading && reports.length === 0 && (
          <div className="flex justify-center py-10">
            <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-10 text-sm text-muted-foreground">{t("feedbackPanel.noFeedbackFound")}</div>
        )}
        {filtered.map(r => {
          const meta = TIPO_META[r.tipo];
          return (
            <div key={r.id} className="rounded-xl border border-border/50 bg-card p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center shrink-0", meta.color)}>
                    <meta.Icon className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold">{meta.label}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {r.user_name ?? t("feedbackPanel.unknown")} · {fmtDate(r.created_at, t("feedbackPanel.localeCode"))}
                      {r.pagina && <> · <span className="font-mono">{r.pagina}</span></>}
                      {r.app_version && <> · v{r.app_version}</>}
                    </p>
                  </div>
                </div>
                <select
                  value={r.status}
                  onChange={e => handleStatusChange(r.id, e.target.value as FeedbackReport["status"])}
                  className="h-7 px-2 rounded-md border border-border bg-background text-[10px] shrink-0"
                >
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </div>
              <p className="text-[12px] text-foreground whitespace-pre-wrap pl-9">{r.mensagem}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
