/**
 * FluxoCaixaPanel — Fluxo de Caixa + Controle de Pagamentos por Cliente
 * 
 * Usa contas_financeiras + pedidos_comerciais + clientes (já existentes).
 * - Fluxo de caixa mensal (6 meses)
 * - Aging de inadimplência
 * - Projeção próximos 30 dias
 * - Controle de pagamentos: clientes que pagaram / devem / em aberto
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import {
  TrendingUp, TrendingDown, AlertTriangle, RefreshCw,
  BarChart3, Clock, DollarSign, Download, User, CheckCircle2,
  XCircle, AlertCircle, ChevronDown, ChevronUp, Search,
} from "lucide-react";
import { toast } from "sonner";

interface Conta {
  id: string;
  tipo: "pagar" | "receber";
  descricao: string;
  valor: number;
  data_vencimento: string;
  data_emissao: string;
  data_pagamento: string | null;
  status: string;
  categoria: string;
  nota_fiscal: string | null;
  observacoes: string | null;
  pedido_id: string | null;
  fornecedor_id: string | null;
  // Joined via pedido
  cliente_nome?: string;
  cliente_id?: string;
}

const BRL = formatBRL;

const MESES_LABEL = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

function getMes(iso: string) {
  const d = new Date(iso + "T12:00:00");
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function diasAtraso(vencimento: string): number {
  return Math.floor((Date.now() - new Date(vencimento + "T12:00:00").getTime()) / 86400000);
}

// ── Tipos de visualização ─────────────────────────────────────────────────────
type Vis = "fluxo" | "clientes" | "aging" | "projecao";

// ── Fluxo de caixa mensal ─────────────────────────────────────────────────────
function FluxoCaixa({ contas }: { contas: Conta[] }) {
  const meses = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return {
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: `${MESES_LABEL[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`,
      };
    });
  }, []);

  const data = useMemo(() =>
    meses.map(({ key, label }) => {
      const ref = (c: Conta) => getMes(c.data_pagamento || c.data_vencimento) === key;
      const entradas = contas.filter(c => c.tipo === "receber" && c.status === "pago" && ref(c)).reduce((s, c) => s + c.valor, 0);
      const saidas   = contas.filter(c => c.tipo === "pagar"   && c.status === "pago" && ref(c)).reduce((s, c) => s + c.valor, 0);
      return { key, label, entradas, saidas, saldo: entradas - saidas };
    }), [contas, meses]);

  const maxVal = Math.max(...data.flatMap(d => [d.entradas, d.saidas]), 1);

  return (
    <div className="rounded-2xl border border-border/40 bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-primary" />
        <p className="text-sm font-bold">Fluxo de Caixa — últimos 6 meses</p>
      </div>
      <div className="flex items-end gap-2 h-36">
        {data.map((d) => (
          <div key={d.key} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex gap-0.5 items-end h-28">
              <div className="flex-1 flex flex-col justify-end" title={`Entradas: ${BRL(d.entradas)}`}>
                <div className="rounded-t-sm bg-emerald-500/80 transition-all duration-500"
                  style={{ height: `${Math.max(2, (d.entradas / maxVal) * 100)}%` }} />
              </div>
              <div className="flex-1 flex flex-col justify-end" title={`Saídas: ${BRL(d.saidas)}`}>
                <div className="rounded-t-sm bg-red-400/80 transition-all duration-500"
                  style={{ height: `${Math.max(2, (d.saidas / maxVal) * 100)}%` }} />
              </div>
            </div>
            <p className="text-[9px] text-muted-foreground">{d.label}</p>
            <p className={cn("text-[9px] font-bold", d.saldo >= 0 ? "text-emerald-600" : "text-red-500")}>
              {d.saldo >= 0 ? "+" : ""}{BRL(d.saldo)}
            </p>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500/80 inline-block"/>Recebido</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red-400/80 inline-block"/>Pago</span>
      </div>
    </div>
  );
}

// ── Controle de pagamentos por cliente ────────────────────────────────────────
interface ClienteResumo {
  nome: string;
  totalReceber: number;
  totalVencido: number;
  totalPago: number;
  quantAberto: number;
  quantVencido: number;
  quantPago: number;
  contas: Conta[];
}

function ControlePagamentos({ contas }: { contas: Conta[] }) {
  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "devedores" | "quitados" | "vencidos">("todos");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);

  // Agrupa contas a receber por cliente (extraído da descrição ou pedido)
  const clientes = useMemo<ClienteResumo[]>(() => {
    const map: Record<string, ClienteResumo> = {};
    for (const c of contas.filter(c => c.tipo === "receber")) {
      // Extrai nome do cliente da descrição (ex: "NF-e 001 — João Silva")
      const nome = c.cliente_nome || c.descricao.split("—")[1]?.trim() || c.descricao;
      if (!map[nome]) {
        map[nome] = { nome, totalReceber: 0, totalVencido: 0, totalPago: 0,
                      quantAberto: 0, quantVencido: 0, quantPago: 0, contas: [] };
      }
      map[nome].contas.push(c);
      if (c.status === "pago") {
        map[nome].totalPago += c.valor;
        map[nome].quantPago++;
      } else if (c.status === "vencido") {
        map[nome].totalVencido += c.valor;
        map[nome].totalReceber += c.valor;
        map[nome].quantVencido++;
      } else {
        map[nome].totalReceber += c.valor;
        map[nome].quantAberto++;
      }
    }
    return Object.values(map).sort((a, b) => b.totalVencido - a.totalVencido || b.totalReceber - a.totalReceber);
  }, [contas]);

  const filtered = useMemo(() => {
    let rows = clientes;
    if (search) rows = rows.filter(c => c.nome.toLowerCase().includes(search.toLowerCase()));
    if (filtro === "devedores") rows = rows.filter(c => c.totalReceber > 0);
    if (filtro === "vencidos")  rows = rows.filter(c => c.totalVencido > 0);
    if (filtro === "quitados")  rows = rows.filter(c => c.totalReceber === 0 && c.totalPago > 0);
    return rows;
  }, [clientes, search, filtro]);

  const totais = useMemo(() => ({
    devedores: clientes.filter(c => c.totalReceber > 0).length,
    vencidos:  clientes.filter(c => c.totalVencido > 0).length,
    quitados:  clientes.filter(c => c.totalReceber === 0 && c.totalPago > 0).length,
    totalAberto: clientes.reduce((s, c) => s + c.totalReceber, 0),
    totalVencido: clientes.reduce((s, c) => s + c.totalVencido, 0),
  }), [clientes]);

  async function registrarBaixa(contaId: string, clienteNome: string) {
    setBaixando(contaId);
    const { error } = await supabase
      .from("contas_financeiras")
      .update({ status: "pago", data_pagamento: new Date().toISOString().split("T")[0] })
      .eq("id", contaId);
    setBaixando(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`Baixa registrada para ${clienteNome}`);
  }

  function statusIcon(c: Conta) {
    if (c.status === "pago")    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    if (c.status === "vencido") return <XCircle className="h-3.5 w-3.5 text-destructive" />;
    return <AlertCircle className="h-3.5 w-3.5 text-amber-500" />;
  }

  return (
    <div className="space-y-4">
      {/* KPIs clientes */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
          <p className="text-[10px] text-muted-foreground">Clientes com Dívida</p>
          <p className="text-xl font-black text-red-600">{totais.devedores}</p>
          <p className="text-[10px] text-muted-foreground">{BRL(totais.totalAberto)} em aberto</p>
        </div>
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3">
          <p className="text-[10px] text-muted-foreground">Vencidos</p>
          <p className="text-xl font-black text-destructive">{totais.vencidos}</p>
          <p className="text-[10px] text-muted-foreground">{BRL(totais.totalVencido)} vencido</p>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
          <p className="text-[10px] text-muted-foreground">Clientes Quitados</p>
          <p className="text-xl font-black text-emerald-600">{totais.quitados}</p>
          <p className="text-[10px] text-muted-foreground">sem pendências</p>
        </div>
        <div className="rounded-xl border border-border/40 bg-card p-3">
          <p className="text-[10px] text-muted-foreground">Total Clientes</p>
          <p className="text-xl font-black text-foreground">{clientes.length}</p>
          <p className="text-[10px] text-muted-foreground">com movimentação</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar cliente..."
            className="w-full pl-8 pr-3 h-8 text-[12px] rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        {(["todos","devedores","vencidos","quitados"] as const).map(f => (
          <button key={f} onClick={() => setFiltro(f)}
            className={cn("h-8 px-3 rounded-lg text-[12px] font-medium border transition-colors",
              filtro === f ? "bg-primary text-primary-foreground border-primary" : "border-input hover:bg-muted/40")}>
            {f === "todos" ? "Todos" : f === "devedores" ? "Com dívida" : f === "vencidos" ? "Vencidos" : "Quitados"}
          </button>
        ))}
      </div>

      {/* Lista de clientes */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
            <User className="h-8 w-8 opacity-20" />
            <p className="text-sm">Nenhum cliente encontrado</p>
          </div>
        )}
        {filtered.map(cl => {
          const isExp = expanded === cl.nome;
          const statusCor = cl.totalVencido > 0
            ? "border-destructive/20 bg-destructive/5"
            : cl.totalReceber > 0
            ? "border-amber-500/20 bg-amber-500/5"
            : "border-emerald-500/20 bg-emerald-500/5";
          return (
            <div key={cl.nome} className={cn("rounded-2xl border overflow-hidden", statusCor)}>
              {/* Header do cliente */}
              <button
                type="button"
                onClick={() => setExpanded(isExp ? null : cl.nome)}
                className="w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              >
                <div className={cn("h-8 w-8 rounded-full flex items-center justify-center shrink-0 text-[12px] font-bold",
                  cl.totalVencido > 0 ? "bg-destructive/10 text-destructive"
                  : cl.totalReceber > 0 ? "bg-amber-500/10 text-amber-600"
                  : "bg-emerald-500/10 text-emerald-600"
                )}>
                  {cl.nome.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold truncate">{cl.nome}</p>
                  <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground flex-wrap">
                    {cl.quantVencido > 0 && (
                      <span className="text-destructive font-medium flex items-center gap-0.5">
                        <XCircle className="h-3 w-3" /> {cl.quantVencido} vencida{cl.quantVencido > 1 ? "s" : ""} · {BRL(cl.totalVencido)}
                      </span>
                    )}
                    {cl.quantAberto > 0 && (
                      <span className="text-amber-600 font-medium flex items-center gap-0.5">
                        <AlertCircle className="h-3 w-3" /> {cl.quantAberto} em aberto · {BRL(cl.totalReceber - cl.totalVencido)}
                      </span>
                    )}
                    {cl.quantPago > 0 && (
                      <span className="text-emerald-600 flex items-center gap-0.5">
                        <CheckCircle2 className="h-3 w-3" /> {cl.quantPago} paga{cl.quantPago > 1 ? "s" : ""} · {BRL(cl.totalPago)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {cl.totalReceber > 0 ? (
                    <p className={cn("text-sm font-bold", cl.totalVencido > 0 ? "text-destructive" : "text-amber-600")}>
                      {BRL(cl.totalReceber)}
                    </p>
                  ) : (
                    <p className="text-sm font-bold text-emerald-600">Quitado</p>
                  )}
                  {isExp ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground ml-auto mt-0.5" />
                          : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto mt-0.5" />}
                </div>
              </button>

              {/* Detalhes das contas do cliente */}
              {isExp && (
                <div className="border-t border-border/20 divide-y divide-border/20">
                  {cl.contas.sort((a, b) => {
                    const order = { vencido: 0, aberto: 1, pago: 2, cancelado: 3 };
                    return (order[a.status as keyof typeof order] ?? 2) - (order[b.status as keyof typeof order] ?? 2);
                  }).map(c => (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                      {statusIcon(c)}
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium truncate">{c.descricao}</p>
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
                          <span>Venc: {new Date(c.data_vencimento + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                          {c.status === "vencido" && (
                            <span className="text-destructive font-medium">{diasAtraso(c.data_vencimento)}d em atraso</span>
                          )}
                          {c.data_pagamento && (
                            <span className="text-emerald-600">Pago em: {new Date(c.data_pagamento + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                          )}
                          {c.nota_fiscal && <span>NF: {c.nota_fiscal}</span>}
                        </div>
                      </div>
                      <p className={cn("text-[12px] font-bold shrink-0",
                        c.status === "pago" ? "text-emerald-600"
                        : c.status === "vencido" ? "text-destructive"
                        : "text-amber-600"
                      )}>{BRL(c.valor)}</p>
                      {c.status !== "pago" && c.status !== "cancelado" && (
                        <button
                          onClick={() => registrarBaixa(c.id, cl.nome)}
                          disabled={baixando === c.id}
                          title="Registrar baixa (pagamento recebido)"
                          className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-emerald-500/10 text-muted-foreground hover:text-emerald-600 transition-colors disabled:opacity-50 shrink-0"
                        >
                          {baixando === c.id
                            ? <div className="h-3 w-3 border border-current border-t-transparent rounded-full animate-spin" />
                            : <CheckCircle2 className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Aging report ──────────────────────────────────────────────────────────────
function AgingReport({ contas }: { contas: Conta[] }) {
  const today = new Date();
  const brackets = useMemo(() => {
    const vencidas = contas.filter(c => c.status === "vencido" && c.tipo === "receber");
    function dias(c: Conta) {
      return Math.floor((today.getTime() - new Date(c.data_vencimento + "T12:00:00").getTime()) / 86400000);
    }
    return [
      { label: "1–30 dias",  color: "bg-amber-500",  filter: (c: Conta) => { const d = dias(c); return d >= 1  && d <= 30;  } },
      { label: "31–60 dias", color: "bg-orange-500", filter: (c: Conta) => { const d = dias(c); return d >= 31 && d <= 60;  } },
      { label: "61–90 dias", color: "bg-red-500",    filter: (c: Conta) => { const d = dias(c); return d >= 61 && d <= 90;  } },
      { label: "91+ dias",   color: "bg-red-700",    filter: (c: Conta) => dias(c) > 90 },
    ].map(b => ({
      label: b.label, color: b.color,
      itens: vencidas.filter(b.filter),
      total: vencidas.filter(b.filter).reduce((s, c) => s + c.valor, 0),
    }));
  }, [contas, today]);

  const totalVencido = brackets.reduce((s, b) => s + b.total, 0);

  if (totalVencido === 0) return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 flex flex-col items-center gap-2">
      <TrendingUp className="h-8 w-8 text-emerald-500 opacity-50" />
      <p className="text-sm font-medium text-emerald-600">Sem inadimplência</p>
      <p className="text-[11px] text-muted-foreground">Todas as contas a receber estão em dia</p>
    </div>
  );

  return (
    <div className="rounded-2xl border border-border/40 bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-destructive" />
          <p className="text-sm font-bold">Aging — Inadimplência a Receber</p>
        </div>
        <p className="text-sm font-bold text-destructive">{BRL(totalVencido)}</p>
      </div>
      {brackets.map(b => {
        const pct = totalVencido > 0 ? (b.total / totalVencido) * 100 : 0;
        return (
          <div key={b.label} className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">{b.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{b.itens.length} conta{b.itens.length !== 1 ? "s" : ""}</span>
                <span className="font-bold font-mono">{BRL(b.total)}</span>
                <span className="text-muted-foreground/60">{pct.toFixed(0)}%</span>
              </div>
            </div>
            <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
              <div className={cn("h-full rounded-full transition-all duration-700", b.color)} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Projeção 30 dias ──────────────────────────────────────────────────────────
function ProjecaoSaldo({ contas }: { contas: Conta[] }) {
  const em30 = new Date(Date.now() + 30 * 86400000);
  const abertas = contas.filter(c => c.status === "aberto" && new Date(c.data_vencimento + "T12:00:00") <= em30);
  const receber30 = abertas.filter(c => c.tipo === "receber").reduce((s, c) => s + c.valor, 0);
  const pagar30   = abertas.filter(c => c.tipo === "pagar").reduce((s, c) => s + c.valor, 0);
  const saldo30   = receber30 - pagar30;
  return (
    <div className="rounded-2xl border border-border/40 bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <DollarSign className="h-4 w-4 text-primary" />
        <p className="text-sm font-bold">Projeção — próximos 30 dias</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-2.5 text-center">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">A Receber</p>
          <p className="text-sm font-bold text-emerald-600">{BRL(receber30)}</p>
          <p className="text-[9px] text-muted-foreground">{abertas.filter(c => c.tipo === "receber").length} contas</p>
        </div>
        <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-2.5 text-center">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">A Pagar</p>
          <p className="text-sm font-bold text-red-600">{BRL(pagar30)}</p>
          <p className="text-[9px] text-muted-foreground">{abertas.filter(c => c.tipo === "pagar").length} contas</p>
        </div>
        <div className={cn("rounded-xl border p-2.5 text-center", saldo30 >= 0 ? "bg-primary/5 border-primary/20" : "bg-orange-500/5 border-orange-500/20")}>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Saldo</p>
          <p className={cn("text-sm font-bold", saldo30 >= 0 ? "text-primary" : "text-orange-600")}>{BRL(saldo30)}</p>
          <p className="text-[9px] text-muted-foreground">{saldo30 >= 0 ? "positivo" : "negativo"}</p>
        </div>
      </div>
    </div>
  );
}

// ── Painel principal ──────────────────────────────────────────────────────────
export function FluxoCaixaPanel() {
  const [contas, setContas]   = useState<Conta[]>([]);
  const [loading, setLoading] = useState(true);
  const [vis, setVis]         = useState<Vis>("clientes");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Busca contas com dados do pedido+cliente via join
      const { data, error } = await supabase
        .from("contas_financeiras")
        .select(`
          id, tipo, descricao, valor, data_emissao, data_vencimento,
          data_pagamento, status, categoria, nota_fiscal, observacoes,
          pedido_id, fornecedor_id,
          pedido:pedidos_comerciais(
            cliente_id,
            cliente:clientes(id, nome)
          )
        `)
        .order("data_vencimento");
      if (error) throw error;

      // Flattens cliente info
      const mapped = ((data ?? []) as any[]).map(c => {
        const pedido = Array.isArray(c.pedido) ? c.pedido[0] : c.pedido;
        const cliente = Array.isArray(pedido?.cliente) ? pedido?.cliente[0] : pedido?.cliente;
        return {
          ...c,
          cliente_nome: cliente?.nome ?? null,
          cliente_id: cliente?.id ?? null,
          pedido: undefined,
        } as Conta;
      });
      setContas(mapped);
    } catch (err) {
      logger.error("FluxoCaixaPanel: erro ao carregar", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function exportCSV() {
    const header = "tipo,status,descricao,cliente,valor,vencimento,pagamento,nota_fiscal\n";
    const rows = contas.map(c =>
      [c.tipo, c.status, `"${c.descricao}"`, `"${c.cliente_nome ?? ""}"`,
       c.valor, c.data_vencimento, c.data_pagamento ?? "", c.nota_fiscal ?? ""].join(",")
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "fluxo-caixa.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  const TABS: { id: Vis; label: string; Icon: typeof BarChart3 }[] = [
    { id: "clientes", label: "Clientes",    Icon: User       },
    { id: "fluxo",    label: "Fluxo Mensal",Icon: BarChart3  },
    { id: "aging",    label: "Inadimplência",Icon: Clock     },
    { id: "projecao", label: "Projeção 30d", Icon: TrendingUp},
  ];

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setVis(id)}
            className={cn("h-8 px-3 rounded-lg text-[12px] font-medium border transition-colors flex items-center gap-1.5",
              vis === id ? "bg-primary text-primary-foreground border-primary" : "border-input hover:bg-muted/40")}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button onClick={load} className="h-8 w-8 flex items-center justify-center rounded-lg border border-input hover:bg-muted/40">
            <RefreshCw className={cn("h-3.5 w-3.5 text-muted-foreground", loading && "animate-spin")} />
          </button>
          <button onClick={exportCSV} className="h-8 px-3 rounded-lg border border-input text-[12px] flex items-center gap-1.5 hover:bg-muted/40">
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>

      {vis === "clientes"  && <ControlePagamentos contas={contas} />}
      {vis === "fluxo"     && <FluxoCaixa contas={contas} />}
      {vis === "aging"     && <AgingReport contas={contas} />}
      {vis === "projecao"  && <ProjecaoSaldo contas={contas} />}
    </div>
  );
}
