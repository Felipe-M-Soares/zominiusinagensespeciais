/**
 * Visão geral do Financeiro — o que precisa de atenção hoje.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, CalendarClock, FileText, Loader2, Receipt, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { fmtData, hojeISO, mesISO, somarDias } from "@/lib/financeiro";
import { totalPedido, type EmissorStatus, type PedidoFaturar } from "./fiscal";

interface ContaResumo { id: string; tipo: "pagar" | "receber"; descricao: string; valor: number; data_vencimento: string; status: string; favorecido: string | null }
interface Dados {
  faturadoMes: number; notasMes: number; faturadoMesAnterior: number;
  aFaturar: number; aFaturarValor: number;
  receberVencido: number; receber30: number; pagarVencido: number; pagar30: number; saldoBancos: number;
  proximas: ContaResumo[];
}

export function VisaoGeralPanel({ emissor, irPara }: { emissor: EmissorStatus; irPara: (aba: "faturamento" | "contas" | "configuracoes") => void }) {
  const [d, setD] = useState<Dados | null>(null);
  const load = useCallback(async () => {
    await supabase.rpc("atualizar_contas_vencidas");
    const hoje = hojeISO(), em30 = somarDias(hoje, 30);
    const ini = `${mesISO()}-01`;
    const ant = new Date(`${ini}T12:00:00`); ant.setMonth(ant.getMonth() - 1);
    const iniAnt = `${mesISO(ant)}-01`;
    const [nfRes, nfAntRes, pedRes, cRes, bRes] = await Promise.all([
      supabase.from("notas_fiscais").select("valor_total").eq("tipo", "venda").eq("status", "autorizada").eq("ambiente", 1).gte("emitida_em", `${ini}T00:00:00-03:00`),
      supabase.from("notas_fiscais").select("valor_total").eq("tipo", "venda").eq("status", "autorizada").eq("ambiente", 1).gte("emitida_em", `${iniAnt}T00:00:00-03:00`).lt("emitida_em", `${ini}T00:00:00-03:00`),
      supabase.from("pedidos_comerciais").select("frete,desconto_pct,pedido_itens(quantidade,valor_unitario)").eq("status", "pronto"),
      supabase.from("contas_financeiras").select("id,tipo,descricao,valor,data_vencimento,status,favorecido").in("status", ["aberto", "vencido"]).order("data_vencimento").limit(3000),
      supabase.from("financeiro_contas_bancarias").select("saldo_atual"),
    ]);
    const contas = ((cRes.data ?? []) as unknown as ContaResumo[]).map(c => ({ ...c, valor: Number(c.valor) }));
    const soma = (l: ContaResumo[]) => l.reduce((s, c) => s + c.valor, 0);
    const pedidos = (pedRes.data ?? []) as unknown as PedidoFaturar[];
    setD({
      faturadoMes: (nfRes.data ?? []).reduce((s, n) => s + Number(n.valor_total ?? 0), 0),
      notasMes: nfRes.data?.length ?? 0,
      faturadoMesAnterior: (nfAntRes.data ?? []).reduce((s, n) => s + Number(n.valor_total ?? 0), 0),
      aFaturar: pedidos.length,
      aFaturarValor: pedidos.reduce((s, p) => s + totalPedido(p), 0),
      receberVencido: soma(contas.filter(c => c.tipo === "receber" && c.data_vencimento < hoje)),
      receber30: soma(contas.filter(c => c.tipo === "receber" && c.data_vencimento >= hoje && c.data_vencimento <= em30)),
      pagarVencido: soma(contas.filter(c => c.tipo === "pagar" && c.data_vencimento < hoje)),
      pagar30: soma(contas.filter(c => c.tipo === "pagar" && c.data_vencimento >= hoje && c.data_vencimento <= em30)),
      saldoBancos: (bRes.data ?? []).reduce((s, b) => s + Number(b.saldo_atual ?? 0), 0),
      proximas: contas.filter(c => c.data_vencimento <= somarDias(hoje, 7)).slice(0, 8),
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!d) return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  const variacao = d.faturadoMesAnterior > 0 ? ((d.faturadoMes - d.faturadoMesAnterior) / d.faturadoMesAnterior) * 100 : null;
  const saldo30 = d.saldoBancos + d.receber30 - d.pagar30;

  const cards = [
    { l: "Faturado no mês", v: formatBRL(d.faturadoMes), s: `${d.notasMes} nota${d.notasMes !== 1 ? "s" : ""}${variacao != null ? ` · ${variacao >= 0 ? "+" : ""}${variacao.toFixed(0)}% vs mês passado` : ""}`, Icon: Receipt, acao: () => irPara("faturamento") },
    { l: "Pronto para faturar", v: formatBRL(d.aFaturarValor), s: `${d.aFaturar} pedido${d.aFaturar !== 1 ? "s" : ""} aguardando nota`, Icon: FileText, alerta: d.aFaturar > 0, acao: () => irPara("faturamento") },
    { l: "A receber (30 dias)", v: formatBRL(d.receber30), s: d.receberVencido > 0 ? `${formatBRL(d.receberVencido)} vencido` : "nada vencido", Icon: ArrowDownCircle, perigo: d.receberVencido > 0, acao: () => irPara("contas") },
    { l: "A pagar (30 dias)", v: formatBRL(d.pagar30), s: d.pagarVencido > 0 ? `${formatBRL(d.pagarVencido)} vencido` : "nada vencido", Icon: ArrowUpCircle, perigo: d.pagarVencido > 0, acao: () => irPara("contas") },
    { l: "Saldo em bancos", v: formatBRL(d.saldoBancos), s: `previsto em 30 dias: ${formatBRL(saldo30)}`, Icon: Wallet, perigo: saldo30 < 0, acao: () => irPara("configuracoes") },
  ];

  return (
    <div className="space-y-4">
      {!emissor.ativo && emissor.carregado && (
        <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm flex flex-wrap items-center gap-2">
          <FileText className="h-4 w-4 text-primary shrink-0" />
          <span className="flex-1 min-w-[14rem]">Emissão de NF-e pelo sistema está desligada — as notas feitas em outro emissor são registradas em Faturamento. Pode ativar quando quiser.</span>
          <Button size="sm" variant="outline" onClick={() => irPara("configuracoes")}>Ver como ativar</Button>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        {cards.map(c => (
          <button key={c.l} type="button" onClick={c.acao} className="text-left rounded-2xl border bg-card p-4 hover:border-primary/40 hover:shadow-sm transition">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><c.Icon className="h-3.5 w-3.5" />{c.l}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{c.v}</p>
            <p className={cn("text-xs mt-0.5", c.perigo ? "text-red-600 font-medium" : c.alerta ? "text-amber-600 font-medium" : "text-muted-foreground")}>{c.s}</p>
          </button>
        ))}
      </div>
      <section className="rounded-2xl border bg-card">
        <div className="px-4 py-3 border-b flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary" /><h3 className="font-semibold text-sm flex-1">Vencidas e vencendo nos próximos 7 dias</h3>
          <Button size="sm" variant="ghost" onClick={() => irPara("contas")}>Ver todas</Button></div>
        {d.proximas.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nada vencendo nesta semana. 👍</p> : (
          <ul className="divide-y">
            {d.proximas.map(c => {
              const vencida = c.data_vencimento < hojeISO();
              return (
                <li key={c.id} className="px-4 py-3 flex items-center gap-3">
                  {c.tipo === "receber" ? <ArrowDownCircle className="h-5 w-5 text-green-600 shrink-0" /> : <ArrowUpCircle className="h-5 w-5 text-red-500 shrink-0" />}
                  <div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{c.favorecido ?? (c.descricao.split("—")[1]?.trim() || c.descricao)}</p><p className="text-xs text-muted-foreground truncate">{c.tipo === "receber" ? "A receber" : "A pagar"} · {c.descricao}</p></div>
                  <p className={cn("text-xs whitespace-nowrap", vencida ? "text-red-600 font-semibold" : "text-muted-foreground")}>{vencida && <AlertTriangle className="inline h-3.5 w-3.5 mr-0.5 -mt-0.5" />}{fmtData(c.data_vencimento)}</p>
                  <p className="font-semibold tabular-nums w-28 text-right">{formatBRL(c.valor)}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
