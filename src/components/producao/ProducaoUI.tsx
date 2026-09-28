/**
 * Peças visuais compartilhadas pelos painéis de Produção (KPI, seção, estados
 * vazio/carregando, controle segmentado, confirmação destrutiva, estilos de
 * gráfico). Mantém todas as abas no mesmo padrão do app (Financeiro,
 * Planejamento): rounded-2xl, inputs h-11 no celular, cores semânticas.
 */
import type { ReactNode } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

// ── Classes de formulário ─────────────────────────────────────────────────────
export const lblCls = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";
export const selCls = "w-full h-11 rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";
export const txtCls = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring";

export function Campo({ label, children, className, dica }: { label: ReactNode; children: ReactNode; className?: string; dica?: ReactNode }) {
  return (
    <div className={cn("space-y-1.5 min-w-0", className)}>
      <label className={cn(lblCls, "block")}>{label}</label>
      {children}
      {dica && <p className="text-[11px] text-muted-foreground">{dica}</p>}
    </div>
  );
}

// ── Cores semânticas por percentual (OEE, disponibilidade, qualidade…) ───────
export type Tom = "ok" | "atencao" | "ruim" | "neutro";
export const tomPct = (v: number | null | undefined, bom = 85, medio = 65): Tom =>
  v == null || !isFinite(v) ? "neutro" : v >= bom ? "ok" : v >= medio ? "atencao" : "ruim";
export const TOM_TXT: Record<Tom, string> = {
  ok: "text-green-600 dark:text-green-400",
  atencao: "text-amber-600 dark:text-amber-400",
  ruim: "text-red-600 dark:text-red-400",
  neutro: "text-foreground",
};
export const TOM_BAR: Record<Tom, string> = {
  ok: "bg-green-500", atencao: "bg-amber-500", ruim: "bg-red-500", neutro: "bg-primary",
};
/** Cores para gráficos (recharts) — funcionam em claro e escuro. */
export const COR = {
  ok: "hsl(142 71% 42%)",
  atencao: "hsl(38 92% 50%)",
  ruim: "hsl(0 72% 55%)",
  primaria: "hsl(var(--chart-1))",
  roxo: "hsl(var(--chart-4))",
  verde: "hsl(var(--chart-3))",
  laranja: "hsl(var(--chart-2))",
  plano: "hsl(var(--muted-foreground) / 0.35)",
};
export const PALETA = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))",
  "hsl(199 40% 60%)", "hsl(330 65% 55%)", "hsl(172 60% 40%)"];
export const corTom = (t: Tom) => (t === "ok" ? COR.ok : t === "atencao" ? COR.atencao : t === "ruim" ? COR.ruim : COR.primaria);

export const tooltipStyle = {
  background: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))",
  border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12,
};
export const eixoTick = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
export const gradeCor = "hsl(var(--border))";

export const fmtInt = (v: number) => Math.round(v || 0).toLocaleString("pt-BR");
export const fmtPct1 = (v: number) => `${(v || 0).toFixed(1).replace(".", ",")}%`;
export const fmtHorasCurto = (h: number) => {
  const tot = Math.round((h || 0) * 60), hh = Math.floor(tot / 60), mm = tot % 60;
  if (hh === 0) return `${mm}min`;
  return mm ? `${hh}h${String(mm).padStart(2, "0")}` : `${hh}h`;
};

// ── KPI ──────────────────────────────────────────────────────────────────────
export function KpiCard({ label, value, sub, Icon, tom = "neutro", subTom, onClick, progresso, ativo, className }: {
  label: string; value: ReactNode; sub?: ReactNode; Icon?: React.ElementType; tom?: Tom; subTom?: Tom;
  onClick?: () => void; progresso?: { pct: number; tom?: Tom } | null; ativo?: boolean; className?: string;
}) {
  const conteudo = (
    <>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}<span className="truncate">{label}</span>
      </p>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums leading-tight", TOM_TXT[tom])}>{value}</p>
      {progresso && (
        <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
          <div className={cn("h-full rounded-full transition-all", TOM_BAR[progresso.tom ?? tom])} style={{ width: `${Math.max(0, Math.min(100, progresso.pct))}%` }} />
        </div>
      )}
      {sub && <p className={cn("mt-1 text-xs", subTom && subTom !== "neutro" ? cn(TOM_TXT[subTom], "font-medium") : "text-muted-foreground")}>{sub}</p>}
    </>
  );
  const base = cn("rounded-2xl border bg-card p-3.5 sm:p-4 text-left min-w-0", ativo && "border-primary ring-1 ring-primary/30", className);
  return onClick
    ? <button type="button" onClick={onClick} aria-pressed={ativo} className={cn(base, "hover:border-primary/40 hover:shadow-sm transition")}>{conteudo}</button>
    : <div className={base}>{conteudo}</div>;
}

