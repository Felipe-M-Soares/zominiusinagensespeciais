/**
 * supabase/functions/gs1-api/index.ts
 *
 * Edge Function — Proxy seguro para as APIs GS1 Brasil
 *
 * Cobre as 3 APIs:
 *  • CNP (Cadastro Nacional de Produtos) — GET/POST/PATCH de produtos
 *  • Provider (Verified by GS1)          — GET /provider/v2/verified
 *  • Provider Other Keys                 — GET /provider-otherKeys/searchByKey
 *
 * Auth: OAuth 2.0 (client_credentials + password). O token é obtido
 * na primeira requisição e cacheado em memória por 55 minutos.
 *
 * Deploy:
 *   supabase functions deploy gs1-api
 *
 * Secrets obrigatórios (supabase secrets set KEY=VALUE):
 *   GS1_CLIENT_ID      → client_id fornecido pela GS1 Brasil
 *   GS1_CLIENT_SECRET  → client_secret fornecido pela GS1 Brasil
 *   GS1_USERNAME       → e-mail cadastrado no CNP (cnp.gs1br.org)
 *   GS1_PASSWORD       → senha do portal CNP
 *   GS1_ENV            → "producao" | "homologacao"  (default: homologacao)
 *   ALLOWED_ORIGIN     → domínio do frontend
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { log } from "../_shared/log.ts";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface TokenCache {
  accessToken: string;
  expiresAt: number; // ms epoch
}

type GS1Endpoint =
  | "cnp_get"      // GET  /cnp/products/{gtin}
  | "cnp_list"     // GET  /cnp/products?...
  | "cnp_post"     // POST /cnp/products
  | "cnp_patch"    // PATCH /cnp/products/{gtin}
  | "provider"     // GET  /provider/v2/verified
  | "provider_keys"; // GET /provider-otherKeys/searchByKey

interface RequestBody {
  endpoint: GS1Endpoint;
  gtin?: string;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
}

// ─── Cache de token ───────────────────────────────────────────────────────────

let tokenCache: TokenCache | null = null;

function getHost(env: string): string {
  return env === "producao"
    ? "https://api.gs1br.org"
    : "https://api-hml.gs1br.org";
}

async function getAccessToken(host: string): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.accessToken;
  }

  const clientId     = Deno.env.get("GS1_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GS1_CLIENT_SECRET") ?? "";
  const username     = Deno.env.get("GS1_USERNAME") ?? "";
  const password     = Deno.env.get("GS1_PASSWORD") ?? "";

  if (!clientId || !clientSecret || !username || !password) {
    throw new Error(
      "Credenciais GS1 não configuradas. Configure GS1_CLIENT_ID, GS1_CLIENT_SECRET, GS1_USERNAME e GS1_PASSWORD nos secrets do Supabase."
    );
  }

  const basicAuth = btoa(`${clientId}:${clientSecret}`);

  const res = await fetch(`${host}/oauth/access-token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "password",
      username,
      password,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`GS1 Auth falhou (${res.status}): ${txt}`);
  }

  const data = await res.json();
  const token: string = data.access_token;
  // expires_in em segundos, default 3600
  const expiresIn: number = data.expires_in ?? 3600;

  tokenCache = {
    accessToken: token,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  return token;
}

// ─── Roteador de endpoints ────────────────────────────────────────────────────

// GTIN válido: 8 a 14 dígitos numéricos (mesma regra já aplicada no frontend,
// que faz gtin.replace(/\D/g, "") antes de enviar). Bloqueia qualquer valor
// que tente alterar o path da requisição à API GS1 (path traversal, etc).
function isValidGtin(gtin: string): boolean {
  return /^\d{8,14}$/.test(gtin);
}

function buildUrl(host: string, req: RequestBody): { url: string; method: string } {
  switch (req.endpoint) {
    case "cnp_get":
      if (!req.gtin || !isValidGtin(req.gtin)) throw new Error("GTIN inválido");
      return { url: `${host}/cnp/products/${req.gtin}`, method: "GET" };

    case "cnp_list": {
      const q = new URLSearchParams(req.params ?? {});
      return { url: `${host}/cnp/products?${q}`, method: "GET" };
    }

    case "cnp_post":
      return { url: `${host}/cnp/products`, method: "POST" };

    case "cnp_patch":
      if (!req.gtin || !isValidGtin(req.gtin)) throw new Error("GTIN inválido");
      return { url: `${host}/cnp/products/${req.gtin}`, method: "PATCH" };

    case "provider": {
      const q = new URLSearchParams(req.params ?? {});
      return { url: `${host}/provider/v2/verified?${q}`, method: "GET" };
    }

    case "provider_keys": {
      const q = new URLSearchParams(req.params ?? {});
      return { url: `${host}/provider-otherKeys/searchByKey?${q}`, method: "GET" };
    }

    default:
      throw new Error(`Endpoint desconhecido: ${(req as RequestBody).endpoint}`);
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (httpReq: Request) => {
  const corsHeaders = getCorsHeaders(httpReq);

  // Preflight
  if (httpReq.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // SEG-FIX: exige usuário autenticado com role admin ou qualidade —
    // mesma regra já aplicada no frontend para a rota /qualidade (ver
    // AppShell.tsx e App.tsx, RoleGuard roles=["qualidade","admin"]).
    // Sem isso, qualquer usuário autenticado podia consumir a cota/credenciais
    // OAuth da GS1, mesmo sem acesso à tela que usa essa function.
    //
    // NOTA: o campo "status" vai dentro do corpo JSON (além do status HTTP da
    // Response) porque o frontend (GS1Panel.tsx) lê res.status do corpo
    // retornado por supabase.functions.invoke, não o status HTTP da resposta.
    const authHeader = httpReq.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok: false, status: 401, error: "Não autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl     = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return new Response(JSON.stringify({ ok: false, status: 500, error: "Erro de configuração do servidor" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ ok: false, status: 401, error: "Sessão expirada ou inválida. Faça login novamente." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: roleData } = await adminClient
      .from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
    if (roleData?.role !== "admin" && roleData?.role !== "qualidade") {
      return new Response(JSON.stringify({ ok: false, status: 403, error: "Apenas Qualidade ou administradores podem consultar a GS1" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const env  = Deno.env.get("GS1_ENV") ?? "homologacao";
    const host = getHost(env);

    const body: RequestBody = await httpReq.json();

    // Autentica na GS1 (token OAuth da GS1, diferente do JWT do usuário acima)
    const gs1Token = await getAccessToken(host);

    // Montar requisição
    const { url, method } = buildUrl(host, body);

    const fetchOpts: RequestInit = {
      method,
      headers: {
        "Authorization": `Bearer ${gs1Token}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
    };

    if (body.body && (method === "POST" || method === "PATCH")) {
      fetchOpts.body = JSON.stringify(body.body);
    }

    const gs1Res = await fetch(url, fetchOpts);
    const gs1Data = await gs1Res.json().catch(() => ({}));

    return new Response(
      JSON.stringify({
        ok: gs1Res.ok,
        status: gs1Res.status,
        data: gs1Data,
        env,
      }),
      {
        status: gs1Res.ok ? 200 : gs1Res.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("gs1-api", "[gs1-api]", message);
    return new Response(
      JSON.stringify({ ok: false, status: 500, error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
