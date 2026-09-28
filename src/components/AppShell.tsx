/**
 * AppShell — casca do app (menu lateral no computador, barra inferior +
 * gaveta no celular).
 *
 * Reformulação (set/2026):
 *  - Celular: barra inferior fixa com os módulos que o perfil pode ver (até 4)
 *    + botão "Menu", que abre a gaveta com todos os módulos, Guia de uso,
 *    Manuais, Sobre/Ajuda, reportar problema, tema e sair. Quem tem poucos
 *    módulos ganha o atalho "Guia" direto na barra.
 *  - Computador: menu lateral recolhível com as seções Módulos,
 *    Administração (só admin) e Ajuda (Guia de uso em destaque).
 *  - Permissões: a lista de módulos sai de ROLE_ROUTES/temPapel (admin vê
 *    tudo; gerente vê todos os módulos menos Admin; demais perfis, só os seus).
 */
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/hooks/useNotifications";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { ROLE_LABELS, getHomeRoute, temPapel } from "@/types/roles";
import type { AppRole } from "@/types/roles";
import logoZomini from "@/assets/logo_zomini.webp";
import { NotificacoesPanel } from "@/components/NotificacoesPanel";
import { FeedbackButton } from "@/components/FeedbackButton";
import {
  Boxes,
  ShoppingBag,
  Receipt,
  Settings,
  LogOut,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  Factory,
  Workflow,
  Cpu,
  ShieldCheck,
  Info,
  BookOpen,
  FileText,
} from "lucide-react";

import { APP_VERSION } from "@/lib/appInfo";

interface NavItem {
  label: string;
  /** Rótulo curto para a barra inferior do celular. */
  short?: string;
  icon: React.ElementType;
  path: string;
  roles?: AppRole[];
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Componentes", short: "Peças",   icon: Cpu,         path: "/",           roles: ["estoque", "qualidade", "producao"] },
  { label: "Estoque",                        icon: Boxes,       path: "/estoque",    roles: ["estoque", "qualidade"] },
  { label: "Qualidade",                      icon: ShieldCheck, path: "/qualidade",  roles: ["qualidade"] },
  { label: "Comercial",                      icon: ShoppingBag, path: "/comercial",  roles: ["comercial"] },
  { label: "Financeiro",                     icon: Receipt,     path: "/financeiro", roles: ["financeiro"] },
  { label: "Produção",                       icon: Factory,     path: "/producao",   roles: ["producao"] },
  { label: "Processos",                      icon: Workflow,    path: "/processos",  roles: ["processos", "producao"] },
];

const ADMIN_ITEM: NavItem = { label: "Admin", icon: Settings, path: "/admin", adminOnly: true };

const HELP_ITEMS: NavItem[] = [
  { label: "Guia de uso",   short: "Guia", icon: BookOpen, path: "/guia" },
  { label: "Manuais",                      icon: FileText, path: "/manual" },
  { label: "Sobre / Ajuda",                icon: Info,     path: "/sobre" },
];

/** Máximo de módulos na barra inferior do celular (o 5º botão é "Menu"). */
const BOTTOM_SLOTS = 4;

// ── Item do menu lateral / gaveta ─────────────────────────────────────────────

function NavButton({
  item, active, collapsed = false, onNav, highlight = false,
}: {
  item: NavItem;
  active: boolean;
  collapsed?: boolean;
  onNav: (path: string) => void;
  highlight?: boolean;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => onNav(item.path)}
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "w-full flex items-center rounded-xl text-sm font-medium transition-colors duration-150 group relative",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        collapsed ? "h-10 justify-center" : "h-10 px-3 gap-3",
        active
          ? "bg-primary/10 text-primary font-semibold"
          : highlight
            ? "text-foreground bg-brand/10 hover:bg-brand/15"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
      )}
    >
      {!collapsed && active && (
        <span aria-hidden className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-primary" />
      )}
      <Icon className={cn("shrink-0", collapsed ? "w-5 h-5" : "w-4 h-4", highlight && !active && "text-brand")} />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {collapsed && (
        <span className="absolute left-full ml-2 px-2 py-1 bg-foreground text-background text-xs rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg">
          {item.label}
        </span>
      )}
    </button>
  );
}

