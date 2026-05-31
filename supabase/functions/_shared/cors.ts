/**
 * CORS helper para Edge Functions.
 *
 * SEGURANÇA: Configure ALLOWED_ORIGIN no painel do Supabase com o domínio
 * exato de produção (ex: "https://app.zomini.com.br").
 * Nunca deixe em "*" em produção — permite requisições de qualquer origem.
 *
 * Em desenvolvimento local, configure ALLOWED_ORIGIN=* apenas no .env local.
 */
export function getCorsHeaders(req: Request): Record<string, string> {
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
  const origin = req.headers.get("origin") ?? "";

  const responseOrigin =
    allowedOrigin === "*"
      ? "*"
      : origin === allowedOrigin
      ? origin
      : allowedOrigin;

  return {
    "Access-Control-Allow-Origin": responseOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
