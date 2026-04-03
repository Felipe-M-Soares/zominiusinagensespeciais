import { createClient } from "npm:@supabase/supabase-js@2";

// FIX: CORS dinâmico — aceita "*" (dev) ou domínio exato (prod).
function getCorsHeaders(req: Request): Record<string, string> {
  const allowed = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
  const origin = req.headers.get("origin") ?? "";
  const responseOrigin = allowed === "*" ? "*" : (origin === allowed ? origin : allowed);
  return {
    "Access-Control-Allow-Origin": responseOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// CODE-006: Validate env vars at startup
function getRequiredEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // CODE-006: Validate env vars early with informative error
    let supabaseUrl: string, supabaseAnonKey: string, serviceRoleKey: string;
    try {
      supabaseUrl = getRequiredEnv("SUPABASE_URL");
      supabaseAnonKey = getRequiredEnv("SUPABASE_ANON_KEY");
      serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    } catch (envErr) {
      console.error(envErr);
      return new Response(JSON.stringify({ error: "Erro de configuração do servidor" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // VULN-001 FIX: Use auth.getUser() for cryptographic JWT validation.
    // NEVER use manual base64 JWT decoding for identity — it has NO signature verification
    // and allows any attacker to forge a token with arbitrary sub/role claims.
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      console.error("JWT validation failed in admin-reset-password:", userError?.message ?? "no user");
      return new Response(JSON.stringify({ error: "Sessão expirada ou inválida. Faça login novamente." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // VULN-002 FIX: Now that user.id is cryptographically verified, role check is trustworthy
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    // VULN-010 FIX: Do not log sensitive user data in production
    const DEBUG = Deno.env.get("DEBUG") === "true";
    if (DEBUG) {
      console.log("Caller role:", roleData?.role);
    }

    if (roleData?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Apenas administradores podem alterar senhas" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Corpo da requisição inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { target_user_id, new_password } = body as {
      target_user_id?: string;
      new_password?: string;
    };

    if (!target_user_id || typeof target_user_id !== "string") {
      return new Response(JSON.stringify({ error: "target_user_id é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SEC: Valida UUID para prevenir path injection ou queries inesperadas
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(target_user_id)) {
      return new Response(JSON.stringify({ error: "target_user_id deve ser um UUID válido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SEC: Valida senha — mínimo 8 chars, máximo 72 chars (limite do bcrypt usado pelo Supabase Auth).
    // Senhas acima de 72 chars são silenciosamente truncadas pelo bcrypt — informar o limite
    // é mais honesto que aceitar qualquer tamanho e truncar sem avisar.
    if (!new_password || typeof new_password !== "string" || new_password.length < 8) {
      return new Response(
        JSON.stringify({ error: "A senha deve ter no mínimo 8 caracteres" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (new_password.length > 72) {
      return new Response(
        JSON.stringify({ error: "A senha deve ter no máximo 72 caracteres" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (target_user_id === user.id) {
      return new Response(
        JSON.stringify({ error: "Use o fluxo padrão para alterar sua própria senha" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: updateError } = await adminClient.auth.admin.updateUserById(
      target_user_id,
      { password: new_password }
    );

    if (updateError) {
      console.error("updateUserById error:", updateError.message);
      return new Response(
        JSON.stringify({ error: "Não foi possível redefinir a senha." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("admin-reset-password error:", err);
    return new Response(JSON.stringify({ error: "Erro interno." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
