/**
 * ItemEstoqueDialog — detalhe de uma peça do estoque.
 *
 * Reúne o que antes ficava espalhado em 3 modais (Lotes, Histórico e o card):
 *  - saldo da fase (disponível / reservado / mínimo) e dados da peça
 *  - ações da fase (Entrada, Mover p/ Expedição, Retirada, Retrabalho, Concluir)
 *  - abas Lotes · Movimentações · Ajustes (mínimo, localização, observações)
 *  - zona de risco (admin): zerar saldo e histórico / remover do estoque
 */
import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownCircle, ArrowUpCircle, History, Loader2, MapPin, PackageCheck, Save,
  Settings2, ShieldAlert, Tag, Trash2, Truck, Wrench,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { StockItem } from "@/hooks/useStock";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/errorMessages";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { countryFlag } from "@/components/DeviceCard";
import { LotesDoItem } from "./LotesPanel";
import { HistoricoDoItem } from "./StockHistoryPanel";
import { Chip, DIALOG_CLS, FaseChip, SITUACAO_CFG, fmtNum, situacaoItem } from "./estoqueUi";

export type AbaDetalhe = "lotes" | "movimentacoes" | "ajustes";

export interface AcoesItem {
  onEntrada: (i: StockItem) => void;
  onSaida: (i: StockItem) => void;
  onTransferir: (i: StockItem) => void;
  onRetrabalho: (i: StockItem) => void;
  onConcluir: (i: StockItem) => void;
  onZerar: (i: StockItem) => void;
  onRemover: (i: StockItem) => void;
}

interface Props {
  item: StockItem | null;
  abaInicial?: AbaDetalhe;
  onClose: () => void;
  onChanged: () => void;
  acoes: AcoesItem;
  isAdmin: boolean;
  podeEditar: boolean;
}

