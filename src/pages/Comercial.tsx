/**
 * Comercial — Página exclusiva para vendedoras (e admins)
 *
 * Rota: /comercial
 * Acesso: role === "comercial" | "admin"
 *
 * Fluxo:
 *  1. Vendedora seleciona ou cadastra cliente
 *  2. Visualiza peças disponíveis na expedição
 *  3. Cria pedido (nome do cliente + lote + quantidade)
 *  4. Peças ficam reservadas no estoque
 *  5. Admin/Estoque fatura o pedido → peças saem da expedição
 */

import { temPapel } from "@/types/roles";
import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from "react";
import { useConfirmEnter } from "@/hooks/useConfirmEnter";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";


import { useClickOutside } from "@/hooks/useClickOutside";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ShoppingBag,
  User,
  Search,
  X,
  Plus,
  Trash2,
  CheckCircle2,
  PackageCheck,
  Clock,
  Tag,
  ChevronDown,
  ChevronUp,
  FileText,
  Ban,
  Truck,
  LayoutDashboard,
  History,
  Bell,
  Copy,
  MessageSquare,
  Send,
  RotateCcw,
  Pencil,
  FileDown,
  Loader2,
} from "lucide-react";
import { PageNav } from "@/components/PageNav";

import { displayLote } from "@/lib/lote";
import { TabelaPrecos } from "@/components/TabelaPrecos";

import type { Cliente, PedidoCompleto } from "@/types/comercial";
import { FORMAS_PGTO_PEDIDO, logAudit, pedidoAtrasado } from "@/types/comercial";
import { excluirClienteSeguro } from "@/lib/pedidoUtils";
import { DuplicadosClientesDialog } from "@/components/comercial/DuplicadosClientesDialog";
import { agruparDuplicados } from "@/lib/clientesDuplicados";
import { DashboardComercial, type FiltroPedidosDash } from "@/components/comercial/DashboardComercial";
import { ClientesPanel } from "@/components/comercial/ClientesPanel";
import { HistoricoPanel, FILTRO_HISTORICO_PADRAO, type FiltroHistorico } from "@/components/comercial/HistoricoPanel";

// ─── Modais extraídos — lazy-loaded para reduzir o bundle inicial da página ────
// (ver src/components/comercial/). Cada um só baixa quando de fato abre.
const ClienteModal           = lazy(() => import("@/components/comercial/ClienteModal").then(m => ({ default: m.ClienteModal })));
const NovoPedidoModal        = lazy(() => import("@/components/comercial/NovoPedidoModal").then(m => ({ default: m.NovoPedidoModal })));
const AdicionarPecaModal     = lazy(() => import("@/components/comercial/AdicionarPecaModal").then(m => ({ default: m.AdicionarPecaModal })));
const FaturarModal           = lazy(() => import("@/components/comercial/FaturarModal").then(m => ({ default: m.FaturarModal })));
const HistoricoClienteModal  = lazy(() => import("@/components/comercial/HistoricoClienteModal").then(m => ({ default: m.HistoricoClienteModal })));
const ComentariosModal       = lazy(() => import("@/components/comercial/ComentariosModal").then(m => ({ default: m.ComentariosModal })));
const HistoricoGeralModal    = lazy(() => import("@/components/comercial/HistoricoGeralModal").then(m => ({ default: m.HistoricoGeralModal })));
const EditarDadosPedidoDialog = lazy(() => import("@/components/comercial/EditarDadosPedidoDialog").then(m => ({ default: m.EditarDadosPedidoDialog })));

// ─── Botão Reenviar Pedido Retornado ──────────────────────────────────────────

function ReenviarPedidoRetornadoBtn({ pedidoId, onComentar, onReenviar }: { pedidoId: string; onComentar: () => void; onReenviar: () => void }) {
  async function handleReenviar() {
    onReenviar(); // otimista — atualiza UI na hora
    const { error } = await supabase
      .from("pedidos_comerciais")
      .update({ status: "pendente", observacoes: null })
      .eq("id", pedidoId);
    if (error) toast.error("Erro ao reenviar pedido.");
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={onComentar}
        className="h-9 px-3 flex items-center justify-center gap-1.5 rounded-xl text-[11px] font-medium text-orange-600 dark:text-orange-400 hover:bg-orange-500/10 border border-orange-500/30 transition-colors shrink-0"
      >
        <MessageSquare className="h-3.5 w-3.5 shrink-0" />
        Ver motivo
      </button>
      <button
        type="button"
        onClick={handleReenviar}
        className="flex-1 h-9 rounded-xl bg-orange-500 hover:bg-orange-400 active:scale-95 text-white text-[11px] font-semibold transition-all flex items-center justify-center gap-1.5 min-w-0"
      >
        <Send className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">Reenviar ao Estoque</span>
      </button>
    </div>
  );
}

// ─── Card de Pedido ───────────────────────────────────────────────────────────

interface PedidoCardProps {
  pedido: PedidoCompleto;
  isAdmin: boolean;
  canConfirm?: boolean;
  clientes: Cliente[];
  onFaturar: (p: PedidoCompleto) => void;
  onCancelar: (p: PedidoCompleto) => void;
  onAdicionarPeca: (p: PedidoCompleto) => void;
  onDuplicar: (p: PedidoCompleto) => void;
  onComentar: (p: PedidoCompleto) => void;
  onReenviar: (p: PedidoCompleto) => void;
  onRemoverItemComercial: (pedido: PedidoCompleto, item: PedidoCompleto["itens"][0]) => void;
  onEditarPedido: (p: PedidoCompleto) => void;
  /** Pode editar os dados (pagamento, prazo, frete, endereço, obs.) do pedido pendente. */
  podeEditarDados?: boolean;
  onEditarDados?: (p: PedidoCompleto) => void;
}

