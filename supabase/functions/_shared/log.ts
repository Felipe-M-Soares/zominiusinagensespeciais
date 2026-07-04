/** Logger seguro para Edge Functions.
 * Em produção não imprime payload, JWT, e-mail, chave fiscal, XML ou dados internos.
 * Para depuração pontual, configure DEBUG_EDGE_LOGS=true.
 */
const debug = Deno.env.get("DEBUG_EDGE_LOGS") === "true";

function safeText(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return "erro interno";
}

function joinSafe(values: unknown[]): string {
  if (!debug) return "erro interno";
  return values.map(safeText).join(" ").slice(0, 500);
}

export const log = {
  info: (scope: string, ...values: unknown[]) => {
    if (debug) console.info(`[${scope}] ${joinSafe(values)}`);
  },
  warn: (scope: string, ...values: unknown[]) => {
    if (debug) console.warn(`[${scope}] ${joinSafe(values)}`);
  },
  error: (scope: string, ...values: unknown[]) => {
    console.error(`[${scope}] ${joinSafe(values)}`);
  },
};
