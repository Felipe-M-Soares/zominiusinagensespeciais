/**
 * Editar dados de um pedido AINDA PENDENTE (não confirmado): observações,
 * prazo de entrega, frete, forma de pagamento/parcelas e endereço de entrega.
 *
 * Atualiza só esses campos em `pedidos_comerciais`, com filtro status=pendente
 * (se o estoque já pegou o pedido no meio do caminho, nada é alterado e avisamos).
 * A RLS "pedidos_update" já permite a vendedora dona e admin/comercial/gerente.
 * Itens: continuam por "Adicionar peça" (RPC) e remover peça (RPC).
 */
import { useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, Loader2, Truck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { friendlyError } from "@/lib/errorMessages";
import { parseValor } from "@/lib/financeiro";
import { FORMAS_PGTO_PEDIDO, type Cliente, type PedidoCompleto } from "@/types/comercial";

interface Props {
  pedido: PedidoCompleto | null;
  cliente: Cliente | null;
  onClose: () => void;
  onSalvo: (p: PedidoCompleto) => void;
}

const COM_PARCELAS = ["cartao_credito", "boleto"];

export function EditarDadosPedidoDialog({ pedido, cliente, onClose, onSalvo }: Props) {
  const [obs, setObs] = useState("");
  const [prazo, setPrazo] = useState("");
  const [frete, setFrete] = useState("");
  const [forma, setForma] = useState("");
  const [parcelas, setParcelas] = useState(1);
  const [usarCliente, setUsarCliente] = useState(true);
  const [endereco, setEndereco] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!pedido) return;
    setObs(pedido.observacoes ?? "");
    setPrazo(pedido.prazo_entrega ?? "");
    setFrete(pedido.frete ? String(pedido.frete).replace(".", ",") : "");
    setForma(pedido.forma_pagamento ?? "");
    setParcelas(pedido.parcelas ?? 1);
    setUsarCliente(pedido.usar_endereco_cliente ?? true);
    setEndereco(pedido.usar_endereco_cliente === false ? pedido.endereco_entrega ?? "" : "");
  }, [pedido]);

  async function salvar() {
    if (!pedido) return;
    const freteNum = Math.max(0, parseValor(frete));
    if (!usarCliente && !endereco.trim()) { toast.error("Informe o endereço de entrega."); return; }
    const parc = COM_PARCELAS.includes(forma) ? Math.max(1, parcelas) : 1;
    const endFinal = usarCliente ? (cliente?.endereco ?? null) : endereco.trim().slice(0, 300);
    const payload = {
      observacoes: obs.trim().slice(0, 1000) || null,
      prazo_entrega: prazo || null,
      frete: Math.round(freteNum * 100) / 100,
      forma_pagamento: forma || null,
      parcelas: parc,
      usar_endereco_cliente: usarCliente,
      endereco_entrega: endFinal,
    };
    setSalvando(true);
    const { data, error } = await supabase.from("pedidos_comerciais")
      .update(payload).eq("id", pedido.id).eq("status", "pendente").select("id");
    setSalvando(false);
    if (error) { toast.error(friendlyError(error, "Não foi possível salvar.")); return; }
    if (!data?.length) { toast.error("Este pedido já saiu de \"aguardando confirmação\" — não dá mais para editar por aqui."); return; }
    toast.success("Dados do pedido atualizados.");
    onSalvo({ ...pedido, ...payload });
  }

  const rotulo = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";

  return (
    <Dialog open={!!pedido} onOpenChange={v => !v && !salvando && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto grid-cols-[minmax(0,1fr)]">
        <DialogHeader className="text-left">
          <DialogTitle>Editar dados do pedido</DialogTitle>
          <DialogDescription className="truncate">#{pedido?.id.slice(0, 8).toUpperCase()} · {pedido?.cliente_nome}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <span className={rotulo}>Pagamento</span>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(FORMAS_PGTO_PEDIDO).map(([id, label]) => (
                <button key={id} type="button" onClick={() => { setForma(f => f === id ? "" : id); setParcelas(1); }} aria-pressed={forma === id}
                  className={cn("h-10 px-3 rounded-full border text-sm", forma === id ? "border-primary bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted")}>{label}</button>
              ))}
            </div>
            {COM_PARCELAS.includes(forma) && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[1, 2, 3, 4, 5, 6, 10, 12].map(n => (
                  <button key={n} type="button" onClick={() => setParcelas(n)} aria-pressed={parcelas === n}
                    className={cn("h-9 min-w-11 px-2 rounded-lg border text-sm", parcelas === n ? "border-primary bg-primary/10 text-primary font-medium" : "text-muted-foreground")}>{n === 1 ? "à vista" : `${n}x`}</button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1.5"><span className={cn(rotulo, "flex items-center gap-1")}><CalendarDays className="h-3.5 w-3.5" />Prazo de entrega</span>
              <Input type="date" value={prazo} onChange={e => setPrazo(e.target.value)} className="h-11" /></label>
            <label className="block space-y-1.5"><span className={cn(rotulo, "flex items-center gap-1")}><Truck className="h-3.5 w-3.5" />Frete (R$)</span>
              <Input value={frete} onChange={e => setFrete(e.target.value)} inputMode="decimal" placeholder="0,00" className="h-11" /></label>
          </div>

          <div className="space-y-1.5">
            <span className={rotulo}>Entrega</span>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setUsarCliente(true)} aria-pressed={usarCliente} className={cn("flex-1 h-10 rounded-xl border text-sm", usarCliente ? "border-primary bg-primary/10 text-primary font-medium" : "text-muted-foreground")}>Endereço do cliente</button>
              <button type="button" onClick={() => setUsarCliente(false)} aria-pressed={!usarCliente} className={cn("flex-1 h-10 rounded-xl border text-sm", !usarCliente ? "border-primary bg-primary/10 text-primary font-medium" : "text-muted-foreground")}>Outro endereço</button>
            </div>
            {usarCliente
              ? <p className="text-xs text-muted-foreground">{cliente?.endereco || "Cliente sem endereço cadastrado"}</p>
              : <Input value={endereco} onChange={e => setEndereco(e.target.value.slice(0, 300))} placeholder="Rua, número, bairro, cidade/UF" className="h-11" />}
          </div>

          <label className="block space-y-1.5">
            <span className={rotulo}>Observações</span>
            <Textarea value={obs} onChange={e => setObs(e.target.value.slice(0, 1000))} rows={3} placeholder="Observações para o estoque / financeiro" />
          </label>
          <p className="text-xs text-muted-foreground">Para mudar as peças use “Peça” (adicionar) ou o × ao lado de cada item.</p>
        </div>

        <DialogFooter className="gap-2 flex-row">
          <Button variant="outline" className="flex-1 sm:flex-none h-11" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button className="flex-1 sm:flex-none h-11 gap-1.5" onClick={salvar} disabled={salvando}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
