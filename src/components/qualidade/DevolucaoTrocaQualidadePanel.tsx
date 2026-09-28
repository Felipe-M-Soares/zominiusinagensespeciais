/**
 * DevolucaoTrocaQualidadePanel — Análise de Devolução/Troca (Qualidade)
 *
 * A mercadoria sempre volta acompanhada da NF de venda original. É a
 * Qualidade quem recebe e analisa fisicamente o lote, e só ela decide se o
 * caso é devolução ou troca. Este painel:
 *
 *  1. "Registrar retorno" — busca o pedido/NF original faturado, seleciona
 *     os itens e quantidades que fisicamente chegaram de volta, e chama a
 *     RPC iniciar_analise_qualidade_devolucao. Isso cria o rascunho da nota
 *     (mesma tabela do Financeiro — notas_devolucao_troca) e dá entrada das
 *     peças no Retrabalho do Estoque, com o MESMO LOTE da venda, travando o
 *     pedido contra uma segunda análise concorrente.
 *  2. Lista as análises em aberto e já concluídas (KPIs clicáveis, busca).
 *  3. "Analisar" — conclui a análise (devolução / troca / reprovado), grava
 *     o laudo, e altera a MESMA nota já criada (não cria uma nova). Isso:
 *       • Devolução aprovada → peça sai do Retrabalho e volta à Expedição
 *         (mesmo lote), e gera o crédito ("saldo") do cliente no Financeiro.
 *       • Troca aprovada → peça fica retida no Retrabalho para o Estoque
 *         decidir o reaproveitamento (fluxo "Concluir Retrabalho" já
 *         existente); o Financeiro fica livre para emitir a NF de troca.
 *       • Reprovado → nota cancelada, peça permanece retida, sem crédito.
 *
 * Escrita só pelas RPCs (a tabela não libera UPDATE direto para Qualidade):
 * análise concluída fica somente leitura — é o registro de rastreabilidade.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Ban, CheckCircle2, ChevronRight, ClipboardCheck, FileText, Loader2, Lock, Minus, Plus, PlusCircle,
  RefreshCw, Repeat2, Undo2, User,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { untypedRpc } from "@/lib/untypedRpc";
import { logger } from "@/lib/logger";
import { friendlyError } from "@/lib/errorMessages";
import { formatBRL } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { CampoBusca, Chip, Etapas, KpiCard, ListaSkeleton, SELECT_CLS, Vazio, fmtDia, type Tom } from "./shared";

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface ItemNota {
  id: string; descricao: string; ncm: string; cfop: string;
  quantidade: number; valorUnitario: string; aliqICMS: string; cst: string;
  device_id?: string; lote?: string; stock_item_id?: string;
}

interface Registro {
  id: string; tipo: "devolucao" | "troca"; pedido_id: string | null;
  cliente_nome: string; nf_original_numero: string | null;
  motivo: string; itens: ItemNota[]; valor_total: number;
  status: "rascunho" | "autorizada" | "rejeitada" | "cancelada";
  status_msg: string | null; numero: string | null; tipo_nota: string;
  created_at: string; updated_at?: string | null;
}

interface PedidoBusca {
  id: string; cliente_nome: string; nota_fiscal: string | null;
  itens: {
    stock_item_id: string; quantidade: number; valor_unitario: number; lote: string | null;
    device_id?: string; device_model?: string; ncm?: string; cfop_padrao?: string;
  }[];
}

// Deriva um "sub-status" de qualidade a partir do status_msg (convenção
// "[QUALIDADE:xxx] laudo..." — não é uma coluna nova, reaproveita o campo
// de mensagem já existente na tabela do Financeiro).
type QStatus = "em_analise" | "aprovado_devolucao" | "aprovado_troca" | "reprovado" | "outro";
function qStatus(r: Registro): QStatus {
  const m = r.status_msg ?? "";
  if (m.startsWith("[QUALIDADE:em_analise]")) return "em_analise";
  if (m.startsWith("[QUALIDADE:aprovado_devolucao]")) return "aprovado_devolucao";
  if (m.startsWith("[QUALIDADE:aprovado_troca]")) return "aprovado_troca";
  if (m.startsWith("[QUALIDADE:reprovado]")) return "reprovado";
  return "outro";
}
function qLaudo(r: Registro): string {
  return (r.status_msg ?? "").replace(/^\[QUALIDADE:[a-z_]+\]\s*/, "");
}

