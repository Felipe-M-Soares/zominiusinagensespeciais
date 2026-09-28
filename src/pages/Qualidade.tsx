/**
 * Qualidade — 6 abas (antes eram 7, sem visão geral):
 *   Visão geral · Devolução/Troca · Pós-venda e recall (lote → cliente) ·
 *   Regularização ANVISA (pipeline de 4 fases) · Lotes no estoque (onde está
 *   + movimentações) · GS1.
 * "Rastreab. Pós-venda" e "Recall" viraram uma aba só; "Rastreamento" e
 * "Histórico" viraram a aba "Lotes no estoque". Nenhuma função foi removida.
 *
 * A aba ativa (e um filtro opcional) ficam na URL (?aba=...&f=...), então os
 * atalhos da visão geral abrem a lista já filtrada e o link pode ser
 * compartilhado.
 */
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Barcode, ClipboardCheck, LayoutDashboard, Loader2, MapPin, PackageSearch, ShieldCheck, Undo2 } from "lucide-react";
import { PageNav, type PageNavTab } from "@/components/PageNav";
import { useIsMobile } from "@/hooks/use-mobile";
import { carregarResumo, type ResumoQualidade } from "@/components/qualidade/shared";
import type { AbaQualidade } from "@/components/qualidade/VisaoGeralQualidadePanel";

const VisaoGeralQualidadePanel = lazy(() => import("@/components/qualidade/VisaoGeralQualidadePanel").then(m => ({ default: m.VisaoGeralQualidadePanel })));
const DevolucaoTrocaQualidadePanel = lazy(() => import("@/components/qualidade/DevolucaoTrocaQualidadePanel").then(m => ({ default: m.DevolucaoTrocaQualidadePanel })));
const RastreabilidadePanel = lazy(() => import("@/components/qualidade/RastreabilidadePanel").then(m => ({ default: m.RastreabilidadePanel })));
const RegularizacaoPanel = lazy(() => import("@/components/qualidade/RegularizacaoPanel").then(m => ({ default: m.RegularizacaoPanel })));
const EstoqueLotesPanel = lazy(() => import("@/components/qualidade/EstoqueLotesPanel").then(m => ({ default: m.EstoqueLotesPanel })));
const GS1Panel = lazy(() => import("@/components/qualidade/GS1Panel").then(m => ({ default: m.GS1Panel })));

const ABAS: AbaQualidade[] = ["visao", "devolucao", "posvenda", "regularizacao", "lotes", "gs1"];

export default function Qualidade() {
  const isMobile = useIsMobile();
  const [params, setParams] = useSearchParams();
  const abaUrl = params.get("aba") as AbaQualidade | null;
  const aba: AbaQualidade = abaUrl && ABAS.includes(abaUrl) ? abaUrl : "visao";
  const filtro = params.get("f");
  const [resumo, setResumo] = useState<ResumoQualidade | null>(null);

  const irPara = useCallback((a: AbaQualidade, f?: string) => setParams(p => {
    const n = new URLSearchParams(p);
    n.set("aba", a);
    if (f) n.set("f", f); else n.delete("f");
    return n;
  }, { replace: true }), [setParams]);

  const atualizarResumo = useCallback(() => {
    carregarResumo().then(setResumo).catch(() => setResumo(r => r ?? {
      aRegularizar: 0, emProcesso: 0, vencendo: [], vencendoTotal: 0, devolucoes: [], recalls: [], retrabalhoPecas: 0, retrabalhoItens: 0,
    }));
  }, []);
  useEffect(() => { atualizarResumo(); }, [atualizarResumo]);

  const recallAtivos = resumo?.recalls.filter(r => r.status_recall === "recall_ativo").length ?? 0;

  const TABS: PageNavTab<AbaQualidade>[] = [
    { id: "visao",         label: "Visão geral",   Icon: LayoutDashboard },
    { id: "devolucao",     label: "Devoluções",    Icon: Undo2,          badge: resumo?.devolucoes.length, activeColor: "text-orange-600 dark:text-orange-400", activeBg: "bg-orange-500/10", activeBorder: "border-orange-500/40", badgeBg: "bg-orange-500/15", badgeText: "text-orange-600 dark:text-orange-400" },
    { id: "posvenda",      label: "Pós-venda",     Icon: MapPin,         badge: recallAtivos, activeColor: "text-rose-600 dark:text-rose-400", activeBg: "bg-rose-500/10", activeBorder: "border-rose-500/40", badgeBg: "bg-rose-500/15", badgeText: "text-rose-600 dark:text-rose-400" },
    { id: "regularizacao", label: "ANVISA",        Icon: ClipboardCheck, badge: resumo?.vencendoTotal, activeColor: "text-violet-600 dark:text-violet-400", activeBg: "bg-violet-500/10", activeBorder: "border-violet-500/40", badgeBg: "bg-violet-500/15", badgeText: "text-violet-600 dark:text-violet-400" },
    { id: "lotes",         label: "Lotes",         Icon: PackageSearch,  activeColor: "text-blue-600 dark:text-blue-400", activeBg: "bg-blue-500/10", activeBorder: "border-blue-500/40" },
    { id: "gs1",           label: "GS1",           Icon: Barcode,        activeColor: "text-cyan-600 dark:text-cyan-400", activeBg: "bg-cyan-500/10", activeBorder: "border-cyan-500/40" },
  ];

  return (
    <div className="flex flex-col h-full bg-transparent">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="px-3 sm:px-4 h-12 sm:h-14 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold leading-tight">Qualidade</h1>
            <p className="hidden sm:block text-[10px] text-muted-foreground leading-tight truncate">Devoluções e trocas, rastreabilidade lote → cliente, recall, regularização ANVISA e UDI/GS1</p>
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto">
        <div className="px-3 sm:px-4 py-4 space-y-4">
          <PageNav tabs={TABS} activeTab={aba} onTabChange={a => irPara(a)} cols={isMobile ? 2 : undefined} loading={!resumo} ariaLabel="Seções da Qualidade" />
          <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
            {/* key com o filtro: abrir um atalho da visão geral remonta a aba já filtrada */}
            <div key={`${aba}:${filtro ?? ""}`}>
              {aba === "visao" && <VisaoGeralQualidadePanel resumo={resumo} irPara={irPara} />}
              {aba === "devolucao" && <DevolucaoTrocaQualidadePanel filtroInicial={filtro} onMudou={atualizarResumo} />}
              {aba === "posvenda" && <RastreabilidadePanel filtroInicial={filtro} onMudou={atualizarResumo} />}
              {aba === "regularizacao" && <RegularizacaoPanel filtroInicial={filtro} onMudou={atualizarResumo} />}
              {aba === "lotes" && <EstoqueLotesPanel filtroInicial={filtro} />}
              {aba === "gs1" && <GS1Panel />}
            </div>
          </Suspense>
        </div>
      </main>
    </div>
  );
}
