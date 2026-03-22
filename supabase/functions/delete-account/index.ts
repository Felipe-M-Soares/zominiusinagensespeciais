import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://conceptusinagensespeciais.vercel.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller token server-side
    const adminClient2 = createClient(supabaseUrl, serviceRoleKey);
const { data: { user: caller }, error: userError } = await adminClient2.auth.getUser(
  authHeader.replace('Bearer ', '')
);
if (userError || !caller) {
  return new Response(JSON.stringify({ error: "Token inválido" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // empty body is handled below
    }

    const targetUserId = body.target_user_id;
    if (!targetUserId || typeof targetUserId !== "string") {
      return new Response(JSON.stringify({ error: "target_user_id é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Prevent self-deletion
    if (targetUserId === caller.id) {
      return new Response(
        JSON.stringify({ error: "Não é possível excluir sua própria conta" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Admin-only check
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .maybeSingle();

    if (roleData?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Apenas administradores podem excluir usuários" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Delete in correct order (profile data first, then auth user)
    const [profileDelete, roleDelete] = await Promise.all([
      adminClient.from("profiles").delete().eq("user_id", targetUserId),
      adminClient.from("user_roles").delete().eq("user_id", targetUserId),
    ]);

    if (profileDelete.error) {
      console.error("Profile delete error:", profileDelete.error.message);
    }
    if (roleDelete.error) {
      console.error("Role delete error:", roleDelete.error.message);
    }

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetUserId);
    if (deleteError) {
      console.error("deleteUser error:", deleteError.message);
      return new Response(
        JSON.stringify({ error: "Não foi possível excluir o usuário. Tente novamente." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("delete-account error:", err);
    return new Response(JSON.stringify({ error: "Erro interno ao processar a exclusão." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
