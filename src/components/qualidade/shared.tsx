/**
 * Peças visuais e consultas compartilhadas pelas abas da Qualidade.
 * Segue o padrão das telas já reformuladas (Financeiro/Comercial):
 * containers rounded-2xl border bg-card, chips rounded-full, busca h-11.
 */
import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ─── Tons semânticos ─────────────────────────────────────────────────────────

export type Tom = "neutro" | "ok" | "atencao" | "perigo" | "info" | "roxo" | "laranja" | "ciano";

export const TOM_CHIP: Record<Tom, string> = {
  neutro:  "bg-muted text-muted-foreground border-border",
  ok:      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  atencao: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  perigo:  "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
  info:    "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30",
  roxo:    "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/30",
  laranja: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30",
  ciano:   "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/30",
};

const TOM_VALOR: Record<Tom, string> = {
  neutro: "", ok: "text-emerald-700 dark:text-emerald-400", atencao: "text-amber-600 dark:text-amber-400",
  perigo: "text-red-600 dark:text-red-400", info: "text-blue-600 dark:text-blue-400", roxo: "text-violet-600 dark:text-violet-400",
  laranja: "text-orange-600 dark:text-orange-400", ciano: "text-cyan-600 dark:text-cyan-400",
};

export function Chip({ tom = "neutro", children, className, title }: { tom?: Tom; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", TOM_CHIP[tom], className)}>
      {children}
    </span>
  );
}

// ─── KPI clicável ────────────────────────────────────────────────────────────

export function KpiCard({ label, value, sub, Icon, tom = "neutro", ativo, onClick }: {
  label: string; value: ReactNode; sub?: ReactNode; Icon?: React.ElementType; tom?: Tom; ativo?: boolean; onClick?: () => void;
}) {
  const conteudo = (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}<span className="leading-tight">{label}</span>
      </p>
      <p className={cn("mt-1 text-xl sm:text-2xl font-bold tabular-nums", TOM_VALOR[tom])}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{sub}</p>}
    </>
  );
  if (!onClick) return <div className="rounded-2xl border bg-card p-4 min-w-0">{conteudo}</div>;
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo}
      className={cn("text-left rounded-2xl border bg-card p-4 min-w-0 flex flex-col justify-start transition hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        ativo && "border-primary/60 ring-1 ring-primary/30")}>
      {conteudo}
    </button>
  );
}

// ─── Busca ───────────────────────────────────────────────────────────────────

