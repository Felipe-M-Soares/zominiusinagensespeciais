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

const TIPO_META: Record<FeedbackReport["tipo"], { label: string; Icon: React.ElementType; color: string }> = {
  bug:      { label: "Problema",  Icon: Bug,                   color: "text-red-600 bg-red-500/10" },
  sugestao: { label: "Sugestão",  Icon: Lightbulb,              color: "text-amber-600 bg-amber-500/10" },
  outro:    { label: "Outro",     Icon: MessageCircleQuestion,  color: "text-blue-600 bg-blue-500/10" },
};

const STATUS_LABELS: Record<FeedbackReport["status"], string> = {
  novo: "Novo", em_analise: "Em análise", resolvido: "Resolvido", arquivado: "Arquivado",
};

const STATUS_OPTIONS: FeedbackReport["status"][] = ["novo", "em_analise", "resolvido", "arquivado"];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export function FeedbackPanel({ onNovosChange }: { onNovosChange?: (n: number) => void } = {}) {
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
      setReports(Array.isArray(data) ? (data as FeedbackReport[]) : []);
    } catch {
      toast.error("Erro ao carregar feedbacks.");
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  async function handleStatusChange(id: string, status: FeedbackReport["status"]) {
    const { data, error } = await supabase.rpc("atualizar_status_feedback", { p_id: id, p_status: status });
    const result = data as { ok?: boolean; error?: string } | null;
    if (error || result?.ok === false) {
      toast.error(result?.error ?? "Erro ao atualizar status.");
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
  useEffect(() => { if (!filterStatus && !loading) onNovosChange?.(countNovo); }, [countNovo, filterStatus, loading, onNovosChange]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por mensagem ou nome…"
            aria-label="Buscar feedback"
            className="w-full h-11 pl-9 pr-3 rounded-xl border border-input bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            aria-label="Filtrar por status"
            className="h-11 flex-1 sm:flex-none px-3 rounded-xl border border-input bg-card text-sm"
          >
            <option value="">Todos os status</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
          <button
            type="button"
            onClick={fetchReports}
            disabled={loading}
            className="h-11 w-11 shrink-0 flex items-center justify-center rounded-xl border border-input bg-card hover:bg-muted/40 text-muted-foreground transition-colors"
            title="Atualizar"
            aria-label="Atualizar"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {countNovo > 0 && (
        <p className="text-xs text-muted-foreground">
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold text-amber-600 bg-amber-500/10 mr-1.5">{countNovo} novo{countNovo !== 1 ? "s" : ""}</span>
          Mude o status para “Em análise” ou “Resolvido” conforme for tratando.
        </p>
      )}

      <div className="rounded-2xl border bg-card overflow-hidden">
        {loading && reports.length === 0 ? (
          <div className="flex justify-center py-12">
            <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-2 px-6 py-12">
            <div className="h-12 w-12 rounded-2xl bg-muted flex items-center justify-center"><MessageCircleQuestion className="h-6 w-6 text-muted-foreground" /></div>
            <p className="text-sm font-semibold">Nenhum feedback encontrado</p>
            <p className="text-xs text-muted-foreground">Quando alguém usar “Reportar problema” (menu Ajuda), aparece aqui.</p>
          </div>
        ) : (
          <ul className="divide-y">
            {filtered.map(r => {
              const meta = TIPO_META[r.tipo];
              return (
                <li key={r.id} className={cn("p-3 sm:px-4 space-y-2", r.status === "novo" && "bg-amber-500/[0.04]")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0", meta.color)}>
                        <meta.Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{meta.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.user_name ?? "Desconhecido"} · {fmtDate(r.created_at)}
                          {r.pagina && <> · <span className="font-mono">{r.pagina}</span></>}
                          {r.app_version && <> · v{r.app_version}</>}
                        </p>
                      </div>
                    </div>
                    <select
                      value={r.status}
                      onChange={e => handleStatusChange(r.id, e.target.value as FeedbackReport["status"])}
                      aria-label="Status do feedback"
                      className={cn(
                        "h-9 px-2 rounded-lg border bg-background text-xs font-medium shrink-0",
                        r.status === "novo" && "border-amber-500/50 text-amber-600",
                        r.status === "resolvido" && "border-emerald-500/40 text-emerald-600"
                      )}
                    >
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </select>
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap break-words sm:pl-[46px]">{r.mensagem}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
