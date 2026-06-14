/**
 * health — Endpoint de health check para monitoramento externo
 *
 * GET /functions/v1/health
 * Retorna status do serviço e da conexão com o banco.
 * Não requer autenticação (útil para Uptime Robot, BetterStack, etc.)
 *
 * verify_jwt = false intencional: é um endpoint público de status.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const start = Date.now();
  let dbStatus = "unknown";
  let dbLatencyMs = 0;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey    = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (supabaseUrl && anonKey) {
      const client = createClient(supabaseUrl, anonKey);
      const dbStart = Date.now();
      const { error } = await client.rpc("health_check");
      dbLatencyMs = Date.now() - dbStart;
      dbStatus = error ? "degraded" : "ok";
    } else {
      dbStatus = "not_configured";
    }
  } catch {
    dbStatus = "error";
  }

  const totalMs = Date.now() - start;
  const status = dbStatus === "ok" ? "ok" : "degraded";
  const httpStatus = status === "ok" ? 200 : 503;

  return new Response(
    JSON.stringify({
      status,
      db: dbStatus,
      db_latency_ms: dbLatencyMs,
      total_latency_ms: totalMs,
      timestamp: new Date().toISOString(),
      region: Deno.env.get("DENO_REGION") ?? "unknown",
    }),
    {
      status: httpStatus,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
