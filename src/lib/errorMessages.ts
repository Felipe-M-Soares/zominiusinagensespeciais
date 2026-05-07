/**
 * SEG-04 FIX: Helper de sanitização de mensagens de erro.
 *
 * Em produção, mensagens raw do Supabase/PostgREST podem expor nomes de tabelas,
 * colunas e constraints de FK — informações úteis para ataques de enumeração.
 *
 * Em desenvolvimento, a mensagem original é exibida para facilitar debugging.
 */
export function friendlyError(err: unknown, fallback = "Operação falhou."): string {
  if (import.meta.env.DEV && err instanceof Error) return err.message;
  return fallback;
}

/** Extrai mensagem de erro de um objeto de erro do Supabase ou genérico. */
export function extractError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}
