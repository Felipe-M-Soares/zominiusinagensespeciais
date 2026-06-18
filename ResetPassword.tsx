/**
 * SEG-04: Sanitização de mensagens de erro para toasts.
 *
 * Em PRODUÇÃO: exibe apenas o fallback genérico — nunca expõe nomes de tabela,
 * colunas, constraints FK ou detalhes internos do PostgreSQL/PostgREST.
 *
 * Em DESENVOLVIMENTO: exibe a mensagem real para facilitar debugging.
 *
 * Suporta: Error nativo, PostgrestError do Supabase ({code, message, details, hint}),
 * strings e objetos desconhecidos.
 */
export function friendlyError(err: unknown, fallback = "Operação falhou. Tente novamente."): string {
  if (import.meta.env.DEV) {
    // Em dev: mensagem completa para debug
    if (err instanceof Error) return err.message;
    if (err && typeof err === "object") {
      const e = err as Record<string, unknown>;
      // PostgrestError shape
      if (typeof e.message === "string") {
        const detail = typeof e.details === "string" ? ` | ${e.details}` : "";
        const hint   = typeof e.hint    === "string" ? ` | Hint: ${e.hint}` : "";
        const code   = typeof e.code    === "string" ? ` [${e.code}]` : "";
        return e.message + detail + hint + code;
      }
    }
    return String(err);
  }
  // Em PRODUÇÃO: apenas mensagem genérica — zero vazamento de schema
  return fallback;
}

/** Extrai mensagem interna de erro (usar apenas em logs, nunca em UI). */
export function extractError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}
