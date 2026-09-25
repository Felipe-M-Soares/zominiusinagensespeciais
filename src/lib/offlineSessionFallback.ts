import type { Session } from "@supabase/supabase-js";

/**
 * Lê a sessão diretamente do localStorage, sem passar por getSession().
 *
 * Por quê: getSession() do supabase-js, ao notar que o access_token salvo já
 * expirou, tenta renovar automaticamente contra o servidor antes de
 * resolver. Se isso falhar por falta de rede, getSession() resolve com
 * session: null — mesmo que o refresh_token (que dura muito mais que o
 * access_token) ainda esteja salvo e válido. Isso é um comportamento
 * documentado do supabase-js, não uma falha deste app: não há como evitar a
 * tentativa de renovação dentro da própria lib.
 *
 * Este fallback só deve ser usado quando navigator.onLine === false — é uma
 * rede de segurança para não deslogar um operador em campo só porque o
 * token expirou no momento exato em que ficou sem internet. Quando a
 * conexão voltar, o fluxo normal (TOKEN_REFRESHED/SIGNED_OUT real) assume de
 * novo e essa sessão "crua" é substituída pela confirmada pelo servidor.
 *
 * Importante: isto NÃO valida a assinatura do JWT nem confere com o
 * servidor — é uma leitura de cache local, então só decide se a UI mostra
 * "logado" ou não enquanto offline. Toda operação real contra o banco
 * (RLS, RPCs) continua exigindo um token genuinamente válido no servidor;
 * se o token estiver de fato expirado/revogado, as chamadas online vão
 * falhar normalmente quando a conexão voltar, e o fluxo real de
 * autenticação assume a partir daí.
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
