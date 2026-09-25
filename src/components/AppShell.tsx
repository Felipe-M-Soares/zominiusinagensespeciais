import { useState, useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/hooks/useNotifications";
import { getStoredTheme, applyTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/types/roles";
import type { AppRole } from "@/types/roles";
import logoZomini from "@/assets/logo_zomini.png";
import { NotificacoesPanel } from "@/components/NotificacoesPanel";
import {
  Boxes,
  ShoppingBag,
  Receipt,
  Settings,
  LogOut,
  Sun,
  Moon,
  ChevronLeft,
  Menu,
  X,
  Factory,
  Workflow,
  Cpu,
  ShieldCheck,
  Info,
} from "lucide-react";
import { FeedbackButton } from "@/components/FeedbackButton";
import { APP_VERSION } from "@/lib/appInfo";

interface NavItem {
  label: string;
  icon: React.ElementType;
  path: string;
  roles?: string[];
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Componentes", icon: Cpu,          path: "/",          roles: ["admin","estoque","qualidade","producao"] },
  { label: "Estoque",     icon: Boxes,         path: "/estoque",   roles: ["admin","estoque","qualidade"] },
  { label: "Qualidade",   icon: ShieldCheck,   path: "/qualidade", roles: ["admin","qualidade"] },
  { label: "Comercial",   icon: ShoppingBag,   path: "/comercial", roles: ["admin","comercial"] },
  { label: "Financeiro",  icon: Receipt,       path: "/financeiro",roles: ["admin","financeiro"] },
  { label: "Produção",    icon: Factory,       path: "/producao",  roles: ["admin","producao"] },
  { label: "Processos",   icon: Workflow,      path: "/processos", roles: ["admin","processos","producao"] },
];

const ADMIN_ITEMS: NavItem[] = [
  { label: "Admin", icon: Settings, path: "/admin", adminOnly: true },
];

interface SidebarNavProps {
  visibleItems: NavItem[];
  isAdmin: boolean;
  collapsed: boolean;
  isActive: (path: string) => boolean;
  onNav: (path: string) => void;
}

function SidebarNav({ visibleItems, isAdmin, collapsed, isActive, onNav }: SidebarNavProps) {
  return (
    <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto scrollbar-thin">
      {!collapsed && (
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 pb-1 pt-1">
          Módulos
        </p>
      )}
      {visibleItems.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.path);
        return (
          <button
            key={item.path}
            onClick={() => onNav(item.path)}
            title={collapsed ? item.label : undefined}
            className={cn(
              "w-full flex items-center rounded-lg text-sm font-medium transition-all duration-150 group relative overflow-hidden",
              collapsed ? "p-2.5 justify-center" : "px-3 py-2.5 gap-3",
              active
                ? "bg-primary/10 text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            )}
          >
            {!collapsed && active && (
              <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-primary" />
            )}
            <Icon className={cn("shrink-0 transition-colors", collapsed ? "w-5 h-5" : "w-4 h-4")} />
            {!collapsed && <span className="truncate">{item.label}</span>}
            {collapsed && active && (
              <span className="absolute left-full ml-2 px-2 py-1 bg-foreground text-background text-xs rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg">
                {item.label}
              </span>
            )}
          </button>
        );
      })}

      {isAdmin && (
        <>
          {!collapsed && (
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 pb-1 pt-3">
              Administração
            </p>
          )}
          {collapsed && <div className="border-t border-sidebar-border/60 my-2" />}
          {ADMIN_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                onClick={() => onNav(item.path)}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "w-full flex items-center rounded-lg text-sm font-medium transition-all duration-150 group relative",
                  collapsed ? "p-2.5 justify-center" : "px-3 py-2.5 gap-3",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                )}
              >
                <Icon className={cn("shrink-0 transition-colors", collapsed ? "w-5 h-5" : "w-4 h-4")} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </>
      )}
    </nav>
  );
}

interface MobileNavProps {
  visibleItems: NavItem[];
  isAdmin: boolean;
  isActive: (path: string) => boolean;
  onNav: (path: string) => void;
}

