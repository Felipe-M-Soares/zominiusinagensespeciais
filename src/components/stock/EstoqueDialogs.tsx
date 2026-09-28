/**
 * Diálogos auxiliares do Estoque:
 *  - EscolherItemDialog: escolhe a peça para as ações rápidas da Visão geral
 *    (Registrar entrada / retirada / mover para expedição).
 *  - EstoqueBaixoDialog: peças abaixo do mínimo e expedição com menos de 100 un.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { StockItem } from "@/hooks/useStock";
import { cn } from "@/lib/utils";
import { Chip, DIALOG_CLS, FaseChip, SITUACAO_CFG, abaixoDoMinimo, fmtNum, saldoUtil, situacaoItem } from "./estoqueUi";

/** Limite histórico usado pelo alerta de expedição (antes fixo no painel). */
export const LIMITE_EXPEDICAO_BAIXA = 100;

function normalizar(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function LinhaItem({ item, onClick, extra }: { item: StockItem; onClick: () => void; extra?: React.ReactNode }) {
  const sit = situacaoItem(item);
  return (
    <li>
      <button type="button" onClick={onClick} className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-muted/50 active:bg-muted">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug line-clamp-2">{item.device.model}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
            <span className="text-xs text-muted-foreground font-mono">{item.device.reference}</span>
            {extra}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className={cn("text-lg font-bold tabular-nums leading-none", SITUACAO_CFG[sit].num)}>{fmtNum(saldoUtil(item))}</p>
          {item.min_quantity > 0 && <p className="text-[11px] text-muted-foreground">mín. {fmtNum(item.min_quantity)}</p>}
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>
    </li>
  );
}

export function EscolherItemDialog({ open, titulo, descricao, itens, onEscolher, onClose }: {
  open: boolean;
  titulo: string;
  descricao: string;
  itens: StockItem[];
  onEscolher: (i: StockItem) => void;
  onClose: () => void;
}) {
  const [busca, setBusca] = useState("");
  const lista = useMemo(() => {
    const q = normalizar(busca.trim());
    const base = [...itens].sort((a, b) => a.device.model.localeCompare(b.device.model, "pt-BR"));
    if (!q) return base.slice(0, 80);
    return base.filter(i => normalizar(`${i.device.model} ${i.device.reference} ${i.device.udi_di ?? ""} ${i.device.internal_code ?? ""}`).includes(q)).slice(0, 80);
  }, [itens, busca]);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { setBusca(""); onClose(); } }}>
      <DialogContent className={cn(DIALOG_CLS, "max-w-lg")}>
        <DialogHeader className="text-left">
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Modelo, referência ou código..." className="h-11 pl-9" autoFocus />
        </div>
        {lista.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {itens.length === 0 ? "Nenhuma peça disponível para esta ação." : "Nenhuma peça encontrada para essa busca."}
          </p>
        ) : (
          <ul className="rounded-xl border divide-y overflow-hidden">
            {lista.map(i => <LinhaItem key={i.id} item={i} onClick={() => { setBusca(""); onEscolher(i); }} />)}
          </ul>
        )}
        {itens.length > lista.length && !busca && (
          <p className="text-xs text-muted-foreground text-center">Mostrando {lista.length} de {itens.length}. Busque para encontrar outras peças.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function EstoqueBaixoDialog({ open, itens, onClose, onAbrir }: {
  open: boolean;
  itens: StockItem[];
  onClose: () => void;
  onAbrir: (i: StockItem) => void;
}) {
  const [modo, setModo] = useState<"minimo" | "expedicao">("minimo");
  const abaixoMin = useMemo(
    () => itens.filter(abaixoDoMinimo).sort((a, b) => saldoUtil(a) - saldoUtil(b)),
    [itens]
  );
  const expBaixa = useMemo(
    () => itens.filter(i => i.fase === "expedicao" && i.quantity < LIMITE_EXPEDICAO_BAIXA).sort((a, b) => a.quantity - b.quantity),
    [itens]
  );
  const lista = modo === "minimo" ? abaixoMin : expBaixa;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className={cn(DIALOG_CLS, "max-w-lg")}>
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" />Estoque baixo</DialogTitle>
          <DialogDescription>Toque numa peça para ver lotes, movimentações e ajustar o mínimo.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1 rounded-xl border bg-muted/40 p-1" role="tablist">
          {([
            ["minimo", `Abaixo do mínimo (${abaixoMin.length})`],
            ["expedicao", `Expedição < ${LIMITE_EXPEDICAO_BAIXA} un. (${expBaixa.length})`],
          ] as ["minimo" | "expedicao", string][]).map(([id, l]) => (
            <button key={id} type="button" role="tab" aria-selected={modo === id} onClick={() => setModo(id)}
              className={cn("flex-1 min-h-10 px-2 py-1.5 rounded-lg text-xs sm:text-sm font-medium", modo === id ? "bg-card shadow-sm" : "text-muted-foreground")}>
              {l}
            </button>
          ))}
        </div>
        {lista.length === 0 ? (
          <div className="py-8 text-center space-y-1">
            <p className="text-sm text-muted-foreground">
              {modo === "minimo" ? "Nenhuma peça abaixo do mínimo." : "Nenhuma peça da expedição abaixo de 100 unidades."}
            </p>
            {modo === "minimo" && (
              <p className="text-xs text-muted-foreground">Para receber alertas, defina o estoque mínimo na aba “Ajustes” de cada peça.</p>
            )}
          </div>
        ) : (
          <ul className="rounded-xl border divide-y overflow-hidden">
            {lista.map(i => (
              <LinhaItem key={i.id} item={i} onClick={() => { onClose(); onAbrir(i); }}
                extra={<><FaseChip fase={i.fase} className="text-[10px] px-1.5" />{saldoUtil(i) === 0 && <Chip className={SITUACAO_CFG.zerado.chip}>Zerado</Chip>}</>} />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
