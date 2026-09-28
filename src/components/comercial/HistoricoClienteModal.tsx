/**
 * Detalhe do cliente: cadastro, contato rápido, números (total comprado,
 * pedidos, último pedido, crédito de devolução) e histórico de pedidos.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { Loader2, MapPin, Pencil, ShoppingCart, Wallet } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ContatoBotoes } from "@/components/comercial/ContatoBotoes";
import { STATUS_VENDA, SITUACAO_PEDIDO, type Cliente, type PedidoCompleto } from "@/types/comercial";

interface PedidoHist {
  id: string; status: string; created_at: string; frete: number; nota_fiscal: string | null;
  itens: { device_model?: string; quantidade: number; valor_unitario: number }[];
}

const COR_STATUS: Record<string, string> = {
  pendente: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  separando: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  pronto: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  faturado: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  enviado: "bg-teal-500/10 text-teal-700 dark:text-teal-400",
  cancelado: "bg-muted text-muted-foreground",
  retorno: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
};

export function HistoricoClienteModal({ clienteId, clientes, onClose, onEditar, onNovoPedido, onAbrirPedido }: {
  clienteId: string | null;
  clientes: Cliente[];
  onClose: () => void;
  onEditar?: (c: Cliente) => void;
  onNovoPedido?: (c: Cliente) => void;
  /** Abre o pedido (card completo) — opcional. */
  onAbrirPedido?: (pedidoId: string) => void;
}) {
  const [pedidos, setPedidos] = useState<PedidoHist[]>([]);
  const [loading, setLoading] = useState(false);
  const [saldo, setSaldo] = useState(0);
  const cliente = clientes.find(c => c.id === clienteId);

  useEffect(() => {
    if (!clienteId) return;
    let cancel = false;
    setSaldo(0);
    supabase
      .from("contas_financeiras")
      .select("valor, pedidos_comerciais!inner(cliente_id)")
      .eq("categoria", "credito_devolucao_cliente")
      .eq("status", "aberto")
      .eq("pedidos_comerciais.cliente_id", clienteId)
      .then(({ data }) => {
        if (!cancel) setSaldo((data ?? []).reduce((s, r) => s + (Number(r.valor) || 0), 0));
      });
    return () => { cancel = true; };
  }, [clienteId]);

  useEffect(() => {
    if (!clienteId) return;
    let cancel = false;
    setLoading(true);
    supabase
      .from("pedidos_comerciais")
      .select("id, status, created_at, frete, nota_fiscal, pedido_itens(quantidade, valor_unitario, stock_items!pedido_itens_stock_item_id_fkey(devices!stock_items_device_id_fkey(model)))")
      .eq("cliente_id", clienteId)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (cancel) return;
        setPedidos((data ?? []).map((p: Record<string, unknown>) => ({
          id: p.id as string,
          status: p.status as string,
          created_at: p.created_at as string,
          frete: Number(p.frete ?? 0),
          nota_fiscal: (p.nota_fiscal as string | null) ?? null,
          itens: ((p.pedido_itens as Record<string, unknown>[]) ?? []).map((i: Record<string, unknown>) => ({
            device_model: ((i.stock_items as { devices?: { model?: string } } | null)?.devices?.model),
            quantidade: i.quantidade as number,
            valor_unitario: Number(i.valor_unitario ?? 0),
          })),
        })));
        setLoading(false);
      });
    return () => { cancel = true; };
  }, [clienteId]);

  const numeros = useMemo(() => {
    const vendas = pedidos.filter(p => STATUS_VENDA.includes(p.status as PedidoCompleto["status"]));
    const total = vendas.reduce((s, p) => s + p.frete + p.itens.reduce((si, i) => si + i.valor_unitario * i.quantidade, 0), 0);
    const ultimo = pedidos.find(p => p.status !== "cancelado")?.created_at ?? null;
    return { total, qtd: vendas.length, ultimo };
  }, [pedidos]);

  const endereco = cliente ? (cliente.endereco || [cliente.logradouro, cliente.numero, cliente.bairro, cliente.municipio, cliente.uf].filter(Boolean).join(", ")) : "";

  return (
    <Dialog open={!!clienteId} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto overflow-x-hidden p-0 gap-0 grid-cols-[minmax(0,1fr)]">
        <DialogHeader className="px-5 pt-5 pb-4 text-left space-y-1 border-b">
          <DialogTitle className="pr-6 leading-snug">{cliente?.nome ?? "Cliente"}</DialogTitle>
          <DialogDescription>
            {[cliente?.documento, cliente?.municipio && `${cliente.municipio}${cliente.uf ? `/${cliente.uf}` : ""}`, cliente?.ie && `IE ${cliente.ie}`].filter(Boolean).join(" · ") || "Cadastro sem documento"}
          </DialogDescription>
          {cliente && <ContatoBotoes telefone={cliente.telefone} email={cliente.email} className="pt-2" />}
        </DialogHeader>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl border bg-card p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Comprado</p>
              <p className="text-base sm:text-lg font-bold tabular-nums leading-tight mt-0.5">{formatBRL(numeros.total)}</p>
            </div>
            <div className="rounded-2xl border bg-card p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pedidos</p>
              <p className="text-base sm:text-lg font-bold tabular-nums leading-tight mt-0.5">{numeros.qtd}</p>
            </div>
            <div className="rounded-2xl border bg-card p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Último</p>
              <p className="text-base sm:text-lg font-bold tabular-nums leading-tight mt-0.5">{numeros.ultimo ? new Date(numeros.ultimo).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—"}</p>
            </div>
          </div>

          {saldo > 0 && (
            <div className="flex items-center gap-2 text-sm font-medium text-sky-800 dark:text-sky-300 bg-sky-500/10 border border-sky-500/25 rounded-xl px-3 py-2">
              <Wallet className="h-4 w-4 shrink-0" />Crédito de devolução disponível: {formatBRL(saldo)}
            </div>
          )}
          {endereco && (
            <p className="text-sm text-muted-foreground flex items-start gap-1.5"><MapPin className="h-4 w-4 shrink-0 mt-0.5" />{endereco}{cliente?.cep ? ` · CEP ${cliente.cep}` : ""}</p>
          )}
          {cliente?.observacoes && <p className="text-sm rounded-xl bg-muted/40 px-3 py-2 whitespace-pre-wrap">{cliente.observacoes}</p>}

          {cliente && (onEditar || onNovoPedido) && (
            <div className="flex gap-2">
              {onNovoPedido && <Button className="flex-1 h-11 gap-1.5" onClick={() => onNovoPedido(cliente)}><ShoppingCart className="h-4 w-4" />Novo pedido</Button>}
              {onEditar && <Button variant="outline" className="flex-1 h-11 gap-1.5" onClick={() => onEditar(cliente)}><Pencil className="h-4 w-4" />Editar cadastro</Button>}
            </div>
          )}

          <section className="rounded-2xl border bg-card overflow-hidden">
            <h3 className="px-4 py-3 border-b text-sm font-semibold">Histórico de pedidos</h3>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</div>
            ) : pedidos.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Este cliente ainda não tem pedidos.</p>
            ) : (
              <ul className="divide-y">
                {pedidos.map(p => {
                  const total = p.frete + p.itens.reduce((s, i) => s + i.valor_unitario * i.quantidade, 0);
                  const pecas = p.itens.reduce((s, i) => s + i.quantidade, 0);
                  const Tag = onAbrirPedido ? "button" : "div";
                  return (
                    <li key={p.id}>
                      <Tag {...(onAbrirPedido ? { type: "button" as const, onClick: () => onAbrirPedido(p.id) } : {})}
                        className={cn("w-full text-left px-4 py-3 space-y-1", onAbrirPedido && "hover:bg-muted/50")}>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium tabular-nums">{new Date(p.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })}</span>
                          <span className="text-xs text-muted-foreground">#{p.id.slice(0, 8).toUpperCase()}{p.nota_fiscal ? ` · NF ${p.nota_fiscal}` : ""}</span>
                          <span className="ml-auto font-semibold tabular-nums text-sm">{formatBRL(total)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap shrink-0", COR_STATUS[p.status] ?? "bg-muted text-muted-foreground")}>
                            {SITUACAO_PEDIDO[p.status as PedidoCompleto["status"]] ?? p.status}
                          </span>
                          <span className="text-xs text-muted-foreground truncate min-w-0">
                            {pecas} peça{pecas !== 1 ? "s" : ""} · {p.itens.slice(0, 2).map(i => i.device_model ?? "—").join(", ")}{p.itens.length > 2 ? ` +${p.itens.length - 2}` : ""}
                          </span>
                        </div>
                      </Tag>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
