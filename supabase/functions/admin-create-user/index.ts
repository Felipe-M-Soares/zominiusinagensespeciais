import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // Verifica autenticação do chamador
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Valida JWT criptograficamente
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Token inválido" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verifica que o chamador é admin
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleData?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Apenas administradores podem criar usuários" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Lê e valida o body
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Body inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { email, password, display_name, role: newRole } = body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return new Response(JSON.stringify({ error: "Email inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!password || typeof password !== "string" || password.length < 8) {
      return new Response(JSON.stringify({ error: "Senha deve ter no mínimo 8 caracteres" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // FIX: bcrypt trunca silenciosamente senhas acima de 72 chars.
    // Informar o limite é mais honesto que aceitar e truncar sem avisar.
    if (password.length > 72) {
      return new Response(JSON.stringify({ error: "Senha deve ter no máximo 72 caracteres" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!display_name || typeof display_name !== "string" || display_name.trim().length < 2) {
      return new Response(JSON.stringify({ error: "Nome inválido (mínimo 2 caracteres)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const validRole = newRole === "admin" ? "admin" : "client";

    // Cria o usuário via admin API — sem necessidade de confirmar email
    const { data: createdUser, error: createError } = await adminClient.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true, // Admin cria já confirmado
      user_metadata: { display_name: display_name.trim().slice(0, 100) },
    });

    if (createError) {
      console.error("createUser error:", createError.message);
      // Traduz erros comuns
      if (createError.message.includes("already registered") || createError.message.includes("already been registered")) {
        return new Response(JSON.stringify({ error: "Este email já está cadastrado" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Erro ao criar usuário: " + createError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!createdUser?.user) {
      return new Response(JSON.stringify({ error: "Erro inesperado ao criar usuário" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newUserId = createdUser.user.id;

    // FIX: race condition — o trigger handle_new_user no Supabase insere o perfil de forma
    // assíncrona após createUser(). Se fizermos UPDATE imediatamente, a linha pode não existir
    // ainda, e o UPDATE afeta 0 linhas (silenciosamente falha sem retornar erro).
    // Solução: upsert garante que a linha existe independente do timing do trigger.
    const cleanName = (display_name as string).trim().slice(0, 100);
    const { error: profileErr } = await adminClient
      .from("profiles")
      .upsert(
        { user_id: newUserId, approved: true, display_name: cleanName, email: (email as string).trim().toLowerCase() },
        { onConflict: "user_id" }
      );
    if (profileErr) {
      console.error("Profile upsert error:", profileErr.message);
      // Não falha a criação — o trigger pode ter criado com dados corretos
    }

    // Define role se não for client (padrão já é client pelo trigger)
    if (validRole === "admin") {
      // Mesmo problema: upsert garante que a linha existe antes de atualizar
      const { error: roleErr } = await adminClient
        .from("user_roles")
        .upsert(
          { user_id: newUserId, role: "admin" },
          { onConflict: "user_id" }
        );
      if (roleErr) {
        console.error("Role upsert error:", roleErr.message);
      }
    }

    return new Response(JSON.stringify({ success: true, user_id: newUserId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("admin-create-user error:", err);
    return new Response(JSON.stringify({ error: "Erro interno." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
