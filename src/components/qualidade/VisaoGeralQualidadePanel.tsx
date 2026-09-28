/**
 * Visão geral da Qualidade — o que precisa de atenção hoje.
 * Cada KPI e cada lista leva direto para a aba certa, já filtrada.
 */
import { AlertTriangle, CalendarClock, ChevronRight, ClipboardCheck, Loader2, Lock, MapPin, ShieldCheck, Undo2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Chip, KpiCard, fmtDia, recallInfo, type ResumoQualidade } from "./shared";

export type AbaQualidade = "visao" | "devolucao" | "posvenda" | "regularizacao" | "lotes" | "gs1";

function diasDesde(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

function Secao({ Icon, cor, titulo, onVerTodos, children }: { Icon: React.ElementType; cor: string; titulo: string; onVerTodos: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card overflow-hidden flex flex-col min-w-0">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <Icon className={cn("h-4 w-4 shrink-0", cor)} />
        <h3 className="font-semibold text-sm flex-1 min-w-0 truncate">{titulo}</h3>
        <Button size="sm" variant="ghost" className="h-9 shrink-0" onClick={onVerTodos}>Ver todos</Button>
      </div>
      {children}
    </section>
  );
}

export function VisaoGeralQualidadePanel({ resumo, irPara }: { resumo: ResumoQualidade | null; irPara: (aba: AbaQualidade, filtro?: string) => void }) {
  if (!resumo) return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  const recallAtivo = resumo.recalls.filter(r => r.status_recall === "recall_ativo");
  const emAlerta = resumo.recalls.length - recallAtivo.length;
  const valorTravado = resumo.devolucoes.reduce((s, d) => s + d.valor_total, 0);
  const vencidos = resumo.vencendo.filter(v => v.dias_ate_vencer < 0).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <div className="col-span-2 sm:col-span-1 grid">
          <KpiCard label="Retornos a analisar" value={resumo.devolucoes.length} Icon={Lock} tom={resumo.devolucoes.length > 0 ? "atencao" : "ok"}
            sub={resumo.devolucoes.length > 0 ? `${formatBRL(valorTravado)} travados aguardando laudo` : "nenhum retorno pendente"}
            onClick={() => irPara("devolucao", "aberto")} />
        </div>
        <KpiCard label="Recall ativo" value={recallAtivo.length} Icon={AlertTriangle} tom={recallAtivo.length > 0 ? "perigo" : "ok"}
          sub={emAlerta > 0 ? `+ ${emAlerta} envio(s) em alerta` : "nenhum lote em alerta"}
          onClick={() => irPara("posvenda", recallAtivo.length > 0 ? "recall_ativo" : "atencao")} />
        <KpiCard label="A regularizar" value={resumo.aRegularizar} Icon={ClipboardCheck} tom={resumo.aRegularizar > 0 ? "atencao" : "ok"}
          sub={`${resumo.emProcesso} em processo na ANVISA`} onClick={() => irPara("regularizacao", "abertas")} />
        <KpiCard label="Registro vencendo" value={resumo.vencendoTotal} Icon={CalendarClock} tom={vencidos > 0 ? "perigo" : resumo.vencendoTotal > 0 ? "atencao" : "neutro"}
          sub={vencidos > 0 ? `${vencidos} já vencido(s)` : "nos próximos 12 meses"} onClick={() => irPara("regularizacao", "vencendo")} />
        <KpiCard label="Retidas no retrabalho" value={resumo.retrabalhoPecas.toLocaleString("pt-BR")} Icon={Wrench} tom={resumo.retrabalhoPecas > 0 ? "atencao" : "neutro"}
          sub={`${resumo.retrabalhoItens} item(ns) de estoque`} onClick={() => irPara("lotes")} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Secao Icon={Undo2} cor="text-orange-500" titulo="Retornos aguardando análise" onVerTodos={() => irPara("devolucao", "aberto")}>
          {resumo.devolucoes.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma peça aguardando laudo.</p>
          ) : (
            <ul className="divide-y">
              {resumo.devolucoes.slice(0, 5).map(d => {
                const dias = diasDesde(d.created_at);
                return (
                  <li key={d.id}>
                    <button type="button" onClick={() => irPara("devolucao", "aberto")} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/30">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{d.cliente_nome}</p>
                        <p className="text-xs text-muted-foreground truncate">NF {d.nf_original_numero ?? "—"} · recebido em {fmtDia(d.created_at)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold tabular-nums">{formatBRL(d.valor_total)}</p>
                        <p className={cn("text-xs", dias > 7 ? "text-red-600 font-medium" : dias > 2 ? "text-amber-600" : "text-muted-foreground")}>
                          {dias === 0 ? "hoje" : `há ${dias} dia${dias !== 1 ? "s" : ""}`}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Secao>

        <Secao Icon={MapPin} cor="text-rose-500" titulo="Recall e alertas" onVerTodos={() => irPara("posvenda", "atencao")}>
          {resumo.recalls.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum lote em recall ou alerta.</p>
          ) : (
            <ul className="divide-y">
              {[...recallAtivo, ...resumo.recalls.filter(r => r.status_recall !== "recall_ativo")].slice(0, 5).map(r => {
                const info = recallInfo(r.status_recall);
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => irPara("posvenda", r.status_recall)} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/30">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="text-sm font-medium truncate"><span className="font-mono">{r.lote}</span> · {r.device_ref}</p>
                        <p className="text-xs text-muted-foreground truncate">{r.cliente_nome} · {r.quantidade} un. · {fmtDia(r.data_envio)}</p>
                      </div>
                      <Chip tom={info.tom} className="shrink-0">{info.label}</Chip>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Secao>

        <Secao Icon={ShieldCheck} cor="text-violet-500" titulo="Registros ANVISA a renovar" onVerTodos={() => irPara("regularizacao", "vencendo")}>
          {resumo.vencendo.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum registro vence nos próximos 12 meses.</p>
          ) : (
            <ul className="divide-y">
              {resumo.vencendo.slice(0, 5).map(v => (
                <li key={v.id}>
                  <button type="button" onClick={() => irPara("regularizacao", "vencendo")} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/30">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{v.model}</p>
                      <p className="text-xs text-muted-foreground font-mono truncate">{v.reference}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={cn("text-sm font-semibold", v.dias_ate_vencer < 0 ? "text-red-600" : v.dias_ate_vencer < 90 ? "text-red-600" : "text-amber-600")}>
                        {v.dias_ate_vencer < 0 ? `vencido há ${-v.dias_ate_vencer}d` : `${v.dias_ate_vencer} dias`}
                      </p>
                      <p className="text-xs text-muted-foreground">{fmtDia(v.data_vencimento_anvisa)}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 hidden sm:block" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Secao>
      </div>
    </div>
  );
}
