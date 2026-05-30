import { useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { AdminDevices } from "@/components/admin/AdminDevices";
import { AdminUsers } from "@/components/admin/AdminUsers";
import { PageNav } from "@/components/PageNav";
import { Settings, Cpu, Users } from "lucide-react";
import { getStoredTheme, applyTheme } from "@/lib/theme";

type AdminTab = "devices" | "users";

const ADMIN_TABS = [
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
];

export default function Admin() {
  const { signOut } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>("devices");

  const [isDark, setIsDark] = useState(() => {
    const theme = getStoredTheme();
    if (theme === "system") return window.matchMedia("(prefers-color-scheme: dark)").matches;
    return theme === "dark";
  });
  const toggleTheme = useCallback(() => {
    const next = !isDark;
    setIsDark(next);
    applyTheme(next ? "dark" : "light");
  }, [isDark]);

  return (
    <div className="flex flex-col h-full bg-transparent">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-primary" />
            <h1 className="text-sm font-semibold">Admin</h1>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleTheme}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors"
              title={isDark ? "Modo claro" : "Modo escuro"}
            >
              {isDark
                ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
                : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              }
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-4 py-4 space-y-4 h-full flex flex-col">
        <div className="rounded-xl border bg-primary/5 border-primary/20 text-primary/80 px-4 py-3 text-[12px]">
          Gerencie dispositivos cadastrados no sistema e controle o acesso dos usuários.
        </div>

        <PageNav
          tabs={ADMIN_TABS}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        {activeTab === "devices" && <AdminDevices />}
        {activeTab === "users"   && <AdminUsers />}
        </div>
      </main>
    </div>
  );
}
