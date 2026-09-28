/**
 * Painel do Comercial: vendas do mês, ticket médio, pedidos aguardando,
 * atrasados, evolução mensal, top clientes e top peças.
 * Vendedora vê os próprios números; admin/gerente veem tudo e podem filtrar
 * por vendedora. Os cards levam para a aba certa já filtrada.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, BarChart3, CalendarClock, Clock, Download, Package, Receipt, RotateCcw, Trophy, TrendingUp, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { escHtml } from "@/lib/escHtml";
import { Button } from "@/components/ui/button";
import { STATUS_VENDA, pedidoAtrasado, totalPedido, type PedidoCompleto } from "@/types/comercial";
import { chaveVendedora, periodoRapido, type FiltroHistorico } from "@/components/comercial/HistoricoPanel";

export type FiltroPedidosDash = "pendente" | "atrasados" | "retorno" | "pronto";

interface Props {
  pedidos: PedidoCompleto[];
  loading: boolean;
  currentUserName: string | null;
  verTudo: boolean;
  meus: (p: PedidoCompleto) => boolean;
  onIrPedidos: (filtro: FiltroPedidosDash, vendedora: string) => void;
  onIrHistorico: (f: Partial<FiltroHistorico>) => void;
  onAbrirCliente: (clienteId: string) => void;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const brlCurto = (v: number) => v >= 1_000_000 ? `R$ ${(v / 1_000_000).toFixed(1).replace(".", ",")} mi` : v >= 10_000 ? `R$ ${Math.round(v / 1000)} mil` : formatBRL(v);

export function DashboardComercial({ pedidos, loading, currentUserName, verTudo, meus, onIrPedidos, onIrHistorico, onAbrirCliente }: Props) {
  const [vendedora, setVendedora] = useState("");

  const vendedoras = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pedidos) m.set(chaveVendedora(p), p.vendedora_nome ?? "Sem vendedora");
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [pedidos]);

  const escopo = useMemo(() => {
    if (!verTudo) return pedidos.filter(meus);
    return vendedora ? pedidos.filter(p => chaveVendedora(p) === vendedora) : pedidos;
  }, [pedidos, verTudo, meus, vendedora]);

  const d = useMemo(() => {
    const agora = new Date();
    const iniMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
    const iniMesPassado = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
    // mesmo dia do mês passado — comparação justa com o mês corrente
    const mesmoDiaMesPassado = new Date(agora.getFullYear(), agora.getMonth() - 1, agora.getDate(), 23, 59, 59);
    const ini12 = new Date(agora.getFullYear() - 1, agora.getMonth() + 1, 1);
    const vendas = escopo.filter(p => STATUS_VENDA.includes(p.status));
    const doMes = vendas.filter(p => new Date(p.created_at) >= iniMes);
    const mesPassadoAteHoje = vendas.filter(p => { const c = new Date(p.created_at); return c >= iniMesPassado && c <= mesmoDiaMesPassado; });
    const valorMes = doMes.reduce((s, p) => s + totalPedido(p), 0);
    const valorMesPassado = mesPassadoAteHoje.reduce((s, p) => s + totalPedido(p), 0);
    const pendentes = escopo.filter(p => p.status === "pendente");
    const atrasados = escopo.filter(p => pedidoAtrasado(p, agora));
    const retorno = escopo.filter(p => p.status === "retorno");
    const prontos = escopo.filter(p => p.status === "pronto");

    // Evolução — últimos 6 meses
    const meses: { chave: string; label: string; valor: number; qtd: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const m = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
      meses.push({ chave: `${m.getFullYear()}-${m.getMonth()}`, label: MESES[m.getMonth()], valor: 0, qtd: 0 });
    }
    for (const p of vendas) {
      const c = new Date(p.created_at);
      const mm = meses.find(x => x.chave === `${c.getFullYear()}-${c.getMonth()}`);
      if (mm) { mm.valor += totalPedido(p); mm.qtd += 1; }
    }

    // Top clientes e peças — últimos 12 meses
    const ult12 = vendas.filter(p => new Date(p.created_at) >= ini12);
    const cli = new Map<string, { id: string; nome: string; valor: number; pedidos: number }>();
    const pecas = new Map<string, { nome: string; ref: string; qtd: number; valor: number }>();
    const vend = new Map<string, { nome: string; valor: number; pedidos: number }>();
    for (const p of ult12) {
      const t = totalPedido(p);
      const c = cli.get(p.cliente_id) ?? { id: p.cliente_id, nome: p.cliente_nome, valor: 0, pedidos: 0 };
      c.valor += t; c.pedidos += 1; cli.set(p.cliente_id, c);
      for (const i of p.itens) {
        const k = i.device_id ?? i.device_model ?? "—";
        const x = pecas.get(k) ?? { nome: i.device_model ?? "—", ref: i.device_reference ?? "", qtd: 0, valor: 0 };
        x.qtd += i.quantidade; x.valor += (i.valor_unitario ?? 0) * i.quantidade; pecas.set(k, x);
      }
    }
    for (const p of doMes) {
      const k = chaveVendedora(p);
      const v = vend.get(k) ?? { nome: p.vendedora_nome ?? "Sem vendedora", valor: 0, pedidos: 0 };
      v.valor += totalPedido(p); v.pedidos += 1; vend.set(k, v);
    }
    return {
      valorMes, qtdMes: doMes.length, ticket: doMes.length ? valorMes / doMes.length : 0,
      ticketPassado: mesPassadoAteHoje.length ? valorMesPassado / mesPassadoAteHoje.length : 0,
      variacao: valorMesPassado > 0 ? ((valorMes - valorMesPassado) / valorMesPassado) * 100 : null,
      pendentes: pendentes.length, pendentesValor: pendentes.reduce((s, p) => s + totalPedido(p), 0),
      atrasados: atrasados.length, retorno: retorno.length, prontos: prontos.length,
      meses,
      topClientes: [...cli.values()].sort((a, b) => b.valor - a.valor).slice(0, 5),
      topPecas: [...pecas.values()].sort((a, b) => b.qtd - a.qtd).slice(0, 5),
      ranking: [...vend.values()].sort((a, b) => b.valor - a.valor).slice(0, 6),
    };
  }, [escopo]);

  function baixarRelatorio() {
    const confirmados = escopo.filter(p => STATUS_VENDA.includes(p.status));
    if (confirmados.length === 0) { toast.error("Nenhum pedido confirmado encontrado."); return; }
    const nomeRel = verTudo ? (vendedora ? vendedoras.find(([k]) => k === vendedora)?.[1] ?? "" : "Todas as vendedoras") : currentUserName ?? "";
    const pecas: Record<string, { model: string; ref: string; total: number }> = {};
    for (const p of confirmados) for (const i of p.itens) {
      const model = i.device_model?.trim() || "—"; const ref = i.device_reference?.trim() || "—";
      const key = `${model}||${ref}`;
      if (!pecas[key]) pecas[key] = { model, ref, total: 0 };
      pecas[key].total += i.quantidade ?? 0;
    }
    const pecasList = Object.values(pecas).sort((a, b) => b.total - a.total);
    const esc = escHtml;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Relatório de Pedidos — ${esc(nomeRel)}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px;color:#111}h1{font-size:18px;margin-bottom:4px}p.sub{font-size:12px;color:#666;margin-bottom:20px}
      table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;padding:8px 10px;background:#f3f4f6;border-bottom:2px solid #ddd}
      td{padding:7px 10px;border-bottom:1px solid #eee}.r{text-align:right}.total{font-weight:bold}.footer{margin-top:20px;font-size:11px;color:#999}</style></head><body>
      <h1>Relatório de Pedidos</h1>
      <p class="sub">Vendedora: <strong>${esc(nomeRel)}</strong> · Gerado em ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
      <table><thead><tr><th>#</th><th>Peça</th><th>Referência</th><th class="r">Qtd. vendida</th></tr></thead><tbody>
      ${pecasList.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.model)}</td><td>${esc(p.ref)}</td><td class="r total">${p.total}</td></tr>`).join("")}
      </tbody></table>
      <h2 style="font-size:14px;margin:20px 0 8px">Pedidos</h2>
      <table><thead><tr><th>#</th><th>Cliente</th><th>Situação</th><th>Data</th><th class="r">Peças</th><th class="r">Total</th></tr></thead><tbody>
      ${confirmados.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.cliente_nome)}</td><td>${esc(p.status)}</td><td>${new Date(p.created_at).toLocaleDateString("pt-BR")}</td><td class="r">${p.itens.reduce((s, it) => s + it.quantidade, 0)}</td><td class="r">${esc(formatBRL(totalPedido(p)))}</td></tr>`).join("")}
      </tbody></table>
      <p class="footer">Total de ${confirmados.length} pedido(s) confirmado(s) · ${pecasList.reduce((s, p) => s + p.total, 0)} peças · ${esc(formatBRL(confirmados.reduce((s, p) => s + totalPedido(p), 0)))}</p>
      </body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const w = window.open(url, "_blank");
    if (!w) { URL.revokeObjectURL(url); toast.error("Popup bloqueado. Permita popups para imprimir."); return; }
    w.addEventListener("load", () => { w.print(); URL.revokeObjectURL(url); }, { once: true });
  }

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => <div key={i} className="rounded-2xl border bg-muted/30 h-28 animate-pulse" />)}
      </div>
    );
  }

  const cards = [
    { l: "Vendas do mês", v: brlCurto(d.valorMes), s: `${d.qtdMes} pedido${d.qtdMes !== 1 ? "s" : ""}${d.variacao != null ? ` · ${d.variacao >= 0 ? "+" : ""}${d.variacao.toFixed(0)}% vs mês passado` : ""}`, Icon: Receipt, tom: "",
      acao: () => onIrHistorico({ ...periodoRapido("mes"), situacao: "vendas", vendedora }) },
    { l: "Ticket médio", v: d.ticket ? brlCurto(d.ticket) : "—", s: d.ticketPassado ? `mês passado: ${brlCurto(d.ticketPassado)}` : "por pedido no mês", Icon: TrendingUp, tom: "",
      acao: () => onIrHistorico({ ...periodoRapido("mes"), situacao: "vendas", vendedora }) },
    { l: "A confirmar", v: String(d.pendentes), s: d.pendentes ? `${formatBRL(d.pendentesValor)} a confirmar` : "nada pendente", Icon: Clock, tom: d.pendentes ? "alerta" : "",
      acao: () => onIrPedidos("pendente", vendedora) },
    { l: "Atrasados", v: String(d.atrasados), s: d.atrasados ? "prazo de entrega vencido" : "tudo no prazo", Icon: CalendarClock, tom: d.atrasados ? "perigo" : "ok",
      acao: () => onIrPedidos("atrasados", vendedora) },
  ];

  const maxMes = Math.max(1, ...d.meses.map(m => m.valor));
  const maxCli = d.topClientes[0]?.valor || 1;
  const maxPeca = d.topPecas[0]?.qtd || 1;
  const maxVend = d.ranking[0]?.valor || 1;

  return (
    <div className="space-y-4">
      {verTudo && (
        <div className="flex flex-wrap items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <select value={vendedora} onChange={e => setVendedora(e.target.value)} aria-label="Filtrar por vendedora"
            className="h-11 flex-1 sm:flex-none sm:min-w-[14rem] rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="">Todas as vendedoras</option>
            {vendedoras.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
        </div>
      )}

      {(d.retorno > 0 || d.prontos > 0) && (
        <div className="flex flex-wrap gap-2">
          {d.retorno > 0 && (
            <button type="button" onClick={() => onIrPedidos("retorno", vendedora)} className="flex-1 min-w-[14rem] rounded-2xl border border-orange-500/30 bg-orange-500/5 px-4 py-3 text-left text-sm flex items-center gap-2 hover:border-orange-500/60">
              <RotateCcw className="h-4 w-4 text-orange-600 shrink-0" />
              <span><strong>{d.retorno}</strong> pedido{d.retorno !== 1 ? "s" : ""} voltou do estoque — revise e reenvie</span>
            </button>
          )}
          {d.prontos > 0 && (
            <button type="button" onClick={() => onIrPedidos("pronto", vendedora)} className="flex-1 min-w-[14rem] rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-left text-sm flex items-center gap-2 hover:border-emerald-500/60">
              <Package className="h-4 w-4 text-emerald-600 shrink-0" />
              <span><strong>{d.prontos}</strong> pronto{d.prontos !== 1 ? "s" : ""} aguardando nota fiscal</span>
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map(c => (
          <button key={c.l} type="button" onClick={c.acao} className="text-left rounded-2xl border bg-card p-3 sm:p-4 hover:border-primary/40 hover:shadow-sm transition min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 leading-tight"><c.Icon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{c.l}</span></p>
            <p className={cn("mt-1 text-xl sm:text-2xl font-bold tabular-nums truncate", c.tom === "perigo" && "text-red-600 dark:text-red-400", c.tom === "alerta" && "text-amber-600 dark:text-amber-400")}>{c.v}</p>
            <p className={cn("text-xs mt-0.5 line-clamp-2", c.tom === "perigo" ? "text-red-600 dark:text-red-400 font-medium" : c.tom === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
              {c.tom === "perigo" && <AlertTriangle className="inline h-3 w-3 mr-0.5 -mt-0.5" />}{c.s}
            </p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Evolução mensal */}
        <section className="rounded-2xl border bg-card lg:col-span-1">
          <div className="px-4 py-3 border-b flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /><h3 className="font-semibold text-sm">Vendas por mês</h3></div>
          <div className="p-4">
            <div className="flex items-end gap-2 h-36" role="img" aria-label={`Vendas dos últimos 6 meses: ${d.meses.map(m => `${m.label} ${formatBRL(m.valor)}`).join(", ")}`}>
              {d.meses.map((m, i) => {
                const atual = i === d.meses.length - 1;
                return (
                  <div key={m.chave} className="flex-1 h-full flex flex-col justify-end items-center gap-1 group" title={`${m.label}: ${formatBRL(m.valor)} · ${m.qtd} pedido${m.qtd !== 1 ? "s" : ""}`}>
                    <span className="text-[10px] tabular-nums text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">{m.valor ? brlCurto(m.valor).replace("R$ ", "") : ""}</span>
                    <div className={cn("w-full max-w-10 rounded-t-[4px]", atual ? "bg-primary" : "bg-primary/40 group-hover:bg-primary/60")} style={{ height: `${Math.max(m.valor ? 4 : 1, (m.valor / maxMes) * 100)}%` }} />
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 mt-1.5 border-t pt-1.5">
              {d.meses.map((m, i) => <span key={m.chave} className={cn("flex-1 text-center text-xs", i === d.meses.length - 1 ? "font-semibold" : "text-muted-foreground")}>{m.label}</span>)}
            </div>
          </div>
        </section>

        {/* Top clientes */}
        <section className="rounded-2xl border bg-card">
          <div className="px-4 py-3 border-b flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-500" /><h3 className="font-semibold text-sm flex-1">Clientes que mais compraram</h3><span className="text-xs text-muted-foreground">12 meses</span></div>
          {d.topClientes.length === 0 ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">Sem vendas confirmadas ainda.</p> : (
            <ul className="divide-y">
              {d.topClientes.map((c, i) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onAbrirCliente(c.id)} className="w-full px-4 py-2.5 text-left hover:bg-muted/40 space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="w-5 text-xs text-muted-foreground tabular-nums">{i + 1}º</span>
                      <span className="font-medium truncate flex-1">{c.nome}</span>
                      <span className="font-semibold tabular-nums shrink-0">{brlCurto(c.valor)}</span>
                    </div>
                    <div className="ml-7 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary/70" style={{ width: `${(c.valor / maxCli) * 100}%` }} /></div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Top peças */}
        <section className="rounded-2xl border bg-card">
          <div className="px-4 py-3 border-b flex items-center gap-2"><Package className="h-4 w-4 text-primary" /><h3 className="font-semibold text-sm flex-1">Peças mais vendidas</h3><span className="text-xs text-muted-foreground">12 meses</span></div>
          {d.topPecas.length === 0 ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">Sem vendas confirmadas ainda.</p> : (
            <ul className="divide-y">
              {d.topPecas.map((p, i) => (
                <li key={`${p.nome}-${p.ref}`} className="px-4 py-2.5 space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-5 text-xs text-muted-foreground tabular-nums">{i + 1}º</span>
                    <span className="font-medium truncate flex-1" title={p.ref}>{p.nome}</span>
                    <span className="font-semibold tabular-nums shrink-0">{p.qtd.toLocaleString("pt-BR")} un.</span>
                  </div>
                  <div className="ml-7 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary/70" style={{ width: `${(p.qtd / maxPeca) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {verTudo && !vendedora && d.ranking.length > 0 && (
        <section className="rounded-2xl border bg-card">
          <div className="px-4 py-3 border-b flex items-center gap-2"><Users className="h-4 w-4 text-primary" /><h3 className="font-semibold text-sm flex-1">Vendas do mês por vendedora</h3></div>
          <ul className="divide-y">
            {d.ranking.map((v, i) => (
              <li key={v.nome + i} className="px-4 py-2.5 space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="w-5 text-xs text-muted-foreground tabular-nums">{i + 1}º</span>
                  <span className="font-medium truncate flex-1">{v.nome}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{v.pedidos} ped.</span>
                  <span className="font-semibold tabular-nums shrink-0 w-24 text-right">{brlCurto(v.valor)}</span>
                </div>
                <div className="ml-7 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary/70" style={{ width: `${(v.valor / maxVend) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Button variant="outline" className="w-full sm:w-auto h-11 gap-2" onClick={baixarRelatorio}>
        <Download className="h-4 w-4" />{verTudo ? "Relatório de pedidos (PDF)" : "Baixar meu relatório em PDF"}
      </Button>
    </div>
  );
}
