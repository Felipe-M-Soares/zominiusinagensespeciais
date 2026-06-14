/**
 * useNotifications — Notificações em tempo real via Supabase Realtime
 * 
 * Usa a tabela `notificacoes` já existente no banco.
 * Atualiza o contador de não lidas em tempo real sem polling.
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

export function useNotifications() {
  const { user } = useAuth();
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [loading, setLoading] = useState(false);

  const unreadCount = notificacoes.filter((n) => !n.lida).length;

  const fetchNotificacoes = useCallback(async () => {
    if (!user?.id) return;
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
  }, [user?.id]);

  // Carrega ao montar
  useEffect(() => {
    fetchNotificacoes();
  }, [fetchNotificacoes]);

  // Realtime: escuta novas notificações sem polling
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`notificacoes:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notificacoes",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          // Recarrega ao qualquer mudança (insert/update/delete)
          fetchNotificacoes();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, fetchNotificacoes]);

  const marcarComoLida = useCallback(async (id: string) => {
    // Otimista: atualiza localmente antes de confirmar no banco
    setNotificacoes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, lida: true } : n))
    );
    const { error } = await supabase
      .from("notificacoes")
      .update({ lida: true })
      .eq("id", id);
    if (error) {
      logger.error("Erro ao marcar notificação como lida", error);
      fetchNotificacoes(); // Reverte se falhou
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

  return {
    notificacoes,
    unreadCount,
    loading,
    marcarComoLida,
    marcarTodasComoLidas,
    refetch: fetchNotificacoes,
  };
}
