/**
 * useRealtimeInvalidation — Invalida queries do React Query via Supabase Realtime
 *
 * Assina mudanças em tabelas críticas e invalida o cache automaticamente.
 * Elimina a necessidade de refresh manual quando outro usuário faz uma
 * movimentação de estoque ou muda o status de um pedido.
 *
 * Uso: chamar uma vez no nível do layout (AppShell ou página principal).
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function useRealtimeInvalidation() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel("realtime-invalidation")
      // Movimentações de estoque → invalida cache de estoque
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "stock_movements",
      }, () => {
        queryClient.invalidateQueries({ queryKey: ["stock"] });
      })
      // Status de pedidos → invalida cache comercial
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "pedidos_comerciais",
      }, () => {
        queryClient.invalidateQueries({ queryKey: ["pedidos"] });
        queryClient.invalidateQueries({ queryKey: ["stock"] }); // reservas mudam junto
      })
      // Novos dispositivos → invalida cache de devices
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "devices",
      }, () => {
        queryClient.invalidateQueries({ queryKey: ["devices"] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id, queryClient]);
}
