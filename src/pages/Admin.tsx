/**
 * Admin — painel geral, usuários, dispositivos (catálogo), auditoria e
 * feedback. Só para o perfil admin (RoleGuard adminOnly em App.tsx).
 * A aba aberta fica na URL (?aba=...).
 */
import { useCallback, useEffect, useState, lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { AdminDevices } from "@/components/admin/AdminDevices";
import { AdminUsers } from "@/components/admin/AdminUsers";
import { AuditLogPanel } from "@/components/admin/AuditLogPanel";
import { FeedbackPanel } from "@/components/admin/FeedbackPanel";
import { ClearHistoryButton } from "@/components/admin/ClearHistoryButton";
import { DashboardGeral } from "@/components/qualidade/DashboardGeral";
import { PageNav, type PageNavTab } from "@/components/PageNav";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Settings, Cpu, Users, LayoutDashboard, Shield, MessageSquare, DatabaseBackup } from "lucide-react";

const BackupPanel = lazy(() => import("@/components/stock/BackupPanel").then(m => ({ default: m.BackupPanel })));

type AdminTab = "dashboard" | "users" | "devices" | "auditoria" | "feedback";
const ABAS: AdminTab[] = ["dashboard", "users", "devices", "auditoria", "feedback"];

const DESCRICAO: Record<AdminTab, string> = {
  dashboard: "Resumo geral da empresa",
  users: "Contas, perfis de acesso e senhas",
  devices: "Catálogo de dispositivos, imagens e desenhos técnicos",
  auditoria: "Registro das ações administrativas",
  feedback: "Problemas e sugestões enviados pela equipe",
};

export default function Admin() {
  const [params, setParams] = useSearchParams();
  const abaUrl = params.get("aba") as AdminTab | null;
  const activeTab: AdminTab = abaUrl && ABAS.includes(abaUrl) ? abaUrl : "dashboard";
  const setActiveTab = useCallback((t: AdminTab) => setParams(p => { const n = new URLSearchParams(p); n.set("aba", t); return n; }, { replace: true }), [setParams]);

  const [auditKey, setAuditKey] = useState(0);
  const [backupOpen, setBackupOpen] = useState(false);
  const [pendentes, setPendentes] = useState(0);
  const [feedbackNovos, setFeedbackNovos] = useState(0);

  // Contadores para os selos das abas (usuários aguardando aprovação e
  // feedbacks novos). Falha silenciosa: sem selo, nada quebra.
  useEffect(() => {
    let vivo = true;
    supabase.from("profiles").select("user_id", { count: "exact", head: true })
      .eq("approved", false).eq("blocked", false)
      .then(({ count }) => { if (vivo) setPendentes(count ?? 0); });
    supabase.rpc("listar_feedback_reports", { p_status: "novo" })
      .then(({ data }) => { if (vivo) setFeedbackNovos(Array.isArray(data) ? data.length : 0); });
    return () => { vivo = false; };
  }, [activeTab]);

  const tabs: PageNavTab<AdminTab>[] = [
    { id: "dashboard", label: "Painel", Icon: LayoutDashboard, activeColor: "text-emerald-600 dark:text-emerald-400", activeBg: "bg-emerald-500/10", activeBorder: "border-emerald-500/40", badgeBg: "bg-emerald-500/15", badgeText: "text-emerald-600 dark:text-emerald-400" },
    { id: "users", label: "Usuários", Icon: Users, badge: pendentes, activeColor: "text-violet-600 dark:text-violet-400", activeBg: "bg-violet-500/10", activeBorder: "border-violet-500/40", badgeBg: "bg-violet-500/15", badgeText: "text-violet-600 dark:text-violet-400" },
    { id: "devices", label: "Dispositivos", Icon: Cpu, activeColor: "text-primary", activeBg: "bg-primary/10", activeBorder: "border-primary/40", badgeBg: "bg-primary/15", badgeText: "text-primary" },
    { id: "auditoria", label: "Auditoria", Icon: Shield, activeColor: "text-amber-600 dark:text-amber-400", activeBg: "bg-amber-500/10", activeBorder: "border-amber-500/40", badgeBg: "bg-amber-500/15", badgeText: "text-amber-600 dark:text-amber-400" },
    { id: "feedback", label: "Feedback", Icon: MessageSquare, badge: feedbackNovos, activeColor: "text-rose-600 dark:text-rose-400", activeBg: "bg-rose-500/10", activeBorder: "border-rose-500/40", badgeBg: "bg-rose-500/15", badgeText: "text-rose-600 dark:text-rose-400" },
  ];

  return (
    <div className="flex flex-col h-full bg-transparent">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="px-3 sm:px-4 h-12 sm:h-14 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Settings className="h-4 w-4 text-primary shrink-0" />
            <div className="min-w-0">
              <h1 className="text-sm font-semibold leading-tight">Admin</h1>
              <p className="hidden sm:block text-[10px] text-muted-foreground leading-tight truncate">{DESCRICAO[activeTab]}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {activeTab === "auditoria" && (
              <ClearHistoryButton
                rpc="admin_clear_audit_log"
                confirmTitle="Apagar log de auditoria?"
                confirmDescription="Apaga todo o histórico de ações administrativas registradas. Não afeta nenhum outro dado do sistema."
                onCleared={() => setAuditKey(k => k + 1)}
              />
            )}
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs rounded-xl" onClick={() => setBackupOpen(true)} aria-label="Backup">
              <DatabaseBackup className="h-3.5 w-3.5" /><span className="hidden sm:inline">Backup</span>
            </Button>
          </div>
        </div>
      </header>

      <Suspense fallback={null}>
        <BackupPanel open={backupOpen} onClose={() => setBackupOpen(false)} />
      </Suspense>

      <main className="flex-1 overflow-y-auto">
        <div className="px-3 sm:px-4 py-4 space-y-4">
          <PageNav tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} ariaLabel="Seções do Admin" />
          <p className="sm:hidden text-xs text-muted-foreground -mt-1 px-1">{DESCRICAO[activeTab]}</p>

          {activeTab === "dashboard" && <DashboardGeral />}
          {activeTab === "devices"   && <AdminDevices />}
          {activeTab === "users"     && <AdminUsers onCountsChange={setPendentes} />}
          {activeTab === "auditoria" && <AuditLogPanel key={auditKey} />}
          {activeTab === "feedback"  && <FeedbackPanel onNovosChange={setFeedbackNovos} />}
        </div>
      </main>
    </div>
  );
}
