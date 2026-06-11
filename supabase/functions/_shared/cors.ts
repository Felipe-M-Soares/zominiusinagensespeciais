/**
 * CORS helper para Edge Functions.
 *
 * SEGURANÇA: Configure ALLOWED_ORIGIN no painel do Supabase com o(s) domínio(s)
 * permitido(s). Aceita múltiplos valores separados por vírgula.
 * Ex: "https://zominiusinagensespeciais.vercel.app,https://meudominio.com.br"
 *
 * Use "*" apenas em desenvolvimento local.
 *
 * Como configurar:
 *  Supabase Dashboard → Project Settings → Edge Functions → Secrets
 *  Nome: ALLOWED_ORIGIN
 *  Valor: https://zominiusinagensespeciais.vercel.app,https://outro-dominio.com.br
 */
export function getCorsHeaders(req: Request): Record<string, string> {
  const allowedOriginEnv = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
  const origin = req.headers.get("origin") ?? "";

  let responseOrigin: string;

  if (allowedOriginEnv === "*") {
    // Desenvolvimento local: aceita tudo
    responseOrigin = "*";
  } else {
    // Produção: verifica se a origem está na lista de domínios permitidos
    // Suporta múltiplos domínios separados por vírgula
    const allowedList = allowedOriginEnv
      .split(",")
      .map((o) => o.trim().toLowerCase())
      .filter(Boolean);

    const originLower = origin.toLowerCase();
    responseOrigin = allowedList.includes(originLower)
      ? origin                  // reflete a origem exata se estiver na lista
      : allowedList[0];         // fallback para o primeiro domínio configurado
  }

  return {
    "Access-Control-Allow-Origin": responseOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    // Necessário quando Access-Control-Allow-Origin não é "*"
    "Vary": "Origin",
  };
}
