import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

function getRequiredEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing env: ${key}`);
  return value;
}

// Gera email interno a partir do login: login@interno.conceptus
function loginToEmail(login: string): string {
  return `${login.toLowerCase().trim()}@interno.conceptus`;
}

// Rate limiting: max 10 requests per minute per IP for admin operations
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(ip: string, maxReq = 10, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxReq) return false;
  entry.count++;
  return true;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Rate limit by IP (DDoS / brute-force protection)
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? req.headers.get("cf-connecting-ip")
    ?? "unknown";
  if (!checkRateLimit(clientIp)) {
    return new Response(JSON.stringify({ error: "Muitas requisições. Aguarde 1 minuto." }), {
      status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" },
    });
  }

  try {
    const supabaseUrl   = getRequiredEnv("SUPABASE_URL");
    const supabaseAnon  = getRequiredEnv("SUPABASE_ANON_KEY");
    const serviceKey    = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

    // Valida JWT do chamador
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Sessão inválida." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Verifica que chamador é admin
    const { data: roleData } = await adminClient
      .from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
    if (roleData?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Apenas administradores podem criar usuários" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // DDoS protection: limit body to 8KB (login+password+name+role = ~400 bytes max)
    const MAX_BODY = 8 * 1024;
    const rawBuf = await req.arrayBuffer();
    if (rawBuf.byteLength > MAX_BODY) {
      return new Response(JSON.stringify({ error: "Requisição muito grande." }), {
        status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let body: Record<string, string> = {};
    try { body = JSON.parse(new TextDecoder().decode(rawBuf)); } catch { /* invalid json = empty body */ }
    const { login, password, display_name, role: newRole } = body;

    // Valida login (username)
    if (!login || typeof login !== "string" || login.trim().length < 2) {
      return new Response(JSON.stringify({ error: "Login inválido (mínimo 2 caracteres)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const cleanLogin = login.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
    if (cleanLogin.length < 2) {
      return new Response(JSON.stringify({ error: "Login deve conter letras, números, ponto, hífen ou underscore" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Valida senha
    if (!password || typeof password !== "string" || password.length < 8) {
      return new Response(JSON.stringify({ error: "Senha deve ter no mínimo 8 caracteres" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (password.length > 72) {
      return new Response(JSON.stringify({ error: "Senha deve ter no máximo 72 caracteres" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Valida nome
    if (!display_name || typeof display_name !== "string" || display_name.trim().length < 2) {
      return new Response(JSON.stringify({ error: "Nome inválido (mínimo 2 caracteres)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verifica se login já existe
    const { data: existingProfile } = await adminClient
      .from("profiles").select("user_id").ilike("login", cleanLogin).maybeSingle();
    if (existingProfile) {
      return new Response(JSON.stringify({ error: "Este login já está em uso" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const internalEmail = loginToEmail(cleanLogin);
    const cleanName = display_name.trim().slice(0, 100);
    const validRole = ["admin", "estoque", "qualidade", "comercial", "financeiro", "producao"].includes(newRole) ? newRole : "estoque";

    // Cria usuário
    const { data: createdUser, error: createError } = await adminClient.auth.admin.createUser({
      email: internalEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: cleanName },
    });

    if (createError) {
      if (createError.message.includes("already registered") || createError.message.includes("already been registered")) {
        return new Response(JSON.stringify({ error: "Este login já está em uso" }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Erro ao criar usuário: " + createError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!createdUser?.user) {
      return new Response(JSON.stringify({ error: "Erro inesperado ao criar usuário" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newUserId = createdUser.user.id;

    // Profile com login + must_change_password = true (usuário define senha no 1º login)
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

    // Role — inserido para TODOS os roles, não apenas admin
    await adminClient.from("user_roles").upsert(
      { user_id: newUserId, role: validRole },
      { onConflict: "user_id" }
    );

    return new Response(JSON.stringify({ success: true, user_id: newUserId, login: cleanLogin }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("admin-create-user error:", err);
    return new Response(JSON.stringify({ error: "Erro interno." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
