/**
 * useThemeSync — Sincroniza preferência de tema com a coluna profiles.theme
 *
 * Ao fazer login, lê o tema salvo no banco e aplica.
 * Ao trocar o tema, persiste no banco (além do localStorage já existente).
 * Funciona mesmo sem conexão — cai para o localStorage como fallback.
 */
import { useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { applyTheme, getStoredTheme } from "@/lib/theme";
import type { Theme } from "@/lib/theme";
import { useAuth } from "@/hooks/useAuth";
import { logger } from "@/lib/logger";

export function useThemeSync() {
  const { user } = useAuth();

  // Ao logar: puxa o tema do banco e aplica
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    supabase
      .from("profiles")
      .select("theme")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error || !data?.theme) return;
        const theme = data.theme as Theme;
        applyTheme(theme);
      })
      .catch((err) => logger.error("useThemeSync load error:", err));

    return () => { cancelled = true; };
  }, [user?.id]);

  // Persiste o tema no banco E no localStorage
  const saveTheme = useCallback(async (theme: Theme) => {
    applyTheme(theme); // aplica imediatamente (localStorage dentro do applyTheme)
    if (!user?.id) return;
    try {
      await supabase
        .from("profiles")
        .update({ theme })
        .eq("user_id", user.id);
    } catch (err) {
      logger.error("useThemeSync save error:", err);
      // Falha silenciosa — localStorage já tem o valor
    }
  }, [user?.id]);

  return { saveTheme, currentTheme: getStoredTheme() };
}
