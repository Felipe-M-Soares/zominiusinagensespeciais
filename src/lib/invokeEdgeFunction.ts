import { supabase } from "@/integrations/supabase/client";

/**
 * Invoca uma Edge Function com token JWT garantidamente válido,
 * usando fetch() diretamente para evitar que o SDK sobrescreva
 * o Authorization header com um token stale/expirado.
 *
 * CAUSA RAIZ do "Invalid JWT" persistente:
 * ─────────────────────────────────────────
 * supabase.functions.invoke() injeta internamente o Authorization header
 * a partir do token em cache do SDK. Em algumas versões do supabase-js v2,
 * esse header é injetado DEPOIS dos headers customizados, sobrescrevendo
 * o token fresco que passamos manualmente.
 *
 * SOLUÇÃO DEFINITIVA:
 * ───────────────────
 * Usar fetch() diretamente contra a URL da Edge Function, passando os headers
 * nós mesmos — sem depender de nenhum comportamento interno do SDK.
 * Antes disso, forçamos refreshSession() se o token estiver expirado.
 */

function isTokenExpiredOrExpiringSoon(token: string, bufferSec = 60): boolean {
  try {
    const payload = token.split(".")[1];
    if (!payload) return true;
    const { exp } = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (!exp) return true;
    return Date.now() / 1000 >= exp - bufferSec;
  } catch {
    return true;
  }
}

export async function invokeWithAuth<T = unknown>(
  functionName: string,
  options?: { body?: Record<string, unknown> }
): Promise<{ data: T | null; error: Error | null; errorMsg: string | null }> {

  // ── 1. Pega sessão do storage local ────────────────────────────────────
  const { data: { session }, error: sessionErr } = await supabase.auth.getSession();

  if (sessionErr || !session) {
    return {
      data: null,
      error: new Error("Sessão não encontrada. Faça login novamente."),
      errorMsg: "Sessão não encontrada. Faça login novamente.",
    };
  }

  // ── 2. Renova se expirado ou prestes a expirar (<60s) ──────────────────
  let accessToken = session.access_token;

  if (isTokenExpiredOrExpiringSoon(accessToken)) {
    const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
    if (refreshErr || !refreshed.session) {
      await supabase.auth.signOut();
      return {
        data: null,
        error: new Error("Sessão expirada. Faça login novamente."),
        errorMsg: "Sessão expirada. Faça login novamente.",
      };
    }
    accessToken = refreshed.session.access_token;
  }

  // ── 3. Monta URL da Edge Function ──────────────────────────────────────
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey    = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

  if (!supabaseUrl || !anonKey) {
    return {
      data: null,
      error: new Error("Variáveis de ambiente não configuradas."),
      errorMsg: "Variáveis de ambiente não configuradas.",
    };
  }

  const url = `${supabaseUrl}/functions/v1/${functionName}`;

  // ── 4. fetch() direto — SEM passar pelo SDK ────────────────────────────
  // Garantia total de que o token que enviamos é o único na requisição.
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,   // token fresco, recém-renovado
        "apikey": anonKey,                           // obrigatório pelo gateway Supabase
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (networkErr) {
    const msg = networkErr instanceof Error ? networkErr.message : "Erro de rede";
    return { data: null, error: networkErr as Error, errorMsg: "Erro de rede: " + msg };
  }

  // ── 5. Lê a resposta ───────────────────────────────────────────────────
  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = null;
  }

  if (response.ok) {
    return { data: responseBody as T, error: null, errorMsg: null };
  }

  // Extrai mensagem de erro do corpo JSON
  let errorMsg = `Erro ${response.status}`;
  if (responseBody && typeof responseBody === "object") {
    const body = responseBody as { error?: string; message?: string };
    errorMsg = body.error ?? body.message ?? errorMsg;
  }

  return {
    data: null,
    error: new Error(errorMsg),
    errorMsg,
  };
}
