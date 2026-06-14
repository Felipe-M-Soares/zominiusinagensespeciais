/**
 * _shared/utils.ts — Utilitários compartilhados entre todas as Edge Functions
 *
 * Centraliza lógica repetida para evitar duplicação (DRY) e garantir
 * comportamento consistente entre funções.
 */

// ─── Validação de variáveis de ambiente ───────────────────────────────────────

/**
 * Retorna o valor de uma variável de ambiente obrigatória.
 * Lança um erro claro se a variável não estiver configurada.
 */
export function getRequiredEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

// ─── Conversão de login para email interno ────────────────────────────────────

/**
 * Converte um login interno para o formato de email usado no Supabase Auth.
 * Mantém compatível com a lógica de signIn no frontend.
 */
export function loginToEmail(login: string): string {
  return `${login.toLowerCase().trim()}@interno.conceptus`;
}

// ─── Validação de UUID ────────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Retorna true se o string for um UUID v4 válido. */
export function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

// ─── Rate limiting em memória (fallback) ─────────────────────────────────────
// NOTA: Este rate limiting é em memória e não persiste entre cold starts.
// Para produção com alto volume, use o check_rate_limit() do PostgreSQL.
// Esta implementação serve como camada adicional de proteção para bursts rápidos.

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Verifica e registra uma tentativa de rate limit por chave (ex: IP + ação).
 * @returns true se dentro do limite, false se excedeu.
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= maxRequests) return false;

  entry.count++;
  return true;
}

// ─── Respostas padronizadas ───────────────────────────────────────────────────

/** Cria uma Response JSON com os headers CORS e Content-Type corretos. */
export function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