const Q_INFO: Record<QStatus, { label: string; tom: Tom }> = {
  em_analise:         { label: "Aguardando análise", tom: "atencao" },
  aprovado_devolucao: { label: "Devolução aprovada", tom: "laranja" },
  aprovado_troca:     { label: "Troca aprovada",     tom: "ciano" },
  reprovado:          { label: "Reprovado",          tom: "perigo" },
  outro:              { label: "—",                  tom: "neutro" },
};

const ETAPAS_DEV = ["Retorno recebido", "Em análise", "Decisão"];

type Filtro = "aberto" | "concluido" | "todos" | "aprovado_devolucao" | "aprovado_troca" | "reprovado";
const FILTROS: { id: Filtro; label: string }[] = [
  { id: "aberto", label: "Aguardando análise" },
  { id: "concluido", label: "Concluídas" },
  { id: "aprovado_devolucao", label: "Devoluções aprovadas" },
  { id: "aprovado_troca", label: "Trocas aprovadas" },
  { id: "reprovado", label: "Reprovadas" },
  { id: "todos", label: "Todas" },
];

// ─── Painel ──────────────────────────────────────────────────────────────────

export function DevolucaoTrocaQualidadePanel({ filtroInicial, onMudou }: { filtroInicial?: string | null; onMudou?: () => void } = {}) {
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>(() => FILTROS.some(f => f.id === filtroInicial) ? filtroInicial as Filtro : "aberto");
  const [busca, setBusca] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [analisar, setAnalisar] = useState<Registro | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("notas_devolucao_troca")
      .select("*")
      .like("status_msg", "[QUALIDADE:%")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) { toast.error(friendlyError(error)); setLoading(false); return; }
    setRegistros(((data ?? []) as unknown as Registro[]).map(r => ({ ...r, itens: Array.isArray(r.itens) ? r.itens : [], valor_total: Number(r.valor_total ?? 0) })));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const cont = useMemo(() => {
    const c = { aberto: 0, aprovado_devolucao: 0, aprovado_troca: 0, reprovado: 0, valorAberto: 0 };
    for (const r of registros) {
      const q = qStatus(r);
      if (q === "em_analise") { c.aberto++; c.valorAberto += r.valor_total; }
      else if (q === "aprovado_devolucao") c.aprovado_devolucao++;
      else if (q === "aprovado_troca") c.aprovado_troca++;
      else if (q === "reprovado") c.reprovado++;
    }
    return c;
  }, [registros]);

  const filtrados = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return registros.filter(r => {
      const q = qStatus(r);
      if (filtro === "aberto" && q !== "em_analise") return false;
      if (filtro === "concluido" && q === "em_analise") return false;
      if ((filtro === "aprovado_devolucao" || filtro === "aprovado_troca" || filtro === "reprovado") && q !== filtro) return false;
      if (!b) return true;
      const texto = `${r.cliente_nome} ${r.nf_original_numero ?? ""} ${r.itens.map(i => `${i.descricao} ${i.lote ?? ""}`).join(" ")}`.toLowerCase();
      return texto.includes(b);
    }).sort((a, b) => filtro === "aberto" ? a.created_at.localeCompare(b.created_at) : 0);
  }, [registros, filtro, busca]);

  const alternar = (f: Filtro) => setFiltro(atual => atual === f ? "todos" : f);
  const recarregar = () => { load(); onMudou?.(); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground flex-1 min-w-[14rem]">
          Peças que voltaram com a NF de venda original. Registre o retorno quando chegar e conclua com o laudo — só então o Financeiro gera o crédito ou a NF de troca.
        </p>
        <Button className="h-11 gap-1.5 w-full sm:w-auto" onClick={() => setModalOpen(true)}>
          <PlusCircle className="h-4 w-4" />Registrar retorno
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Aguardando análise" value={cont.aberto} Icon={Lock} tom={cont.aberto > 0 ? "atencao" : "ok"}
          sub={cont.aberto > 0 ? `${formatBRL(cont.valorAberto)} travados` : "nada pendente"} ativo={filtro === "aberto"} onClick={() => alternar("aberto")} />
        <KpiCard label="Devoluções aprovadas" value={cont.aprovado_devolucao} Icon={Undo2} tom="laranja"
          sub="voltaram ao estoque + crédito" ativo={filtro === "aprovado_devolucao"} onClick={() => alternar("aprovado_devolucao")} />
        <KpiCard label="Trocas aprovadas" value={cont.aprovado_troca} Icon={Repeat2} tom="ciano"
          sub="retidas no retrabalho" ativo={filtro === "aprovado_troca"} onClick={() => alternar("aprovado_troca")} />
        <KpiCard label="Reprovadas" value={cont.reprovado} Icon={Ban} tom={cont.reprovado > 0 ? "perigo" : "neutro"}
          sub="não procede — sem crédito" ativo={filtro === "reprovado"} onClick={() => alternar("reprovado")} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CampoBusca value={busca} onChange={setBusca} placeholder="Cliente, NF original, produto ou lote..." />
        <select value={filtro} onChange={e => setFiltro(e.target.value as Filtro)} aria-label="Situação" className={cn(SELECT_CLS, "w-auto flex-1 sm:flex-none")}>
          {FILTROS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={load} disabled={loading} aria-label="Atualizar">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="rounded-2xl border bg-card overflow-hidden">
        {loading && registros.length === 0 ? <ListaSkeleton /> : filtrados.length === 0 ? (
          <Vazio Icon={ClipboardCheck}
            titulo={busca ? "Nenhum retorno encontrado" : filtro === "aberto" ? "Nenhum retorno aguardando análise" : "Nenhum retorno neste filtro"}
            dica={busca ? "Confira o nome do cliente ou o número da NF." : "Quando uma peça voltar com a NF de venda, clique em “Registrar retorno”."}
            acao={!busca ? <Button variant="outline" className="h-11 gap-1.5" onClick={() => setModalOpen(true)}><PlusCircle className="h-4 w-4" />Registrar retorno</Button> : undefined} />
        ) : (
          <ul className="divide-y">
            {filtrados.map(r => {
              const q = qStatus(r);
              const info = Q_INFO[q];
              const pecas = r.itens.reduce((s, i) => s + (Number(i.quantidade) || 0), 0);
              const concluido = q !== "em_analise";
              return (
                <li key={r.id}>
                  <button type="button" onClick={() => setAnalisar(r)}
                    className="w-full text-left p-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem_9rem] lg:items-center hover:bg-muted/30 transition-colors">
                    <div className="flex items-start gap-3 min-w-0">
                      <span className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0",
                        !concluido ? "bg-amber-500/10 text-amber-600" : r.tipo === "devolucao" ? "bg-orange-500/10 text-orange-600" : "bg-cyan-500/10 text-cyan-600")}>
                        {!concluido ? <Lock className="h-4 w-4" /> : r.tipo === "devolucao" ? <Undo2 className="h-4 w-4" /> : <Repeat2 className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold truncate">{r.cliente_nome}</p>
                          <p className="font-bold tabular-nums shrink-0 lg:hidden">{formatBRL(r.valor_total)}</p>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          NF original {r.nf_original_numero ?? "—"} · {pecas} peça{pecas !== 1 ? "s" : ""} · recebido em {fmtDia(r.created_at)}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          <Chip tom={info.tom}>{!concluido && <Lock className="h-3 w-3" />}{info.label}</Chip>
                          {r.itens.slice(0, 2).map(i => i.lote && <Chip key={i.id} className="font-mono">lote {i.lote}</Chip>)}
                          {r.itens.length > 2 && <Chip>+{r.itens.length - 2}</Chip>}
                        </div>
                      </div>
                    </div>
                    <Etapas etapas={ETAPAS_DEV} atual={concluido ? 2 : 1} concluido={concluido}
                      tom={q === "reprovado" ? "perigo" : concluido ? "ok" : "atencao"} />
                    <div className="hidden lg:flex items-center gap-3 justify-end">
                      <p className="font-bold tabular-nums">{formatBRL(r.valor_total)}</p>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {modalOpen && (
        <RegistrarRetornoModal onClose={() => setModalOpen(false)} onSuccess={() => { setModalOpen(false); setFiltro("aberto"); recarregar(); }} />
      )}
      {analisar && (
        <AnalisarModal registro={analisar} onClose={() => setAnalisar(null)} onDone={() => { setAnalisar(null); recarregar(); }} />
      )}
    </div>
  );
}

// ─── Modal: registrar retorno físico ─────────────────────────────────────────

function RegistrarRetornoModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [busca, setBusca] = useState("");
  const [todos, setTodos] = useState<PedidoBusca[]>([]);
  const [buscando, setBuscando] = useState(true);
  const [erroCarga, setErroCarga] = useState(false);
  const [pedido, setPedido] = useState<PedidoBusca | null>(null);
  const [selecionados, setSelecionados] = useState<Record<string, number>>({});
  const [observacao, setObservacao] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("pedidos_comerciais")
      .select(`
        id, nota_fiscal,
        clientes(nome),
        pedido_itens(stock_item_id, quantidade, valor_unitario, lote,
          stock_items(device_id, devices(model, ncm, cfop_padrao)))
      `)
      .in("status", ["faturado", "enviado"])
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (error) { logger.error("busca pedido retorno qualidade:", error); setErroCarga(true); setBuscando(false); return; }
        setTodos(((data ?? []) as Record<string, unknown>[]).map(p => ({
          id: p.id as string,
          cliente_nome: ((p.clientes as Record<string, unknown> | null)?.nome as string) ?? "(sem nome)",
          nota_fiscal: p.nota_fiscal as string | null,
          itens: ((p.pedido_itens as Record<string, unknown>[]) ?? []).map(i => {
            const si = i.stock_items as Record<string, unknown> | null;
            const dev = si?.devices as Record<string, unknown> | null;
            return {
              stock_item_id: i.stock_item_id as string,
              quantidade: i.quantidade as number,
              valor_unitario: (i.valor_unitario as number) ?? 0,
              lote: (i.lote as string | null) ?? null,
              device_id: si?.device_id as string | undefined,
              device_model: dev?.model as string | undefined,
              ncm: dev?.ncm as string | undefined,
              cfop_padrao: dev?.cfop_padrao as string | undefined,
            };
          }),
        })));
        setBuscando(false);
      });
  }, []);

  const resultados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (q.length < 2) return [];
    return todos.filter(p =>
      p.cliente_nome.toLowerCase().includes(q) ||
      (p.nota_fiscal ?? "").toLowerCase().includes(q) ||
      p.id.slice(0, 8).toLowerCase().includes(q)
    ).slice(0, 15);
  }, [busca, todos]);

  function selecionarPedido(p: PedidoBusca) {
    setPedido(p);
    setSelecionados({});
  }

  const setQtd = (id: string, max: number, v: number) => setSelecionados(prev => ({ ...prev, [id]: Math.max(0, Math.min(max, v || 0)) }));
  const totalSel = pedido ? pedido.itens.reduce((s, i) => s + (selecionados[i.stock_item_id] ?? 0) * i.valor_unitario, 0) : 0;
  const pecasSel = Object.values(selecionados).reduce((s, n) => s + n, 0);

  async function confirmar() {
    if (!pedido) return;
    const itens: ItemNota[] = pedido.itens
      .filter(i => (selecionados[i.stock_item_id] ?? 0) > 0)
      .map(i => ({
        id: Math.random().toString(36).slice(2),
        descricao: i.device_model ?? "Produto", ncm: i.ncm ?? "90213990", cfop: "1202",
        quantidade: selecionados[i.stock_item_id], valorUnitario: i.valor_unitario.toFixed(2),
        aliqICMS: "12.00", cst: "00",
        device_id: i.device_id, lote: i.lote ?? undefined, stock_item_id: i.stock_item_id,
      }));
    if (itens.length === 0) { toast.error("Informe a quantidade de ao menos um item que voltou"); return; }
    if (itens.some(i => !i.lote)) {
      toast.error("Um dos itens selecionados não tem lote registrado na venda — não é possível preservar a rastreabilidade. Verifique o pedido.");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await untypedRpc("iniciar_analise_qualidade_devolucao", {
        p_pedido_id: pedido.id, p_itens: itens, p_observacao: observacao.trim() || null,
      });
      if (error) throw error;
      const r = data as { ok?: boolean; error?: string } | null;
      if (!r?.ok) { toast.error(r?.error ?? "Erro ao registrar retorno"); return; }
      toast.success("Retorno registrado! Peças deram entrada no Retrabalho — pedido travado até a análise concluir.");
      onSuccess();
    } catch (err) {
      toast.error(friendlyError(err));
      logger.error("RegistrarRetornoModal:", err);
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && !saving && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="text-left pr-6">
          <DialogTitle className="flex items-center gap-2"><Undo2 className="h-5 w-5 text-orange-500" />Registrar retorno físico</DialogTitle>
          <DialogDescription>
            Só registre quando a peça chegar com a NF de venda. Devolução ou troca você decide depois, na análise — agora as peças só entram no Retrabalho (mesmo lote) e o pedido fica travado.
          </DialogDescription>
        </DialogHeader>

        {!pedido ? (
          <div className="space-y-3">
            <CampoBusca value={busca} onChange={setBusca} placeholder="Nº da NF, nome do cliente ou nº do pedido..." autoFocus className="min-w-0" />
            {buscando ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Carregando pedidos faturados...</p>
            ) : erroCarga ? (
              <p className="text-sm text-red-600">Não foi possível carregar os pedidos faturados. Feche e tente de novo.</p>
            ) : busca.trim().length < 2 ? (
              <p className="text-xs text-muted-foreground">Digite ao menos 2 letras. {todos.length} pedidos faturados/enviados disponíveis.</p>
            ) : resultados.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nenhum pedido faturado encontrado.</p>
            ) : (
              <ul className="rounded-2xl border divide-y overflow-hidden">
                {resultados.map(p => (
                  <li key={p.id}>
                    <button type="button" onClick={() => selecionarPedido(p)} className="w-full text-left px-3 py-3 hover:bg-muted/40 flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{p.cliente_nome}</p>
                        <p className="text-xs text-muted-foreground">Pedido #{p.id.slice(0, 8).toUpperCase()} · {p.nota_fiscal ? `NF ${p.nota_fiscal}` : "sem NF"} · {p.itens.length} item(ns)</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-2xl border border-orange-500/30 bg-orange-500/5 p-3 flex items-start gap-3">
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-sm font-semibold flex items-center gap-1.5"><User className="h-4 w-4 text-orange-600 shrink-0" /><span className="truncate">{pedido.cliente_nome}</span></p>
                <p className="text-xs text-muted-foreground flex items-center gap-1.5"><FileText className="h-3.5 w-3.5 shrink-0" />NF original {pedido.nota_fiscal ?? "—"} · pedido #{pedido.id.slice(0, 8).toUpperCase()}</p>
              </div>
              <Button variant="ghost" size="sm" className="h-9 shrink-0" onClick={() => setPedido(null)} disabled={saving}>Outro pedido</Button>
            </div>

            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quantas peças voltaram fisicamente?</p>
            <ul className="rounded-2xl border divide-y">
              {pedido.itens.map(i => {
                const v = selecionados[i.stock_item_id] ?? 0;
                return (
                  <li key={i.stock_item_id} className="p-3 flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[10rem]">
                      <p className="text-sm font-medium">{i.device_model ?? "Produto"}</p>
                      <p className={cn("text-xs", i.lote ? "text-muted-foreground" : "text-red-600 font-medium")}>
                        vendidas {i.quantidade} · {i.lote ? `lote ${i.lote}` : "sem lote na venda!"} · {formatBRL(i.valor_unitario)}/un.
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="outline" size="icon" className="h-11 w-11" onClick={() => setQtd(i.stock_item_id, i.quantidade, v - 1)} disabled={v <= 0} aria-label="Diminuir"><Minus className="h-4 w-4" /></Button>
                      <input type="number" inputMode="numeric" min={0} max={i.quantidade} value={v}
                        onChange={e => setQtd(i.stock_item_id, i.quantidade, parseInt(e.target.value))}
                        aria-label={`Quantidade devolvida de ${i.device_model ?? "produto"}`}
                        className="w-16 h-11 rounded-xl border border-input bg-background text-center text-sm tabular-nums" />
                      <Button type="button" variant="outline" size="icon" className="h-11 w-11" onClick={() => setQtd(i.stock_item_id, i.quantidade, v + 1)} disabled={v >= i.quantidade} aria-label="Aumentar"><Plus className="h-4 w-4" /></Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <Textarea value={observacao} onChange={e => setObservacao(e.target.value)} rows={2}
              placeholder="Observação inicial (opcional) — ex: cliente relatou defeito no encaixe" />
            {pecasSel > 0 && <p className="text-sm text-right">{pecasSel} peça(s) · <strong>{formatBRL(totalSel)}</strong></p>}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="h-11 gap-1.5" onClick={confirmar} disabled={saving || !pedido || pecasSel === 0}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
            {saving ? "Registrando..." : "Registrar e travar pedido"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Modal: analisar e concluir ──────────────────────────────────────────────

const DECISOES = [
  { id: "devolucao" as const, label: "Devolução", desc: "Volta à Expedição (mesmo lote) + crédito do cliente", Icon: Undo2, cor: "border-orange-500 bg-orange-500/10" },
  { id: "troca" as const, label: "Troca", desc: "Fica retida no Retrabalho; Financeiro emite NF de troca", Icon: Repeat2, cor: "border-cyan-500 bg-cyan-500/10" },
  { id: "reprovado" as const, label: "Reprovar", desc: "Não procede: nota cancelada, sem crédito", Icon: Ban, cor: "border-red-500 bg-red-500/10" },
];

function AnalisarModal({ registro, onClose, onDone }: { registro: Registro; onClose: () => void; onDone: () => void }) {
  const q = qStatus(registro);
  const jaConcluido = q !== "em_analise";
  const [decisao, setDecisao] = useState<"devolucao" | "troca" | "reprovado">("devolucao");
  const [laudo, setLaudo] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const info = Q_INFO[q];
  const dec = DECISOES.find(d => d.id === decisao)!;

  async function concluir() {
    setSaving(true);
    try {
      const { data, error } = await untypedRpc("finalizar_analise_qualidade_devolucao", {
        p_id: registro.id, p_decisao: decisao, p_laudo: laudo.trim(),
      });
      if (error) throw error;
      const r = data as { ok?: boolean; error?: string } | null;
      if (!r?.ok) { toast.error(r?.error ?? "Erro ao concluir análise"); return; }
      const msg = decisao === "devolucao"
        ? "Devolução aprovada! Peça voltou ao estoque (mesmo lote) e o crédito do cliente foi gerado no Financeiro."
        : decisao === "troca"
        ? "Troca aprovada! Peça retida no Retrabalho — o Financeiro já pode emitir a NF de troca."
        : "Análise reprovada — nota cancelada, peça permanece retida para decisão do Estoque.";
      toast.success(msg, { duration: 6000 });
      onDone();
    } catch (err) {
      toast.error(friendlyError(err));
      logger.error("AnalisarModal:", err);
    } finally { setSaving(false); setConfirmar(false); }
  }

  function pedirConfirmacao() {
    if (!laudo.trim()) { toast.error("Descreva o laudo da análise"); return; }
    setConfirmar(true);
  }

  return (
    <>
      <Dialog open onOpenChange={o => !o && !saving && onClose()}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader className="text-left pr-6">
            <DialogTitle>{jaConcluido ? "Análise concluída" : "Analisar retorno"}</DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-2">
              <span>{registro.cliente_nome} · NF original {registro.nf_original_numero ?? "—"}</span>
              <Chip tom={info.tom}>{!jaConcluido && <Lock className="h-3 w-3" />}{info.label}</Chip>
            </DialogDescription>
          </DialogHeader>

          <Etapas etapas={ETAPAS_DEV} atual={jaConcluido ? 2 : 1} concluido={jaConcluido}
            tom={q === "reprovado" ? "perigo" : jaConcluido ? "ok" : "atencao"} />

          <div className="rounded-2xl border overflow-hidden">
            <ul className="divide-y">
              {registro.itens.map(it => (
                <li key={it.id} className="px-3 py-2.5 flex items-center gap-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{it.descricao}</p>
                    <p className="text-xs text-muted-foreground">{it.quantidade} un.{it.lote ? ` · lote ${it.lote}` : ""} · {formatBRL(parseFloat(it.valorUnitario) || 0)}/un.</p>
                  </div>
                  <p className="font-semibold tabular-nums shrink-0">{formatBRL(it.quantidade * (parseFloat(it.valorUnitario) || 0))}</p>
                </li>
              ))}
            </ul>
            <div className="px-3 py-2.5 border-t bg-muted/30 flex items-center justify-between text-sm font-bold">
              <span>Total</span><span className="tabular-nums">{formatBRL(registro.valor_total)}</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Recebido em {fmtDia(registro.created_at)}{jaConcluido && registro.updated_at ? ` · concluído em ${fmtDia(registro.updated_at)}` : ""}</p>

          {jaConcluido ? (
            <div className="rounded-2xl border p-3 space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" />Laudo (registro fechado — rastreabilidade)</p>
              <p className="text-sm whitespace-pre-wrap">{qLaudo(registro) || "(sem laudo registrado)"}</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Decisão da Qualidade</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Decisão">
                {DECISOES.map(d => (
                  <button key={d.id} type="button" role="radio" aria-checked={decisao === d.id} onClick={() => setDecisao(d.id)}
                    className={cn("rounded-xl border-2 p-3 text-left transition-colors flex sm:block items-start gap-3", decisao === d.id ? d.cor : "border-border hover:border-muted-foreground/40")}>
                    <d.Icon className="h-5 w-5 shrink-0 sm:mb-1.5" />
                    <span className="block">
                      <span className="block text-sm font-bold">{d.label}</span>
                      <span className="block text-xs text-muted-foreground">{d.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Laudo da análise *</span>
                <Textarea value={laudo} onChange={e => setLaudo(e.target.value)} rows={4}
                  placeholder="O que foi constatado no lote e por que essa decisão..." />
              </label>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-11" onClick={onClose} disabled={saving}>{jaConcluido ? "Fechar" : "Cancelar"}</Button>
            {!jaConcluido && (
              <Button className="h-11 gap-1.5" onClick={pedirConfirmacao} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Concluir análise
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmar} onOpenChange={o => !saving && setConfirmar(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" />Concluir como “{dec.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {dec.desc}. Depois de concluída, a análise não pode ser alterada (fica registrada para rastreabilidade).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Voltar</AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={e => { e.preventDefault(); concluir(); }}
              className={cn(decisao === "reprovado" && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default DevolucaoTrocaQualidadePanel;
