/**
 * CadastrosPanel — Unifica Máquinas e Produtos numa única aba do menu de Produção.
 * Ferramentas foi movido para o módulo Processos.
 */
import { useState } from "react";
import { Settings2, Package } from "lucide-react";
import { PageNav, type PageNavTab } from "@/components/PageNav";
import { MaquinasPanel } from "@/components/producao/MaquinasPanel";
import { ProdutosPanel } from "@/components/producao/ProdutosPanel";

type CadastroView = "maquinas" | "produtos";

const TABS: PageNavTab<CadastroView>[] = [
  { id: "maquinas", label: "Máquinas", Icon: Settings2, activeColor: "text-purple-600 dark:text-purple-400", activeBg: "bg-purple-500/10", activeBorder: "border-purple-500/40", badgeBg: "bg-purple-500/15", badgeText: "text-purple-600 dark:text-purple-400" },
  { id: "produtos", label: "Produtos", Icon: Package, activeColor: "text-cyan-600 dark:text-cyan-400", activeBg: "bg-cyan-500/10", activeBorder: "border-cyan-500/40", badgeBg: "bg-cyan-500/15", badgeText: "text-cyan-600 dark:text-cyan-400" },
];

export function CadastrosPanel({ isAdmin, canWrite }: { isAdmin: boolean; canWrite?: boolean }) {
  const [view, setView] = useState<CadastroView>("maquinas");

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <PageNav tabs={TABS} activeTab={view} onTabChange={setView} cols={2} />
      {view === "maquinas" && <MaquinasPanel isAdmin={isAdmin} canWrite={canWrite} />}
      {view === "produtos" && <ProdutosPanel isAdmin={isAdmin} canWrite={canWrite} />}
    </div>
  );
}
