/**
 * Adicionar peça a um pedido pendente.
 *
 * Lista TODAS as peças do catálogo de venda (RPC `catalogo_venda`), com o saldo
 * livre real da expedição — antes usava a lista do useStock (limitada a 500
 * linhas), e peças sumiam. Peça sem saldo aparece desabilitada.
 * A gravação continua pela RPC atômica `adicionar_item_pedido`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Loader2, Minus, Package, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { friendlyError } from "@/lib/errorMessages";
import { carregarCatalogoVenda, filtrarCatalogo, type PecaCatalogo } from "@/lib/catalogoVenda";
import type { PedidoCompleto } from "@/types/comercial";

interface AdicionarPecaModalProps {
  pedido: PedidoCompleto | null;
  onClose: () => void;
  onSuccess: () => void;
}

const LIMITE_LISTA = 80;

export function AdicionarPecaModal({ pedido, onClose, onSuccess }: AdicionarPecaModalProps) {
  const { isAdmin, role } = useAuth();
  // Mesma regra do banco (trigger de desconto máximo): admin, financeiro e gerente podem exceder.
  const podeExceder = isAdmin || role === "financeiro" || role === "gerente";

  const [catalogo, setCatalogo] = useState<PecaCatalogo[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<PecaCatalogo | null>(null);
  const [qtd, setQtd] = useState(1);
  const [desconto, setDesconto] = useState("");
  const [saving, setSaving] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try {
      setCatalogo(await carregarCatalogoVenda());
    } catch (e) {
      setErro(friendlyError(e));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (!pedido) return;
    setBusca(""); setSel(null); setQtd(1); setDesconto("");
    carregar();
  }, [pedido, carregar]);

  // Unidades desse item de expedição já neste pedido (para mostrar ao lado do saldo).
  const jaNoPedido = useMemo(() => (pedido?.itens ?? []).reduce<Record<string, number>>((acc, it) => {
    acc[it.stock_item_id] = (acc[it.stock_item_id] ?? 0) + it.quantidade;
    return acc;
  }, {}), [pedido]);

  const lista = useMemo(() => {
    const f = filtrarCatalogo(catalogo, busca);
    // Com saldo primeiro, depois por nome.
    return [...f].sort((a, b) => Number(b.disponivel > 0) - Number(a.disponivel > 0) || a.model.localeCompare(b.model, "pt-BR"));
  }, [catalogo, busca]);

  const max = sel ? Math.max(0, sel.disponivel) : 0;
  const descNum = Math.max(0, Number(desconto.replace(",", ".")) || 0);
  const descMax = sel?.desconto_max_pct ?? 0;
  const descAcima = !!sel && sel.preco_venda > 0 && !podeExceder && descNum > descMax;
  const precoLiquido = sel ? Math.max(0, sel.preco_venda * (1 - Math.min(100, descNum) / 100)) : 0;

  function escolher(p: PecaCatalogo) {
    if (p.disponivel <= 0 || !p.stock_item_id) return;
    setSel(p); setQtd(1); setDesconto("");
  }

  async function handleAdd() {
    if (!pedido || !sel?.stock_item_id) return;
    if (qtd < 1 || qtd > max) { toast.error(`Disponível: ${max} un.`); return; }
    if (descAcima) { toast.error(`Desconto máximo desta peça: ${String(descMax).replace(".", ",")}%.`); return; }
    setSaving(true);
    const { data, error } = await supabase.rpc("adicionar_item_pedido", {
      p_pedido_id: pedido.id,
      p_stock_item_id: sel.stock_item_id,
      p_quantidade: qtd,
      p_valor_unitario: Math.round(precoLiquido * 100) / 100,
    });
    setSaving(false);
    const result = data as { ok?: boolean; error?: string } | null;
    if (error || result?.ok === false) {
      toast.error(result?.error ?? (error ? friendlyError(error) : "Erro ao adicionar peça."));
      return;
    }
    toast.success(`${sel.model} adicionada ao pedido.`);
    onSuccess();
    onClose();
  }

  return (
    <Dialog open={!!pedido} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg p-0 gap-0 max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 text-left border-b">
          <DialogTitle className="flex items-center gap-2 pr-6">
            {sel && (
              <button type="button" onClick={() => setSel(null)} aria-label="Voltar para a lista" className="h-8 w-8 -ml-1 flex items-center justify-center rounded-lg hover:bg-muted">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            Adicionar peça
          </DialogTitle>
          <DialogDescription className="truncate">{pedido?.cliente_nome}</DialogDescription>
        </DialogHeader>

        {!sel ? (
          <>
            <div className="px-4 pt-3 pb-2 shrink-0">
              <SearchInputWithBarcode value={busca} onChange={setBusca} onSearch={setBusca}
                placeholder="Nome, referência ou bipe o código..." height="h-11" inputClass="text-sm" autoFocus />
            </div>
            <div className="flex-1 overflow-y-auto min-h-[16rem]">
              {carregando ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando peças...</div>
              ) : erro ? (
                <div className="py-12 px-6 text-center space-y-3">
                  <p className="text-sm text-muted-foreground">Não foi possível carregar as peças. {erro}</p>
                  <Button variant="outline" onClick={carregar} className="gap-1.5"><RefreshCw className="h-4 w-4" />Tentar de novo</Button>
                </div>
              ) : lista.length === 0 ? (
                <div className="py-14 text-center text-sm text-muted-foreground">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  {busca ? "Nenhuma peça encontrada com essa busca." : "Nenhuma peça cadastrada para venda."}
                </div>
              ) : (
                <ul className="divide-y border-t">
                  {lista.slice(0, LIMITE_LISTA).map(p => {
                    const semSaldo = p.disponivel <= 0 || !p.stock_item_id;
                    const ja = p.stock_item_id ? jaNoPedido[p.stock_item_id] ?? 0 : 0;
                    return (
                      <li key={p.device_id}>
                        <button type="button" disabled={semSaldo} onClick={() => escolher(p)}
                          aria-label={`Escolher ${p.model}`}
                          className={cn("w-full px-4 py-3 flex items-center gap-3 text-left transition-colors",
                            semSaldo ? "opacity-60 cursor-not-allowed" : "hover:bg-muted/50 active:bg-muted")}>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{p.model}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {p.reference}{p.internal_code && p.internal_code !== p.reference ? ` · ${p.internal_code}` : ""}
                              {p.preco_venda > 0 ? ` · ${formatBRL(p.preco_venda)}` : " · sem preço"}
                            </p>
                            {semSaldo && (
                              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                                sem saldo na expedição{p.em_producao > 0 ? ` · ${p.em_producao.toLocaleString("pt-BR")} em produção` : ""}
                              </p>
                            )}
                            {!semSaldo && ja > 0 && <p className="text-xs text-muted-foreground mt-0.5">{ja} já neste pedido</p>}
                          </div>
                          {!semSaldo && (
                            <span className="shrink-0 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 text-xs font-semibold tabular-nums">
                              {p.disponivel.toLocaleString("pt-BR")} disp.
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                  {lista.length > LIMITE_LISTA && (
                    <li className="px-4 py-3 text-xs text-center text-muted-foreground">Mostrando {LIMITE_LISTA} de {lista.length}. Digite mais para refinar.</li>
                  )}
                </ul>
              )}
            </div>
            <div className="px-4 py-3 border-t shrink-0">
              <Button variant="outline" className="w-full h-11" onClick={onClose}>Fechar</Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="rounded-2xl border bg-muted/30 p-4">
                <p className="font-semibold leading-snug">{sel.model}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{sel.reference}{sel.internal_code && sel.internal_code !== sel.reference ? ` · ${sel.internal_code}` : ""}</p>
                <div className="flex flex-wrap gap-1.5 mt-2 text-xs">
                  <span className="rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 font-medium">{max.toLocaleString("pt-BR")} disponíveis</span>
                  {(jaNoPedido[sel.stock_item_id ?? ""] ?? 0) > 0 && <span className="rounded-full bg-muted px-2 py-0.5">{jaNoPedido[sel.stock_item_id ?? ""]} já no pedido</span>}
                  {sel.em_producao > 0 && <span className="rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-400 px-2 py-0.5">{sel.em_producao.toLocaleString("pt-BR")} em produção</span>}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quantidade</span>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={() => setQtd(q => Math.max(1, q - 1))} aria-label="Diminuir"><Minus className="h-4 w-4" /></Button>
                  <Input type="number" inputMode="numeric" min={1} max={max} value={qtd === 0 ? "" : qtd}
                    onChange={e => { const v = parseInt(e.target.value, 10); setQtd(isNaN(v) ? 0 : v); }}
                    onBlur={() => setQtd(q => Math.max(1, Math.min(max, q || 1)))}
                    className="h-11 text-center text-lg font-bold tabular-nums" aria-label="Quantidade" />
                  <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={() => setQtd(q => Math.min(max, q + 1))} aria-label="Aumentar"><Plus className="h-4 w-4" /></Button>
                  <Button type="button" variant="outline" className="h-11 shrink-0" onClick={() => setQtd(max)}>Máx</Button>
                </div>
                {qtd > max && <p className="text-xs text-destructive">Só há {max} disponíveis.</p>}
              </div>

              {sel.preco_venda > 0 ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preço de tabela</span>
                      <p className="h-11 flex items-center px-3 rounded-md border bg-muted/40 font-semibold tabular-nums">{formatBRL(sel.preco_venda)}</p>
                    </div>
                    <label className="space-y-1.5 block">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Desconto %</span>
                      <Input value={desconto} onChange={e => setDesconto(e.target.value.replace(/[^\d,.]/g, "").slice(0, 5))} inputMode="decimal" placeholder="0"
                        className={cn("h-11 tabular-nums", descAcima && "border-destructive focus-visible:ring-destructive")} aria-invalid={descAcima} />
                    </label>
                  </div>
                  <p className={cn("text-xs", descAcima ? "text-destructive font-medium" : "text-muted-foreground")}>
                    Desconto máximo desta peça: {String(descMax).replace(".", ",")}%{podeExceder ? " (seu perfil pode passar do limite)" : ""}
                  </p>
                  <div className="flex items-center justify-between rounded-xl bg-primary/5 border border-primary/20 px-3 py-2.5">
                    <span className="text-sm text-muted-foreground">{qtd} × {formatBRL(precoLiquido)}</span>
                    <span className="text-lg font-bold tabular-nums">{formatBRL(precoLiquido * qtd)}</span>
                  </div>
                </div>
              ) : (
                <p className="rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 px-3 py-2 text-sm">Peça sem preço na tabela — entra no pedido com valor zero. Peça ao financeiro para cadastrar o preço.</p>
              )}
            </div>
            <div className="px-4 py-3 border-t shrink-0 flex gap-2">
              <Button variant="outline" className="h-11 flex-1" onClick={() => setSel(null)}>Trocar peça</Button>
              <Button className="h-11 flex-1 gap-1.5" onClick={handleAdd} disabled={saving || qtd < 1 || qtd > max || descAcima}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Adicionar {qtd > 0 ? `${qtd} un.` : ""}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