function MobileNav({ visibleItems, isAdmin, isActive, onNav }: MobileNavProps) {
  return (
    <nav className="py-3 px-2 space-y-0.5">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 pb-1 pt-1">
        Módulos
      </p>
      {visibleItems.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.path);
        return (
          <button
            key={item.path}
            onClick={() => onNav(item.path)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            )}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span>{item.label}</span>
          </button>
        );
      })}
      {isAdmin && (
        <>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 pb-1 pt-3">
            Administração
          </p>
          {ADMIN_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                onClick={() => onNav(item.path)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </>
      )}
    </nav>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export function AppShell({ children }: { children: React.ReactNode }) {
  const { signOut, isAdmin, role, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // ── Notificações: hook chamado UMA VEZ aqui, dados passados via props ────────
  // Restrito a admin — enabled=false evita query + canal Realtime
  // desnecessários para quem nunca vai ver o painel (ver NotificacoesBell
  // em Comercial.tsx para o sino próprio da vendedora, que é independente).
  const notifState = useNotifications(isAdmin);

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isDark, setIsDark] = useState(() => {
    const theme = getStoredTheme();
    if (theme === "system") return window.matchMedia("(prefers-color-scheme: dark)").matches;
    return theme === "dark";
  });

  useEffect(() => {
    applyTheme(getStoredTheme());
  }, []);

  // Atalho Cmd+K / Ctrl+K → busca global no estoque
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        navigate("/estoque");
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [navigate]);

  const toggleTheme = useCallback(() => {
    const next = !isDark;
    setIsDark(next);
    applyTheme(next ? "dark" : "light");
  }, [isDark]);

  const isActive = useCallback(
    (path: string) => {
      if (path === "/") return location.pathname === "/";
      return location.pathname.startsWith(path);
    },
    [location.pathname]
  );

  const handleNav = useCallback(
    (path: string) => {
      navigate(path);
      setMobileOpen(false);
    },
    [navigate]
  );

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (isAdmin) return true;
    if (!item.roles) return true;
    return item.roles.includes(role ?? "");
  });

  const userInitial = user?.email?.charAt(0).toUpperCase() ?? "U";
  const userEmail = user?.email ?? "";

  return (
    <div className="flex h-screen bg-background">
      {/* ── Desktop Sidebar ─────────────────────────────────────── */}
      <aside
        className={cn(
          "hidden md:flex flex-col bg-card border-r border-border/60 transition-all duration-300 shrink-0 shadow-sm",
          collapsed ? "w-[60px]" : "w-[220px]"
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div
            className={cn(
              "flex items-center border-b border-sidebar-border/60 transition-all duration-300",
              collapsed ? "px-3 py-3 justify-center" : "px-4 py-3 gap-3"
            )}
          >
            {collapsed ? (
              <button
                onClick={() => handleNav("/")}
                className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 hover:bg-primary/20 transition-colors"
                title="Ir para Componentes"
              >
                <Cpu className="w-4 h-4 text-primary" />
              </button>
            ) : (
              <button
                onClick={() => handleNav("/")}
                className="flex-1 min-w-0 hover:opacity-80 transition-opacity cursor-pointer"
                title="Ir para Componentes"
              >
                <img
                  src={logoZomini}
                  alt="Zomini Usinagens Especiais"
                  className="h-9 w-auto object-contain"
                />
              </button>
            )}
            {!collapsed && (
              <button
                onClick={() => setCollapsed(true)}
                className="ml-auto p-1 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                title="Recolher menu"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
          </div>

          {collapsed && (
            <div className="px-3 pt-2 pb-1">
              <button
                onClick={() => setCollapsed(false)}
                className="w-full flex items-center justify-center p-2 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                title="Expandir menu"
              >
                <Menu className="w-4 h-4" />
              </button>
            </div>
          )}

          <SidebarNav
            visibleItems={visibleItems}
            isAdmin={isAdmin}
            collapsed={collapsed}
            isActive={isActive}
            onNav={handleNav}
          />

          {/* Bottom */}
          <div className="border-t border-sidebar-border/60 p-2 space-y-0.5">
            <button
              onClick={toggleTheme}
              title={isDark ? "Modo claro" : "Modo escuro"}
              className={cn(
                "w-full flex items-center rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors",
                collapsed ? "p-2.5 justify-center" : "px-3 py-2 gap-3"
              )}
            >
              {isDark
                ? <Sun className={cn("shrink-0", collapsed ? "w-5 h-5" : "w-4 h-4")} />
                : <Moon className={cn("shrink-0", collapsed ? "w-5 h-5" : "w-4 h-4")} />
              }
              {!collapsed && <span>{isDark ? "Modo Claro" : "Modo Escuro"}</span>}
            </button>

            {/* Notificações desktop — restrito a admin. A vendedora já tem
                seu próprio sino (NotificacoesBell) dentro da página
                Comercial, independente deste — manter os dois é
                intencional, não duplicação. */}
            {isAdmin && (
              <div className={cn("flex", collapsed ? "justify-center px-1" : "px-1")}>
                <NotificacoesPanel {...notifState} align="left" dropUp />
              </div>
            )}

            <button
              onClick={() => navigate("/sobre")}
              title="Sobre o sistema, manual, guia de uso e reportar problemas"
              className={cn(
                "w-full flex items-center rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors",
                collapsed ? "p-2.5 justify-center" : "px-3 py-2 gap-3"
              )}
            >
              <Info className={cn("shrink-0", collapsed ? "w-5 h-5" : "w-4 h-4")} />
              {!collapsed && <span>Sobre / Ajuda</span>}
            </button>

            {collapsed ? (
              <div className="pt-1 border-t border-sidebar-border/40">
                <div className="flex flex-col items-center gap-1 py-1">
                  <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center">
                    <span className="text-xs font-bold text-primary">{userInitial}</span>
                  </div>
                  <button
                    onClick={() => signOut()}
                    title="Sair"
                    className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors w-full flex justify-center"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="pt-1 border-t border-sidebar-border/40 mt-1">
                <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg">
                  <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-primary">{userInitial}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{userEmail}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{role ? (ROLE_LABELS[role as AppRole] ?? role) : "Usuário"}</p>
                  </div>
                  <button
                    onClick={() => signOut()}
                    title="Sair"
                    className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-[9px] text-muted-foreground/50 text-center pt-1">v{APP_VERSION}</p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ── Mobile overlay ──────────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile Sidebar (drawer) ──────────────────────────────── */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border/60 shadow-xl flex flex-col md:hidden transition-transform duration-300",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-sidebar-border/60">
          <img src={logoZomini} alt="Zomini" className="h-9 w-auto object-contain" decoding="async" />
          <button
            onClick={() => setMobileOpen(false)}
            className="p-1.5 rounded-md hover:bg-muted/50 text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <MobileNav
            visibleItems={visibleItems}
            isAdmin={isAdmin}
            isActive={isActive}
            onNav={handleNav}
          />
        </div>

        <div className="border-t border-sidebar-border/60 p-2 space-y-0.5">
          <button
            onClick={toggleTheme}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            <span>{isDark ? "Modo Claro" : "Modo Escuro"}</span>
          </button>
          <button
            onClick={() => { setMobileOpen(false); navigate("/sobre"); }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <Info className="w-4 h-4" />
            <span>Sobre / Ajuda</span>
          </button>
          <div className="pt-1 border-t border-sidebar-border/40 mt-1">
            <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg">
              <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-primary">{userInitial}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{userEmail}</p>
                <p className="text-[10px] text-muted-foreground capitalize">{role ? (ROLE_LABELS[role as AppRole] ?? role) : "Usuário"}</p>
              </div>
              <button
                onClick={() => signOut()}
                title="Sair"
                className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[9px] text-muted-foreground/50 text-center pt-1">v{APP_VERSION}</p>
          </div>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
        {/* Mobile topbar */}
        <header className="md:hidden flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-card/90 backdrop-blur-md shrink-0 z-30 mobile-header-safe">
          <button onClick={() => handleNav("/")} className="hover:opacity-80 transition-opacity" title="Componentes">
            <img src={logoZomini} alt="Zomini" className="h-7 w-auto object-contain" decoding="async" />
          </button>
          <div className="flex items-center gap-1">
            {/* Notificações mobile — restrito a admin, mesmo critério do desktop */}
            {isAdmin && <NotificacoesPanel {...notifState} align="right" />}
            <button
              onClick={() => setMobileOpen(true)}
              className="p-2 rounded-lg hover:bg-muted/60 text-muted-foreground min-h-[44px] min-w-[44px] flex items-center justify-center"
              title="Menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden pb-safe">{children}</main>
      </div>
    </div>
  );
}
