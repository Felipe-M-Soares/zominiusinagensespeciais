import { createClient } from "npm:@supabase/supabase-js@2";

// FIX: CORS dinâmico — ALLOWED_ORIGIN pode ser "*" (dev) ou domínio exato (prod).
// O CORS estático com domínio hardcoded bloqueia requests quando o domínio de produção
// não bate exatamente (ex: www. vs sem www, ou domínios custom no Vercel).
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

    // CORREÇÃO JWT: padrão oficial Supabase para Edge Functions.
    // Passa o Authorization header no global.headers ao criar o cliente.
    // getUser() SEM argumento lê do header — forma mais confiável.
    // getUser(token) como argumento às vezes falha com "Invalid JWT" em certos
    // estados de sessão mesmo com token válido.
    const token = authHeader.replace("Bearer ", "").trim();
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      console.error("JWT validation failed:", userError?.message ?? "no user returned");
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
      // SECURITY: não expor o papel do usuário no corpo do erro —
      // informação desnecessária para o chamador não-admin.
      console.error("Access denied in delete-account. user.id:", user.id, "role found:", roleData?.role ?? "none");
      return new Response(
        JSON.stringify({ error: "Acesso negado. Apenas administradores podem excluir usuários." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch { /* empty body is ok */ }

    const targetUserId = body.target_user_id;
    if (!targetUserId || typeof targetUserId !== "string") {
      return new Response(JSON.stringify({ error: "target_user_id é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SEC: Valida que target_user_id é um UUID válido para prevenir injeção via path
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(targetUserId)) {
      return new Response(JSON.stringify({ error: "target_user_id deve ser um UUID válido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (targetUserId === user.id) {
      return new Response(
        JSON.stringify({ error: "Não é possível excluir sua própria conta" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // SEC: Verifica que o usuário alvo existe ANTES de tentar deletar registros relacionados.
    // Sem esta checagem, um UUID de usuário inexistente causaria deleções sem efeito
    // seguidas de um erro confuso do auth.admin.deleteUser.
    const { data: targetUser, error: lookupError } = await adminClient.auth.admin.getUserById(targetUserId);
    if (lookupError || !targetUser?.user) {
      return new Response(JSON.stringify({ error: "Usuário alvo não encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ordem correta: limpar tabelas da aplicação ANTES de deletar o auth user.
    // Se deletarmos o auth user primeiro e o cleanup falhar, os registros ficam órfãos
    // sem user_id válido e sem como associar a quem pertenciam.
    const { error: profileErr } = await adminClient.from("profiles").delete().eq("user_id", targetUserId);
    if (profileErr) console.error("profiles delete error:", profileErr.message);
    
    const { error: roleErr } = await adminClient.from("user_roles").delete().eq("user_id", targetUserId);
    if (roleErr) console.error("user_roles delete error:", roleErr.message);

    // Agora deleta o auth user
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetUserId);
    if (deleteError) {
      console.error("deleteUser error:", deleteError.message);
      return new Response(
        // SECURITY: não expor mensagem interna do Supabase ao cliente
        JSON.stringify({ error: "Não foi possível excluir o usuário." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("delete-account error:", msg);
    return new Response(JSON.stringify({ error: "Erro interno: " + msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