export function CampoBusca({ value, onChange, placeholder, onEnter, className, autoFocus }: {
  value: string; onChange: (v: string) => void; placeholder: string; onEnter?: () => void; className?: string; autoFocus?: boolean;
}) {
  return (
    <div className={cn("relative flex-1 min-w-[12rem]", className)}>
      <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <Input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
        onKeyDown={e => { if (e.key === "Enter") onEnter?.(); }}
        className="h-11 pl-9 pr-9" aria-label={placeholder} />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Limpar busca"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// ─── Seletor segmentado (sub-visões dentro de uma aba) ───────────────────────

export function Segmentado<T extends string>({ opcoes, valor, onChange, className }: {
  opcoes: { id: T; label: string; count?: number }[]; valor: T; onChange: (v: T) => void; className?: string;
}) {
  return (
    <div className={cn("flex gap-1 rounded-xl border bg-muted/40 p-1 max-w-full overflow-x-auto scrollbar-none", className)} role="tablist">
      {opcoes.map(o => (
        <button key={o.id} type="button" role="tab" aria-selected={valor === o.id} onClick={() => onChange(o.id)}
          className={cn("h-10 px-3 sm:px-4 rounded-lg text-sm font-medium whitespace-nowrap flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5",
            valor === o.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
          {o.label}
          {o.count !== undefined && (
            <span className={cn("text-[11px] tabular-nums rounded-full px-1.5 min-w-[1.25rem]", valor === o.id ? "bg-primary/15 text-primary" : "bg-muted")}>{o.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Estado vazio ────────────────────────────────────────────────────────────

export function Vazio({ Icon, titulo, dica, acao }: { Icon: React.ElementType; titulo: string; dica?: ReactNode; acao?: ReactNode }) {
  return (
    <div className="py-12 px-4 text-center space-y-2">
      <Icon className="h-8 w-8 mx-auto text-muted-foreground/40" />
      <p className="text-sm font-medium">{titulo}</p>
      {dica && <p className="text-xs text-muted-foreground max-w-sm mx-auto">{dica}</p>}
      {acao && <div className="pt-2">{acao}</div>}
    </div>
  );
}

export function ListaSkeleton({ linhas = 5 }: { linhas?: number }) {
  return (
    <div className="divide-y">
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="p-4 space-y-2">
          <div className="h-4 w-1/2 rounded bg-muted animate-pulse" />
          <div className="h-3 w-1/3 rounded bg-muted/70 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// ─── Barra de etapas (mesmo visual do PedidoCard do Comercial) ───────────────

export function Etapas({ etapas, atual, tom = "primary", concluido }: {
  etapas: string[]; atual: number; tom?: "primary" | "ok" | "perigo" | "atencao"; concluido?: boolean;
}) {
  const cor = { primary: "bg-primary", ok: "bg-emerald-500", perigo: "bg-red-500", atencao: "bg-amber-500" }[tom];
  return (
    <div className="flex items-start gap-1" aria-label={`Etapa: ${etapas[Math.min(atual, etapas.length - 1)]}`}>
      {etapas.map((e, i) => (
        <div key={e} className="flex-1 min-w-0 space-y-1">
          <div className={cn("h-1.5 rounded-full", i < atual || (concluido && i <= atual) ? cor : i === atual ? cn(cor, "opacity-60") : "bg-muted")} />
          <p className={cn("text-[10px] text-center truncate", i === atual ? "font-semibold text-foreground" : "text-muted-foreground")}>{e}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Campo de formulário ─────────────────────────────────────────────────────

export function Campo({ label, children, className, dica }: { label: string; children: ReactNode; className?: string; dica?: ReactNode }) {
  return (
    <label className={cn("block space-y-1.5 min-w-0", className)}>
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
      {dica}
    </label>
  );
}

export const SELECT_CLS = "h-11 w-full rounded-xl border border-input bg-background px-3 text-sm disabled:opacity-60 disabled:cursor-not-allowed";

// ─── Datas ───────────────────────────────────────────────────────────────────

export function fmtDia(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

export function fmtDiaHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// ─── Recall (status de rastreabilidade pós-venda) ────────────────────────────

export type StatusRecall = "normal" | "alerta" | "recall_ativo" | "devolvido";
export const RECALL_INFO: Record<StatusRecall, { label: string; tom: Tom; dot: string; dica: string }> = {
  normal:       { label: "Normal",       tom: "ok",      dot: "bg-emerald-500",           dica: "Nenhuma ação necessária" },
  alerta:       { label: "Em alerta",    tom: "atencao", dot: "bg-amber-500",             dica: "Lote sob observação — acompanhe" },
  recall_ativo: { label: "Recall ativo", tom: "perigo",  dot: "bg-red-500 animate-pulse", dica: "Contatar o cliente e recolher o produto" },
  devolvido:    { label: "Devolvido",    tom: "neutro",  dot: "bg-muted-foreground",      dica: "Produto já voltou para a fábrica" },
};
export const STATUS_RECALL: StatusRecall[] = ["normal", "alerta", "recall_ativo", "devolvido"];
export function recallInfo(s: string) { return RECALL_INFO[s as StatusRecall] ?? RECALL_INFO.normal; }

// ─── Resumo (Visão geral + badges das abas) ──────────────────────────────────

export interface DevolucaoResumo { id: string; tipo: string; cliente_nome: string; nf_original_numero: string | null; valor_total: number; created_at: string }
export interface RecallResumo { id: string; lote: string; device_ref: string; device_model: string; cliente_nome: string; quantidade: number; status_recall: string; data_envio: string }
export interface VencendoResumo { id: string; model: string; reference: string; dias_ate_vencer: number; data_vencimento_anvisa: string | null }

export interface ResumoQualidade {
  aRegularizar: number;
  emProcesso: number;
  vencendo: VencendoResumo[];
  vencendoTotal: number;
  devolucoes: DevolucaoResumo[];
  recalls: RecallResumo[];
  retrabalhoPecas: number;
  retrabalhoItens: number;
}

export async function carregarResumo(): Promise<ResumoQualidade> {
  const [aReg, emProc, venc, dev, rec, retr] = await Promise.all([
    supabase.from("devices_regularizacao").select("id", { count: "exact", head: true }).lt("fase_atual", 5),
    supabase.from("devices_regularizacao").select("id", { count: "exact", head: true }).eq("status_regularizacao", "em_processo"),
    supabase.from("devices_regularizacao").select("id,model,reference,dias_ate_vencer,data_vencimento_anvisa", { count: "exact" })
      .lt("dias_ate_vencer", 365).order("dias_ate_vencer", { ascending: true }).limit(6),
    supabase.from("notas_devolucao_troca").select("id,tipo,cliente_nome,nf_original_numero,valor_total,created_at")
      .like("status_msg", "[QUALIDADE:em_analise]%").order("created_at", { ascending: true }).limit(100),
    supabase.from("rastreabilidade_pos_venda").select("id,lote,device_ref,device_model,cliente_nome,quantidade,status_recall,data_envio")
      .in("status_recall", ["alerta", "recall_ativo"]).order("data_envio", { ascending: false }).limit(1000),
    supabase.from("stock_items").select("quantity").eq("fase", "retrabalho").gt("quantity", 0).limit(5000),
  ]);
  const vencRows = (venc.data ?? []) as unknown as VencendoResumo[];
  const retrRows = (retr.data ?? []) as { quantity: number }[];
  return {
    aRegularizar: aReg.count ?? 0,
    emProcesso: emProc.count ?? 0,
    vencendo: vencRows,
    vencendoTotal: venc.count ?? vencRows.length,
    devolucoes: ((dev.data ?? []) as unknown as DevolucaoResumo[]).map(d => ({ ...d, valor_total: Number(d.valor_total ?? 0) })),
    recalls: (rec.data ?? []) as unknown as RecallResumo[],
    retrabalhoPecas: retrRows.reduce((s, r) => s + (r.quantity ?? 0), 0),
    retrabalhoItens: retrRows.length,
  };
}
