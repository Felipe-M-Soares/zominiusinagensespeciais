/**
 * ListaItensEstoque — lista das peças de uma fase.
 * Celular: cards com saldo grande e ação principal (h-11).
 * Desktop: lista densa em colunas dentro de um card (divide-y).
 * Tocar/clicar na peça abre o detalhe (lotes, movimentações, ajustes).
 */
import { memo } from "react";
import { ArrowDownCircle, ArrowUpCircle, ChevronRight, MapPin, PackageCheck, Tag, Truck, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StockFase, StockItem } from "@/hooks/useStock";
import { cn } from "@/lib/utils";
import { Chip, SITUACAO_CFG, fmtNum, saldoUtil, situacaoItem } from "./estoqueUi";

interface Props {
  fase: StockFase;
  items: StockItem[];
  loteMap: Map<string, number>;
  onAbrir: (i: StockItem) => void;
  onEntrada: (i: StockItem) => void;
  onSaida: (i: StockItem) => void;
  onTransferir: (i: StockItem) => void;
  onRetrabalho: (i: StockItem) => void;
  onConcluir: (i: StockItem) => void;
}

function acoesDaFase(fase: StockFase, item: StockItem, p: Props) {
  if (fase === "intermediaria") return {
    principal: { label: "Entrada", Icon: ArrowDownCircle, onClick: () => p.onEntrada(item), disabled: false },
    secundaria: { label: "Mover p/ Expedição", curto: "Expedição", Icon: Truck, onClick: () => p.onTransferir(item), disabled: item.quantity === 0 },
  };
  if (fase === "expedicao") return {
    principal: { label: "Retirada", Icon: ArrowUpCircle, onClick: () => p.onSaida(item), disabled: item.quantity === 0 },
    secundaria: { label: "Retrabalho", curto: "Retrabalho", Icon: Wrench, onClick: () => p.onRetrabalho(item), disabled: item.quantity === 0 },
  };
  return {
    principal: { label: "Concluir → Expedição", Icon: PackageCheck, onClick: () => p.onConcluir(item), disabled: item.quantity === 0 },
    secundaria: null,
  };
}

