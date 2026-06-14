/**
 * admin-create-user — Cria um novo usuário interno (apenas admin)
 *
 * SEGURANÇA:
 *  - verify_jwt = true no config.toml: o Supabase valida o JWT antes de chegar aqui
 *  - Role admin verificada com service role key (não depende de claim no JWT)
 *  - Rate limiting por IP (em memória + banco via RLS)
 *  - Body size limitado a 8KB
 *  - Login sanitizado: apenas [a-z0-9._-]
 *  - Senha validada: 8-72 chars
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  getRequiredEnv,
  loginToEmail,
  checkRateLimit,
  jsonResponse,
} from "../_shared/utils.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
  }

  // Rate limit por IP: 10 criações por minuto
  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";
  if (!checkRateLimit(`create-user:${clientIp}`, 10, 60_000)) {
    return jsonResponse(
      { error: "Muitas requisições. Aguarde 1 minuto." },
      429,
      { ...corsHeaders, "Retry-After": "60" }
    );
  }

  try {
    const supabaseUrl = getRequiredEnv("SUPABASE_URL");
    const supabaseAnon = getRequiredEnv("API_ANON_KEY");
    const serviceKey = getRequiredEnv("API_SERVICE_KEY");

    // Com verify_jwt = true, o Supabase já validou o JWT.
    // Extraímos o token para criar um cliente com contexto de usuário.
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) {
      return jsonResponse({ error: "Não autenticado" }, 401, corsHeaders);
    }

    // Verifica identidade do chamador via SDK (não só pelo JWT claim)
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ error: "Sessão inválida: " + (userError?.message ?? "sem usuário") }, 401, corsHeaders);
    }

    // Verifica role admin com service role (fonte de verdade confiável)
    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: roleData, error: roleError } = await adminClient
      .from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
    if (roleError) {
      return jsonResponse({ error: "Erro ao verificar role: " + roleError.message }, 500, corsHeaders);
    }
    if (roleData?.role !== "admin") {
      return jsonResponse({ error: "Apenas administradores podem criar usuários" }, 403, corsHeaders);
    }

    // Lê e valida body
    const MAX_BODY = 8 * 1024;
    const rawBuf = await req.arrayBuffer();
    if (rawBuf.byteLength > MAX_BODY) {
      return jsonResponse({ error: "Requisição muito grande." }, 413, corsHeaders);
    }
    let body: Record<string, string> = {};
    try { body = JSON.parse(new TextDecoder().decode(rawBuf)); } catch { /* invalid json */ }

    const { login, password, display_name, role: newRole } = body;

    if (!login || typeof login !== "string" || login.trim().length < 2) {
      return jsonResponse({ error: "Login inválido (mínimo 2 caracteres)" }, 400, corsHeaders);
    }
    const cleanLogin = login.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
    if (cleanLogin.length < 2) {
      return jsonResponse({ error: "Login deve conter letras, números, ponto, hífen ou underscore" }, 400, corsHeaders);
    }

    if (!password || typeof password !== "string" || password.length < 8) {
      return jsonResponse({ error: "Senha deve ter no mínimo 8 caracteres" }, 400, corsHeaders);
    }
    if (password.length > 72) {
      return jsonResponse({ error: "Senha deve ter no máximo 72 caracteres" }, 400, corsHeaders);
    }

    if (!display_name || typeof display_name !== "string" || display_name.trim().length < 2) {
      return jsonResponse({ error: "Nome inválido (mínimo 2 caracteres)" }, 400, corsHeaders);
    }

    // Verifica login duplicado
    const { data: existingProfile } = await adminClient
      .from("profiles").select("user_id").ilike("login", cleanLogin).maybeSingle();
    if (existingProfile) {
      return jsonResponse({ error: "Este login já está em uso" }, 409, corsHeaders);
    }

    const internalEmail = loginToEmail(cleanLogin);
    const cleanName = display_name.trim().slice(0, 100);
    const validRoles = ["admin", "estoque", "qualidade", "comercial", "financeiro", "producao"];
    const validRole = validRoles.includes(newRole) ? newRole : "estoque";

    const { data: createdUser, error: createError } = await adminClient.auth.admin.createUser({
      email: internalEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: cleanName },
    });

    if (createError) {
      if (createError.message.includes("already registered") || createError.message.includes("already been registered")) {
        return jsonResponse({ error: "Este login já está em uso" }, 409, corsHeaders);
      }
      return jsonResponse({ error: "Erro ao criar usuário: " + createError.message }, 500, corsHeaders);
    }
    if (!createdUser?.user) {
      return jsonResponse({ error: "Erro inesperado ao criar usuário" }, 500, corsHeaders);
    }

    const newUserId = createdUser.user.id;

    await adminClient.from("profiles").upsert(
      {
        user_id: newUserId,
        approved: true,
        display_name: cleanName,
        email: internalEmail,
        login: cleanLogin,
        must_change_password: true,
      },
      { onConflict: "user_id" }
    );

    await adminClient.from("user_roles").upsert(
      { user_id: newUserId, role: validRole },
      { onConflict: "user_id" }
    );

    return jsonResponse({ success: true, user_id: newUserId, login: cleanLogin }, 200, corsHeaders);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("admin-create-user error:", msg);
    return jsonResponse({ error: "Erro interno do servidor" }, 500, corsHeaders);
  }
});
