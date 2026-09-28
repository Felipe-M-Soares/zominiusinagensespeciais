/**
 * estoqueUi — peças visuais e regras de exibição compartilhadas pelo módulo
 * Estoque (fases, situação do saldo, chips). Só apresentação: nenhuma regra
 * de negócio/gravação mora aqui.
 */
import { Package, Truck, Wrench } from "lucide-react";
import type { StockFase, StockItem } from "@/hooks/useStock";
import { cn } from "@/lib/utils";

export const FASE_CFG: Record<StockFase, {
  label: string;
  curto: string;
  Icon: React.ElementType;
  text: string;
  bg: string;
  border: string;
  descricao: string;
}> = {
  intermediaria: {
    label: "Intermediário",
    curto: "Interm.",
    Icon: Package,
    text: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/30",
    descricao: "Peças desembaladas que chegaram da produção. Registre a entrada por lote e mova para a Expedição depois de embalar.",
  },
  expedicao: {
    label: "Expedição",
    curto: "Exped.",
    Icon: Truck,
    text: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    descricao: "Peças embaladas e prontas para venda ou retirada. Pedidos do Comercial são separados daqui.",
  },
  retrabalho: {
    label: "Retrabalho",
    curto: "Retrab.",
    Icon: Wrench,
    text: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
    descricao: "Peças que voltaram da Expedição para reprocessar. Ao concluir, elas retornam para a Expedição.",
  },
};

export type Situacao = "ok" | "baixo" | "zerado";

/** Saldo que conta para a situação: na expedição desconta o que já está reservado em pedidos. */
export function saldoUtil(item: StockItem): number {
  return item.fase === "expedicao" ? item.quantity_available : item.quantity;
}

export function situacaoItem(item: StockItem): Situacao {
  const s = saldoUtil(item);
  if (s <= 0) return "zerado";
  if (item.min_quantity > 0 && s <= item.min_quantity) return "baixo";
  return "ok";
}

export function abaixoDoMinimo(item: StockItem): boolean {
  return item.min_quantity > 0 && saldoUtil(item) <= item.min_quantity;
}

export const SITUACAO_CFG: Record<Situacao, { label: string; chip: string; num: string }> = {
  ok:     { label: "OK",     chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", num: "text-foreground" },
  baixo:  { label: "Baixo",  chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400",       num: "text-amber-600 dark:text-amber-400" },
  zerado: { label: "Zerado", chip: "bg-red-500/10 text-red-700 dark:text-red-400",             num: "text-red-600 dark:text-red-400" },
};

export function Chip({ className, children, title }: { className?: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", className)}>
      {children}
    </span>
  );
}

export function FaseChip({ fase, className }: { fase: StockFase; className?: string }) {
  const c = FASE_CFG[fase];
  return (
    <Chip className={cn(c.bg, c.text, className)}>
      <c.Icon className="h-3 w-3" aria-hidden />{c.label}
    </Chip>
  );
}

export function fmtDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function fmtNum(n: number): string {
  return n.toLocaleString("pt-BR");
}

/** Classe padrão dos diálogos do módulo — cabe no celular e rola por dentro. */
export const DIALOG_CLS = "w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto rounded-2xl";
