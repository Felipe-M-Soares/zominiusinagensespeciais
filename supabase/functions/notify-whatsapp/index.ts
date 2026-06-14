/**
 * notify-whatsapp — Envia notificação via WhatsApp Business API
 *
 * Chamada quando status de pedido muda para "pronto".
 * Usa a API oficial do WhatsApp Business (Meta Graph API).
 *
 * Secrets necessários:
 *   WA_PHONE_NUMBER_ID → ID do número de WhatsApp Business
 *   WA_ACCESS_TOKEN    → Token de acesso Meta Graph API
 *   WA_TEMPLATE_NAME   → Nome do template aprovado (ex: "pedido_pronto")
 *   ALLOWED_ORIGIN     → Domínio do frontend
 *
 * Ativar trigger no banco:
 *   Quando pedidos_comerciais.status = 'pronto', chamar esta Edge Function
 *   via pg_net (extensão do Supabase) ou via webhook do Supabase.
 */

import { getCorsHeaders } from "../_shared/cors.ts";
import { getRequiredEnv, jsonResponse } from "../_shared/utils.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

interface PedidoPayload {
  pedido_id: string;
  cliente_nome: string;
  cliente_telefone?: string;
  nota_fiscal?: string;
  total_pecas?: number;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);

  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) return jsonResponse({ error: "Não autenticado" }, 401, corsHeaders);

    const supabaseUrl  = getRequiredEnv("SUPABASE_URL");
    const supabaseAnon = getRequiredEnv("SUPABASE_ANON_KEY");
    const waPhoneId    = getRequiredEnv("WA_PHONE_NUMBER_ID");
    const waToken      = getRequiredEnv("WA_ACCESS_TOKEN");
    const waTemplate   = Deno.env.get("WA_TEMPLATE_NAME") ?? "pedido_pronto";

    // Valida JWT
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return jsonResponse({ error: "Sessão inválida" }, 401, corsHeaders);

    const body: PedidoPayload = await req.json();
    const { cliente_telefone, cliente_nome, pedido_id, total_pecas } = body;

    if (!cliente_telefone) {
      return jsonResponse({ error: "cliente_telefone é obrigatório" }, 400, corsHeaders);
    }

    // Normaliza telefone para formato internacional (Brasil: +55XXXXXXXXXXX)
    const phone = cliente_telefone.replace(/\D/g, "");
    const phoneIntl = phone.startsWith("55") ? phone : `55${phone}`;

    // Envia via Meta Graph API usando template de mensagem aprovado
    const waRes = await fetch(
      `https://graph.facebook.com/v19.0/${waPhoneId}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${waToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phoneIntl,
          type: "template",
          template: {
            name: waTemplate,
            language: { code: "pt_BR" },
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: cliente_nome },
                  { type: "text", text: pedido_id.slice(0, 8).toUpperCase() },
                  { type: "text", text: total_pecas?.toString() ?? "—" },
                ],
              },
            ],
          },
        }),
      }
    );

    if (!waRes.ok) {
      const err = await waRes.text();
      console.error("WhatsApp API error:", err);
      return jsonResponse({ error: "Erro ao enviar mensagem WhatsApp" }, 502, corsHeaders);
    }

    const waData = await waRes.json();
    console.log("WhatsApp message sent:", waData?.messages?.[0]?.id);
    return jsonResponse({ success: true, message_id: waData?.messages?.[0]?.id }, 200, corsHeaders);

  } catch (err) {
    console.error("notify-whatsapp error:", err);
    return jsonResponse({ error: "Erro interno" }, 500, corsHeaders);
  }
});
