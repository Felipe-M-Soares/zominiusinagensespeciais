/**
 * Contas — a receber, a pagar e fluxo de caixa num lugar só.
 *
 *  • A receber: geradas sozinhas ao faturar (uma por parcela).
 *  • A pagar: geradas pelos pedidos de compra recebidos ou lançadas aqui
 *    (compras, custos fixos com repetição mensal etc.).
 *  • Baixa com data e conta bancária; estorno; cancelamento (nunca apaga
 *    conta ligada a nota fiscal).
 *  • Fluxo de caixa: realizado dos últimos 6 meses + previsto dos próximos 3.
 *  • Conciliação: importa o extrato OFX do banco e dá baixa nas contas que batem.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, Ban, CheckCircle2, Download, FileUp, Landmark, Loader2, Plus, RefreshCw, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { friendlyError } from "@/lib/errorMessages";
import { baixarCsv, fmtData, FORMAS_PAGAMENTO, hojeISO, parseValor, somarDias } from "@/lib/financeiro";
import { candidatas, decodificarOfx, lerOfx, sugerirConciliacao, type ExtratoOfx } from "@/lib/ofx";

interface Conta {
  id: string; tipo: "pagar" | "receber"; descricao: string; valor: number; valor_pago: number | null;
  data_emissao: string; data_vencimento: string; data_pagamento: string | null;
  status: "aberto" | "pago" | "vencido" | "cancelado"; categoria: string; nota_fiscal: string | null; observacoes: string | null;
  pedido_id: string | null; pedido_compra_id: string | null; fornecedor_id: string | null; favorecido: string | null;
  forma_pagamento: string | null; banco_id: string | null;
  nome: string; // cliente / fornecedor / favorecido
}
interface Banco { id: string; banco: string; conta: string }

export const CATEGORIAS_PAGAR: Record<string, string> = {
  materia_prima: "Matéria-prima", insumo_producao: "Insumos de produção", ferramentas: "Ferramentas", manutencao: "Manutenção",
  maquina: "Máquinas e equipamentos", energia: "Energia", aluguel: "Aluguel", servico: "Serviços / software",
  folha: "Folha e encargos", impostos: "Impostos", frete: "Frete", computador: "TI", mobiliario: "Mobiliário",
  material_escritorio: "Escritório", ativo_empresa: "Ativo permanente", compra: "Compras", outro: "Outros", outros: "Outros",
};
const CATEGORIAS_RECEBER: Record<string, string> = { venda: "Venda", servico: "Serviço", credito_cliente: "Crédito de cliente", outros: "Outros" };
const nomeCategoria = (c: string) => CATEGORIAS_PAGAR[c] ?? CATEGORIAS_RECEBER[c] ?? c;

type Visao = "receber" | "pagar" | "fluxo";
type FiltroStatus = "abertas" | "vencidas" | "pagas" | "todas";

export function FluxoCaixaPanel() {
  const [contas, setContas] = useState<Conta[]>([]);
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [loading, setLoading] = useState(true);
  const [visao, setVisao] = useState<Visao>("receber");
  const [filtro, setFiltro] = useState<FiltroStatus>("abertas");
  const [busca, setBusca] = useState("");
  const [baixa, setBaixa] = useState<Conta | null>(null);
  const [nova, setNova] = useState<"pagar" | "receber" | null>(null);
  const [cancelar, setCancelar] = useState<Conta | null>(null);
  const [conciliar, setConciliar] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    await supabase.rpc("atualizar_contas_vencidas");
    const desde = somarDias(hojeISO(), -400);
    const [cRes, bRes] = await Promise.all([
      supabase.from("contas_financeiras")
        .select("id,tipo,descricao,valor,valor_pago,data_emissao,data_vencimento,data_pagamento,status,categoria,nota_fiscal,observacoes,pedido_id,pedido_compra_id,fornecedor_id,favorecido,forma_pagamento,banco_id,pedido:pedidos_comerciais(cliente:clientes(nome)),fornecedor:fornecedores(razao_social)")
        .or(`status.in.(aberto,vencido),data_vencimento.gte.${desde}`)
        .order("data_vencimento").limit(5000),
      supabase.from("financeiro_contas_bancarias").select("id,banco,conta").order("banco"),
    ]);
    if (cRes.error) toast.error("Não foi possível carregar as contas.");
    type Linha = Omit<Conta, "nome"> & { pedido?: { cliente?: { nome?: string } | null } | null; fornecedor?: { razao_social?: string } | null };
    setContas(((cRes.data ?? []) as unknown as Linha[]).map(c => ({
      ...c, valor: Number(c.valor), valor_pago: c.valor_pago != null ? Number(c.valor_pago) : null,
      nome: c.pedido?.cliente?.nome ?? c.fornecedor?.razao_social ?? c.favorecido ?? (c.descricao.split("—")[1]?.trim() || "—"),
    })));
    setBancos((bRes.data ?? []) as Banco[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const hoje = hojeISO();
  const em7 = somarDias(hoje, 7), em30 = somarDias(hoje, 30);
  const abertas = (t: "pagar" | "receber") => contas.filter(c => c.tipo === t && (c.status === "aberto" || c.status === "vencido"));
  const soma = (l: Conta[]) => l.reduce((s, c) => s + c.valor, 0);
  const kpis = {
    receberVencido: soma(abertas("receber").filter(c => c.data_vencimento < hoje)),
    receber30: soma(abertas("receber").filter(c => c.data_vencimento >= hoje && c.data_vencimento <= em30)),
    pagarVencido: soma(abertas("pagar").filter(c => c.data_vencimento < hoje)),
    pagar7: soma(abertas("pagar").filter(c => c.data_vencimento >= hoje && c.data_vencimento <= em7)),
  };

  const lista = useMemo(() => {
    if (visao === "fluxo") return [];
    const q = busca.trim().toLowerCase();
    return contas.filter(c => c.tipo === visao)
      .filter(c => filtro === "todas" ? true
        : filtro === "pagas" ? c.status === "pago"
        : filtro === "vencidas" ? (c.status === "vencido" || (c.status === "aberto" && c.data_vencimento < hoje))
        : c.status === "aberto" || c.status === "vencido")
      .filter(c => !q || `${c.nome} ${c.descricao} ${c.nota_fiscal ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => filtro === "pagas" ? (b.data_pagamento ?? "").localeCompare(a.data_pagamento ?? "") : a.data_vencimento.localeCompare(b.data_vencimento));
  }, [contas, visao, filtro, busca, hoje]);

  async function estornar(c: Conta) {
    const { error } = await supabase.from("contas_financeiras").update({
      status: c.data_vencimento < hoje ? "vencido" : "aberto", data_pagamento: null, valor_pago: null, banco_id: null,
    }).eq("id", c.id);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success("Baixa estornada."); load();
  }

  function exportar() {
    baixarCsv(`contas-${visao}-${hoje}.csv`, ["Tipo", "Situação", "Nome", "Descrição", "Categoria", "Vencimento", "Valor", "Pago em", "Valor pago", "NF"],
      lista.map(c => [c.tipo === "pagar" ? "A pagar" : "A receber", c.status, c.nome, c.descricao, nomeCategoria(c.categoria),
        fmtData(c.data_vencimento), c.valor, fmtData(c.data_pagamento), c.valor_pago ?? null, c.nota_fiscal]));
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { l: "A receber vencido", v: kpis.receberVencido, cls: kpis.receberVencido > 0 ? "text-red-600" : "" },
          { l: "A receber em 30 dias", v: kpis.receber30, cls: "text-green-700 dark:text-green-400" },
          { l: "A pagar vencido", v: kpis.pagarVencido, cls: kpis.pagarVencido > 0 ? "text-red-600" : "" },
          { l: "A pagar em 7 dias", v: kpis.pagar7, cls: kpis.pagar7 > 0 ? "text-amber-600" : "" },
        ].map(k => (
          <div key={k.l} className="rounded-2xl border bg-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{k.l}</p>
            <p className={cn("mt-1 text-xl sm:text-2xl font-bold tabular-nums", k.cls)}>{formatBRL(k.v)}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl border bg-muted/40 p-1" role="tablist">
          {([["receber", "A receber"], ["pagar", "A pagar"], ["fluxo", "Fluxo de caixa"]] as [Visao, string][]).map(([id, l]) => (
            <button key={id} type="button" role="tab" aria-selected={visao === id} onClick={() => setVisao(id)}
              className={cn("h-10 px-4 rounded-lg text-sm font-medium", visao === id ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>{l}</button>
          ))}
        </div>
        {visao !== "fluxo" && (
          <>
            <select value={filtro} onChange={e => setFiltro(e.target.value as FiltroStatus)} aria-label="Situação" className="h-11 rounded-xl border border-input bg-background px-3 text-sm">
              <option value="abertas">Em aberto</option><option value="vencidas">Vencidas</option><option value="pagas">{visao === "pagar" ? "Pagas" : "Recebidas"}</option><option value="todas">Todas</option>
            </select>
            <div className="relative flex-1 min-w-[12rem]">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={busca} onChange={e => setBusca(e.target.value)} placeholder={visao === "pagar" ? "Fornecedor, descrição ou NF..." : "Cliente, descrição ou NF..."} className="h-11 pl-9" />
            </div>
          </>
        )}
        <Button variant="outline" size="icon" className="h-11 w-11" onClick={load} disabled={loading} aria-label="Atualizar"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /></Button>
        <Button variant="outline" className="h-11 gap-1.5" onClick={() => setConciliar(true)} title="Importar extrato OFX do banco e dar baixa automática"><Landmark className="h-4 w-4" />Conciliar extrato</Button>
        {visao !== "fluxo" && <Button variant="outline" className="h-11 gap-1.5" onClick={exportar} disabled={!lista.length}><Download className="h-4 w-4" />Excel</Button>}
        {visao !== "fluxo" && <Button className="h-11 gap-1.5" onClick={() => setNova(visao)}><Plus className="h-4 w-4" />{visao === "pagar" ? "Nova conta a pagar" : "Nova conta a receber"}</Button>}
      </div>

      {visao === "fluxo" ? <FluxoMensal contas={contas} /> : (
        <div className="rounded-2xl border bg-card overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</div>
          ) : lista.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Nenhuma conta {filtro === "pagas" ? "paga" : "neste filtro"}.</div>
          ) : (
            <ul className="divide-y">
              {lista.map(c => {
                const atrasada = (c.status === "aberto" || c.status === "vencido") && c.data_vencimento < hoje;
                const dias = atrasada ? Math.round((new Date(`${hoje}T12:00:00`).getTime() - new Date(`${c.data_vencimento}T12:00:00`).getTime()) / 86400000) : 0;
                return (
                  <li key={c.id} className={cn("p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4", c.status === "cancelado" && "opacity-60")}>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate">{c.nome}</p>
                      <p className="text-xs text-muted-foreground truncate">{c.descricao} · {nomeCategoria(c.categoria)}{c.nota_fiscal ? ` · NF ${c.nota_fiscal}` : ""}</p>
                    </div>
                    <div className="sm:text-right sm:w-40">
                      <p className="text-xs text-muted-foreground">{c.status === "pago" ? `${c.tipo === "pagar" ? "Pago" : "Recebido"} em ${fmtData(c.data_pagamento)}` : `Vence ${fmtData(c.data_vencimento)}`}</p>
                      {atrasada && <p className="text-xs font-semibold text-red-600">{dias} dia{dias !== 1 ? "s" : ""} em atraso</p>}
                      {c.status === "cancelado" && <p className="text-xs text-muted-foreground">cancelada</p>}
                    </div>
                    <p className={cn("text-lg font-bold tabular-nums sm:w-36 sm:text-right", c.status === "pago" ? "text-green-700 dark:text-green-400" : atrasada ? "text-red-600" : "")}>{formatBRL(c.valor_pago ?? c.valor)}</p>
                    <div className="flex gap-1.5 sm:w-44 sm:justify-end">
                      {(c.status === "aberto" || c.status === "vencido") && <>
                        <Button size="sm" className="h-9 gap-1" onClick={() => setBaixa(c)}><CheckCircle2 className="h-4 w-4" />{c.tipo === "pagar" ? "Pagar" : "Receber"}</Button>
                        <Button size="icon" variant="ghost" className="h-9 w-9" title="Cancelar conta" aria-label="Cancelar conta" onClick={() => setCancelar(c)}><Ban className="h-4 w-4" /></Button>
                      </>}
                      {c.status === "pago" && <Button size="sm" variant="ghost" className="h-9 gap-1" onClick={() => estornar(c)}><RotateCcw className="h-4 w-4" />Estornar</Button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {baixa && <BaixaDialog conta={baixa} bancos={bancos} onClose={() => setBaixa(null)} onFeito={() => { setBaixa(null); load(); }} />}
      {nova && <NovaContaDialog tipo={nova} onClose={() => setNova(null)} onFeito={() => { setNova(null); load(); }} />}
      {conciliar && <ConciliarOfxDialog contas={contas} bancos={bancos} onClose={() => setConciliar(false)} onFeito={() => { setConciliar(false); load(); }} />}
      {cancelar && <CancelarContaDialog conta={cancelar} onClose={() => setCancelar(null)} onFeito={() => { setCancelar(null); load(); }} />}
    </div>
  );
}

function FluxoMensal({ contas }: { contas: Conta[] }) {
  const meses = useMemo(() => {
    const base = new Date(); base.setDate(1);
    return Array.from({ length: 9 }, (_, i) => {
      const d = new Date(base); d.setMonth(base.getMonth() - 5 + i);
      const k = hojeISO(d).slice(0, 7);
      const futuro = i > 5;
      const atual = i === 5;
      const doMes = (c: Conta, campo: "data_pagamento" | "data_vencimento") => (c[campo] ?? "").startsWith(k);
      const realizado = (t: "pagar" | "receber") => contas.filter(c => c.tipo === t && c.status === "pago" && doMes(c, "data_pagamento")).reduce((s, c) => s + (c.valor_pago ?? c.valor), 0);
      const previsto = (t: "pagar" | "receber") => contas.filter(c => c.tipo === t && (c.status === "aberto" || c.status === "vencido") && doMes(c, "data_vencimento")).reduce((s, c) => s + c.valor, 0);
      const entradas = realizado("receber") + (futuro || atual ? previsto("receber") : 0);
      const saidas = realizado("pagar") + (futuro || atual ? previsto("pagar") : 0);
      const mesesCurtos = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
      return { k, label: `${mesesCurtos[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`, entradas, saidas, futuro, atual };
    });
  }, [contas]);
  const max = Math.max(1, ...meses.flatMap(m => [m.entradas, m.saidas]));
  let acumulado = 0;
  return (
    <div className="rounded-2xl border bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-green-600" />Entradas</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-500" />Saídas</span>
        <span>Meses futuros (tracejado) = previsto pelas contas em aberto</span>
      </div>
      <div className="grid grid-cols-9 gap-1.5 sm:gap-3 items-end h-44">
        {meses.map(m => (
          <div key={m.k} className="flex flex-col items-center gap-1 h-full justify-end">
            <div className="flex gap-0.5 sm:gap-1 items-end h-36 w-full justify-center">
              <div title={`Entradas ${formatBRL(m.entradas)}`} className={cn("w-1/2 max-w-6 rounded-t bg-green-600", m.futuro && "bg-green-600/40 border border-dashed border-green-700")} style={{ height: `${Math.max(2, m.entradas / max * 100)}%` }} />
              <div title={`Saídas ${formatBRL(m.saidas)}`} className={cn("w-1/2 max-w-6 rounded-t bg-red-500", m.futuro && "bg-red-500/40 border border-dashed border-red-600")} style={{ height: `${Math.max(2, m.saidas / max * 100)}%` }} />
            </div>
            <p className={cn("text-[10px] sm:text-xs", m.atual ? "font-bold" : "text-muted-foreground")}>{m.label}</p>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[520px]">
          <thead><tr className="text-left text-xs text-muted-foreground border-b"><th className="py-2">Mês</th><th className="py-2 text-right">Entradas</th><th className="py-2 text-right">Saídas</th><th className="py-2 text-right">Resultado</th><th className="py-2 text-right">Acumulado</th></tr></thead>
          <tbody>
            {meses.map(m => {
              const res = m.entradas - m.saidas; acumulado += res;
              return (
                <tr key={m.k} className={cn("border-b last:border-0", m.futuro && "text-muted-foreground")}>
                  <td className="py-2">{m.label}{m.futuro ? " (previsto)" : m.atual ? " (atual)" : ""}</td>
                  <td className="py-2 text-right tabular-nums">{formatBRL(m.entradas)}</td>
                  <td className="py-2 text-right tabular-nums">{formatBRL(m.saidas)}</td>
                  <td className={cn("py-2 text-right tabular-nums font-medium", res >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600")}>{formatBRL(res)}</td>
                  <td className="py-2 text-right tabular-nums">{formatBRL(acumulado)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BaixaDialog({ conta, bancos, onClose, onFeito }: { conta: Conta; bancos: Banco[]; onClose: () => void; onFeito: () => void }) {
  const [data, setData] = useState(hojeISO());
  const [valor, setValor] = useState(conta.valor.toFixed(2).replace(".", ","));
  const [banco, setBanco] = useState(bancos[0]?.id ?? "");
  const [forma, setForma] = useState(conta.forma_pagamento ?? "");
  const [salvando, setSalvando] = useState(false);
  const v = parseValor(valor);
  async function salvar() {
    if (!(v > 0)) { toast.error("Informe o valor."); return; }
    if (data > hojeISO()) { toast.error("A data do pagamento não pode ser no futuro."); return; }
    setSalvando(true);
    const obs = Math.abs(v - conta.valor) > 0.005
      ? `${conta.observacoes ? conta.observacoes + " · " : ""}Baixa de ${formatBRL(v)} (original ${formatBRL(conta.valor)})` : conta.observacoes;
    const { error } = await supabase.from("contas_financeiras").update({
      status: "pago", data_pagamento: data, valor_pago: v, banco_id: banco || null, forma_pagamento: forma || null, observacoes: obs,
    }).eq("id", conta.id);
    setSalvando(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(conta.tipo === "pagar" ? "Pagamento registrado." : "Recebimento registrado.");
    onFeito();
  }
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{conta.tipo === "pagar" ? <ArrowUpCircle className="h-5 w-5 text-red-500" /> : <ArrowDownCircle className="h-5 w-5 text-green-600" />}{conta.tipo === "pagar" ? "Registrar pagamento" : "Registrar recebimento"}</DialogTitle>
          <DialogDescription>{conta.nome} · {conta.descricao}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Data</span><Input type="date" value={data} max={hojeISO()} onChange={e => setData(e.target.value)} className="h-11" /></label>
          <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Valor (R$)</span><Input value={valor} onChange={e => setValor(e.target.value)} inputMode="decimal" className="h-11" /></label>
          <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conta bancária</span>
            <select value={banco} onChange={e => setBanco(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
              <option value="">—</option>{bancos.map(b => <option key={b.id} value={b.id}>{b.banco} · {b.conta}</option>)}
            </select></label>
          <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Forma</span>
            <select value={forma} onChange={e => setForma(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
              <option value="">—</option>{Object.entries(FORMAS_PAGAMENTO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></label>
        </div>
        {Math.abs(v - conta.valor) > 0.005 && v > 0 && <p className="text-xs rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 px-3 py-2"><AlertTriangle className="inline h-3.5 w-3.5 mr-1" />Valor diferente do previsto ({formatBRL(conta.valor)}) — juros, multa ou desconto ficam anotados na conta.</p>}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando} className="gap-1.5">{salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConciliarOfxDialog({ contas, bancos, onClose, onFeito }: { contas: Conta[]; bancos: Banco[]; onClose: () => void; onFeito: () => void }) {
  const [extrato, setExtrato] = useState<ExtratoOfx | null>(null);
  const [banco, setBanco] = useState(bancos[0]?.id ?? "");
  const [escolha, setEscolha] = useState<Record<string, string | null>>({});
  const [salvando, setSalvando] = useState(false);
  const [arquivo, setArquivo] = useState("");
  const abertas = useMemo(() => contas.filter(c => c.status === "aberto" || c.status === "vencido"), [contas]);
  // FITIDs já conciliados antes (ficam anotados nas observações da conta) — não baixa duas vezes.
  const jaConciliados = useMemo(() => {
    const set = new Set<string>();
    for (const c of contas) for (const m of (c.observacoes ?? "").matchAll(/OFX ([^\s·)]+)/g)) set.add(m[1]);
    return set;
  }, [contas]);

  async function abrir(f: File) {
    try {
      const ext = lerOfx(decodificarOfx(await f.arrayBuffer()));
      if (!ext.transacoes.length) { toast.error("Nenhuma transação encontrada nesse arquivo. Exporte o extrato em formato OFX (Money)."); return; }
      const novas = ext.transacoes.filter(t => !jaConciliados.has(t.fitid.replace(/\s/g, "")));
      setArquivo(f.name);
      setExtrato({ ...ext, transacoes: novas });
      setEscolha(sugerirConciliacao(novas, abertas));
      const ignoradas = ext.transacoes.length - novas.length;
      if (ignoradas) toast.info(`${ignoradas} transação(ões) já conciliada(s) antes foram ignoradas.`);
    } catch { toast.error("Não consegui ler esse arquivo OFX."); }
  }

  const usadas = new Set(Object.values(escolha).filter(Boolean) as string[]);
  const marcadas = extrato?.transacoes.filter(t => escolha[t.fitid]) ?? [];

  async function confirmar() {
    if (!marcadas.length) return;
    setSalvando(true);
    let ok = 0;
    for (const t of marcadas) {
      const conta = abertas.find(c => c.id === escolha[t.fitid]);
      if (!conta) continue;
      const obs = `${conta.observacoes ? conta.observacoes + " · " : ""}Conciliado pelo extrato (OFX ${t.fitid.replace(/\s/g, "")})`;
      const { error } = await supabase.from("contas_financeiras").update({
        status: "pago", data_pagamento: t.data, valor_pago: Math.abs(t.valor), banco_id: banco || null, observacoes: obs.slice(0, 2000),
      }).eq("id", conta.id).in("status", ["aberto", "vencido"]);
      if (error) { toast.error(`${conta.nome}: ${friendlyError(error)}`); continue; }
      ok++;
    }
    setSalvando(false);
    toast.success(`${ok} conta${ok !== 1 ? "s" : ""} baixada${ok !== 1 ? "s" : ""} pelo extrato.`);
    onFeito();
  }

  return (
    <Dialog open onOpenChange={o => !o && !salvando && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Landmark className="h-5 w-5 text-primary" />Conciliar extrato bancário</DialogTitle>
          <DialogDescription>Exporte o extrato do internet banking em <b>OFX</b> e escolha o arquivo. O sistema sugere qual conta em aberto cada lançamento paga (mesmo valor e data próxima) — você confere e confirma.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block space-y-1.5 flex-1 min-w-[12rem]"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conta bancária do extrato</span>
            <select value={banco} onChange={e => setBanco(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
              <option value="">—</option>{bancos.map(b => <option key={b.id} value={b.id}>{b.banco} · {b.conta}</option>)}
            </select></label>
          <label className="inline-flex h-11 items-center gap-1.5 rounded-xl border px-4 text-sm font-medium cursor-pointer hover:bg-muted">
            <FileUp className="h-4 w-4" />{arquivo || "Escolher arquivo .ofx"}
            <input type="file" accept=".ofx,.OFX,application/x-ofx" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) abrir(f); e.target.value = ""; }} />
          </label>
        </div>
        {extrato && (
          extrato.transacoes.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Todas as transações desse extrato já foram conciliadas.</p> : (
            <div className="rounded-xl border overflow-hidden">
              <div className="px-3 py-2 text-xs text-muted-foreground bg-muted/40 border-b">{extrato.transacoes.length} lançamentos · {marcadas.length} com conta escolhida</div>
              <ul className="divide-y max-h-[50vh] overflow-y-auto">
                {extrato.transacoes.map(t => {
                  const cs = candidatas(t, abertas);
                  const atual = escolha[t.fitid] ?? "";
                  return (
                    <li key={t.fitid} className="px-3 py-2.5 grid grid-cols-1 sm:grid-cols-[6rem_1fr_7rem_16rem] gap-1 sm:gap-3 sm:items-center text-sm">
                      <span className="text-xs text-muted-foreground">{fmtData(t.data)}</span>
                      <span className="truncate" title={t.descricao}>{t.descricao}</span>
                      <span className={cn("tabular-nums font-semibold sm:text-right", t.valor > 0 ? "text-green-700 dark:text-green-400" : "text-red-600")}>{formatBRL(t.valor)}</span>
                      {cs.length === 0 ? <span className="text-xs text-muted-foreground">sem conta em aberto com esse valor</span> : (
                        <select value={atual} onChange={e => setEscolha(m => ({ ...m, [t.fitid]: e.target.value || null }))} aria-label="Conta a baixar"
                          className={cn("h-9 w-full rounded-lg border bg-background px-2 text-xs", atual ? "border-green-500/50" : "border-input")}>
                          <option value="">Não baixar</option>
                          {cs.map(c => <option key={c.id} value={c.id} disabled={c.id !== atual && usadas.has(c.id)}>{c.nome} · vence {fmtData(c.data_vencimento)}</option>)}
                        </select>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={salvando}>Fechar</Button>
          <Button onClick={confirmar} disabled={salvando || !marcadas.length} className="gap-1.5">{salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Dar baixa em {marcadas.length}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NovaContaDialog({ tipo, onClose, onFeito }: { tipo: "pagar" | "receber"; onClose: () => void; onFeito: () => void }) {
  const { user } = useAuth();
  const cats = tipo === "pagar" ? CATEGORIAS_PAGAR : CATEGORIAS_RECEBER;
  const [f, setF] = useState({ favorecido: "", descricao: "", categoria: tipo === "pagar" ? "materia_prima" : "servico", valor: "", vencimento: hojeISO(), nf: "", obs: "", repetir: "1", jaPago: false });
  const [salvando, setSalvando] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF(p => ({ ...p, [k]: v }));
  async function salvar() {
    const valor = parseValor(f.valor);
    if (!f.descricao.trim()) { toast.error("Informe a descrição."); return; }
    if (!(valor > 0)) { toast.error("Informe o valor."); return; }
    const n = Math.max(1, Math.min(60, Number(f.repetir) || 1));
    const linhas = Array.from({ length: n }, (_, i) => {
      const d = new Date(`${f.vencimento}T12:00:00`); d.setMonth(d.getMonth() + i);
      const venc = hojeISO(d);
      const pago = f.jaPago && i === 0;
      return {
        tipo, descricao: n > 1 ? `${f.descricao.trim()} (${i + 1}/${n})` : f.descricao.trim(), valor, categoria: f.categoria,
        data_emissao: hojeISO(), data_vencimento: venc, status: pago ? "pago" : venc < hojeISO() ? "vencido" : "aberto",
        data_pagamento: pago ? venc : null, valor_pago: pago ? valor : null,
        favorecido: f.favorecido.trim() || null, nota_fiscal: f.nf.trim() || null, observacoes: f.obs.trim() || null, created_by: user?.id ?? null,
      };
    });
    setSalvando(true);
    const { error } = await supabase.from("contas_financeiras").insert(linhas);
    setSalvando(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(n > 1 ? `${n} contas lançadas.` : "Conta lançada.");
    onFeito();
  }
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tipo === "pagar" ? "Nova conta a pagar" : "Nova conta a receber"}</DialogTitle>
          <DialogDescription>{tipo === "pagar" ? "Compras, custos fixos (energia, aluguel...), serviços, impostos." : "Recebimentos que não vêm de uma nota fiscal de venda."}</DialogDescription>
        </DialogHeader>
        <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tipo === "pagar" ? "Fornecedor / favorecido" : "Cliente / pagador"}</span>
          <Input value={f.favorecido} onChange={e => set("favorecido", e.target.value.slice(0, 120))} className="h-11" /></label>
        <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Descrição *</span>
          <Input value={f.descricao} onChange={e => set("descricao", e.target.value.slice(0, 160))} className="h-11" placeholder={tipo === "pagar" ? "Ex.: Barra de titânio Ø6, conta de energia de setembro" : ""} /></label>
        <div className="space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Categoria</span>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(cats).filter(([k]) => k !== "outros" || tipo === "receber").map(([k, l]) => (
              <button key={k} type="button" onClick={() => set("categoria", k)}
                className={cn("h-9 px-3 rounded-full border text-sm", f.categoria === k ? "border-primary bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted")}>{l}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Valor (R$) *</span><Input value={f.valor} onChange={e => set("valor", e.target.value)} inputMode="decimal" className="h-11" /></label>
          <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vencimento</span><Input type="date" value={f.vencimento} onChange={e => set("vencimento", e.target.value)} className="h-11" /></label>
          <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Repetir por (meses)</span>
            <select value={f.repetir} onChange={e => set("repetir", e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
              {[1, 2, 3, 4, 6, 10, 12, 24].map(n => <option key={n} value={n}>{n === 1 ? "Não repetir" : `${n} meses`}</option>)}
            </select></label>
          <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nº da NF (opcional)</span><Input value={f.nf} onChange={e => set("nf", e.target.value.slice(0, 60))} className="h-11" /></label>
        </div>
        <Textarea value={f.obs} onChange={e => set("obs", e.target.value.slice(0, 300))} rows={2} placeholder="Observações" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.jaPago} onChange={e => set("jaPago", e.target.checked)} className="h-4 w-4" />Já foi {tipo === "pagar" ? "paga" : "recebida"} (na data do vencimento)</label>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando} className="gap-1.5">{salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Lançar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelarContaDialog({ conta, onClose, onFeito }: { conta: Conta; onClose: () => void; onFeito: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const deNota = conta.tipo === "receber" && !!conta.pedido_id;
  async function salvar() {
    setSalvando(true);
    const { error } = await supabase.from("contas_financeiras").update({
      status: "cancelado", observacoes: `${conta.observacoes ? conta.observacoes + " · " : ""}Cancelada: ${motivo.trim()}`,
    }).eq("id", conta.id);
    setSalvando(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success("Conta cancelada."); onFeito();
  }
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Cancelar conta</DialogTitle><DialogDescription>{conta.nome} · {formatBRL(conta.valor)} · vence {fmtData(conta.data_vencimento)}</DialogDescription></DialogHeader>
        {deNota && <p className="text-sm rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 px-3 py-2">Esta conta veio de uma nota fiscal. Se a venda foi desfeita, o certo é cancelar a NF-e (as contas são canceladas junto). Cancele aqui só para acordos (ex.: desconto concedido, perdão de dívida).</p>}
        <Textarea value={motivo} onChange={e => setMotivo(e.target.value.slice(0, 200))} rows={2} placeholder="Motivo do cancelamento" />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Voltar</Button>
          <Button variant="destructive" onClick={salvar} disabled={salvando || motivo.trim().length < 5}>{salvando && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}Cancelar conta</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
