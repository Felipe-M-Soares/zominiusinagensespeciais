/**
 * useNotifications — Notificações em tempo real via Supabase Realtime
 *
 * IMPORTANTE: deve ser chamado em UMA ÚNICA instância por sessão.
 * O AppShell chama este hook e passa os dados via props para NotificacoesPanel.
 * Nunca instanciar diretamente em componentes filhos — causaria canais duplicados.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logger } from "@/lib/logger";

export interface Notificacao {
  id: string;
  tipo: string;
  titulo: string;
  mensagem: string | null;
  lida: boolean;
  created_at: string;
  pedido_id: string | null;
}

export interface NotificacoesState {
  notificacoes: Notificacao[];
  unreadCount: number;
  loading: boolean;
  marcarComoLida: (id: string) => Promise<void>;
  marcarTodasComoLidas: () => Promise<void>;
  refetch: () => Promise<void>;
}

/**
 * @param enabled Quando false, não busca notificações nem abre o canal
 * Realtime — usado quando o painel de notificações não é exibido para o
 * usuário atual (ex: restrito a admin no AppShell), para não gastar uma
 * query e uma subscription que nunca serão exibidas.
 */
export function useNotifications(enabled = true): NotificacoesState {
  const { user } = useAuth();
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [loading, setLoading] = useState(false);

  const unreadCount = notificacoes.filter((n) => !n.lida).length;

  const fetchNotificacoes = useCallback(async () => {
    if (!user?.id || !enabled) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("notificacoes")
        .select("id, tipo, titulo, mensagem, lida, created_at, pedido_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setNotificacoes((data as Notificacao[]) ?? []);
    } catch (err) {
      logger.error("useNotifications: erro ao buscar notificações", err);
    } finally {
      setLoading(false);
    }
  }, [user?.id, enabled]);

  useEffect(() => {
    fetchNotificacoes();
  }, [fetchNotificacoes]);

  // Canal Realtime — criado UMA VEZ com nome único por usuário
  useEffect(() => {
    if (!user?.id || !enabled) return;

    // Nome único garante que não haja colisão com outros canais
    const channelName = `notif-user-${user.id}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notificacoes",
          filter: `user_id=eq.${user.id}`,
        },
        () => { fetchNotificacoes(); }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          logger.error("useNotifications: erro no canal Realtime");
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, enabled]); // fetchNotificacoes intencionalmente fora das deps para não recriar canal

  const marcarComoLida = useCallback(async (id: string) => {
    setNotificacoes((prev) => prev.map((n) => (n.id === id ? { ...n, lida: true } : n)));
    const { error } = await supabase
      .from("notificacoes")
      .update({ lida: true })
      .eq("id", id);
    if (error) {
      logger.error("Erro ao marcar notificação como lida", error);
      fetchNotificacoes();
    }
  }, [fetchNotificacoes]);

  const marcarTodasComoLidas = useCallback(async () => {
    if (!user?.id || unreadCount === 0) return;
    setNotificacoes((prev) => prev.map((n) => ({ ...n, lida: true })));
    const { error } = await supabase
      .from("notificacoes")
      .update({ lida: true })
      .eq("user_id", user.id)
      .eq("lida", false);
    if (error) {
      logger.error("Erro ao marcar todas como lidas", error);
      fetchNotificacoes();
    }
  }, [user?.id, unreadCount, fetchNotificacoes]);

  return { notificacoes, unreadCount, loading, marcarComoLida, marcarTodasComoLidas, refetch: fetchNotificacoes };
}
