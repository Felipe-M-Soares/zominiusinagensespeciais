import { supabase } from "@/integrations/supabase/client";

/**
 * Chama uma Edge Function do Supabase usando o SDK oficial (supabase.functions.invoke).
 *
 * POR QUE MUDAMOS de fetch() direto para supabase.functions.invoke():
 * ─────────────────────────────────────────────────────────────────────
 * O fetch() direto envia o header "Origin" ao browser, que dispara um preflight
 * CORS (OPTIONS) antes de todo POST. A Edge Function precisa responder com
 * Access-Control-Allow-Origin igual à origem exata do request — qualquer
 * divergência no secret ALLOWED_ORIGIN causa "ERR_FAILED" / bloqueio de CORS.
 *
 * O supabase.functions.invoke() usa internamente o mesmo cliente Supabase,
 * envia o JWT via header "Authorization" automaticamente, e o Supabase CDN
 * já trata o CORS corretamente para chamadas autenticadas via apikey — sem
 * depender do secret ALLOWED_ORIGIN configurado nas Edge Functions.
 *
 * Resultado: a importação de CSV e todas as outras chamadas de Edge Function
 * funcionam independente da URL do deploy (Vercel preview, produção, localhost).
 */
export async function invokeWithAuth<T = unknown>(
  functionName: string,
  options?: { body?: Record<string, unknown> }
): Promise<{ data: T | null; error: Error | null; errorMsg: string | null }> {

  const { data, error } = await supabase.functions.invoke<T>(functionName, {
    body: options?.body,
  });

  if (error) {
    // FunctionsFetchError, FunctionsHttpError, FunctionsRelayError
    const msg = error.message ?? "Erro ao chamar função";
    return { data: null, error: new Error(msg), errorMsg: msg };
  }

  return { data: data ?? null, error: null, errorMsg: null };
}