export function ItemEstoqueDialog({ item, abaInicial = "lotes", onClose, onChanged, acoes, isAdmin, podeEditar }: Props) {
  const [aba, setAba] = useState<AbaDetalhe>(abaInicial);
  const [aoVivo, setAoVivo] = useState<{ qty: number; reserved: number } | null>(null);

  useEffect(() => { if (item) { setAba(abaInicial); setAoVivo(null); } }, [item?.id, abaInicial]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAoVivo = useCallback((v: { qty: number; reserved: number }) => setAoVivo(v), []);

  if (!item) return null;
  const d = item.device;
  const sit = situacaoItem(item);
  const qty = aoVivo?.qty ?? item.quantity;
  const reservado = aoVivo?.reserved ?? item.quantity_reserved;
  const disponivel = Math.max(0, qty - reservado);

  // Fecha o detalhe antes de abrir o modal da ação (evita dois diálogos empilhados no celular)
  const agir = (fn: (i: StockItem) => void) => () => { const i = item; onClose(); fn(i); };

  const tiles = item.fase === "expedicao"
    ? [
        { l: "Disponível", v: disponivel, cls: SITUACAO_CFG[sit].num },
        { l: "Reservado", v: reservado, cls: reservado > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground" },
        { l: "Mínimo", v: item.min_quantity, cls: "text-muted-foreground" },
      ]
    : [
        { l: item.fase === "retrabalho" ? "Em retrabalho" : "Saldo", v: qty, cls: SITUACAO_CFG[sit].num },
        { l: "Mínimo", v: item.min_quantity, cls: "text-muted-foreground" },
      ];

  return (
    <Dialog open={!!item} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className={cn(DIALOG_CLS, "max-w-2xl p-0 gap-0")}>
        <div className="p-4 sm:p-5 space-y-4 border-b">
          <DialogHeader className="text-left space-y-1 pr-8">
            <div className="flex flex-wrap items-center gap-1.5">
              <FaseChip fase={item.fase} />
              <Chip className={SITUACAO_CFG[sit].chip}>{SITUACAO_CFG[sit].label}</Chip>
              {d.classification_code && <Chip className="bg-muted text-muted-foreground">Classe {d.classification_code}</Chip>}
            </div>
            <DialogTitle className="text-lg leading-snug">{d.model}</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {d.reference}{d.brand_name ? ` · ${d.brand_name}` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className={cn("grid gap-2", tiles.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
            {tiles.map(t => (
              <div key={t.l} className="rounded-xl border bg-card px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t.l}</p>
                <p className={cn("text-2xl font-bold tabular-nums leading-tight", t.cls)}>{fmtNum(t.v)}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {item.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{item.location}</span>}
            {d.udi_di && <span className="font-mono">UDI {d.udi_di}</span>}
            {d.anvisa_registration && <span className="font-mono">ANVISA {d.anvisa_registration}</span>}
            {d.manufacturer_country && <span>{countryFlag(d.manufacturer_country)} {d.manufacturer_country}</span>}
          </div>

          {/* Ações da fase — grandes, fáceis de tocar */}
          <div className="grid grid-cols-2 gap-2">
            {item.fase === "intermediaria" && (
              <>
                <Button className="h-11 gap-2" onClick={agir(acoes.onEntrada)}><ArrowDownCircle className="h-4 w-4" />Entrada</Button>
                <Button variant="outline" className="h-11 gap-2" onClick={agir(acoes.onTransferir)} disabled={item.quantity === 0}><Truck className="h-4 w-4" /><span className="sm:hidden">Expedição</span><span className="hidden sm:inline">Mover p/ Expedição</span></Button>
              </>
            )}
            {item.fase === "expedicao" && (
              <>
                <Button className="h-11 gap-2" onClick={agir(acoes.onSaida)} disabled={item.quantity === 0}><ArrowUpCircle className="h-4 w-4" />Retirada</Button>
                <Button variant="outline" className="h-11 gap-2" onClick={agir(acoes.onRetrabalho)} disabled={item.quantity === 0}><Wrench className="h-4 w-4" /><span className="sm:hidden">Retrabalho</span><span className="hidden sm:inline">Enviar p/ retrabalho</span></Button>
              </>
            )}
            {item.fase === "retrabalho" && (
              <Button className="h-11 gap-2 col-span-2" onClick={agir(acoes.onConcluir)} disabled={item.quantity === 0}><PackageCheck className="h-4 w-4" />Concluir retrabalho → Expedição</Button>
            )}
          </div>
        </div>

        {/* Abas */}
        <div className="px-4 sm:px-5 pt-3">
          <div className="flex gap-1 rounded-xl border bg-muted/40 p-1" role="tablist">
            {([
              ["lotes", "Lotes", Tag],
              ["movimentacoes", "Movimentações", History],
              ["ajustes", "Ajustes", Settings2],
            ] as [AbaDetalhe, string, React.ElementType][]).map(([id, l, Icon]) => (
              <button key={id} type="button" role="tab" aria-selected={aba === id} onClick={() => setAba(id)}
                className={cn("flex-1 h-10 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-1.5",
                  aba === id ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                <Icon className="h-4 w-4 hidden sm:block" />{l}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          {aba === "lotes" && <LotesDoItem item={item} onAoVivo={handleAoVivo} />}
          {aba === "movimentacoes" && <HistoricoDoItem item={item} podeEditar={podeEditar} onChanged={onChanged} />}
          {aba === "ajustes" && (
            <AjustesItem item={item} podeEditar={podeEditar} onSaved={onChanged} />
          )}

          {isAdmin && aba === "ajustes" && (
            <div className="mt-5 rounded-xl border border-red-500/30 p-3 space-y-2">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-red-600 dark:text-red-400"><ShieldAlert className="h-4 w-4" />Zona de risco (administrador)</p>
              <p className="text-xs text-muted-foreground">Ações irreversíveis. Use apenas para corrigir cadastros feitos por engano.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Button variant="outline" className="h-10 gap-1.5 text-amber-700 dark:text-amber-400" onClick={agir(acoes.onZerar)}><PackageCheck className="h-4 w-4" />Zerar saldo e histórico</Button>
                <Button variant="outline" className="h-10 gap-1.5 text-red-600 dark:text-red-400" onClick={agir(acoes.onRemover)}><Trash2 className="h-4 w-4" />Remover do estoque</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Ajustes: mínimo, localização e observações (RPC update_stock_item_settings) ──

function AjustesItem({ item, podeEditar, onSaved }: { item: StockItem; podeEditar: boolean; onSaved: () => void }) {
  const [min, setMin] = useState(String(item.min_quantity ?? 0));
  const [local, setLocal] = useState(item.location ?? "");
  const [obs, setObs] = useState(item.notes ?? "");
  const [salvando, setSalvando] = useState(false);
  // No retrabalho o campo notes guarda o lote de origem ("lote:XXXX | ...") — não editar.
  const obsBloqueada = item.fase === "retrabalho";

  useEffect(() => {
    setMin(String(item.min_quantity ?? 0));
    setLocal(item.location ?? "");
    setObs(item.notes ?? "");
  }, [item.id, item.min_quantity, item.location, item.notes]);

  const minNum = Math.max(0, Math.min(999_999, parseInt(min || "0", 10) || 0));
  const mudou = minNum !== item.min_quantity || local.trim() !== (item.location ?? "") || (!obsBloqueada && obs.trim() !== (item.notes ?? ""));

  async function salvar() {
    setSalvando(true);
    const { error } = await supabase.rpc("update_stock_item_settings", {
      p_item_id: item.id,
      p_min_qty: minNum,
      p_location: local.trim(),
      p_notes: obsBloqueada ? null : obs.trim(),
    });
    setSalvando(false);
    if (error) { toast.error(friendlyError(error, "Não foi possível salvar. Verifique se seu perfil pode alterar o estoque.")); return; }
    toast.success("Ajustes salvos.");
    onSaved();
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Estoque mínimo (un.)</span>
          <Input value={min} onChange={e => setMin(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" className="h-11" disabled={!podeEditar} />
          <span className="block text-[11px] text-muted-foreground">Abaixo disso a peça aparece como “Baixo”. Use 0 para não alertar.</span>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Localização</span>
          <Input value={local} onChange={e => setLocal(e.target.value.slice(0, 80))} placeholder="Ex.: Prateleira B3, gaveta 2" className="h-11" disabled={!podeEditar} />
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Observações</span>
        <Textarea value={obs} onChange={e => setObs(e.target.value.slice(0, 500))} rows={3} disabled={!podeEditar || obsBloqueada}
          placeholder="Anotações internas sobre esta peça" />
        {obsBloqueada && <span className="block text-[11px] text-muted-foreground">No retrabalho este campo guarda o lote de origem e não pode ser alterado.</span>}
      </label>
      {podeEditar ? (
        <div className="flex justify-end">
          <Button className="h-11 gap-1.5 w-full sm:w-auto" onClick={salvar} disabled={!mudou || salvando}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Salvar ajustes
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Seu perfil pode consultar, mas não alterar estes dados.</p>
      )}
    </div>
  );
}
