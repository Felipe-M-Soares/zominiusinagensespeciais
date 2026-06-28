/**
 * CadastrosPanel — Unifica Máquinas, Produtos e Ferramentas CNC numa única
 * aba do menu de Produção. Os três eram telas de cadastro administrativo
 * puro (CRUD simples que só alimenta dropdowns de outras telas, sem fluxo
 * operacional próprio) — esse wrapper só adiciona uma navegação interna,
 * sem alterar nenhuma lógica dos três painéis originais.
 */
import { useState } from "react";
import { Settings2, Package, Wrench } from "lucide-react";
import { PageNav, type PageNavTab } from "@/components/PageNav";
import { MaquinasPanel } from "@/components/producao/MaquinasPanel";
import { ProdutosPanel } from "@/components/producao/ProdutosPanel";
import { FerramentasPanel } from "@/components/producao/FerramentasPanel";

type CadastroView = "maquinas" | "produtos" | "ferramentas";

const TABS: PageNavTab<CadastroView>[] = [
  { id: "maquinas",    label: "Máquinas",    Icon: Settings2, activeColor: "text-purple-600 dark:text-purple-400", activeBg: "bg-purple-500/10", activeBorder: "border-purple-500/40", badgeBg: "bg-purple-500/15", badgeText: "text-purple-600 dark:text-purple-400" },
  { id: "produtos",    label: "Produtos",    Icon: Package,   activeColor: "text-cyan-600 dark:text-cyan-400",     activeBg: "bg-cyan-500/10",   activeBorder: "border-cyan-500/40",   badgeBg: "bg-cyan-500/15",   badgeText: "text-cyan-600 dark:text-cyan-400" },
  { id: "ferramentas", label: "Ferramentas", Icon: Wrench,    activeColor: "text-rose-600 dark:text-rose-400",     activeBg: "bg-rose-500/10",   activeBorder: "border-rose-500/40",   badgeBg: "bg-rose-500/15",   badgeText: "text-rose-600 dark:text-rose-400" },
];

export function CadastrosPanel({ isAdmin }: { isAdmin: boolean }) {
  const [view, setView] = useState<CadastroView>("maquinas");

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <PageNav tabs={TABS} activeTab={view} onTabChange={setView} cols={3} />
      {view === "maquinas" && <MaquinasPanel isAdmin={isAdmin} />}
      {view === "produtos" && <ProdutosPanel isAdmin={isAdmin} />}
      {view === "ferramentas" && <FerramentasPanel />}
    </div>
  );
}
