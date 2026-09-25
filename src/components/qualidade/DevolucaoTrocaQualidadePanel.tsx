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
 *  2. Lista as análises em aberto e já concluídas.
 *  3. "Analisar" — conclui a análise (devolução / troca / reprovado), grava
 *     o laudo, e altera a MESMA nota já criada (não cria uma nova). Isso:
 *       • Devolução aprovada → peça sai do Retrabalho e volta à Expedição
 *         (mesmo lote), e gera o crédito ("saldo") do cliente no Financeiro.
 *       • Troca aprovada → peça fica retida no Retrabalho para o Estoque
 *         decidir o reaproveitamento (fluxo "Concluir Retrabalho" já
 *         existente); o Financeiro fica livre para emitir a NF de troca.
 *       • Reprovado → nota cancelada, peça permanece retida, sem crédito.
 */
import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw, PlusCircle, X, Search, Undo2, Repeat2, Loader2, ChevronRight,
  AlertTriangle, CheckCircle2, Ban, User, FileText, Lock, ClipboardCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { friendlyError } from "@/lib/errorMessages";
import { formatBRL } from "@/lib/format";

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
  created_at: string;
}

interface PedidoBusca {
  id: string; cliente_nome: string; nota_fiscal: string | null;
  itens: {
    stock_item_id: string; quantidade: number; valor_unitario: number; lote: string | null;
    device_id?: string; device_model?: string; ncm?: string; cfop_padrao?: string;
  }[];
}

const BRL = formatBRL;

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

const Q_LABEL: Record<QStatus, string> = {
  em_analise: "Em análise", aprovado_devolucao: "Devolução aprovada",
  aprovado_troca: "Troca aprovada", reprovado: "Reprovado", outro: "—",
};
const Q_COLOR: Record<QStatus, string> = {
  em_analise: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  aprovado_devolucao: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30",
  aprovado_troca: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/30",
  reprovado: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
  outro: "bg-muted/40 text-muted-foreground border-border/40",
};

