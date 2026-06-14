/**
 * auto-approve — Auto-aprovação de conta após 60 segundos do registro
 *
 * SEGURANÇA:
 *  - verify_jwt = true: JWT validado pelo Supabase antes de chegar aqui
 *  - Usuário só pode aprovar A SI MESMO
 *  - Bloqueados por admin nunca são auto-aprovados
 *  - UUID validado antes de qualquer query
 *  - Rate limit: 5 tentativas por 5 minutos por IP
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  getRequiredEnv,
  isValidUUID,
  checkRateLimit,
  jsonResponse,
} from "../_shared/utils.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
  }

  // Rate limit: 5 tentativas por 5 minutos por IP
  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";
  if (!checkRateLimit(`auto-approve:${clientIp}`, 5, 300_000)) {
    return jsonResponse(
      { error: "Muitas tentativas. Aguarde 5 minutos." },
      429,
      { ...corsHeaders, "Retry-After": "300" }
    );
  }

  try {
    const supabaseUrl = getRequiredEnv("SUPABASE_URL");
    const supabaseAnonKey = getRequiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

    // Com verify_jwt = true, JWT já foi validado pelo Supabase.
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) {
      return jsonResponse({ error: "Não autenticado" }, 401, corsHeaders);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ error: "Sessão expirada ou inválida. Faça login novamente." }, 401, corsHeaders);
    }

    // Lê e valida body (limitado a 4KB — só precisa de um UUID)
    const MAX_BODY = 4 * 1024;
    const rawBuf = await req.arrayBuffer();
    if (rawBuf.byteLength > MAX_BODY) {
      return jsonResponse({ error: "Requisição muito grande." }, 413, corsHeaders);
    }
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(new TextDecoder().decode(rawBuf)); } catch { /* ok */ }

    const targetUserId = body.user_id;
    if (!targetUserId || typeof targetUserId !== "string") {
      return jsonResponse({ error: "user_id é obrigatório" }, 400, corsHeaders);
    }

    // Valida UUID antes de qualquer checagem de ownership
    if (!isValidUUID(targetUserId)) {
      return jsonResponse({ error: "user_id inválido" }, 400, corsHeaders);
    }

    // Segurança: o usuário só pode aprovar a si mesmo
    if (targetUserId !== user.id) {
      return jsonResponse({ error: "Sem permissão" }, 403, corsHeaders);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("approved, blocked, created_at")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (profileError || !profile) {
      return jsonResponse({ error: "Perfil não encontrado" }, 404, corsHeaders);
    }

    if (profile.blocked === true) {
      return jsonResponse({ error: "Conta bloqueada pelo administrador." }, 403, corsHeaders);
    }

    if (profile.approved === true) {
      return jsonResponse({ success: true, already_approved: true }, 200, corsHeaders);
    }

    // Aguarda mínimo de 55 segundos após criação (margem de 5s para latência)
    const createdAt = new Date(profile.created_at).getTime();
    const ageMs = Date.now() - createdAt;
    const MIN_AGE_MS = 55_000;

    if (ageMs < MIN_AGE_MS) {
      const waitMore = Math.ceil((MIN_AGE_MS - ageMs) / 1000);
      return jsonResponse(
        { error: `Aguarde mais ${waitMore} segundo(s) para aprovação automática`, wait_seconds: waitMore },
        429,
        corsHeaders
      );
    }

    const { error: updateError } = await adminClient
      .from("profiles")
      .update({ approved: true })
      .eq("user_id", targetUserId);

    if (updateError) {
      console.error("auto-approve update error:", updateError.message);
      return jsonResponse({ error: "Erro ao aprovar conta" }, 500, corsHeaders);
    }

    console.log(`Auto-approved user ${targetUserId} after ${Math.round(ageMs / 1000)}s`);
    return jsonResponse({ success: true }, 200, corsHeaders);

  } catch (err) {
    console.error("auto-approve error:", err);
    return jsonResponse({ error: "Erro interno" }, 500, corsHeaders);
  }
});
