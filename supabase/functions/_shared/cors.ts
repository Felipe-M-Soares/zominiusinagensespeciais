/**
 * CORS helper para Edge Functions.
 *
 * Produção:
 * - Configure ALLOWED_ORIGIN com domínios fixos separados por vírgula.
 * - Para previews da Vercel, use ALLOWED_ORIGIN_REGEX com uma expressão segura.
 *
 * Exemplo:
 * ALLOWED_ORIGIN="https://zominiusinagensespeciais.vercel.app,https://app.seudominio.com.br"
 * ALLOWED_ORIGIN_REGEX="^https://zominiusinagensespeciais-[a-z0-9-]+\.vercel\.app$"
 *
 * Desenvolvimento local:
 * - localhost e 127.0.0.1 são permitidos automaticamente.
 * - O fallback "*" foi removido para evitar exposição acidental em produção.
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
    // Regex inválida não deve abrir CORS por acidente.
    return false;
  }
}

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = (req.headers.get("origin") ?? "").replace(/\/$/, "");
  const originLower = origin.toLowerCase();
  const allowedList = splitOrigins(Deno.env.get("ALLOWED_ORIGIN"));
  const allowedRegex = Deno.env.get("ALLOWED_ORIGIN_REGEX");

  const isAllowed =
    !origin ||
    LOCAL_ORIGIN.test(origin) ||
    allowedList.includes(originLower) ||
    matchesAllowedRegex(origin, allowedRegex);

  const responseOrigin = isAllowed
    ? (origin || allowedList[0] || "http://localhost:5173")
    : "null";

  return {
    "Access-Control-Allow-Origin": responseOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
