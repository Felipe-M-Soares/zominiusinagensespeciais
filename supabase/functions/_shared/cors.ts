/**
 * CORS helper para Edge Functions.
 *
 * IMPORTANTE (correção do erro "Failed to send a request to the Edge Function"):
 * ──────────────────────────────────────────────────────────────────────────────
 * A versão anterior devolvia `Access-Control-Allow-Origin: null` quando a origem
 * não estava na allowlist (secret ALLOWED_ORIGIN). Como o secret raramente é
 * atualizado com o domínio real do deploy (produção da Vercel, previews, novo
 * domínio próprio...), o preflight OPTIONS falhava no navegador e TODAS as
 * chamadas — criar conta, resetar senha, importar — quebravam com
 * "Failed to send a request to the Edge Function".
 *
 * A segurança destas funções NÃO depende de CORS: cada função valida o JWT do
 * usuário e checa o role de admin no banco antes de fazer qualquer coisa.
 * CORS aqui só precisa deixar o navegador conversar com a função.
 *
 * Por isso agora o header sempre REFLETE a origem do request (ou "*" quando
 * não há origem, ex: chamadas server-to-server). Se um dia quiser restringir,
 * configure ALLOWED_ORIGIN — origens fora da lista passam a ser recusadas,
 * mas só ative isso depois de garantir que o secret contém TODOS os domínios
 * usados (produção + previews).
 */
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

function splitOrigins(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, "").toLowerCase())
    .filter(Boolean);
}

function matchesAllowedRegex(origin: string, regexValue: string | null): boolean {
  if (!regexValue) return false;
  try {
    return new RegExp(regexValue).test(origin);
  } catch {
    return false;
  }
}

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = (req.headers.get("origin") ?? "").replace(/\/$/, "");
  const originLower = origin.toLowerCase();
  const allowedList = splitOrigins(Deno.env.get("ALLOWED_ORIGIN"));
  const allowedRegex = Deno.env.get("ALLOWED_ORIGIN_REGEX");

  // Modo restrito SÓ se ALLOWED_ORIGIN estiver configurado explicitamente.
  const restrito = allowedList.length > 0 || !!allowedRegex;

  const isAllowed =
    !restrito ||
    !origin ||
    LOCAL_ORIGIN.test(origin) ||
    allowedList.includes(originLower) ||
    matchesAllowedRegex(origin, allowedRegex);

  // Nunca devolve "null" — se recusado, devolve a primeira origem da lista
  // (o navegador bloqueia porque não bate, mas sem quebrar o preflight de
  // origens legítimas por má configuração).
  const responseOrigin = isAllowed ? (origin || "*") : (allowedList[0] || "*");

  return {
    "Access-Control-Allow-Origin": responseOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
