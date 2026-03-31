// Shared CORS helper — aceita qualquer origem do Supabase ou do domínio configurado.
// ALLOWED_ORIGIN pode ser "*" para dev ou o domínio exato para produção.
// O supabase.functions.invoke() no SDK já envia o JWT automaticamente via apikey,
// não precisamos de Access-Control-Allow-Credentials.
export function getCorsHeaders(req: Request): Record<string, string> {
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
  const origin = req.headers.get("origin") ?? "";
  
  // Se ALLOWED_ORIGIN é "*", aceita qualquer origem (útil em dev)
  // Se é um domínio específico, só aceita esse domínio
  const responseOrigin = allowedOrigin === "*" ? "*" : 
    (origin === allowedOrigin ? origin : allowedOrigin);

  return {
    "Access-Control-Allow-Origin": responseOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
