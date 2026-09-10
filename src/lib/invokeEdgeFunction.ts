import { supabase } from "@/integrations/supabase/client";

/**
 * Chama uma Edge Function do Supabase usando o SDK oficial.
 *
 * Usa supabase.functions.invoke() em vez de fetch() direto: evita depender
 * do secret ALLOWED_ORIGIN estar sincronizado com a URL do deploy (preview,
 * produção, localhost) e já envia o JWT automaticamente. Ver CHANGELOG.md.
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
