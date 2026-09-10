/**
 * CORS helper para Edge Functions.
 *
 * Sem ALLOWED_ORIGIN configurado, reflete a origem da requisição (ou "*"
 * sem origem, ex.: chamadas server-to-server) — nunca "null", que quebraria
 * o preflight. A segurança destas funções não depende do CORS: cada uma
 * valida o JWT e o papel do usuário no banco antes de agir.
 *
 * Para restringir, configure ALLOWED_ORIGIN com todos os domínios usados
 * (produção + previews) — origens fora da lista passam a ser recusadas.
 * Ver CHANGELOG.md para o histórico desta decisão.
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