export const ListaItensEstoque = memo(function ListaItensEstoque(props: Props) {
  const { fase, items, loteMap, onAbrir } = props;
  const exp = fase === "expedicao";
  const cols = exp
    ? "grid-cols-[minmax(0,1fr)_4rem_6rem_7rem_auto] xl:grid-cols-[minmax(0,1fr)_9rem_4rem_5rem_6rem_7rem_auto]"
    : "grid-cols-[minmax(0,1fr)_4rem_7rem_auto] xl:grid-cols-[minmax(0,1fr)_9rem_4rem_5rem_7rem_auto]";

  return (
    <>
      {/* Celular: cards */}
      <ul className="lg:hidden grid gap-2 sm:grid-cols-2">
        {items.map(item => {
          const sit = situacaoItem(item);
          const lotes = loteMap.get(item.id) ?? 0;
          const a = acoesDaFase(fase, item, props);
          return (
            <li key={item.id} className="rounded-2xl border bg-card overflow-hidden">
              <button type="button" onClick={() => onAbrir(item)} className="w-full text-left p-3 flex items-start gap-3 active:bg-muted/50">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug line-clamp-2">{item.device.model}</p>
                  <p className="text-xs text-muted-foreground font-mono truncate">{item.device.reference}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {sit !== "ok" && <Chip className={SITUACAO_CFG[sit].chip}>{SITUACAO_CFG[sit].label}</Chip>}
                    {lotes > 0 && <Chip className="bg-muted text-muted-foreground"><Tag className="h-3 w-3" />{lotes} lote{lotes > 1 ? "s" : ""}</Chip>}
                    {exp && item.quantity_reserved > 0 && <Chip className="bg-amber-500/15 text-amber-700 dark:text-amber-400">{fmtNum(item.quantity_reserved)} reserv.</Chip>}
                    {item.location && <Chip className="bg-muted text-muted-foreground max-w-[10rem]"><MapPin className="h-3 w-3 shrink-0" /><span className="truncate">{item.location}</span></Chip>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className={cn("text-2xl font-bold tabular-nums leading-none", SITUACAO_CFG[sit].num)}>{fmtNum(saldoUtil(item))}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{exp ? "disponível" : "un."}</p>
                  {item.min_quantity > 0 && <p className="text-[11px] text-muted-foreground">mín. {fmtNum(item.min_quantity)}</p>}
                </div>
              </button>
              <div className={cn("grid gap-2 px-3 pb-3", a.secundaria ? "grid-cols-2" : "grid-cols-1")}>
                <Button className="h-11 gap-1.5" onClick={a.principal.onClick} disabled={a.principal.disabled}>
                  <a.principal.Icon className="h-4 w-4" />{a.principal.label}
                </Button>
                {a.secundaria && (
                  <Button variant="outline" className="h-11 gap-1.5" onClick={a.secundaria.onClick} disabled={a.secundaria.disabled}>
                    <a.secundaria.Icon className="h-4 w-4" />{a.secundaria.curto}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Desktop: lista densa */}
      <div className="hidden lg:block rounded-2xl border bg-card overflow-hidden">
        <div className={cn(
          "grid items-center gap-3 px-4 py-2 border-b bg-muted/40 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
          cols
        )}>
          <span>Peça</span><span className="hidden xl:block">Localização</span><span className="text-right">Lotes</span><span className="hidden xl:block text-right">Mínimo</span>
          {exp && <span className="text-right">Reservado</span>}
          <span className="text-right">{exp ? "Disponível" : "Saldo"}</span>
          <span className="w-[17rem] text-right">Ações</span>
        </div>
        <ul className="divide-y">
          {items.map(item => {
            const sit = situacaoItem(item);
            const lotes = loteMap.get(item.id) ?? 0;
            const a = acoesDaFase(fase, item, props);
            return (
              <li key={item.id}
                className={cn(
                  "grid items-center gap-3 px-4 py-2.5 hover:bg-muted/40 cursor-pointer",
                  cols
                )}
                onClick={() => onAbrir(item)}
              >
                <div className="min-w-0">
                  <p className="font-medium truncate" title={item.device.model}>{item.device.model}</p>
                  <p className="text-xs text-muted-foreground font-mono truncate">{item.device.reference}{item.device.brand_name ? ` · ${item.device.brand_name}` : ""}</p>
                </div>
                <span className="hidden xl:block text-sm text-muted-foreground truncate" title={item.location ?? ""}>{item.location || "—"}</span>
                <span className="text-sm tabular-nums text-right">{lotes || "—"}</span>
                <span className="hidden xl:block text-sm tabular-nums text-right text-muted-foreground">{item.min_quantity || "—"}</span>
                {exp && <span className={cn("text-sm tabular-nums text-right", item.quantity_reserved > 0 ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground")}>{item.quantity_reserved || "—"}</span>}
                <div className="flex items-center justify-end gap-2">
                  {sit !== "ok" && <Chip className={SITUACAO_CFG[sit].chip}>{SITUACAO_CFG[sit].label}</Chip>}
                  <span className={cn("text-lg font-bold tabular-nums", SITUACAO_CFG[sit].num)}>{fmtNum(saldoUtil(item))}</span>
                </div>
                <div className="w-[17rem] flex items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
                  <Button size="sm" className="h-9 gap-1.5" onClick={a.principal.onClick} disabled={a.principal.disabled}>
                    <a.principal.Icon className="h-4 w-4" />{a.principal.label}
                  </Button>
                  {a.secundaria && (
                    <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={a.secundaria.onClick} disabled={a.secundaria.disabled} title={a.secundaria.label}>
                      <a.secundaria.Icon className="h-4 w-4" />{a.secundaria.curto}
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => onAbrir(item)} aria-label="Abrir detalhe">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
});