// Sinaliza, no próprio pedido original, que parte (ou tudo) dele já voltou
// por devolução/troca. A NF-e de venda já autorizada pelo SEFAZ não pode
// ser alterada — por regra fiscal ela continua "ativa" com a quantidade
// original —, então o jeito certo de não confundir ninguém é mostrar aqui,
// na tela, que uma devolução/troca já foi aprovada para este pedido.
// Só aparece pra quem pode ver: admin, ou a vendedora dona do pedido — não
// pra outras vendedoras que só estejam olhando a lista geral.
function DevolucaoBadgePedido({ pedidoId, vendedoraId, isAdmin }: { pedidoId: string; vendedoraId: string | null; isAdmin: boolean }) {
  const { user } = useAuth();
  const [info, setInfo] = useState<{ tipo: string; qtd: number } | null>(null);

  const podeVer = isAdmin || (!!user?.id && !!vendedoraId && user.id === vendedoraId);

  useEffect(() => {
    if (!podeVer) { setInfo(null); return; }
    let cancelled = false;
    supabase
      .from("notas_devolucao_troca")
      .select("tipo, itens, status_msg")
      .eq("pedido_id", pedidoId)
      .neq("status", "cancelada")
      .then(({ data }) => {
        if (cancelled || !data || data.length === 0) return;
        // só conta as que a Qualidade já aprovou (ou que vieram do fluxo manual do Financeiro)
        const aprovadas = data.filter(d => !(d.status_msg ?? "").startsWith("[QUALIDADE:em_analise]"));
        if (aprovadas.length === 0) return;
        const qtd = aprovadas.reduce((s, d) => {
          const itens = (d.itens as { quantidade?: number }[]) ?? [];
          return s + itens.reduce((si, it) => si + (it.quantidade ?? 0), 0);
        }, 0);
        setInfo({ tipo: aprovadas[0].tipo as string, qtd });
      });
    return () => { cancelled = true; };
  }, [pedidoId, podeVer]);

  if (!podeVer || !info || info.qtd === 0) return null;

  return (
    <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-orange-700 dark:text-orange-400 bg-orange-500/10 border border-orange-500/25 rounded-lg px-2.5 py-1.5">
      <RotateCcw className="h-3 w-3 shrink-0" />
      {info.tipo === "devolucao" ? "Devolução" : "Troca"} registrada — {info.qtd} peça{info.qtd !== 1 ? "s" : ""} {info.qtd !== 1 ? "voltaram" : "voltou"}
    </div>
  );
}