export function DevolucaoTrocaQualidadePanel() {
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<"aberto" | "concluido" | "todos">("aberto");
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
    setRegistros((data ?? []) as unknown as Registro[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtrados = registros.filter(r => {
    const q = qStatus(r);
    if (filtro === "aberto") return q === "em_analise";
    if (filtro === "concluido") return q !== "em_analise";
    return true;
  });

  const abertos = registros.filter(r => qStatus(r) === "em_analise").length;

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold">Devolução / Troca — Análise da Qualidade</h2>
          <p className="text-[12px] text-muted-foreground">
            Peças que voltaram com a NF de venda original, aguardando ou já analisadas pela Qualidade
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load}
            className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/30 text-muted-foreground">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button type="button" onClick={() => setModalOpen(true)}
            className="h-9 px-3 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-[12px] font-semibold flex items-center gap-1.5 transition-colors">
            <PlusCircle size={14} />
            Registrar retorno
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {([
          { id: "aberto", label: "Em análise", count: abertos },
          { id: "concluido", label: "Concluídas", count: registros.length - abertos },
          { id: "todos", label: "Todas", count: registros.length },
        ] as const).map(f => (
          <button key={f.id} type="button" onClick={() => setFiltro(f.id)}
            className={cn("h-8 px-3 rounded-full text-[11px] font-semibold border transition-all flex items-center gap-1.5",
              filtro === f.id ? "bg-orange-600 text-white border-orange-600"
                               : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50")}>
            {f.label}
            <span className={cn("text-[10px] px-1.5 rounded-full", filtro === f.id ? "bg-white/20" : "bg-muted")}>{f.count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>
      ) : filtrados.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <div className="h-16 w-16 rounded-2xl mx-auto flex items-center justify-center bg-muted/30">
            <ClipboardCheck size={28} className="text-muted-foreground/40" />
          </div>
          <p className="text-sm font-semibold">Nenhum retorno {filtro === "aberto" ? "em análise" : "registrado"}</p>
          <p className="text-[12px] text-muted-foreground/70">Clique em "Registrar retorno" quando uma peça voltar com a NF de venda</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {filtrados.map(r => {
            const q = qStatus(r);
            return (
              <button key={r.id} type="button" onClick={() => setAnalisar(r)}
                className="text-left rounded-2xl border border-border/50 bg-card p-3.5 hover:border-orange-400/50 transition-colors space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("h-6 w-6 rounded-lg flex items-center justify-center shrink-0",
                    r.tipo === "devolucao" ? "bg-orange-500/10 text-orange-600" : "bg-cyan-500/10 text-cyan-600")}>
                    {r.tipo === "devolucao" ? <Undo2 size={13} /> : <Repeat2 size={13} />}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground flex-1">
                    {q === "em_analise" ? "Aguardando decisão" : r.tipo === "devolucao" ? "Devolução" : "Troca"}
                  </span>
                  <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full border shrink-0", Q_COLOR[q])}>
                    {q === "em_analise" && <Lock size={9} className="inline mr-0.5 -mt-0.5" />}
                    {Q_LABEL[q]}
                  </span>
                </div>
                <p className="text-[13px] font-semibold truncate">{r.cliente_nome}</p>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>NF original: {r.nf_original_numero ?? "—"}</span>
                  <span className="font-semibold text-foreground">{BRL(r.valor_total)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <RegistrarRetornoModal onClose={() => setModalOpen(false)} onSuccess={() => { setModalOpen(false); load(); }} />
      )}
      {analisar && (
        <AnalisarModal registro={analisar} onClose={() => setAnalisar(null)} onDone={() => { setAnalisar(null); load(); }} />
      )}
    </div>
  );
}

// ─── Modal: registrar retorno físico ─────────────────────────────────────────

function RegistrarRetornoModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [busca, setBusca] = useState("");
  const [todos, setTodos] = useState<PedidoBusca[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<PedidoBusca[]>([]);
  const [pedido, setPedido] = useState<PedidoBusca | null>(null);
  const [selecionados, setSelecionados] = useState<Record<string, number>>({});
  const [observacao, setObservacao] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (carregado) return;
    setBuscando(true);
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
        if (error) { logger.error("busca pedido retorno qualidade:", error); setBuscando(false); return; }
        const mapped: PedidoBusca[] = ((data ?? []) as Record<string, unknown>[]).map(p => ({
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
        }));
        setTodos(mapped);
        setCarregado(true);
        setBuscando(false);
      });
  }, [carregado]);

  useEffect(() => {
    const q = busca.trim().toLowerCase();
    if (q.length < 2) { setResultados([]); return; }
    setResultados(todos.filter(p =>
      p.cliente_nome.toLowerCase().includes(q) ||
      (p.nota_fiscal ?? "").toLowerCase().includes(q) ||
      p.id.slice(0, 8).toLowerCase().includes(q)
    ).slice(0, 15));
  }, [busca, todos]);

  function selecionarPedido(p: PedidoBusca) {
    setPedido(p);
    setSelecionados({});
    setResultados([]);
    setBusca(p.nota_fiscal ?? p.cliente_nome);
  }

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
    if (itens.length === 0) { toast.error("Selecione ao menos um item recebido"); return; }
    if (itens.some(i => !i.lote)) {
      toast.error("Um dos itens selecionados não tem lote registrado na venda — não é possível preservar a rastreabilidade. Verifique o pedido.");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await (supabase.rpc as any)("iniciar_analise_qualidade_devolucao", {
        p_pedido_id: pedido.id, p_itens: itens, p_observacao: observacao || null,
      });
      if (error) throw error;
      const r = data as { ok?: boolean; error?: string } | null;
      if (!r?.ok) { toast.error(r?.error ?? "Erro ao registrar retorno"); return; }
      toast.success("Retorno registrado! Peças deram entrada no Retrabalho — nota travada até a análise concluir.");
      onSuccess();
    } catch (err) {
      toast.error(friendlyError(err));
      logger.error("RegistrarRetornoModal:", err);
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-t-2xl sm:rounded-2xl bg-card border border-border/40 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="px-5 pt-5 pb-3 border-b border-border/20 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-orange-500/15 flex items-center justify-center">
              <Undo2 className="h-4 w-4 text-orange-500" />
            </div>
            <span className="text-sm font-semibold">Registrar retorno físico</span>
          </div>
          <button type="button" onClick={onClose} disabled={saving}
            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-2.5 flex gap-2">
            <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[10.5px] text-amber-800 dark:text-amber-300">
              Registre aqui apenas quando a peça chegar fisicamente com a NF de venda. O tipo (devolução ou
              troca) você decide depois de analisar — por enquanto isto só dá entrada no Retrabalho e trava o
              pedido contra outra ação até a análise terminar.
            </p>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
            <input value={busca} onChange={e => { setBusca(e.target.value); setPedido(null); }}
              placeholder="Buscar por número da NF ou nome do cliente..."
              className="w-full h-9 pl-8 pr-3 rounded-xl border border-border bg-muted/20 text-[12px] outline-none focus:border-orange-400" />
          </div>
          {buscando && <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Carregando pedidos faturados...</p>}
          {resultados.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto rounded-xl border border-border/30 p-1.5">
              {resultados.map(p => (
                <button key={p.id} type="button" onClick={() => selecionarPedido(p)}
                  className="w-full text-left rounded-lg px-2.5 py-2 hover:bg-muted/30 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold truncate">{p.cliente_nome}</p>
                    <p className="text-[10px] text-muted-foreground">Pedido {p.id.slice(0, 8).toUpperCase()} · {p.nota_fiscal ?? "sem NF"}</p>
                  </div>
                  <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          )}
          {pedido && (
            <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-3 space-y-2">
              <div className="flex items-center gap-2"><User size={13} className="text-orange-600" /><p className="text-[12px] font-semibold">{pedido.cliente_nome}</p></div>
              <div className="flex items-center gap-2"><FileText size={13} className="text-orange-600" /><p className="text-[11px] text-muted-foreground">NF original: {pedido.nota_fiscal ?? "—"}</p></div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground pt-1">Itens que voltaram fisicamente</p>
              <div className="space-y-1.5">
                {pedido.itens.map(i => (
                  <div key={i.stock_item_id} className="flex items-center justify-between gap-2 rounded-lg bg-card px-2.5 py-1.5 border border-border/30">
                    <span className="text-[11px] truncate flex-1">
                      {i.device_model ?? "Produto"} <span className="text-muted-foreground">(máx. {i.quantidade}{i.lote ? ` · lote ${i.lote}` : " · sem lote!"})</span>
                    </span>
                    <input type="number" min={0} max={i.quantidade}
                      value={selecionados[i.stock_item_id] ?? 0}
                      onChange={e => setSelecionados(prev => ({ ...prev, [i.stock_item_id]: Math.max(0, Math.min(i.quantidade, parseInt(e.target.value) || 0)) }))}
                      className="w-16 h-7 rounded-lg border border-border/50 text-center text-[11px] outline-none focus:border-orange-400" />
                  </div>
                ))}
              </div>
              <textarea value={observacao} onChange={e => setObservacao(e.target.value)} rows={2}
                placeholder="Observação inicial (opcional) — ex: cliente relatou defeito no encaixe"
                className="w-full px-3 py-2 rounded-xl border border-border bg-muted/20 text-[12px] outline-none focus:border-orange-400 resize-none" />
            </div>
          )}
        </div>
        <div className="p-4 border-t border-border/20 shrink-0">
          <button type="button" onClick={confirmar} disabled={saving || !pedido}
            className="w-full h-10 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-[12px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
            {saving ? <><Loader2 size={14} className="animate-spin" /> Registrando...</> : <><Undo2 size={14} /> Registrar retorno e travar pedido</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: analisar e concluir ──────────────────────────────────────────────

function AnalisarModal({ registro, onClose, onDone }: { registro: Registro; onClose: () => void; onDone: () => void }) {
  const q = qStatus(registro);
  const jaConcluido = q !== "em_analise";
  const [decisao, setDecisao] = useState<"devolucao" | "troca" | "reprovado">("devolucao");
  const [laudo, setLaudo] = useState(jaConcluido ? qLaudo(registro) : "");
  const [saving, setSaving] = useState(false);

  async function concluir() {
    if (!laudo.trim()) { toast.error("Descreva o laudo da análise"); return; }
    setSaving(true);
    try {
      const { data, error } = await (supabase.rpc as any)("finalizar_analise_qualidade_devolucao", {
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
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-t-2xl sm:rounded-2xl bg-card border border-border/40 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="px-5 pt-5 pb-3 border-b border-border/20 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={cn("h-7 w-7 rounded-lg flex items-center justify-center", Q_COLOR[q])}>
              {q === "em_analise" ? <Lock size={14} /> : <CheckCircle2 size={14} />}
            </span>
            <span className="text-sm font-semibold">{jaConcluido ? "Análise concluída" : "Analisar retorno"}</span>
          </div>
          <button type="button" onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 text-[12px]">
          <div><span className="text-muted-foreground">Cliente:</span> <strong>{registro.cliente_nome}</strong></div>
          <div><span className="text-muted-foreground">NF original:</span> {registro.nf_original_numero ?? "—"}</div>
          <div className="space-y-1.5 pt-2 border-t border-border/20">
            {registro.itens.map(it => (
              <div key={it.id} className="flex items-center justify-between rounded-lg bg-muted/20 px-2.5 py-1.5">
                <span className="truncate">{it.descricao} <span className="text-muted-foreground">×{it.quantidade}{it.lote ? ` · lote ${it.lote}` : ""}</span></span>
                <span className="font-semibold shrink-0 ml-2">{BRL(it.quantidade * (parseFloat(it.valorUnitario) || 0))}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-border/20 font-bold">
            <span>Total</span><span>{BRL(registro.valor_total)}</span>
          </div>

          {jaConcluido ? (
            <div className={cn("rounded-lg p-3 border", Q_COLOR[q])}>
              <p className="font-bold mb-1">{Q_LABEL[q]}</p>
              <p className="whitespace-pre-wrap">{qLaudo(registro) || "(sem laudo registrado)"}</p>
            </div>
          ) : (
            <>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground pt-1">Decisão da Qualidade</p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { id: "devolucao" as const, label: "Devolução", desc: "Volta ao estoque + crédito", Icon: Undo2, cor: "border-orange-500 bg-orange-500/5" },
                  { id: "troca" as const, label: "Troca", desc: "Fica em retrabalho", Icon: Repeat2, cor: "border-cyan-500 bg-cyan-500/5" },
                  { id: "reprovado" as const, label: "Reprovar", desc: "Não procede", Icon: Ban, cor: "border-red-500 bg-red-500/5" },
                ]).map(d => (
                  <button key={d.id} type="button" onClick={() => setDecisao(d.id)}
                    className={cn("rounded-xl border-2 p-2.5 text-left transition-all", decisao === d.id ? d.cor : "border-border/40 hover:border-border")}>
                    <d.Icon size={14} className="mb-1" />
                    <p className="text-[11px] font-bold">{d.label}</p>
                    <p className="text-[9px] text-muted-foreground">{d.desc}</p>
                  </button>
                ))}
              </div>
              <textarea value={laudo} onChange={e => setLaudo(e.target.value)} rows={3}
                placeholder="Laudo da análise — o que foi constatado no lote, por que essa decisão..."
                className="w-full px-3 py-2 rounded-xl border border-border bg-muted/20 text-[12px] outline-none focus:border-orange-400 resize-none" />
            </>
          )}
        </div>
        {!jaConcluido && (
          <div className="p-4 border-t border-border/20 shrink-0">
            <button type="button" onClick={concluir} disabled={saving}
              className="w-full h-10 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-[12px] font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
              {saving ? <><Loader2 size={14} className="animate-spin" /> Concluindo...</> : <><CheckCircle2 size={14} /> Concluir análise</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default DevolucaoTrocaQualidadePanel;
