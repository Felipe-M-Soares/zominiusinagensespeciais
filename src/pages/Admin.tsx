import { useState } from "react";
import { AdminDevices } from "@/components/admin/AdminDevices";
import { AdminUsers } from "@/components/admin/AdminUsers";
import { AuditLogPanel } from "@/components/admin/AuditLogPanel";
import { ClearHistoryButton } from "@/components/admin/ClearHistoryButton";
import { DashboardGeral } from "@/components/qualidade/DashboardGeral";
import { PageNav } from "@/components/PageNav";
import { Settings, Cpu, Users, LayoutDashboard, Shield } from "lucide-react";

type AdminTab = "dashboard" | "devices" | "users" | "auditoria";

const ADMIN_TABS = [
  {
    id: "dashboard" as AdminTab,
    label: "Dashboard",
    Icon: LayoutDashboard,
    activeColor: "text-emerald-600 dark:text-emerald-400",
    activeBg: "bg-emerald-500/10",
    activeBorder: "border-emerald-500/40",
    badgeBg: "bg-emerald-500/15",
    badgeText: "text-emerald-600 dark:text-emerald-400",
  },
  {
    id: "devices" as AdminTab,
    label: "Dispositivos",
    Icon: Cpu,
    activeColor: "text-primary",
    activeBg: "bg-primary/10",
    activeBorder: "border-primary/40",
    badgeBg: "bg-primary/15",
    badgeText: "text-primary",
  },
  {
    id: "users" as AdminTab,
    label: "Usuários",
    Icon: Users,
    activeColor: "text-violet-600 dark:text-violet-400",
    activeBg: "bg-violet-500/10",
    activeBorder: "border-violet-500/40",
    badgeBg: "bg-violet-500/15",
    badgeText: "text-violet-600 dark:text-violet-400",
  },
  {
    id: "auditoria" as AdminTab,
    label: "Auditoria",
    Icon: Shield,
    activeColor: "text-amber-600 dark:text-amber-400",
    activeBg: "bg-amber-500/10",
    activeBorder: "border-amber-500/40",
    badgeBg: "bg-amber-500/15",
    badgeText: "text-amber-600 dark:text-amber-400",
  },
];

export default function Admin() {
  const [activeTab, setActiveTab] = useState<AdminTab>("dashboard");
  const [auditKey, setAuditKey] = useState(0);

  return (
    <div className="flex flex-col h-full bg-transparent">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="px-3 sm:px-4 h-12 sm:h-14 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-primary" />
            <h1 className="text-sm font-semibold">Admin</h1>
          </div>
          <div className="flex items-center gap-1">
            {activeTab === "auditoria" && (
              <ClearHistoryButton
                rpc="admin_clear_audit_log"
                confirmTitle="Apagar log de auditoria?"
                confirmDescription="Apaga todo o histórico de ações administrativas registradas. Não afeta nenhum outro dado do sistema."
                onCleared={() => setAuditKey(k => k + 1)}
              />
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="px-3 sm:px-4 py-4 space-y-4 h-full flex flex-col">
          <div className="rounded-xl border bg-primary/5 border-primary/20 text-primary/80 px-4 py-3 text-[12px]">
            Gerencie dispositivos cadastrados no sistema e controle o acesso dos usuários.
          </div>

          <PageNav
            tabs={ADMIN_TABS}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />

          {activeTab === "dashboard" && <DashboardGeral />}
          {activeTab === "devices"   && <AdminDevices />}
          {activeTab === "users"     && <AdminUsers />}
          {activeTab === "auditoria" && <AuditLogPanel key={auditKey} />}
        </div>
      </main>
    </div>
  );
}
