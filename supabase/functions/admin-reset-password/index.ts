/**
 * admin-reset-password — Redefine a senha de um usuário (apenas admin)
 *
 * SEGURANÇA:
 *  - verify_jwt = true no config.toml (validação JWT pelo Supabase antes do handler)
 *  - Role admin verificada via service role key
 *  - Admin não pode redefinir senha de outro admin
 *  - UUID validado antes de qualquer query
 *  - Rate limit: 10 resets por hora por IP
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

  // Rate limit: 10 resets por hora por IP
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`reset-pwd:${ip}`, 10, 3_600_000)) {
    return jsonResponse(
      { error: "Muitas tentativas. Tente novamente em 1 hora." },
      429,
      { ...corsHeaders, "Retry-After": "3600" }
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
      return jsonResponse({ error: "Apenas administradores podem alterar senhas" }, 403, corsHeaders);
    }

    // Lê body
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Corpo da requisição inválido" }, 400, corsHeaders);
    }

    const { target_user_id, new_password } = body as {
      target_user_id?: string;
      new_password?: string;
    };

    if (!target_user_id || typeof target_user_id !== "string") {
      return jsonResponse({ error: "target_user_id é obrigatório" }, 400, corsHeaders);
    }
    if (!isValidUUID(target_user_id)) {
      return jsonResponse({ error: "target_user_id deve ser um UUID válido" }, 400, corsHeaders);
    }

    if (!new_password || typeof new_password !== "string" || new_password.length < 8) {
      return jsonResponse({ error: "A senha deve ter no mínimo 8 caracteres" }, 400, corsHeaders);
    }
    if (new_password.length > 72) {
      return jsonResponse({ error: "A senha deve ter no máximo 72 caracteres" }, 400, corsHeaders);
    }

    if (target_user_id === user.id) {
      return jsonResponse({ error: "Use o fluxo padrão para alterar sua própria senha" }, 400, corsHeaders);
    }

    // Impede admin de redefinir senha de outro admin
    const { data: targetRoleData } = await adminClient
      .from("user_roles").select("role").eq("user_id", target_user_id).maybeSingle();
    if (targetRoleData?.role === "admin") {
      return jsonResponse({ error: "Não é possível redefinir senha de outro administrador." }, 403, corsHeaders);
    }

    const { error: updateError } = await adminClient.auth.admin.updateUserById(
      target_user_id,
      { password: new_password }
    );
    if (updateError) {
      console.error("updateUserById error:", updateError.message);
      return jsonResponse({ error: "Não foi possível redefinir a senha." }, 500, corsHeaders);
    }

    return jsonResponse({ success: true }, 200, corsHeaders);

  } catch (err) {
    console.error("admin-reset-password error:", err);
    return jsonResponse({ error: "Erro interno." }, 500, corsHeaders);
  }
});
