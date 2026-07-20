/**
 * NotificacoesPanel — recebe dados como props (estado gerenciado no AppShell)
 * Isso garante UMA ÚNICA instância do canal Realtime por sessão.
 */
import { useState, useRef, useEffect } from "react";
import { Bell, BellOff, CheckCheck, ShoppingBag, Package, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NotificacoesState, Notificacao } from "@/hooks/useNotifications";
import { useNavigate } from "react-router-dom";
import i18n from "@/i18n";
import { useTranslation } from "react-i18next";

function tipoIcon(tipo: string) {
  if (tipo.includes("pedido") || tipo.includes("comercial")) return ShoppingBag;
  if (tipo.includes("estoque") || tipo.includes("stock"))    return Package;
  if (tipo.includes("alerta") || tipo.includes("critico"))   return AlertCircle;
  return Info;
}

function tipoColor(tipo: string) {
  if (tipo.includes("alerta") || tipo.includes("critico")) return "text-destructive";
  if (tipo.includes("pedido"))  return "text-blue-500";
  if (tipo.includes("estoque")) return "text-amber-500";
  return "text-primary";
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const min  = Math.floor(diff / 60000);
  const hour = Math.floor(diff / 3600000);
  const day  = Math.floor(diff / 86400000);
  if (min  <  1) return i18n.t("notifications.now");
  if (min  < 60) return `${min}min`;
  if (hour < 24) return `${hour}h`;
  if (day  <  7) return `${day}d`;
  return d.toLocaleDateString(i18n.t("notifications.localeCode"), { day: "2-digit", month: "2-digit" });
}

function NotificacaoItem({ n, onRead, onNav }: {
  n: Notificacao;
  onRead: (id: string) => void;
  onNav: (pedidoId: string | null) => void;
}) {
  const Icon = tipoIcon(n.tipo);
  const color = tipoColor(n.tipo);
  return (
    <button
      type="button"
      onClick={() => { onRead(n.id); onNav(n.pedido_id); }}
      className={cn(
        "w-full text-left flex items-start gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors border-b border-border/30 last:border-0",
        !n.lida && "bg-primary/[0.03]"
      )}
    >
      <div className={cn("mt-0.5 shrink-0 h-7 w-7 rounded-full flex items-center justify-center",
        !n.lida ? "bg-primary/10" : "bg-muted/50"
      )}>
        <Icon className={cn("h-3.5 w-3.5", !n.lida ? color : "text-muted-foreground")} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn("text-[12px] font-medium leading-tight truncate",
          n.lida ? "text-muted-foreground" : "text-foreground"
        )}>
          {n.titulo}
        </p>
        {n.mensagem && (
          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{n.mensagem}</p>
        )}
        <p className="text-[10px] text-muted-foreground/60 mt-1">{fmtDate(n.created_at)}</p>
      </div>
      {!n.lida && (
        <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
      )}
    </button>
  );
}

// Props recebidas do AppShell (estado único)
export interface NotificacoesPanelProps extends NotificacoesState {
  align?: "left" | "right"; // left para sidebar desktop, right para mobile topbar
  dropUp?: boolean; // true quando o botão fica no rodapé (sidebar) e o painel não cabe abaixo
}

export function NotificacoesPanel({
  notificacoes, unreadCount, loading, marcarComoLida, marcarTodasComoLidas, align = "right", dropUp = false
}: NotificacoesPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function handleNav(pedidoId: string | null) {
    setOpen(false);
    if (pedidoId) navigate("/comercial");
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("notifications.title")}
        className={cn(
          "relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors",
          open && "bg-muted/60 text-foreground"
        )}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className={cn(
          "absolute w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-border/50 bg-card shadow-xl z-[100] overflow-hidden",
          align === "left" ? "left-0" : "right-0",
          dropUp ? "bottom-full mb-2" : "top-full mt-2"
        )}>
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/40">
            <p className="text-[12px] font-semibold flex items-center gap-1.5">
              <Bell className="h-3.5 w-3.5 text-primary" />
              {t("notifications.title")}
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">
                  {unreadCount}
                </span>
              )}
            </p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={marcarTodasComoLidas}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                title={t("notifications.markAllRead")}
              >
                <CheckCheck className="h-3.5 w-3.5" />
                {t("notifications.readAll")}
              </button>
            )}
          </div>

          <div className="max-h-[60vh] sm:max-h-80 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center py-8">
                <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {!loading && notificacoes.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
                <BellOff className="h-8 w-8 opacity-20" />
                <p className="text-[12px]">{t("notifications.empty")}</p>
              </div>
            )}
            {!loading && notificacoes.map((n) => (
              <NotificacaoItem
                key={n.id}
                n={n}
                onRead={marcarComoLida}
                onNav={handleNav}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
