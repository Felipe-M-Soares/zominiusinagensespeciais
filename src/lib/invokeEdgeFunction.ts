import { supabase } from "@/integrations/supabase/client";

/**
 * Invoca uma Edge Function com o token JWT mais atualizado da sessão.
 *
 * PROBLEMA RAIZ DO "Invalid JWT" / 401:
 * O SDK supabase.functions.invoke() injeta o Authorization header automaticamente
 * usando o token em memória. Se a sessão expirou ou o token foi invalidado
 * (ex: usuário ficou na tela por muito tempo), o token fica stale e a Edge Function
 * recebe um JWT expirado → retorna 401.
 *
 * SOLUÇÃO: antes de cada invoke(), forçamos getSession() que aciona o auto-refresh
 * do token se necessário. Assim a Edge Function sempre recebe um JWT válido.
 */
export async function invokeWithAuth<T = unknown>(
  functionName: string,
  options?: { body?: Record<string, unknown> }
): Promise<{ data: T | null; error: Error | null; errorMsg: string | null }> {
  // 1. Garante que o token está fresco (auto-refresh se expirado)
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();

  if (sessionError || !session) {
    return {
      data: null,
      error: new Error("Sessão expirada. Faça login novamente."),
      errorMsg: "Sessão expirada. Faça login novamente.",
    };
  }

  // 2. Invoca com o token garantidamente válido
  const { data, error } = await supabase.functions.invoke<T>(functionName, {
    ...options,
    headers: {
      // Passa explicitamente o token atualizado para sobrescrever qualquer cache interno
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (!error) {
    return { data, error: null, errorMsg: null };
  }

  // 3. Lê a mensagem de erro real do corpo da resposta HTTP
  // (supabase.functions.invoke() põe erros HTTP em error.context, não em error.message)
  let errorMsg = "Erro desconhecido";
  try {
    const e = error as { context?: Response; message?: string };
    if (e?.context instanceof Response) {
      try {
        const body = await e.context.clone().json() as { error?: string; message?: string };
        if (body?.error) errorMsg = body.error;
        else if (body?.message) errorMsg = body.message;
      } catch {
        try {
          const text = await e.context.clone().text();
          if (text) errorMsg = text.slice(0, 300);
        } catch { /* ignore */ }
      }
    } else {
      errorMsg = e?.message ?? "Erro desconhecido";
    }
  } catch { /* ignore */ }

  return { data: null, error: error as Error, errorMsg };
}
