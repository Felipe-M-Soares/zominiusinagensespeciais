import { supabase } from "@/integrations/supabase/client";

/**
 * Obtém um access_token válido.
 *
 * CORREÇÃO DA ORDEM:
 * ──────────────────────────────────────────────
 * A versão anterior chamava refreshSession() PRIMEIRO. O problema:
 * refreshSession() pode retornar { session: { access_token: undefined } }
 * sem erro quando o servidor não consegue renovar (ex: refresh_token expirado,
 * sessão inválida no servidor). O código então enviava "Bearer undefined".
 *
 * A ordem correta é:
 * 1. getSession() — lê do cache local (localStorage). Confiável quando a sessão
 *    ainda é válida. Falha apenas se não existe sessão.
 * 2. refreshSession() — só como fallback quando getSession retorna token vazio.
 */
async function getFreshToken(): Promise<string | null> {
  // Tentativa 1: sessão em cache local (mais confiável, sem roundtrip de rede)
  try {
    const { data, error } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!error && typeof token === "string" && token.length > 0) {
      return token;
    }
  } catch {
    // getSession falhou — tenta refresh
  }

  // Tentativa 2: força refresh do token via rede
  try {
    const { data, error } = await supabase.auth.refreshSession();
    const token = data?.session?.access_token;
    if (!error && typeof token === "string" && token.length > 0) {
      return token;
    }
  } catch {
    // refresh também falhou
  }

  return null;
}

function isTokenExpired(token: string): boolean {
  try {
    const payload = token.split(".")[1];
    if (!payload) return true;
    const { exp } = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof exp !== "number") return true;
    return Date.now() / 1000 >= exp - 10;
  } catch {
    return true;
  }
}

export async function invokeWithAuth<T = unknown>(
  functionName: string,
  options?: { body?: Record<string, unknown> }
): Promise<{ data: T | null; error: Error | null; errorMsg: string | null }> {

  // 1. Obtém token válido
  const accessToken = await getFreshToken();

  if (!accessToken) {
    return {
      data: null,
      error: new Error("Sessão não encontrada. Faça login novamente."),
      errorMsg: "Sessão não encontrada. Faça login novamente.",
    };
  }

  if (isTokenExpired(accessToken)) {
    supabase.auth.signOut().catch(() => {});
    return {
      data: null,
      error: new Error("Sessão expirada. Faça login novamente."),
      errorMsg: "Sessão expirada. Faça login novamente.",
    };
  }

  // 2. Variáveis de ambiente
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey    = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

  if (!supabaseUrl || !anonKey) {
    return {
      data: null,
      error: new Error("Variáveis de ambiente não configuradas."),
      errorMsg: "Variáveis de ambiente não configuradas.",
    };
  }

  // 3. Chama a Edge Function via fetch() direto
  const url = `${supabaseUrl}/functions/v1/${functionName}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "apikey": anonKey,
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (networkErr) {
    const msg = networkErr instanceof Error ? networkErr.message : "Erro de rede";
    return { data: null, error: networkErr as Error, errorMsg: "Erro de rede: " + msg };
  }

  // 4. Lê a resposta
  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = null;
  }

  if (response.ok) {
    return { data: responseBody as T, error: null, errorMsg: null };
  }

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