// ── Seção (card com cabeçalho) ───────────────────────────────────────────────
export function Secao({ titulo, Icon, acao, children, className, corpo, sub }: {
  titulo: ReactNode; Icon?: React.ElementType; acao?: ReactNode; children: ReactNode; className?: string; corpo?: string; sub?: ReactNode;
}) {
  return (
    <section className={cn("rounded-2xl border bg-card min-w-0", className)}>
      <div className="px-4 py-3 border-b flex items-center gap-2 min-h-[3rem]">
        {Icon && <Icon className="h-4 w-4 text-primary shrink-0" />}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm leading-tight">{titulo}</h3>
          {sub && <p className="text-xs text-muted-foreground leading-tight mt-0.5">{sub}</p>}
        </div>
        {acao}
      </div>
      <div className={cn("p-4", corpo)}>{children}</div>
    </section>
  );
}

// ── Estados ──────────────────────────────────────────────────────────────────
export function Carregando({ texto = "Carregando...", className }: { texto?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground", className)}>
      <Loader2 className="h-4 w-4 animate-spin" />{texto}
    </div>
  );
}

export function Vazio({ Icon, titulo, dica, acao, className }: {
  Icon: React.ElementType; titulo: string; dica?: ReactNode; acao?: ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-1.5 px-4 py-12 text-center", className)}>
      <Icon className="h-9 w-9 text-muted-foreground/40 mb-1" />
      <p className="text-sm font-medium">{titulo}</p>
      {dica && <p className="text-xs text-muted-foreground max-w-sm">{dica}</p>}
      {acao && <div className="mt-2">{acao}</div>}
    </div>
  );
}

// ── Controles ────────────────────────────────────────────────────────────────
export function Segmentado<T extends string | number>({ opcoes, valor, onChange, ariaLabel, className, cheio }: {
  opcoes: { v: T; l: ReactNode; n?: number; tom?: "ruim" }[]; valor: T; onChange: (v: T) => void; ariaLabel: string; className?: string; cheio?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("flex rounded-xl border bg-muted/40 p-1 gap-1", cheio && "w-full", className)}>
      {opcoes.map(o => (
        <button key={String(o.v)} type="button" role="radio" aria-checked={valor === o.v} onClick={() => onChange(o.v)}
          className={cn("h-9 px-3 rounded-lg text-sm font-medium whitespace-nowrap inline-flex items-center justify-center gap-1.5 transition-colors",
            cheio && "flex-1 min-w-0 px-2",
            valor === o.v ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
          {o.l}
          {o.n !== undefined && o.n > 0 && (
            <span className={cn("min-w-5 h-5 px-1 rounded-full text-[11px] font-bold inline-flex items-center justify-center",
              o.tom === "ruim" ? "bg-red-500/15 text-red-600" : "bg-primary/15 text-primary")}>{o.n}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function BotaoAtualizar({ onClick, loading, className }: { onClick: () => void; loading?: boolean; className?: string }) {
  return (
    <Button variant="outline" size="icon" className={cn("h-11 w-11 shrink-0", className)} onClick={onClick} disabled={loading} aria-label="Atualizar" title="Atualizar">
      <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
    </Button>
  );
}

/** Barra "real × meta" com marcador da meta. */
export function BarraMeta({ label, real, meta, fmt = fmtPct1, dica }: {
  label: ReactNode; real: number; meta: number; fmt?: (v: number) => string; dica?: ReactNode;
}) {
  const ok = real >= meta;
  const escala = Math.max(real, meta) * 1.1 || 1;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium truncate">{label}</span>
        <span className="shrink-0 tabular-nums">
          <strong className={ok ? TOM_TXT.ok : TOM_TXT.ruim}>{fmt(real)}</strong>
          <span className="text-xs text-muted-foreground"> / meta {fmt(meta)}</span>
        </span>
      </div>
      <div className="relative h-2.5 rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", ok ? "bg-green-500" : "bg-red-500")} style={{ width: `${Math.min(100, (real / escala) * 100)}%` }} />
        <div className="absolute -top-1 -bottom-1 w-0.5 rounded bg-foreground/70" style={{ left: `${Math.min(100, (meta / escala) * 100)}%` }} aria-hidden />
      </div>
      {dica && <p className="text-[11px] text-muted-foreground">{dica}</p>}
    </div>
  );
}

// ── Confirmação destrutiva ───────────────────────────────────────────────────
export function Confirmar({ aberto, titulo, descricao, acao = "Excluir", onConfirmar, onCancelar, carregando }: {
  aberto: boolean; titulo: string; descricao?: ReactNode; acao?: string;
  onConfirmar: () => void; onCancelar: () => void; carregando?: boolean;
}) {
  return (
    <AlertDialog open={aberto} onOpenChange={o => { if (!o) onCancelar(); }}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          {descricao && <AlertDialogDescription>{descricao}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="h-11" disabled={carregando}>Voltar</AlertDialogCancel>
          <AlertDialogAction className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={carregando}
            onClick={e => { e.preventDefault(); onConfirmar(); }}>
            {carregando && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}{acao}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Datas ─────────────────────────────────────────────────────────────────────
export const MESES_CURTOS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function isoDiaLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
