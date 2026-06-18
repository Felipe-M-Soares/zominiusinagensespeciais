/**
 * sanitize — Sanitização centralizada de strings para queries Supabase/PostgREST
 *
 * Todas as buscas de texto livre passam por sanitizeQuery antes de ir ao banco.
 * Isso evita injeção de sintaxe PostgREST e wildcards inesperados no ILIKE.
 *
 * O que é feito:
 *  1. Trim + limite de 200 chars
 *  2. Remove caracteres de controle (< 0x20) e DEL (0x7F)
 *  3. Remove caracteres com significado no parser PostgREST: () , ; ' " `
 *  4. Escapa %, _ e \ que têm significado especial no operador ILIKE do PostgreSQL
 */
export function sanitizeQuery(raw: string): string {
  return raw
    .trim()
    .slice(0, 200)
    .split("").filter(ch => ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127).join("")
    .replace(/[(),;'"`]/g, "")
    .replace(/[%_\\]/g, "\\$&");
}
