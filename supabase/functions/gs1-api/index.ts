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

import { getCorsHeaders } from "../_shared/cors.ts";

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

function buildUrl(host: string, req: RequestBody): { url: string; method: string } {
  switch (req.endpoint) {
    case "cnp_get":
      return { url: `${host}/cnp/products/${req.gtin ?? ""}`, method: "GET" };

    case "cnp_list": {
      const q = new URLSearchParams(req.params ?? {});
      return { url: `${host}/cnp/products?${q}`, method: "GET" };
    }

    case "cnp_post":
      return { url: `${host}/cnp/products`, method: "POST" };

    case "cnp_patch":
      return { url: `${host}/cnp/products/${req.gtin ?? ""}`, method: "PATCH" };

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
    const env  = Deno.env.get("GS1_ENV") ?? "homologacao";
    const host = getHost(env);

    const body: RequestBody = await httpReq.json();

    // Autenticar
    const token = await getAccessToken(host);

    // Montar requisição
    const { url, method } = buildUrl(host, body);

    const fetchOpts: RequestInit = {
      method,
      headers: {
        "Authorization": `Bearer ${token}`,
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
    console.error("[gs1-api]", message);
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