const ETAPAS = [
  { id: "pendente", label: "Pedido" },
  { id: "separando", label: "Separação" },
  { id: "pronto", label: "Pronto" },
  { id: "faturado", label: "Faturado" },
  { id: "enviado", label: "Enviado" },
] as const;
const ORDEM_ETAPA: Record<string, number> = { pendente: 0, retorno: 0, separando: 1, pronto: 2, faturado: 3, enviado: 4, cancelado: -1 };
const STATUS_PEDIDO: Record<string, { label: string; cls: string; Icon: typeof Clock; dica: string }> = {
  pendente:  { label: "Aguardando confirmação", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30", Icon: Clock, dica: "Confirme para o estoque separar" },
  separando: { label: "Em separação", cls: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30", Icon: PackageCheck, dica: "O estoque está separando os lotes" },
  pronto:    { label: "Pronto — aguardando NF", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30", Icon: CheckCircle2, dica: "O financeiro vai emitir a nota" },
  faturado:  { label: "Faturado", cls: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/30", Icon: FileText, dica: "Nota fiscal emitida" },
  enviado:   { label: "Enviado", cls: "bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/30", Icon: Truck, dica: "Faturado e enviado ao cliente" },
  cancelado: { label: "Cancelado", cls: "bg-muted text-muted-foreground border-border", Icon: Ban, dica: "Pedido cancelado" },
  retorno:   { label: "Voltou do estoque", cls: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30", Icon: RotateCcw, dica: "O estoque devolveu — revise e reenvie" },
};
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function PedidoCard({ pedido, isAdmin, canConfirm, clientes, onFaturar, onCancelar, onAdicionarPeca, onDuplicar, onComentar, onReenviar, onRemoverItemComercial, onEditarPedido, podeEditarDados, onEditarDados, expandido }: PedidoCardProps & { expandido?: boolean }) {
  const [expanded, setExpanded] = useState(!!expandido);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const totalPecas = pedido.itens.reduce((s, i) => s + i.quantidade, 0);
  // valor_unitario já é líquido (com o desconto de cada peça)
  const totalItens = pedido.itens.reduce((s, i) => s + (i.valor_unitario ?? 0) * i.quantidade, 0);
  const total = totalItens + (pedido.frete ?? 0);
  const st = STATUS_PEDIDO[pedido.status] ?? STATUS_PEDIDO.cancelado;
  const etapa = ORDEM_ETAPA[pedido.status] ?? 0;
  const numero = pedido.id.slice(0, 8).toUpperCase();
  const criado = new Date(pedido.created_at);
  const prazoAtrasado = pedidoAtrasado(pedido);

  async function handleGerarPdf() {
    if (gerandoPdf) return;
    setGerandoPdf(true);
    try {
      const cliente = clientes.find(c => c.id === pedido.cliente_id) ?? null;
      const { baixarPdfPedido } = await import("@/lib/pedidoPdf");
      await baixarPdfPedido(pedido, cliente, {
        titulo: pedido.status === "pendente" ? "Orçamento" : "Pedido",
        formaPagamento: pedido.forma_pagamento ?? null,
        parcelas: pedido.parcelas ?? null,
      });
    } catch {
      toast.error("Erro ao gerar PDF.");
    } finally {
      setGerandoPdf(false);
    }
  }

  return (
    <div className={cn("rounded-2xl border bg-card overflow-hidden flex flex-col", pedido.status === "retorno" && "border-orange-500/40", pedido.status === "cancelado" && "opacity-70")}>
      <div className="p-4 space-y-3 flex-1">
        {/* Cabeçalho */}
        <div>
          <h3 className="font-semibold leading-tight truncate" title={pedido.cliente_nome}>{pedido.cliente_nome}</h3>
          <div className="flex items-end justify-between gap-3 mt-1">
            <p className="text-xs text-muted-foreground">
              #{numero} · {criado.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} {criado.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              {pedido.vendedora_nome ? ` · ${pedido.vendedora_nome}` : ""}
            </p>
            <div className="text-right shrink-0">
              <p className="text-lg font-bold tabular-nums leading-tight">{brl(total)}</p>
              <p className="text-xs text-muted-foreground">{totalPecas} peça{totalPecas !== 1 ? "s" : ""}</p>
            </div>
          </div>
        </div>

        {/* Situação + progresso */}
        <div className="space-y-2">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", st.cls)} title={st.dica}>
            <st.Icon className="h-3.5 w-3.5" />{st.label}
          </span>
          {pedido.status !== "cancelado" && (
            <div className="flex items-center gap-1" aria-label={`Etapa: ${st.label}`}>
              {ETAPAS.map((e, i) => (
                <div key={e.id} className="flex-1 space-y-1">
                  <div className={cn("h-1.5 rounded-full", i <= etapa ? (pedido.status === "retorno" ? "bg-orange-500" : "bg-primary") : "bg-muted")} />
                  <p className={cn("text-[10px] text-center", i === etapa ? "font-semibold text-foreground" : "text-muted-foreground")}>{e.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <DevolucaoBadgePedido pedidoId={pedido.id} vendedoraId={pedido.vendedora_id} isAdmin={isAdmin} />

        {/* Informações rápidas */}
        <div className="flex flex-wrap gap-1.5 text-xs">
          {pedido.nota_fiscal && <span className="rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-400 px-2 py-0.5 font-medium">NF {pedido.nota_fiscal}</span>}
          {pedido.forma_pagamento && <span className="rounded-full bg-muted px-2 py-0.5">{FORMA_PGTO[pedido.forma_pagamento] ?? pedido.forma_pagamento}{(pedido.parcelas ?? 1) > 1 ? ` ${pedido.parcelas}x` : ""}</span>}
          {pedido.desconto_pct > 0 && <span className="rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-2 py-0.5">desconto {String(pedido.desconto_pct).replace(".", ",")}%</span>}
          {(pedido.frete ?? 0) > 0 && <span className="rounded-full bg-muted px-2 py-0.5">frete {brl(pedido.frete)}</span>}
          {(pedido.credito_aplicado ?? 0) > 0 && <span className="rounded-full bg-sky-500/10 text-sky-700 dark:text-sky-400 px-2 py-0.5" title="Crédito do cliente abatido — valor a cobrar já descontado">crédito −{brl(pedido.credito_aplicado ?? 0)}</span>}
          {pedido.prazo_entrega && <span className={cn("rounded-full px-2 py-0.5", prazoAtrasado ? "bg-red-500/10 text-red-700 dark:text-red-400 font-medium" : "bg-muted")}>
            entrega {new Date(`${pedido.prazo_entrega}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}{prazoAtrasado ? " · atrasado" : ""}</span>}
          {pedido.rastreio_envio && <span className="rounded-full bg-teal-500/10 text-teal-700 dark:text-teal-400 px-2 py-0.5">rastreio {pedido.rastreio_envio}</span>}
        </div>

        {/* Itens */}
        <button type="button" onClick={() => setExpanded(v => !v)} className="w-full flex items-center justify-between text-sm font-medium text-muted-foreground hover:text-foreground">
          <span>{pedido.itens.length} {pedido.itens.length !== 1 ? "itens" : "item"} no pedido</span>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {expanded && (
          <ul className="rounded-xl border divide-y text-sm">
            {pedido.itens.map(it => (
              <li key={it.id} className="px-3 py-2 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{it.device_model}</p>
                  <p className="text-xs text-muted-foreground">{it.quantidade} × {brl(it.valor_unitario ?? 0)}{displayLote(it.lote) ? ` · lote ${displayLote(it.lote)}` : ""}</p>
                </div>
                <p className="tabular-nums font-medium">{brl((it.valor_unitario ?? 0) * it.quantidade)}</p>
                {pedido.status === "pendente" && pedido.itens.length > 1 && (
                  <button type="button" onClick={() => onRemoverItemComercial(pedido, it)} className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Remover peça" aria-label="Remover peça"><X className="h-3.5 w-3.5" /></button>
                )}
              </li>
            ))}
            {pedido.usar_endereco_cliente === false && pedido.endereco_entrega && <li className="px-3 py-2 text-xs text-muted-foreground">Entrega: {pedido.endereco_entrega}</li>}
            {pedido.observacoes && <li className="px-3 py-2 text-xs text-muted-foreground italic whitespace-pre-wrap">{pedido.observacoes}</li>}
          </ul>
        )}
      </div>

      {/* Ações */}
      <div className="border-t bg-muted/20 p-3 space-y-2">
        {pedido.status === "pendente" && (isAdmin || canConfirm) && (
          <div className="flex gap-2">
            <Button className="flex-1 min-w-0 h-10 gap-1.5 px-3" onClick={() => onFaturar(pedido)}><CheckCircle2 className="h-4 w-4 shrink-0" /><span className="truncate">Confirmar<span className="hidden sm:inline"> pedido</span></span></Button>
            <Button variant="outline" className="h-10 gap-1 px-3" onClick={() => onAdicionarPeca(pedido)}><Plus className="h-4 w-4" />Peça</Button>
            {podeEditarDados && onEditarDados && (
              <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => onEditarDados(pedido)} title="Editar dados (pagamento, prazo, frete, entrega, observações)" aria-label="Editar dados do pedido"><Pencil className="h-4 w-4" /></Button>
            )}
            <Button variant="outline" size="icon" className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => onCancelar(pedido)} title="Cancelar pedido" aria-label="Cancelar pedido"><Ban className="h-4 w-4" /></Button>
          </div>
        )}
        {pedido.status === "pendente" && !(isAdmin || canConfirm) && podeEditarDados && onEditarDados && (
          <Button variant="outline" className="w-full h-10 gap-1.5" onClick={() => onEditarDados(pedido)}><Pencil className="h-4 w-4" />Editar dados</Button>
        )}
        {pedido.status === "retorno" && (
          <div className="space-y-2">
            <Button variant="outline" className="w-full h-10 gap-1.5 border-orange-500/40 text-orange-700 dark:text-orange-400" onClick={() => onEditarPedido(pedido)}><Pencil className="h-4 w-4" />Editar pedido</Button>
            <ReenviarPedidoRetornadoBtn pedidoId={pedido.id} onComentar={() => onComentar(pedido)} onReenviar={() => onReenviar(pedido)} />
          </div>
        )}
        <div className="grid grid-flow-col auto-cols-fr gap-1">
          <Button variant="ghost" size="sm" className="h-9 gap-1 px-2" onClick={handleGerarPdf} disabled={gerandoPdf}>
            {gerandoPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}{pedido.status === "pendente" ? "Orçamento" : "PDF"}
          </Button>
          <Button variant="ghost" size="sm" className="h-9 gap-1 px-2" onClick={() => onDuplicar(pedido)}><Copy className="h-4 w-4" />Repetir</Button>
          {(pedido.status === "pendente" || pedido.status === "retorno") && (
            <Button variant="ghost" size="sm" className="h-9 gap-1 px-2" onClick={() => onComentar(pedido)}><MessageSquare className="h-4 w-4" />Recados</Button>
          )}
        </div>
      </div>
    </div>
  );
}
const FORMA_PGTO = FORMAS_PGTO_PEDIDO;

// ─── Notificações Bell ───────────────────────────────────────────────────────

function NotificacoesBell({ userId }: { userId: string }) {
  const [notifs, setNotifs] = useState<{ id: string; titulo: string; mensagem: string | null; lida: boolean; created_at: string }[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("notificacoes")
      .select("id, titulo, mensagem, lida, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    setNotifs((data as typeof notifs) ?? []);
  }, [userId]);

  useEffect(() => { if (userId) load(); }, [load, userId]);

  // Realtime subscription — recebe notificação instantaneamente e mostra toast
  useEffect(() => {
    const channel = supabase
      .channel(`notif-${userId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "notificacoes",
        filter: `user_id=eq.${userId}`
      }, (payload) => {
        const row = payload.new as { titulo?: string; mensagem?: string | null };
        load();
        toast(row.titulo ?? "Nova notificação", {
          description: row.mensagem ?? undefined,
          duration: 5000,
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, load]);

  // FIX: useClickOutside substitui document.addEventListener duplicado
  useClickOutside(ref, () => setOpen(false));

  async function marcarLidas() {
    const ids = notifs.filter(n => !n.lida).map(n => n.id);
    if (ids.length === 0) return;
    await supabase.from("notificacoes").update({ lida: true }).in("id", ids);
    setNotifs(prev => prev.map(n => ({ ...n, lida: true })));
  }

  const naoLidas = notifs.filter(n => !n.lida).length;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { setOpen(v => !v); if (!open) marcarLidas(); }}
        className="relative h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors"
      >
        <Bell className="h-4 w-4" />
        {naoLidas > 0 && (
          <span className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-violet-500 border-2 border-background" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 rounded-2xl border border-border bg-card shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
            <span className="text-[12px] font-semibold">Notificações</span>
            {naoLidas > 0 && <span className="text-[10px] text-violet-500">{naoLidas} nova{naoLidas > 1 ? "s" : ""}</span>}
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-border/20">
            {notifs.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-muted-foreground">Nenhuma notificação</div>
            ) : notifs.map(n => (
              <div key={n.id} className={cn("px-4 py-3 transition-colors", n.lida ? "" : "bg-violet-500/5")}>
                <div className="flex items-start gap-2">
                  {!n.lida && <span className="h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0 mt-1.5" />}
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold">{n.titulo}</p>
                    {n.mensagem && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{n.mensagem}</p>}
                    <p className="text-[10px] text-muted-foreground/50 mt-1">{new Date(n.created_at).toLocaleDateString("pt-BR")}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Página Principal ─────────────────────────────────────────────────────────

type SubTab = "dashboard" | "pedidos" | "clientes" | "historico" | "precos";
type FiltroStatus = "todos" | "pendente" | "separando" | "pronto" | "enviado" | "retorno" | "cancelado" | "atrasados";

export default function Comercial() {
  const { isAdmin, role, user } = useAuth();

  const isVendedora = role === "comercial";
  const canAccess = temPapel(role, "comercial");
  // Gerente enxerga todos os pedidos/vendedoras como o admin (sem as ações de admin).
  const verTudo = isAdmin || role === "gerente";

  // Nome da usuária logada
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const userEmail = user?.email ?? null;
  useEffect(() => {
    if (!user?.id) return;
    supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => setCurrentUserName((data as { display_name?: string } | null)?.display_name ?? userEmail));
  }, [user?.id, userEmail]);

  // Pedido é "meu" (vendedora logada): pelo id e, para pedidos antigos sem id, pelo nome.
  const uid = user?.id ?? null;
  const meus = useCallback((p: PedidoCompleto) =>
    (!!uid && p.vendedora_id === uid) || (!p.vendedora_id && !!currentUserName && p.vendedora_nome === currentUserName),
  [uid, currentUserName]);

  // Sub-tabs
  const [subTab, setSubTab] = useState<SubTab>("pedidos");
  const [movimentacoesOpen, setMovimentacoesOpen] = useState(false);
  const [duplicadosOpen, setDuplicadosOpen] = useState(false);
  const [filtroHist, setFiltroHist] = useState<{ key: number; f: FiltroHistorico }>({ key: 0, f: FILTRO_HISTORICO_PADRAO });

  // Peças da expedição (NovoPedidoModal ainda recebe; "Adicionar peça" usa o catálogo do banco)

  // Pedidos
  const [pedidos, setPedidos] = useState<PedidoCompleto[]>([]);
  const [loadingPedidos, setLoadingPedidos] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("todos");
  const [buscaPedido, setBuscaPedido] = useState("");
  const [novoPedidoOpen, setNovoPedidoOpen] = useState(false);
  const [faturarPedido, setFaturarPedido] = useState<PedidoCompleto | null>(null);
  const [cancelarPedido, setCancelarPedido] = useState<PedidoCompleto | null>(null);
  const [adicionarPecaPedido, setAdicionarPecaPedido] = useState<PedidoCompleto | null>(null);
  const [editarDadosPedido, setEditarDadosPedido] = useState<PedidoCompleto | null>(null);
  const [pedidoAbertoId, setPedidoAbertoId] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [pedidoComCliente, setPedidoComCliente] = useState<Cliente | null>(null);

  // Clientes
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loadingClientes, setLoadingClientes] = useState(true);
  const loadPedidosAbortRef = useRef<AbortController | null>(null);
  const [clienteModal, setClienteModal] = useState(false);
  const [editCliente, setEditCliente] = useState<Cliente | null>(null);
  const [deleteCliente, setDeleteCliente] = useState<Cliente | null>(null);
  const [deletingCliente, setDeletingCliente] = useState(false);
  const [historicoClienteId, setHistoricoClienteId] = useState<string | null>(null);
  const [comentarioPedidoId, setComentarioPedidoId] = useState<string | null>(null);
  const [duplicandoPedido, setDuplicandoPedido] = useState<PedidoCompleto | null>(null);
  const [editarPedidoRetorno, setEditarPedidoRetorno] = useState<PedidoCompleto | null>(null);
  const [removerItemPendente, setRemoverItemPendente] = useState<{ pedido: PedidoCompleto; item: PedidoCompleto["itens"][0] } | null>(null);
  const [filtroDataInicio, setFiltroDataInicio] = useState("");
  const [filtroDataFim, setFiltroDataFim] = useState("");

  function handleDuplicar(pedido: PedidoCompleto) {
    setPedidoAbertoId(null);
    setDuplicandoPedido(pedido);
    setNovoPedidoOpen(true);
  }

  const loadPedidos = useCallback(async () => {
    // Cancel any in-flight request before starting a new one
    loadPedidosAbortRef.current?.abort();
    const ctrl = new AbortController();
    loadPedidosAbortRef.current = ctrl;

    setLoadingPedidos(true);
    try {
      const { data: pedidosData } = await supabase
        .from("pedidos_comerciais")
        .select("*, frete, clientes(nome)")
        .order("created_at", { ascending: false })
        .abortSignal(ctrl.signal);

      if (ctrl.signal.aborted) return;
      if (!pedidosData) { setPedidos([]); return; }

      const pedidoIds = pedidosData.map((p: Record<string, unknown>) => p.id as string);
      const { data: itensData } = pedidoIds.length > 0
        ? await supabase
          .from("pedido_itens")
          .select("*, stock_items!pedido_itens_stock_item_id_fkey(device_id, devices!stock_items_device_id_fkey(model, reference))")
          .in("pedido_id", pedidoIds)
          .abortSignal(ctrl.signal)
        : { data: [] };

      if (ctrl.signal.aborted) return;

      const itensPorPedido = new Map<string, PedidoCompleto["itens"]>();
      for (const it of (itensData ?? []) as Record<string, unknown>[]) {
        const pid = it.pedido_id as string;
        if (!itensPorPedido.has(pid)) itensPorPedido.set(pid, []);
        const si = it.stock_items as Record<string, unknown> | null;
        const dev = si?.devices as Record<string, unknown> | null;
        itensPorPedido.get(pid)!.push({
          id: it.id as string,
          stock_item_id: it.stock_item_id as string,
          lote: it.lote as string,
          quantidade: it.quantidade as number,
          quantidade_reservada: it.quantidade_reservada as number,
          device_model: dev?.model as string | undefined,
          device_reference: dev?.reference as string | undefined,
          valor_unitario: (it.valor_unitario as number | null) ?? 0,
          device_id: si?.device_id as string | undefined,
        });
      }

      setPedidos(pedidosData.map((p: Record<string, unknown>) => {
        const c = p.clientes as Record<string, unknown> | null;
        return { id: p.id as string, cliente_id: p.cliente_id as string, cliente_nome: c?.nome as string ?? "—", vendedora_nome: p.vendedora_nome as string | null, vendedora_id: (p.vendedora_id as string | null) ?? null, status: p.status as PedidoCompleto["status"], observacoes: p.observacoes as string | null, desconto_pct: (p.desconto_pct as number) ?? 0, frete: (p.frete as number) ?? 0, prazo_entrega: (p.prazo_entrega as string | null) ?? null, created_at: p.created_at as string, faturado_em: p.faturado_em as string | null, nota_fiscal: (p.nota_fiscal as string | null) ?? null, forma_pagamento: (p.forma_pagamento as string | null) ?? null, parcelas: (p.parcelas as number | null) ?? null, rastreio_envio: (p.rastreio_envio as string | null) ?? null, credito_aplicado: Number(p.credito_aplicado ?? 0), endereco_entrega: (p.endereco_entrega as string | null) ?? null, usar_endereco_cliente: (p.usar_endereco_cliente as boolean | null) ?? null, itens: itensPorPedido.get(p.id as string) ?? [] };
      }));
    } catch (_e) {
      toast.error("Erro ao carregar pedidos.", {
        action: { label: "Tentar novamente", onClick: loadPedidos }
      });
    } finally {
      setLoadingPedidos(false);
    }
  }, []);

  const loadClientes = useCallback(async () => {
    setLoadingClientes(true);
    try {
      const { data, error } = await supabase.from("clientes").select("*").order("nome");
      if (error) { toast.error("Erro ao carregar clientes.", {
        action: { label: "Tentar novamente", onClick: loadClientes }
      }); return; }
      setClientes((data as Cliente[]) ?? []);
    } catch (_e) {
      toast.error("Erro ao carregar clientes.", {
        action: { label: "Tentar novamente", onClick: loadClientes }
      });
      setClientes([]);
    } finally {
      setLoadingClientes(false);
    }
  }, []);

  useEffect(() => { loadPedidos(); loadClientes(); }, [loadPedidos, loadClientes]);

  // Realtime: recarrega pedidos automaticamente quando outro usuário muda um pedido
  // (estoque confirma separação, devolve retorno, etc.) — sem precisar deslogar/relogar
  useEffect(() => {
    const channel = supabase
      .channel(`comercial-pedidos-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pedidos_comerciais" },
        () => { loadPedidos(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadPedidos]);

  async function handleCancelar() {
    if (!cancelarPedido) return;
    setCancelando(true);
    try {
      // Use atomic RPC — cancels pedido + releases all reservations in one transaction
      const { data, error } = await supabase.rpc("cancel_pedido", { p_pedido_id: cancelarPedido.id });
      const res = data as { ok?: boolean; error?: string } | null;
      if (error || res?.ok === false) { toast.error(res?.error ?? "Erro ao cancelar."); return; }
      await logAudit(user?.id, currentUserName, "cancel_pedido", "pedido_comercial", cancelarPedido.id, { cliente: cancelarPedido.cliente_nome });
      toast.success("Pedido cancelado.");
      setCancelarPedido(null);
      loadPedidos();
     
    } catch (_e) {
      toast.error("Erro inesperado ao cancelar pedido.");
    } finally {
      setCancelando(false);
    }
  }

  async function handleRemoverItemConfirm() {
    if (!removerItemPendente) return;
    const { item, pedido } = removerItemPendente;
    // Remove da UI imediatamente (otimista)
    setPedidos(prev => prev.map(p => p.id === pedido.id
      ? { ...p, itens: p.itens.filter(i => i.id !== item.id) }
      : p
    ));
    setRemoverItemPendente(null);
    // RPC atômica: libera a reserva e, se a peça já tinha sido
    // separada pro embarque (lotes_separados), devolve a
    // quantidade física pra expedição também — não só a reserva.
    const { data, error } = await supabase.rpc("remove_pedido_item", {
      p_pedido_item_id: item.id,
    });
    const result = data as { ok?: boolean; error?: string } | null;
    if (error || result?.ok === false) {
      toast.error(result?.error ?? error?.message ?? "Erro ao remover peça do pedido.");
      loadPedidos(); // desfaz o otimista, recarrega estado real
      return;
    }
    toast.success(`${item.device_model} removida do pedido.`);
  }

  async function handleDeleteCliente() {
    if (!deleteCliente) return;
    setDeletingCliente(true);
    const res = await excluirClienteSeguro(deleteCliente.id, isAdmin);
    setDeletingCliente(false);
    if (!res.ok) { toast.error(res.error ?? "Não foi possível excluir o cliente.", { duration: 8000 }); return; }
    toast.success("Cliente excluído.");
    setDeleteCliente(null);
    loadClientes();
  }

  const pedidosFiltrados = useMemo(() => {
    const agora = new Date();
    return pedidos.filter(p => {
      if (filtroStatus === "atrasados") { if (!pedidoAtrasado(p, agora)) return false; }
      else if (filtroStatus === "enviado" ? !["faturado", "enviado"].includes(p.status) : filtroStatus !== "todos" && p.status !== filtroStatus) return false;
      const q = buscaPedido.trim().toLowerCase();
      if (q && !`${p.cliente_nome} ${p.id.slice(0, 8)} ${p.nota_fiscal ?? ""} ${p.vendedora_nome ?? ""}`.toLowerCase().includes(q)) return false;
      if (filtroDataInicio && p.created_at < filtroDataInicio) return false;
      if (filtroDataFim && p.created_at > filtroDataFim + "T23:59:59") return false;
      return true;
    });
  }, [pedidos, filtroStatus, filtroDataInicio, filtroDataFim, buscaPedido]);
  const pedidosPendentes  = useMemo(() => pedidos.filter(p => p.status === "pendente").length, [pedidos]);
  const qtdAtrasados = useMemo(() => pedidos.filter(p => pedidoAtrasado(p)).length, [pedidos]);
  const qtdDuplicados = useMemo(() => agruparDuplicados(clientes).reduce((n, g) => n + g.length - 1, 0), [clientes]);
  const pedidoAberto = pedidoAbertoId ? pedidos.find(p => p.id === pedidoAbertoId) ?? null : null;

  // Vendedora dona do pedido, admin e gerente podem editar os dados de um pedido pendente.
  const podeEditarDados = useCallback((p: PedidoCompleto) => verTudo || (!!uid && p.vendedora_id === uid) || (isVendedora && !p.vendedora_id), [verTudo, uid, isVendedora]);

  function irParaPedidos(filtro: FiltroPedidosDash, vendedoraChave: string) {
    setFiltroStatus(filtro);
    setFiltroDataInicio(""); setFiltroDataFim("");
    // Para a vendedora (ou filtro de uma vendedora no painel) a busca já traz só os pedidos dela.
    const nome = vendedoraChave
      ? pedidos.find(p => (p.vendedora_id ?? `nome:${p.vendedora_nome ?? "—"}`) === vendedoraChave)?.vendedora_nome ?? ""
      : !verTudo ? currentUserName ?? "" : "";
    setBuscaPedido(nome);
    setSubTab("pedidos");
  }

  function irParaHistorico(f: Partial<FiltroHistorico>) {
    setFiltroHist(v => ({ key: v.key + 1, f: { ...FILTRO_HISTORICO_PADRAO, ...f } }));
    setSubTab("historico");
  }

  function abrirNovoPedidoCom(c: Cliente | null) {
    setHistoricoClienteId(null);
    setPedidoComCliente(c);
    setNovoPedidoOpen(true);
  }

  const COMERCIAL_TABS = [
    { id: "dashboard" as SubTab, label: "Painel", Icon: LayoutDashboard, activeColor: "text-primary", activeBg: "bg-primary/10", activeBorder: "border-primary/40", badgeBg: "bg-primary/15", badgeText: "text-primary" },
    { id: "pedidos" as SubTab, label: "Pedidos", Icon: ShoppingBag, badge: pedidosPendentes, activeColor: "text-amber-600 dark:text-amber-400", activeBg: "bg-amber-500/10", activeBorder: "border-amber-500/40", badgeBg: "bg-amber-500/15", badgeText: "text-amber-600 dark:text-amber-400" },
    { id: "clientes" as SubTab, label: "Clientes", Icon: User, activeColor: "text-violet-600 dark:text-violet-400", activeBg: "bg-violet-500/10", activeBorder: "border-violet-500/40", badgeBg: "bg-violet-500/15", badgeText: "text-violet-600 dark:text-violet-400" },
    { id: "historico" as SubTab, label: "Histórico", Icon: History, activeColor: "text-cyan-600 dark:text-cyan-400", activeBg: "bg-cyan-500/10", activeBorder: "border-cyan-500/40", badgeBg: "bg-cyan-500/15", badgeText: "text-cyan-600 dark:text-cyan-400" },
    { id: "precos" as SubTab, label: "Preços", Icon: Tag, activeColor: "text-emerald-600 dark:text-emerald-400", activeBg: "bg-emerald-500/10", activeBorder: "border-emerald-500/40", badgeBg: "bg-emerald-500/15", badgeText: "text-emerald-600 dark:text-emerald-400" },
  ];

  // Enter confirma os modais abaixo, igual ao clique no mouse.
  useConfirmEnter(!!cancelarPedido, handleCancelar, cancelando);
  useConfirmEnter(!!removerItemPendente, handleRemoverItemConfirm, false);
  useConfirmEnter(!!deleteCliente, handleDeleteCliente, deletingCliente);

  const renderPedidoCard = (p: PedidoCompleto, expandido?: boolean) => (
    <PedidoCard key={p.id} pedido={p} isAdmin={verTudo} canConfirm={verTudo || isVendedora} clientes={clientes} onFaturar={setFaturarPedido} onCancelar={setCancelarPedido} onAdicionarPeca={setAdicionarPecaPedido} onDuplicar={handleDuplicar} onComentar={p => setComentarioPedidoId(p.id)}
      onReenviar={p => setPedidos(prev => prev.map(x => x.id === p.id ? { ...x, status: "pendente" as const } : x))}
      onRemoverItemComercial={(pedido, item) => setRemoverItemPendente({ pedido, item })}
      onEditarPedido={p => { setPedidoAbertoId(null); setEditarPedidoRetorno(p); }}
      podeEditarDados={podeEditarDados(p)} onEditarDados={setEditarDadosPedido} expandido={expandido} />
  );

  const chipsStatus: [FiltroStatus, string, number][] = [
    ["todos", "Todos", pedidos.length],
    ["pendente", "Aguardando", pedidosPendentes],
    ["separando", "Em separação", pedidos.filter(p => p.status === "separando").length],
    ["pronto", "Prontos", pedidos.filter(p => p.status === "pronto").length],
    ["enviado", "Faturados", pedidos.filter(p => p.status === "faturado" || p.status === "enviado").length],
    ["retorno", "Voltaram", pedidos.filter(p => p.status === "retorno").length],
    ["atrasados", "Atrasados", qtdAtrasados],
    ["cancelado", "Cancelados", pedidos.filter(p => p.status === "cancelado").length],
  ];

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="px-3 sm:px-4 h-12 sm:h-14 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <ShoppingBag className="h-4 w-4 text-violet-500 shrink-0" />
            <h1 className="text-sm font-semibold">Comercial</h1>
            {!loadingPedidos && pedidosPendentes > 0 && (
              <button type="button" onClick={() => irParaPedidos("pendente", "")} title="Pedidos aguardando confirmação"
                className="h-8 flex items-center gap-1 bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 text-xs font-bold px-2.5 rounded-full">
                <Clock className="h-3.5 w-3.5" />
                {pedidosPendentes}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {canAccess && (
              <Button size="sm" className="h-9 gap-1.5" onClick={() => abrirNovoPedidoCom(null)}>
                <Plus className="h-4 w-4" /><span className="hidden min-[400px]:inline">Novo pedido</span><span className="min-[400px]:hidden">Pedido</span>
              </Button>
            )}
            {/* Admin já tem o sino global no AppShell (mesma tabela) — evita sino e toast duplicados */}
            {user && !isAdmin && <NotificacoesBell userId={user.id} />}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto"><div className="px-3 sm:px-4 py-4 space-y-4">
        {!canAccess ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <ShoppingBag className="h-12 w-12 text-muted-foreground/20" />
            <p className="text-muted-foreground font-medium">Acesso restrito</p>
            <p className="text-sm text-muted-foreground/60">Esta área é exclusiva para vendedoras e administradores.</p>
          </div>
        ) : (
          <>
            <PageNav
              tabs={COMERCIAL_TABS}
              activeTab={subTab}
              onTabChange={setSubTab}
              loading={loadingPedidos}
              ariaLabel="Seções do Comercial"
            />

            {/* ── Aba Painel ── */}
            {subTab === "dashboard" && (
              <DashboardComercial
                pedidos={pedidos}
                loading={loadingPedidos}
                currentUserName={currentUserName}
                verTudo={verTudo}
                meus={meus}
                onIrPedidos={irParaPedidos}
                onIrHistorico={irParaHistorico}
                onAbrirCliente={setHistoricoClienteId}
              />
            )}

            {/* ── Aba Pedidos ── */}
            {subTab === "pedidos" && (
              <div className="space-y-3">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[12rem]">
                      <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input value={buscaPedido} onChange={e => setBuscaPedido(e.target.value)} placeholder="Cliente, nº do pedido, NF ou vendedora..." aria-label="Buscar pedido"
                        className="w-full h-11 pl-9 pr-9 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                      {buscaPedido && (
                        <button type="button" onClick={() => setBuscaPedido("")} aria-label="Limpar busca" className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                    {chipsStatus.filter(([id, , n]) => id !== "atrasados" || n > 0 || filtroStatus === id).map(([id, label, n]) => (
                      <button key={id} type="button" onClick={() => setFiltroStatus(id)} aria-pressed={filtroStatus === id}
                        className={cn("h-9 px-3 rounded-full text-sm font-medium border whitespace-nowrap flex items-center gap-1.5",
                          filtroStatus === id ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:border-primary/40",
                          id === "retorno" && n > 0 && filtroStatus !== id && "border-orange-500/50 text-orange-700 dark:text-orange-400",
                          id === "atrasados" && n > 0 && filtroStatus !== id && "border-red-500/50 text-red-700 dark:text-red-400")}>
                        {label}<span className={cn("text-xs tabular-nums", filtroStatus === id ? "opacity-90" : "opacity-70")}>{n}</span>
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 text-sm">
                    <span className="text-muted-foreground shrink-0">Período</span>
                    <input type="date" value={filtroDataInicio} onChange={e => setFiltroDataInicio(e.target.value)} aria-label="De"
                      className="h-9 min-w-0 flex-1 sm:flex-none rounded-lg border border-input bg-background px-2 text-sm" />
                    <span className="text-muted-foreground shrink-0">até</span>
                    <input type="date" value={filtroDataFim} onChange={e => setFiltroDataFim(e.target.value)} aria-label="Até"
                      className="h-9 min-w-0 flex-1 sm:flex-none rounded-lg border border-input bg-background px-2 text-sm" />
                    {(filtroDataInicio || filtroDataFim) && (
                      <button type="button" onClick={() => { setFiltroDataInicio(""); setFiltroDataFim(""); }} aria-label="Limpar período"
                        className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground"><X className="h-4 w-4" /></button>
                    )}
                  </div>
                </div>

                {loadingPedidos ? (
                  <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando pedidos...</div>
                ) : pedidosFiltrados.length === 0 ? (
                  <div className="rounded-2xl border bg-card text-center py-14 px-6 space-y-3">
                    <ShoppingBag className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                    <p className="font-medium">Nenhum pedido encontrado</p>
                    {(filtroStatus !== "todos" || buscaPedido || filtroDataInicio || filtroDataFim) ? (
                      <Button variant="outline" onClick={() => { setFiltroStatus("todos"); setBuscaPedido(""); setFiltroDataInicio(""); setFiltroDataFim(""); }}>Limpar filtros</Button>
                    ) : (
                      <Button onClick={() => abrirNovoPedidoCom(null)} className="gap-1.5"><Plus className="h-4 w-4" />Criar primeiro pedido</Button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {pedidosFiltrados.map(p => renderPedidoCard(p))}
                  </div>
                )}
              </div>
            )}

            {/* ── Aba Clientes ── */}
            {subTab === "clientes" && (
              <ClientesPanel
                clientes={clientes}
                pedidos={pedidos}
                loading={loadingClientes}
                isAdmin={isAdmin}
                verTudo={verTudo}
                qtdDuplicados={qtdDuplicados}
                onNovo={() => { setEditCliente(null); setClienteModal(true); }}
                onEditar={cl => { setEditCliente(cl); setClienteModal(true); }}
                onExcluir={setDeleteCliente}
                onPedido={cl => abrirNovoPedidoCom(cl)}
                onDetalhe={cl => setHistoricoClienteId(cl.id)}
                onDuplicados={() => setDuplicadosOpen(true)}
              />
            )}

            {/* ── Aba Histórico ── */}
            {subTab === "historico" && (
              <HistoricoPanel
                key={filtroHist.key}
                pedidos={pedidos}
                loading={loadingPedidos}
                verTudo={verTudo}
                meus={meus}
                inicial={filtroHist.f}
                onAbrirPedido={p => setPedidoAbertoId(p.id)}
                onMovimentacoes={() => setMovimentacoesOpen(true)}
              />
            )}

            {/* ── Aba Tabela de Preços ── */}
            {subTab === "precos" && (
              <TabelaPrecos modo="comercial" />
            )}
          </>
        )}
      </div>
      </main>

      {/* ── Pedido aberto (do Histórico / detalhe do cliente) ── */}
      <Dialog open={!!pedidoAberto} onOpenChange={v => !v && setPedidoAbertoId(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto overflow-x-hidden p-3 sm:p-4 gap-3 grid-cols-[minmax(0,1fr)]">
          <DialogHeader className="text-left px-1 pt-1">
            <DialogTitle>Pedido #{pedidoAberto?.id.slice(0, 8).toUpperCase()}</DialogTitle>
            <DialogDescription>{pedidoAberto ? new Date(pedidoAberto.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : ""}</DialogDescription>
          </DialogHeader>
          {pedidoAberto && renderPedidoCard(pedidoAberto, true)}
        </DialogContent>
      </Dialog>

      {/* ── Modais ── */}
      <Suspense fallback={null}>
        <NovoPedidoModal
          open={novoPedidoOpen || !!editarPedidoRetorno}
          onClose={() => { setNovoPedidoOpen(false); setPedidoComCliente(null); setDuplicandoPedido(null); setEditarPedidoRetorno(null); }}
          onSuccess={() => { setNovoPedidoOpen(false); setPedidoComCliente(null); setDuplicandoPedido(null); setEditarPedidoRetorno(null); loadPedidos(); }}
          clienteFixo={pedidoComCliente}
          duplicarDe={duplicandoPedido}
          editarPedido={editarPedidoRetorno}
        />
      </Suspense>

      <Suspense fallback={null}>
        <ClienteModal
          open={clienteModal}
          onClose={() => { setClienteModal(false); setEditCliente(null); }}
          onSuccess={() => { setClienteModal(false); setEditCliente(null); loadClientes(); }}
          inicial={editCliente}
        />
      </Suspense>

      <Suspense fallback={null}>
        <FaturarModal
          pedido={faturarPedido}
          onClose={() => setFaturarPedido(null)}
          onSuccess={() => { setFaturarPedido(null); loadPedidos(); }}
        />
      </Suspense>

      <Suspense fallback={null}>
        <AdicionarPecaModal
          pedido={adicionarPecaPedido}
          onClose={() => setAdicionarPecaPedido(null)}
          onSuccess={() => { setAdicionarPecaPedido(null); loadPedidos(); }}
        />
      </Suspense>

      <Suspense fallback={null}>
        <EditarDadosPedidoDialog
          pedido={editarDadosPedido}
          cliente={editarDadosPedido ? clientes.find(c => c.id === editarDadosPedido.cliente_id) ?? null : null}
          onClose={() => setEditarDadosPedido(null)}
          onSalvo={p => { setPedidos(prev => prev.map(x => x.id === p.id ? p : x)); setEditarDadosPedido(null); }}
        />
      </Suspense>

      {/* Cancelar pedido */}
      <AlertDialog open={!!cancelarPedido} onOpenChange={v => { if (!v && !cancelando) setCancelarPedido(null); }}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><Ban className="h-4 w-4 text-destructive" />Cancelar pedido?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground">{cancelarPedido?.cliente_nome}</strong><br />
              As peças reservadas voltarão a ficar disponíveis na expedição.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2">
            <AlertDialogCancel disabled={cancelando} className="flex-1 mt-0 h-11">Voltar</AlertDialogCancel>
            <AlertDialogAction disabled={cancelando} onClick={e => { e.preventDefault(); handleCancelar(); }} className="flex-1 h-11 gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {cancelando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}Cancelar pedido
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Excluir cliente */}
      <AlertDialog open={!!deleteCliente} onOpenChange={v => { if (!v && !deletingCliente) setDeleteCliente(null); }}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><Trash2 className="h-4 w-4 text-destructive" />Excluir cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground">{deleteCliente?.nome}</strong><br />
              {isAdmin ? "Como admin, você pode excluir este cliente mesmo que tenha pedidos vinculados. Os pedidos também serão removidos." : "Clientes com pedidos vinculados não podem ser excluídos."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2">
            <AlertDialogCancel disabled={deletingCliente} className="flex-1 mt-0 h-11">Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={deletingCliente} onClick={e => { e.preventDefault(); handleDeleteCliente(); }} className="flex-1 h-11 gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deletingCliente ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remover item de pedido pendente */}
      <AlertDialog open={!!removerItemPendente} onOpenChange={v => { if (!v) setRemoverItemPendente(null); }}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><X className="h-4 w-4 text-destructive" />Remover peça do pedido?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground">{removerItemPendente?.item.device_model}</strong><br />
              {removerItemPendente?.item.quantidade} un. voltam ao estoque disponível.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2">
            <AlertDialogCancel className="flex-1 mt-0 h-11">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={e => { e.preventDefault(); handleRemoverItemConfirm(); }} className="flex-1 h-11 gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90">
              <X className="h-4 w-4" />Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cadastros repetidos e movimentações da expedição */}
      <Suspense fallback={null}>
        <DuplicadosClientesDialog open={duplicadosOpen} onClose={() => setDuplicadosOpen(false)} clientes={clientes} onMesclado={() => { loadClientes(); loadPedidos(); }} />
        <HistoricoGeralModal open={movimentacoesOpen} onClose={() => setMovimentacoesOpen(false)} isAdmin={verTudo} />
      </Suspense>
      <Suspense fallback={null}>
        <HistoricoClienteModal
          clienteId={historicoClienteId}
          clientes={clientes}
          onClose={() => setHistoricoClienteId(null)}
          onEditar={cl => { setEditCliente(cl); setClienteModal(true); }}
          onNovoPedido={cl => abrirNovoPedidoCom(cl)}
          onAbrirPedido={id => { setHistoricoClienteId(null); setPedidoAbertoId(id); }}
        />
      </Suspense>
      <Suspense fallback={null}>
        <ComentariosModal
          pedidoId={comentarioPedidoId}
          onClose={() => setComentarioPedidoId(null)}
        />
      </Suspense>
    </div>
  );
}
