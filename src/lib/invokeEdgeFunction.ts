import { supabase } from "@/integrations/supabase/client";

/**
 * Invoca uma Edge Function com token JWT garantidamente válido.
 *
 * CAUSA RAIZ DO "Invalid JWT" / 401:
 * ─────────────────────────────────
 * 1. supabase.functions.invoke() usa o token em cache do SDK. Se a sessão
 *    expirou (padrão: 1h), o token fica stale e a Edge Function retorna 401.
 *
 * 2. getSession() lê apenas do storage local — NÃO vai à rede e NÃO renova
 *    o token automaticamente. Um token expirado retorna normalmente por getSession().
 *
 * SOLUÇÃO:
 * ────────
 * Usar refreshSession() para forçar renovação via rede se o access_token estiver
 * expirado (verificamos manualmente o exp do JWT). Só chama refreshSession() quando
 * necessário para não desperdiçar requests.
 */

function isTokenExpiredOrExpiringSoon(accessToken: string, bufferSeconds = 60): boolean {
  try {
    // JWT = header.payload.signature — decodifica o payload (base64url)
    const payload = accessToken.split(".")[1];
    if (!payload) return true;
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    const exp: number = decoded.exp;
    if (!exp) return true;
    // Considera expirado se faltar menos de `bufferSeconds` segundos
    return Date.now() / 1000 >= exp - bufferSeconds;
  } catch {
    return true; // na dúvida, força refresh
  }
}

export async function invokeWithAuth<T = unknown>(
  functionName: string,
  options?: { body?: Record<string, unknown> }
): Promise<{ data: T | null; error: Error | null; errorMsg: string | null }> {

  // ── Passo 1: obtém a sessão atual do storage local ──────────────────────
  const { data: { session: currentSession }, error: sessionErr } = await supabase.auth.getSession();

  if (sessionErr || !currentSession) {
    return {
      data: null,
      error: new Error("Sessão não encontrada. Faça login novamente."),
      errorMsg: "Sessão não encontrada. Faça login novamente.",
    };
  }

  // ── Passo 2: renova o token se estiver expirado ou prestes a expirar ────
  let accessToken = currentSession.access_token;

  if (isTokenExpiredOrExpiringSoon(accessToken)) {
    const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
    if (refreshErr || !refreshed.session) {
      // Token não pode ser renovado — sessão inválida, força novo login
      await supabase.auth.signOut();
      return {
        data: null,
        error: new Error("Sessão expirada. Faça login novamente."),
        errorMsg: "Sessão expirada. Faça login novamente.",
      };
    }
    accessToken = refreshed.session.access_token;
  }

  // ── Passo 3: invoca a Edge Function com o token garantidamente válido ───
  // Passa o Authorization header explicitamente para sobrescrever o cache
  // interno do SDK (que pode ainda ter o token antigo em memória).
  const { data, error } = await supabase.functions.invoke<T>(functionName, {
    body: options?.body,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!error) {
    return { data, error: null, errorMsg: null };
  }

  // ── Passo 4: lê a mensagem de erro real do corpo HTTP ────────────────────
  // supabase.functions.invoke() coloca a Response em error.context,
  // não em error.message (que é sempre genérico: "Edge Function returned non-2xx")
  let errorMsg = "Erro desconhecido";
  try {
    const e = error as { context?: Response; message?: string };
    if (e?.context instanceof Response) {
      // Clona antes de ler — Response só pode ser consumida uma vez
      const cloned = e.context.clone();
      try {
        const body = await cloned.json() as { error?: string; message?: string };
        if (body?.error) errorMsg = body.error;
        else if (body?.message) errorMsg = body.message;
      } catch {
        try {
          const text = await e.context.clone().text();
          if (text) errorMsg = text.slice(0, 400);
        } catch { /* ignore */ }
      }
    } else {
      errorMsg = e?.message ?? "Erro desconhecido";
    }
  } catch { /* ignore */ }

  return { data: null, error: error as Error, errorMsg };
}
