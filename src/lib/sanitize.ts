/**
 * Sanitização centralizada de strings para queries PostgREST / Supabase.
 *
 * DUP-02 FIX: Antes havia duas implementações ligeiramente diferentes em
 * supabaseUtils.ts e useStock.ts. Agora há uma fonte única aqui.
 *
 * O que esta função faz:
 *  1. Trim e limite de comprimento (200 chars) — evita strings absurdamente longas
 *  2. Remove caracteres de controle (< 0x20) e DEL (0x7F) — evita inputs malformados
 *  3. Remove caracteres com significado sintático no parser PostgREST: () , ; ' " `
 *  4. Escapa %, _ e \ que têm significado no operador ILIKE do PostgreSQL
 *
 * Referência: https://postgrest.org/en/stable/references/api/tables_views.html
 */
export function sanitizeQuery(raw: string): string {
  return raw
    .trim()
    .slice(0, 200)
    // Remove control characters and DEL
    .split("").filter(ch => ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127).join("")
    // Remove PostgREST/SQL syntax chars
    .replace(/[(),;'"`]/g, "")
    // Escape ILIKE wildcards and backslash
    .replace(/[%_\\]/g, "\\$&");
}
