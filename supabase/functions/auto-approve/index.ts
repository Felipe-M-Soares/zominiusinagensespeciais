import { createClient } from "npm:@supabase/supabase-js@2";

// COD-02 FIX: Importado do módulo compartilhado em vez de duplicar
import { getCorsHeaders } from "../_shared/cors.ts";;
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Erro de configuração do servidor" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Valida que o request vem de um usuário autenticado (o próprio que está aguardando)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // CORREÇÃO JWT: padrão oficial Supabase para Edge Functions.
    // Passa o Authorization header no global.headers ao criar o cliente.
    // getUser() SEM argumento lê do header — forma mais confiável.
    const token = authHeader.replace("Bearer ", "").trim();
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      console.error("JWT validation failed in auto-approve:", userError?.message ?? "no user");
      return new Response(JSON.stringify({ error: "Sessão expirada ou inválida. Faça login novamente." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Lê o user_id do body
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch { /* ok */ }

    const targetUserId = body.user_id;
    if (!targetUserId || typeof targetUserId !== "string") {
      return new Response(JSON.stringify({ error: "user_id é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SECURITY: valida formato UUID ANTES de qualquer outra checagem.
    // A verificação de ownership (targetUserId !== user.id) deve vir depois —
    // caso contrário, um UUID malformado que coincidisse com user.id ignoraria
    // a validação de formato e chegaria às queries do banco com valor inesperado.
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(targetUserId)) {
      return new Response(JSON.stringify({ error: "user_id inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Segurança: o usuário só pode aprovar A SI MESMO (auto-aprovação)
    // Admins usam o painel AdminUsers para aprovar outros usuários
    if (targetUserId !== user.id) {
      return new Response(JSON.stringify({ error: "Sem permissão" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verifica se a conta tem pelo menos 55 segundos (evita aprovação antes do tempo)
    // Usamos service role para ler created_at sem restrição de RLS
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("approved, blocked, created_at")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "Perfil não encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SEGURANÇA: usuário bloqueado por admin não pode ser auto-aprovado
    if (profile.blocked === true) {
      return new Response(JSON.stringify({ error: "Conta bloqueada pelo administrador." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Se já aprovado, retorna sucesso sem fazer nada
    if (profile.approved === true) {
      return new Response(JSON.stringify({ success: true, already_approved: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verifica que a conta tem pelo menos 55s (margem de 5s para latência de rede)
    const createdAt = new Date(profile.created_at).getTime();
    const ageMs = Date.now() - createdAt;
    const MIN_AGE_MS = 55_000; // 55 segundos

    if (ageMs < MIN_AGE_MS) {
      const waitMore = Math.ceil((MIN_AGE_MS - ageMs) / 1000);
      return new Response(JSON.stringify({
        error: `Aguarde mais ${waitMore} segundo(s) para aprovação automática`,
        wait_seconds: waitMore,
      }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Aprova o usuário
    const { error: updateError } = await adminClient
      .from("profiles")
      .update({ approved: true })
      .eq("user_id", targetUserId);

    if (updateError) {
      console.error("auto-approve update error:", updateError.message);
      return new Response(JSON.stringify({ error: "Erro ao aprovar conta" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Auto-approved user ${targetUserId} after ${Math.round(ageMs / 1000)}s`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("auto-approve error:", err);
    return new Response(JSON.stringify({ error: "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
