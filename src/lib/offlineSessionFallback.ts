import type { Session } from "@supabase/supabase-js";

/**
 * Lê a sessão diretamente do localStorage, sem passar por getSession().
 *
 * getSession() tenta renovar o token contra o servidor quando ele expirou;
 * sem rede, isso falha e resolve com session: null mesmo com um
 * refresh_token ainda válido salvo localmente. Usar só quando
 * navigator.onLine === false, como rede de segurança para não deslogar um
 * operador em campo por falta de conexão. Ver CHANGELOG.md.
 *
 * IMPORTANTE: isto NÃO valida a assinatura do JWT nem confere com o
 * servidor — decide apenas o que a UI mostra enquanto offline. Toda
 * operação real (RLS, RPCs) continua exigindo um token válido no servidor.
 */
export function readRawSessionFromStorage(): Session | null {
  if (typeof window === "undefined" || !window.localStorage) return null;

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!supabaseUrl) return null;

  let storageKey: string;
  try {
    const hostname = new URL(supabaseUrl).hostname;
    storageKey = `sb-${hostname.split(".")[0]}-auth-token`;
  } catch {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    // Validação mínima de formato — não é validação de segurança, só
    // garante que o objeto tem a forma esperada antes de usar.
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.access_token || !parsed.refresh_token || !parsed.user) return null;
    return parsed as Session;
  } catch {
    return null;
  }
}
