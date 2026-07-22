import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStock } from "@/hooks/useStock";
import { useClickOutside } from "@/hooks/useClickOutside";
import { useDebounce } from "@/hooks/useDebounce";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { X, Plus, Package, Minus } from "lucide-react";
import { toast } from "sonner";
import type { PedidoCompleto } from "@/types/comercial";

interface AdicionarPecaModalProps {
  pedido: PedidoCompleto | null;
  expedicaoItems: ReturnType<typeof useStock>["items"];
  onClose: () => void;
  onSuccess: () => void;
}

export function AdicionarPecaModal({ pedido, expedicaoItems, onClose, onSuccess }: AdicionarPecaModalProps) {
  const [search, setSearch] = useState("");
  const [autocomplete, setAutocomplete] = useState<ReturnType<typeof useStock>["items"]>([]);
  const [showAutocomp, setShowAutocomp] = useState(false);
  const [selectedPeca, setSelectedPeca] = useState<ReturnType<typeof useStock>["items"][0] | null>(null);
  const [qtd, setQtd] = useState(1);
  const [descontoItem, setDescontoItem] = useState(0);
  const [precoMap, setPrecoMap] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pedido) {
      setSearch(""); setSelectedPeca(null); setQtd(1); setDescontoItem(0);
      setTimeout(() => inputRef.current?.focus(), 100);
      supabase.from("devices").select("id, preco_venda").gt("preco_venda", 0)
        .then(({ data }) => {
          if (!data) return;
          const map: Record<string, number> = {};
          (data as { id: string; preco_venda: number }[]).forEach(r => { map[r.id] = r.preco_venda; });
          setPrecoMap(map);
        });
    }
  }, [pedido]);

  // FIX: useClickOutside substitui document.addEventListener duplicado
  useClickOutside(dropRef, () => setShowAutocomp(false));

  // Calcula quantas unidades de cada stock_item já estão no pedido atual (ainda não reservadas)
  const jaNosPedido = (pedido?.itens ?? []).reduce<Record<string, number>>((acc, it) => {
    acc[it.stock_item_id] = (acc[it.stock_item_id] ?? 0) + it.quantidade;
    return acc;
  }, {});

  // Retorna o disponível real descontando o que já está no pedido pendente
  function dispReal(item: ReturnType<typeof useStock>["items"][0]) {
    const bruto = Math.max(0, item.quantity_available);
    const jaAdicionado = jaNosPedido[item.id] ?? 0;
    return Math.max(0, bruto - jaAdicionado);
  }

  // FIX: useDebounce substitui debounceRef inline
  const debouncedInput = useDebounce((v: string) => {
    const q = v.trim().toLowerCase();
    const vistos = new Set<string>();
    const deduped = expedicaoItems.filter(i => {
      if (!i.device?.model?.toLowerCase().includes(q) && q) return false;
      if (vistos.has(i.device_id)) return false;
      if (dispReal(i) <= 0) return false;
      vistos.add(i.device_id); return true;
    }).slice(0, 15);
    setAutocomplete(deduped); setShowAutocomp(deduped.length > 0);
  }, 80);

  function handleInput(v: string) {
    setSearch(v); setSelectedPeca(null);
    debouncedInput(v);
  }

  function handleFocus() {
    const vistos = new Set<string>();
    const deduped = expedicaoItems.filter(i => {
      if (vistos.has(i.device_id)) return false;
      if (dispReal(i) <= 0) return false; // oculta peças sem saldo real disponível
      vistos.add(i.device_id); return true;
    }).slice(0, 15);
    setAutocomplete(deduped); setShowAutocomp(deduped.length > 0);
  }

  // Disponível real = bruto da expedição − já no pedido pendente
  const maxDisponivel = selectedPeca ? dispReal(selectedPeca) : 0;

  async function handleAdd() {
    if (!pedido || !selectedPeca) return;
    if (qtd < 1 || qtd > maxDisponivel) { toast.error(`Disponível: ${maxDisponivel} un.`); return; }
    setSaving(true);
    const precoBase = precoMap[selectedPeca.device_id] ?? 0;
    const valorLiquido = Math.max(0, precoBase * (1 - descontoItem / 100));
    const { error } = await supabase.from("pedido_itens").insert({
      pedido_id: pedido.id,
      stock_item_id: selectedPeca.id,
      lote: null,
      quantidade: qtd,
      quantidade_reservada: qtd,
      valor_unitario: valorLiquido,
    });
    if (error) { setSaving(false); toast.error("Erro ao adicionar peça."); return; }

    // FIX: chama reserve_stock para incrementar quantity_reserved no banco.
    // Antes: inseria com quantidade_reservada: 0 e nunca chamava reserve_stock.
    const { data: reserved, error: reserveErr } = await supabase.rpc("reserve_stock", {
      p_item_id: selectedPeca.id,
      p_qty: qtd,
    });
    const result = reserved as { ok?: boolean; error?: string } | null;
    if (reserveErr || result?.ok === false) {
      toast.error(result?.error ?? "Estoque insuficiente.");
      setSaving(false);
      return;
    }

    setSaving(false);
    toast.success(`${selectedPeca.device?.model} adicionada ao pedido!`);
    onSuccess();
    onClose();
  }

  if (!pedido) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-card border border-border/30 shadow-2xl flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-200 max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/20 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-violet-500/15 flex items-center justify-center">
              <Plus className="h-4 w-4 text-violet-500" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-none">Adicionar Peça</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-[200px]">{pedido.cliente_nome}</p>
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-xl hover:bg-muted/50 text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Busca */}
          <div className="px-4 pt-4 pb-2 shrink-0">
            <SearchInputWithBarcode
              value={search}
              onChange={v => handleInput(v)}
              onSearch={v => handleInput(v)}
              onFocus={handleFocus}
              placeholder="Modelo, referência ou bipe o código..."
              height="h-11"
              inputClass="text-[13px]"
              autoFocus
            />
          </div>

          {/* Lista de resultados */}
          <div className="flex-1 overflow-y-auto px-4 pb-2" ref={dropRef}>
            {/* Estado: sem peça selecionada */}
            {!selectedPeca && (
              <>
                {autocomplete.length === 0 && search.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
                    <Package className="h-10 w-10 opacity-15" />
                    <p className="text-[12px]">Digite para buscar peças da expedição</p>
                  </div>
                )}
                {autocomplete.length === 0 && search.length > 0 && (
                  <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
                    <Package className="h-10 w-10 opacity-15" />
                    <p className="text-[12px]">Nenhuma peça encontrada com saldo disponível</p>
                  </div>
                )}
                {autocomplete.length > 0 && (
                  <div className="space-y-1.5 py-1">
                    {autocomplete.map(item => {
                      const disp = dispReal(item);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onMouseDown={e => { e.preventDefault(); setSelectedPeca(item); setSearch(item.device?.model ?? ""); setShowAutocomp(false); setQtd(1); }}
                          className="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-border/30 hover:border-violet-500/40 hover:bg-violet-500/5 text-left transition-all group"
                        >
                          <div className="h-9 w-9 rounded-xl bg-muted/40 group-hover:bg-violet-500/10 flex items-center justify-center shrink-0 transition-colors">
                            <Package className="h-4 w-4 text-muted-foreground group-hover:text-violet-500 transition-colors" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-semibold truncate">{item.device?.model}</p>
                            <p className="text-[10px] text-muted-foreground font-mono">{item.device?.reference}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[15px] font-black text-emerald-500">{disp}</p>
                            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">disponível</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {/* Peça selecionada */}
            {selectedPeca && (
              <div className="py-3 space-y-4">
                {/* Card da peça */}
                <div className="rounded-xl border-2 border-violet-500/40 bg-violet-500/5 p-4">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-xl bg-violet-500/15 flex items-center justify-center shrink-0">
                      <Package className="h-5 w-5 text-violet-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold leading-snug">{selectedPeca.device?.model}</p>
                      <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{selectedPeca.device?.reference}</p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                          {maxDisponivel} disponíveis
                        </span>
                        {(jaNosPedido[selectedPeca.id] ?? 0) > 0 && (
                          <span className="text-[11px] text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-full">
                            {jaNosPedido[selectedPeca.id]} já no pedido
                          </span>
                        )}
                      </div>
                    </div>
                    <button type="button"
                      onClick={() => { setSelectedPeca(null); setSearch(""); setTimeout(() => inputRef.current?.focus(), 50); }}
                      className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/50 text-muted-foreground shrink-0 transition-colors"
                      title="Trocar peça">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Seletor de quantidade */}
                <div className="space-y-2">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Quantidade</label>
                  <div className="flex items-center gap-3">
                    <button type="button"
                      onClick={() => setQtd(q => Math.max(1, q - 1))}
                      className="h-11 w-11 rounded-xl bg-muted/40 hover:bg-muted/70 flex items-center justify-center transition-colors shrink-0">
                      <Minus className="h-4 w-4" />
                    </button>
                    <input
                      type="number" inputMode="numeric" min={1} max={maxDisponivel}
                      value={qtd === 0 ? "" : qtd}
                      onChange={e => {
                        const raw = e.target.value;
                        if (raw === "") { setQtd(0); return; } // permite apagar no celular sem forçar 1 de volta
                        const v = parseInt(raw, 10);
                        if (!isNaN(v)) setQtd(v);
                      }}
                      onBlur={() => setQtd(q => Math.max(1, Math.min(maxDisponivel, q || 1)))}
                      className="flex-1 text-center text-[22px] font-black bg-muted/20 border border-border/40 rounded-xl h-11 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50"
                    />
                    <button type="button"
                      onClick={() => setQtd(q => Math.min(maxDisponivel, q + 1))}
                      className="h-11 w-11 rounded-xl bg-muted/40 hover:bg-muted/70 flex items-center justify-center transition-colors shrink-0">
                      <Plus className="h-4 w-4" />
                    </button>
                    <button type="button"
                      onClick={() => setQtd(maxDisponivel)}
                      className="h-11 px-3 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 text-[11px] font-bold transition-colors shrink-0">
                      Máx
                    </button>
                  </div>
                  {qtd > 0 && (
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
                      <span>Restará na expedição:</span>
                      <span className={qtd > maxDisponivel ? "text-destructive font-bold" : "font-semibold text-foreground"}>
                        {Math.max(0, maxDisponivel - qtd)} un.
                      </span>
                    </div>
                  )}
                </div>

                {/* Preço e desconto da peça */}
                {(precoMap[selectedPeca.device_id] ?? 0) > 0 && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[10px] font-medium text-muted-foreground">Preço un.</label>
                        <div className="h-9 rounded-lg border border-border/40 bg-muted/30 flex items-center justify-center text-[13px] font-bold text-foreground">
                          R$ {(precoMap[selectedPeca.device_id] ?? 0).toFixed(2).replace(".", ",")}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-medium text-muted-foreground">Desconto %</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          value={descontoItem === 0 ? "" : String(descontoItem).replace(".", ",")}
                          onChange={e => {
                            const raw = e.target.value.replace(",", ".");
                            if (raw === "") { setDescontoItem(0); return; }
                            const v = parseFloat(raw);
                            if (!isNaN(v)) setDescontoItem(Math.max(0, v));
                          }}
                          className="w-full h-9 rounded-lg border border-border/50 bg-background text-sm text-center font-mono font-bold text-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-violet-500/8 border border-violet-500/20 px-3 py-2">
                      <span className="text-[11px] text-muted-foreground">
                        {qtd}x {descontoItem > 0 ? `com ${String(descontoItem).replace(".", ",")}% off` : "preço de tabela"}
                      </span>
                      <span className="text-[14px] font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                        R$ {((precoMap[selectedPeca.device_id] ?? 0) * qtd * (1 - descontoItem / 100)).toFixed(2).replace(".", ",")}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 pb-4 pt-3 shrink-0 border-t border-border/20 flex gap-2.5">
          <button type="button" onClick={onClose}
            className="flex-1 h-11 rounded-xl border border-border/40 text-[13px] font-medium text-muted-foreground hover:bg-muted/30 transition-colors">
            Cancelar
          </button>
          <button type="button" onClick={handleAdd}
            disabled={!selectedPeca || saving || qtd < 1 || qtd > maxDisponivel}
            className="flex-1 h-11 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[13px] font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2 shadow-sm shadow-violet-500/30">
            {saving
              ? <div className="h-4 w-4 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />
              : <Plus className="h-4 w-4" />}
            {selectedPeca ? `Adicionar ${qtd} un.` : "Selecione uma peça"}
          </button>
        </div>
      </div>
    </div>
  );
}
