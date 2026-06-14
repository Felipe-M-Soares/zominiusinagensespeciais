/**
 * delete-account — Exclui um usuário do sistema (apenas admin)
 *
 * SEGURANÇA:
 *  - verify_jwt = true no config.toml (validação JWT pelo Supabase antes do handler)
 *  - Role admin verificada via service role key
 *  - Admin não pode excluir a própria conta
 *  - UUID validado antes de qualquer query
 *  - Rate limit: 3 exclusões por dia por IP (ação destrutiva)
 *  - Limpeza de registros na ordem correta (app antes de auth.users)
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

  // Rate limit: 3 exclusões por dia por IP (ação irreversível)
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`delete-account:${ip}`, 3, 86_400_000)) {
    return jsonResponse(
      { error: "Limite diário atingido." },
      429,
      { ...corsHeaders, "Retry-After": "86400" }
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

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Verifica role admin
    const { data: roleData } = await adminClient
      .from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
    if (roleData?.role !== "admin") {
      return jsonResponse({ error: "Acesso negado. Apenas administradores podem excluir usuários." }, 403, corsHeaders);
    }

    // Lê body
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* ok */ }

    const targetUserId = body.target_user_id;
    if (!targetUserId || typeof targetUserId !== "string") {
      return jsonResponse({ error: "target_user_id é obrigatório" }, 400, corsHeaders);
    }
    if (!isValidUUID(targetUserId)) {
      return jsonResponse({ error: "target_user_id deve ser um UUID válido" }, 400, corsHeaders);
    }
    if (targetUserId === user.id) {
      return jsonResponse({ error: "Não é possível excluir sua própria conta" }, 400, corsHeaders);
    }

    // Verifica existência do usuário alvo
    const { data: targetUser, error: lookupError } = await adminClient.auth.admin.getUserById(targetUserId);
    if (lookupError || !targetUser?.user) {
      return jsonResponse({ error: "Usuário alvo não encontrado" }, 404, corsHeaders);
    }

    // Limpa registros da app ANTES de deletar o auth user
    const { error: profileErr } = await adminClient.from("profiles").delete().eq("user_id", targetUserId);
    if (profileErr) console.error("profiles delete error:", profileErr.message);

    const { error: roleErr } = await adminClient.from("user_roles").delete().eq("user_id", targetUserId);
    if (roleErr) console.error("user_roles delete error:", roleErr.message);

    // Deleta o auth user
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetUserId);
    if (deleteError) {
      console.error("deleteUser error:", deleteError.message);
      return jsonResponse({ error: "Não foi possível excluir o usuário." }, 500, corsHeaders);
    }

    return jsonResponse({ success: true }, 200, corsHeaders);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("delete-account error:", msg);
    return jsonResponse({ error: "Erro interno." }, 500, corsHeaders);
  }
});
