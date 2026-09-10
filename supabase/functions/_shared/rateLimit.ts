import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Rate limit persistente por IP, via a função check_rate_limit do banco
 * (mesma usada pelas RPCs de estoque/pedidos, tabela rate_limit_log).
 * Substitui contadores em memória local, que não sobrevivem a cold starts
 * nem são compartilhados entre múltiplas instâncias da Edge Function.
 *
 * Em caso de falha na própria checagem (RPC indisponível), não bloqueia —
 * evita que uma falha de infraestrutura derrube a funcionalidade principal.
 */
export async function checkRateLimitByIp(
  adminClient: SupabaseClient,
  ip: string,
  action: string
): Promise<boolean> {
  const { data: ipKey, error: keyError } = await adminClient.rpc("ip_rate_limit_key", { p_ip: ip });
  if (keyError || !ipKey) return true;
  const { data: allowed, error: rlError } = await adminClient.rpc("check_rate_limit", {
    p_action: action,
    p_user_id: ipKey,
  });
  if (rlError) return true;
  return allowed !== false;
}
