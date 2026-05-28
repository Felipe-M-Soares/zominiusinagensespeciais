import { useState, useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { getStoredTheme, applyTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import logoZominiDark from "@/assets/logo_zomini_dark.png";
import { Boxes, ShoppingBag, Receipt, Settings, LogOut, Sun, Moon, ChevronLeft, Menu, X, Factory, Cpu } from "lucide-react";

interface NavItem { label: string; icon: React.ElementType; path: string; roles?: string[]; adminOnly?: boolean; }

const NAV_ITEMS: NavItem[] = [
  { label: "Componentes", icon: Cpu,         path: "/" },
  { label: "Estoque",     icon: Boxes,       path: "/estoque" },
  { label: "Comercial",   icon: ShoppingBag, path: "/comercial", roles: ["vendedora","admin"] },
  { label: "Financeiro",  icon: Receipt,     path: "/financeiro", roles: ["financeiro","admin"] },
  { label: "Produção",    icon: Factory,     path: "/producao" },
];
const ADMIN_ITEMS: NavItem[] = [{ label: "Admin", icon: Settings, path: "/admin", adminOnly: true }];

function NavBtn({ item, active, collapsed, onNav }: { item: NavItem; active: boolean; collapsed: boolean; onNav: (p:string)=>void }) {
  const Icon = item.icon;
  return (
    <button onClick={() => onNav(item.path)} title={collapsed ? item.label : undefined}
      className={cn("w-full flex items-center rounded-md text-[13px] font-medium transition-all duration-150 group relative",
        collapsed ? "p-2.5 justify-center" : "px-3 py-2.5 gap-3")}
      style={{ color: active ? "hsl(var(--sidebar-primary))" : "hsl(var(--sidebar-foreground))", background: active ? "hsl(var(--sidebar-primary) / 0.12)" : "transparent" }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "hsl(var(--sidebar-accent))"; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
      {!collapsed && active && <span className="absolute left-0 top-2 bottom-2 w-[2.5px] rounded-r-full" style={{ background: "hsl(var(--sidebar-primary))" }}/>}
      <Icon className="w-4 h-4 shrink-0"/>
      {!collapsed && <span className="truncate">{item.label}</span>}
      {collapsed && (
        <span className="absolute left-full ml-3 px-2.5 py-1.5 rounded-md text-[11px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-[60] shadow-lg border"
          style={{ background: "hsl(var(--sidebar-accent))", color: "hsl(var(--sidebar-accent-foreground))", borderColor: "hsl(var(--sidebar-border))" }}>
          {item.label}
        </span>
      )}
    </button>
  );
}

function SidebarNav({ visibleItems, isAdmin, collapsed, isActive, onNav }: { visibleItems: NavItem[]; isAdmin: boolean; collapsed: boolean; isActive:(p:string)=>boolean; onNav:(p:string)=>void }) {
  return (
    <nav className="flex-1 py-4 px-2.5 space-y-0.5 overflow-y-auto">
      {!collapsed && <p className="text-[9px] font-bold uppercase tracking-[0.14em] px-2 pb-2 pt-1 select-none" style={{ color: "hsl(var(--sidebar-foreground) / 0.38)" }}>Módulos</p>}
      {visibleItems.map(item => <NavBtn key={item.path} item={item} active={isActive(item.path)} collapsed={collapsed} onNav={onNav}/>)}
      {isAdmin && (
        <>
          {!collapsed
            ? <p className="text-[9px] font-bold uppercase tracking-[0.14em] px-2 pb-2 pt-4 select-none" style={{ color: "hsl(var(--sidebar-foreground) / 0.38)" }}>Sistema</p>
            : <div className="border-t my-3 mx-1" style={{ borderColor: "hsl(var(--sidebar-border))" }}/>}
          {ADMIN_ITEMS.map(item => <NavBtn key={item.path} item={item} active={isActive(item.path)} collapsed={collapsed} onNav={onNav}/>)}
        </>
      )}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { signOut, isAdmin, role, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isDark, setIsDark] = useState(() => { const t = getStoredTheme(); return t === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : t === "dark"; });

  useEffect(() => { applyTheme(getStoredTheme()); }, []);

  const toggleTheme = useCallback(() => { const next = !isDark; setIsDark(next); applyTheme(next ? "dark" : "light"); }, [isDark]);
  const isActive   = useCallback((path: string) => path === "/" ? location.pathname === "/" : location.pathname.startsWith(path), [location.pathname]);
  const handleNav  = useCallback((path: string) => { navigate(path); setMobileOpen(false); }, [navigate]);

  const visibleItems = NAV_ITEMS.filter(item => !item.roles || isAdmin || item.roles.includes(role ?? ""));
  const userInitial  = user?.email?.charAt(0).toUpperCase() ?? "U";
  const userEmail    = user?.email ?? "";

  const sidebarStyle: React.CSSProperties = { background: "hsl(var(--sidebar-background))", borderRight: "1px solid hsl(var(--sidebar-border))" };

  function BottomControls({ isMobile = false }: { isMobile?: boolean }) {
    return (
      <div className="border-t p-2 space-y-0.5" style={{ borderColor: "hsl(var(--sidebar-border))" }}>
        <button onClick={toggleTheme} title={isDark ? "Modo claro" : "Modo escuro"}
          className={cn("w-full flex items-center rounded-md text-[13px] font-medium transition-colors", (!collapsed || isMobile) ? "px-3 py-2 gap-3" : "p-2.5 justify-center")}
          style={{ color: "hsl(var(--sidebar-foreground) / 0.55)" }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "hsl(var(--sidebar-accent))"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
          {isDark ? <Sun className="w-4 h-4 shrink-0"/> : <Moon className="w-4 h-4 shrink-0"/>}
          {(!collapsed || isMobile) && <span>{isDark ? "Modo Claro" : "Modo Escuro"}</span>}
        </button>
        <div className="border-t pt-2 mt-1" style={{ borderColor: "hsl(var(--sidebar-border) / 0.5)" }}>
          {collapsed && !isMobile ? (
            <div className="flex flex-col items-center gap-1">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: "hsl(var(--sidebar-primary) / 0.18)", color: "hsl(var(--sidebar-primary))" }}>{userInitial}</div>
              <button onClick={() => signOut()} title="Sair" className="p-1.5 rounded-md w-full flex justify-center transition-colors" style={{ color: "hsl(var(--sidebar-foreground) / 0.4)" }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "hsl(var(--destructive))"} onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "hsl(var(--sidebar-foreground) / 0.4)"}><LogOut className="w-3.5 h-3.5"/></button>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md">
              <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold" style={{ background: "hsl(var(--sidebar-primary) / 0.18)", color: "hsl(var(--sidebar-primary))" }}>{userInitial}</div>
              <div className="flex-1 min-w-0">
                <p className="text-[11.5px] font-medium truncate" style={{ color: "hsl(var(--sidebar-foreground))" }}>{userEmail}</p>
                <p className="text-[10px] capitalize" style={{ color: "hsl(var(--sidebar-foreground) / 0.42)" }}>{role ?? "funcionário"}</p>
              </div>
              <button onClick={() => signOut()} title="Sair" className="p-1.5 rounded-md transition-colors shrink-0" style={{ color: "hsl(var(--sidebar-foreground) / 0.38)" }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "hsl(var(--destructive))"} onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "hsl(var(--sidebar-foreground) / 0.38)"}><LogOut className="w-3.5 h-3.5"/></button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "hsl(var(--background))" }}>
      {/* Desktop sidebar */}
      <aside className={cn("hidden md:flex flex-col shrink-0 transition-all duration-300 relative", collapsed ? "w-[56px]" : "w-[212px]")} style={sidebarStyle}>
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: "linear-gradient(90deg, hsl(var(--sidebar-primary)), transparent)" }}/>
        <div className="flex flex-col h-full">
          <div className={cn("flex items-center border-b transition-all duration-300", collapsed ? "px-3 py-[14px] justify-center" : "px-4 py-[11px] gap-2")} style={{ borderColor: "hsl(var(--sidebar-border))" }}>
            {collapsed ? (
              <button onClick={() => setCollapsed(false)} className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: "hsl(var(--sidebar-primary) / 0.14)" }} title="Expandir menu">
                <Menu className="w-4 h-4" style={{ color: "hsl(var(--sidebar-primary))" }}/>
              </button>
            ) : (
              <>
                <img src={logoZominiDark} alt="Zomini" className="h-[30px] w-auto object-contain flex-1 min-w-0 opacity-90"/>
                <button onClick={() => setCollapsed(true)} className="p-1.5 rounded-md transition-colors shrink-0 hover:bg-[hsl(var(--sidebar-accent))]" style={{ color: "hsl(var(--sidebar-foreground) / 0.38)" }} title="Recolher menu">
                  <ChevronLeft className="w-3.5 h-3.5"/>
                </button>
              </>
            )}
          </div>
          <SidebarNav visibleItems={visibleItems} isAdmin={isAdmin} collapsed={collapsed} isActive={isActive} onNav={handleNav}/>
          <BottomControls/>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && <div className="fixed inset-0 z-40 md:hidden" style={{ background: "hsl(222 32% 5% / 0.72)", backdropFilter: "blur(4px)" }} onClick={() => setMobileOpen(false)}/>}

      {/* Mobile drawer */}
      <aside className={cn("fixed inset-y-0 left-0 z-50 w-60 flex flex-col md:hidden transition-transform duration-300 shadow-2xl", mobileOpen ? "translate-x-0" : "-translate-x-full")} style={sidebarStyle}>
        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: "linear-gradient(90deg, hsl(var(--sidebar-primary)), transparent)" }}/>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "hsl(var(--sidebar-border))" }}>
          <img src={logoZominiDark} alt="Zomini" className="h-[28px] w-auto object-contain opacity-90"/>
          <button onClick={() => setMobileOpen(false)} className="p-1.5 rounded-md transition-colors" style={{ color: "hsl(var(--sidebar-foreground) / 0.5)" }}><X className="w-4 h-4"/></button>
        </div>
        <div className="flex-1 overflow-y-auto"><SidebarNav visibleItems={visibleItems} isAdmin={isAdmin} collapsed={false} isActive={isActive} onNav={handleNav}/></div>
        <BottomControls isMobile/>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="md:hidden flex items-center justify-between px-4 py-2.5 shrink-0 z-30 border-b"
          style={{ background: "hsl(var(--sidebar-background) / 0.97)", borderColor: "hsl(var(--sidebar-border))", backdropFilter: "blur(12px)" }}>
          <img src={logoZominiDark} alt="Zomini" className="h-[26px] w-auto object-contain opacity-90"/>
          <button onClick={() => setMobileOpen(true)} className="p-2 rounded-md" style={{ color: "hsl(var(--sidebar-foreground) / 0.6)" }} title="Menu"><Menu className="w-5 h-5"/></button>
        </header>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