function SectionLabel({ children, collapsed }: { children: React.ReactNode; collapsed?: boolean }) {
  if (collapsed) return <div className="border-t border-border/60 my-2 mx-2" />;
  return (
    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 pb-1 pt-3 first:pt-1">
      {children}
    </p>
  );
}

function Avatar({ initial, size = "md" }: { initial: string; size?: "sm" | "md" }) {
  return (
    <div className={cn(
      "rounded-full bg-primary/15 flex items-center justify-center shrink-0",
      size === "sm" ? "w-8 h-8" : "w-10 h-10"
    )}>
      <span className={cn("font-bold text-primary", size === "sm" ? "text-xs" : "text-sm")}>{initial}</span>
    </div>
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

  const [collapsed, setCollapsedState] = useState(() => {
    try { return localStorage.getItem("sidebar-collapsed") === "1"; } catch { return false; }
  });
  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    try { localStorage.setItem("sidebar-collapsed", v ? "1" : "0"); } catch { /* modo privado */ }
  }, []);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Atalho Cmd+K / Ctrl+K → busca global no estoque
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        // Só para quem tem acesso ao Estoque (senão o RoleGuard devolvia a
        // pessoa para outra tela, parecendo um bug).
        if (!temPapel(role, "estoque", "qualidade")) return;
        e.preventDefault();
        navigate("/estoque");
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [navigate, role]);

  const toggleTheme = useCallback(() => {
    setTheme(isDark ? "light" : "dark");
  }, [isDark, setTheme]);

  // Gaveta mobile: fecha com Esc e trava o scroll do fundo enquanto aberta.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, [mobileOpen]);

  // Gaveta fechada fica "inerte": fora do Tab e do leitor de tela.
  const drawerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    drawerRef.current?.toggleAttribute("inert", !mobileOpen);
  }, [mobileOpen]);

  // Fecha a gaveta ao trocar de rota (ex.: voltar do navegador).
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const isActive = useCallback(
    (path: string) => {
      if (path === "/") return location.pathname === "/";
      return location.pathname === path || location.pathname.startsWith(path + "/");
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

  // Módulos que o perfil pode abrir (admin: todos; gerente: todos menos Admin).
  const visibleItems = useMemo(
    () => NAV_ITEMS.filter((item) => isAdmin || !item.roles || temPapel(role, ...item.roles)),
    [isAdmin, role]
  );
  const moduleItems = useMemo(
    () => (isAdmin ? [...visibleItems, ADMIN_ITEM] : visibleItems),
    [isAdmin, visibleItems]
  );

  // Barra inferior: até 4 módulos. Se a tela atual não estiver entre eles,
  // ela ocupa o último espaço (a aba ativa fica sempre visível). Quem tem
  // poucos módulos ganha o atalho do Guia de uso.
  const bottomItems = useMemo(() => {
    let items = moduleItems.slice(0, BOTTOM_SLOTS);
    const current = moduleItems.find((m) => isActive(m.path));
    if (current && !items.includes(current)) items = [...items.slice(0, BOTTOM_SLOTS - 1), current];
    if (items.length < BOTTOM_SLOTS) items = [...items, HELP_ITEMS[0]];
    return items;
  }, [moduleItems, isActive]);

  // Mostra o nome da pessoa (ou o login), não o e-mail interno
  // usado internamente pela autenticação.
  const displayName =
    (user?.user_metadata as { display_name?: string } | undefined)?.display_name?.trim() ||
    (user?.email ?? "").split("@")[0] ||
    "Usuário";
  const userInitial = displayName.charAt(0).toUpperCase() || "U";
  const roleLabel = role ? (ROLE_LABELS[role as AppRole] ?? role).split(" (")[0] : "Usuário";
  const homeRoute = getHomeRoute((role as AppRole | null) ?? null);

  // Troca de senha obrigatória: tela cheia, sem menu (a pessoa não pode sair
  // dali até definir a senha — o ProtectedLayout já força o redirecionamento).
  if (location.pathname === "/set-password") {
    return <div className="h-[100dvh] overflow-y-auto bg-background">{children}</div>;
  }

  return (
    <div className="flex h-[100dvh] bg-background">
      {/* ── Menu lateral (computador) ─────────────────────────────── */}
      <aside
        className={cn(
          "hidden md:flex flex-col bg-card border-r border-border/60 transition-[width] duration-300 shrink-0",
          collapsed ? "w-[68px]" : "w-[236px]"
        )}
        aria-label="Menu principal"
      >
        {/* Logo + recolher */}
        <div className={cn("flex items-center h-14 border-b border-border/60 shrink-0", collapsed ? "justify-center px-2" : "px-4 gap-2")}>
          {collapsed ? (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="h-10 w-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
              title="Expandir menu"
              aria-label="Expandir menu"
            >
              <PanelLeftOpen className="w-5 h-5" />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => handleNav(homeRoute)}
                className="flex-1 min-w-0 hover:opacity-80 transition-opacity"
                title="Ir para a tela inicial"
              >
                <img src={logoZomini} alt="Zomini Usinagens Especiais" className="h-8 w-auto object-contain" />
              </button>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors shrink-0"
                title="Recolher menu"
                aria-label="Recolher menu"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </>
          )}
        </div>

        <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto overflow-x-hidden scrollbar-thin">
          <SectionLabel collapsed={collapsed}>Módulos</SectionLabel>
          {visibleItems.map((item) => (
            <NavButton key={item.path} item={item} active={isActive(item.path)} collapsed={collapsed} onNav={handleNav} />
          ))}

          {isAdmin && (
            <>
              <SectionLabel collapsed={collapsed}>Administração</SectionLabel>
              <NavButton item={ADMIN_ITEM} active={isActive(ADMIN_ITEM.path)} collapsed={collapsed} onNav={handleNav} />
            </>
          )}

          <SectionLabel collapsed={collapsed}>Ajuda</SectionLabel>
          {HELP_ITEMS.map((item, i) => (
            <NavButton key={item.path} item={item} active={isActive(item.path)} collapsed={collapsed} onNav={handleNav} highlight={i === 0} />
          ))}
        </nav>

        {/* Rodapé: tema, notificações, conta */}
        <div className="border-t border-border/60 p-2 space-y-0.5 shrink-0">
          <div className={cn("flex gap-1", collapsed ? "flex-col items-center" : "items-center")}>
            <button
              type="button"
              onClick={toggleTheme}
              title={isDark ? "Mudar para modo claro" : "Mudar para modo escuro"}
              aria-label={isDark ? "Mudar para modo claro" : "Mudar para modo escuro"}
              className={cn(
                "flex items-center rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors h-10",
                collapsed ? "w-10 justify-center" : "flex-1 px-3 gap-3"
              )}
            >
              {isDark ? <Sun className="w-4 h-4 shrink-0" /> : <Moon className="w-4 h-4 shrink-0" />}
              {!collapsed && <span>{isDark ? "Modo claro" : "Modo escuro"}</span>}
            </button>
            {/* Notificações — restrito a admin. A vendedora já tem o próprio
                sino (NotificacoesBell) dentro da página Comercial. */}
            {isAdmin && <NotificacoesPanel {...notifState} align="left" dropUp />}
          </div>

          <div className={cn("flex items-center rounded-xl mt-1 pt-2 border-t border-border/40", collapsed ? "flex-col gap-1" : "gap-2.5 px-1.5")}>
            <Avatar initial={userInitial} size="sm" />
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate" title={displayName}>{displayName}</p>
                <p className="text-[10px] text-muted-foreground truncate">{roleLabel} · v{APP_VERSION}</p>
              </div>
            )}
            <button
              type="button"
              onClick={() => signOut()}
              title="Sair"
              aria-label="Sair"
              className="h-9 w-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Gaveta (celular) ─────────────────────────────────────── */}
      <div
        className={cn(
          "fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-[2px] transition-opacity duration-300",
          mobileOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setMobileOpen(false)}
        aria-hidden
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[86vw] max-w-[320px] bg-card border-r border-border/60 shadow-2xl flex flex-col md:hidden transition-transform duration-300 ease-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        aria-hidden={!mobileOpen}
        ref={drawerRef}
      >
        <div className="flex items-center justify-between px-4 h-14 box-content pt-[env(safe-area-inset-top)] border-b border-border/60 shrink-0">
          <img src={logoZomini} alt="Zomini" className="h-8 w-auto object-contain" decoding="async" />
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Fechar menu"
            className="h-10 w-10 -mr-2 rounded-xl flex items-center justify-center hover:bg-muted/70 text-muted-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          {/* Conta */}
          <div className="mx-3 mt-3 flex items-center gap-3 rounded-2xl border bg-muted/30 p-3">
            <Avatar initial={userInitial} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{displayName}</p>
              <p className="text-xs text-muted-foreground truncate">Perfil: {roleLabel}</p>
            </div>
          </div>

          <nav className="px-3 py-2 space-y-0.5" aria-label="Módulos">
            <SectionLabel>Módulos</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              {moduleItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.path);
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => handleNav(item.path)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex flex-col items-start gap-2 rounded-2xl border p-3 min-h-[76px] text-left transition-colors",
                      active
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border/70 bg-background hover:bg-muted/60 text-foreground"
                    )}
                  >
                    <Icon className={cn("h-5 w-5", active ? "text-primary" : "text-muted-foreground")} />
                    <span className="text-sm font-semibold leading-tight">{item.label}</span>
                  </button>
                );
              })}
            </div>

            <SectionLabel>Ajuda</SectionLabel>
            {HELP_ITEMS.map((item, i) => (
              <NavButton key={item.path} item={item} active={isActive(item.path)} onNav={handleNav} highlight={i === 0} />
            ))}
            <FeedbackButton asMenuItem className="h-10 rounded-xl" />
          </nav>
        </div>

        <div className="border-t border-border/60 p-3 space-y-2 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              className="h-11 rounded-xl border flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              {isDark ? "Modo claro" : "Modo escuro"}
            </button>
            <button
              type="button"
              onClick={() => signOut()}
              className="h-11 rounded-xl border border-destructive/30 flex items-center justify-center gap-2 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="w-4 h-4" /> Sair
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground/70 text-center">Versão {APP_VERSION}</p>
        </div>
      </aside>

      {/* ── Conteúdo ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
        {/* Barra superior (celular) */}
        <header className="md:hidden flex items-center justify-between gap-2 h-12 px-3 border-b border-border/60 bg-card/90 backdrop-blur-md shrink-0 z-30 box-content pt-[env(safe-area-inset-top)]">
          <button type="button" onClick={() => handleNav(homeRoute)} className="hover:opacity-80 transition-opacity" title="Tela inicial" aria-label="Tela inicial">
            <img src={logoZomini} alt="Zomini" className="h-7 w-auto object-contain" decoding="async" />
          </button>
          <div className="flex items-center gap-0.5">
            {isAdmin && <NotificacoesPanel {...notifState} align="right" />}
            <button
              type="button"
              onClick={() => handleNav("/guia")}
              className={cn(
                "h-10 px-2.5 rounded-xl flex items-center gap-1.5 text-xs font-semibold transition-colors",
                isActive("/guia") ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
              aria-label="Guia de uso"
            >
              <BookOpen className="h-4 w-4" />
              <span>Guia</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden">{children}</main>

        {/* Barra inferior (celular) */}
        <nav
          className="md:hidden shrink-0 border-t border-border/60 bg-card/95 backdrop-blur-md z-30 pb-[env(safe-area-inset-bottom)]"
          aria-label="Navegação principal"
        >
          <div className="grid h-16" style={{ gridTemplateColumns: `repeat(${bottomItems.length + 1}, minmax(0, 1fr))` }}>
            {bottomItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => handleNav(item.path)}
                  aria-current={active ? "page" : undefined}
                  className="flex flex-col items-center justify-center gap-1 min-w-0 px-1 focus-visible:outline-none group"
                >
                  <span className={cn(
                    "h-8 w-14 max-w-full rounded-full flex items-center justify-center transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring",
                    active ? "bg-primary/15 text-primary" : "text-muted-foreground group-active:bg-muted"
                  )}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className={cn("text-[11px] leading-none truncate max-w-full", active ? "text-primary font-semibold" : "text-muted-foreground font-medium")}>
                    {item.short ?? item.label}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menu"
              aria-expanded={mobileOpen}
              className="flex flex-col items-center justify-center gap-1 min-w-0 px-1 focus-visible:outline-none group"
            >
              <span className={cn(
                "h-8 w-14 max-w-full rounded-full flex items-center justify-center transition-colors text-muted-foreground group-active:bg-muted group-focus-visible:ring-2 group-focus-visible:ring-ring",
                mobileOpen && "bg-muted text-foreground"
              )}>
                <Menu className="h-5 w-5" />
              </span>
              <span className="text-[11px] leading-none text-muted-foreground font-medium">Menu</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}
