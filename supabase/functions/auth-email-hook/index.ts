import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { SignupEmail } from '../_shared/email-templates/signup.tsx'
import { InviteEmail } from '../_shared/email-templates/invite.tsx'
import { MagicLinkEmail } from '../_shared/email-templates/magic-link.tsx'
import { RecoveryEmail } from '../_shared/email-templates/recovery.tsx'
import { EmailChangeEmail } from '../_shared/email-templates/email-change.tsx'
import { ReauthenticationEmail } from '../_shared/email-templates/reauthentication.tsx'

// FIX: CORS dinâmico — evita bloqueio quando domínio muda
function buildCorsHeaders(origin: string): Record<string, string> {
  const allowed = Deno.env.get('ALLOWED_ORIGIN') ?? '*';
  const responseOrigin = allowed === '*' ? '*' : (origin === allowed ? origin : allowed);
  return {
    'Access-Control-Allow-Origin': responseOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

const EMAIL_SUBJECTS: Record<string, string> = {
  signup: 'Confirme seu email',
  invite: 'Você foi convidado',
  magiclink: 'Seu link de acesso',
  recovery: 'Redefinir sua senha',
  email_change: 'Confirme a alteração de email',
  reauthentication: 'Seu código de verificação',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EMAIL_TEMPLATES: Record<string, React.ComponentType<Record<string, unknown>>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
}

const SITE_NAME = "Concept Usinagens Especiais"
// OPS-004 FIX: Use env var so staging/preview/production all work correctly
const ROOT_DOMAIN = Deno.env.get("ROOT_DOMAIN") ?? Deno.env.get("ALLOWED_ORIGIN")?.replace("https://", "") ?? "conceptusinagensespeciais-lac.vercel.app"
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'onboarding@resend.dev'

// Standard Webhooks signature verification
// Supabase Auth Hooks use Standard Webhooks format:
// Header: webhook-id, webhook-timestamp, webhook-signature
// Secret format: v1,whsec_<base64>
async function verifyStandardWebhook(
  body: string,
  webhookId: string,
  timestamp: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    // Extract base64 secret from "v1,whsec_<base64>" format
    const secretBase64 = secret.replace(/^v1,whsec_/, '')
    const secretBytes = Uint8Array.from(atob(secretBase64), c => c.charCodeAt(0))

    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      secretBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    )

    // Standard Webhooks signed payload: "{webhook-id}.{timestamp}.{body}"
    const payload = `${webhookId}.${timestamp}.${body}`
    const signatureBytes = encoder.encode(payload)
    const computedSig = await crypto.subtle.sign('HMAC', key, signatureBytes)
    const computedSigBase64 = btoa(String.fromCharCode(...new Uint8Array(computedSig)))

    // Signature header can have multiple values like "v1,<sig1> v1,<sig2>"
    const signatures = signature.split(' ')
    for (const sig of signatures) {
      const sigValue = sig.replace(/^v1,/, '')
      if (sigValue === computedSigBase64) return true
    }
    return false
  } catch (e) {
    console.error('Signature verification error:', e)
    return false
  }
}

async function sendEmail(opts: {
  to: string
  from: string
  subject: string
  html: string
  text: string
}): Promise<{ message_id?: string }> {
  const resendApiKey = Deno.env.get('RESEND_API_KEY')

  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY not configured.')
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: opts.from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  })

  if (!response.ok) {
    // SECURITY: loga o erro completo internamente mas não propaga a resposta
    // bruta da Resend API (pode conter detalhes de configuração) para cima na stack.
    const errorBody = await response.text()
    console.error(`Resend API error ${response.status}:`, errorBody)
    throw new Error(`Email delivery failed (status ${response.status})`)
  }

  const data = await response.json()
  return { message_id: data.id }
}

async function handleWebhook(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
  const secret = Deno.env.get('HOOK_SECRET')

  if (!secret) {
    console.error('HOOK_SECRET not configured')
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const body = await req.text()

  // Standard Webhooks headers
  const webhookId = req.headers.get('webhook-id') ?? ''
  const timestamp = req.headers.get('webhook-timestamp') ?? ''
  const signature = req.headers.get('webhook-signature') ?? ''

  console.log('Webhook headers:', { webhookId, timestamp, hasSignature: !!signature })

  if (!webhookId || !timestamp || !signature) {
    console.error('Missing Standard Webhooks headers', { webhookId, timestamp, hasSignature: !!signature })
    return new Response(JSON.stringify({ error: 'Missing webhook headers' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // SECURITY: janela de replay reduzida de 300s para 60s.
  // O Supabase reenvia webhooks com o mesmo webhook-id em caso de falha,
  // então a idempotência deve ser tratada pela lógica de negócio (o Resend
  // desduplicará por message_id). Uma janela de 60s é suficiente para latência
  // de rede e muito mais difícil de explorar em ataques de replay.
  const ts = parseInt(timestamp, 10)
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 60) {
    console.error('Stale or future timestamp:', timestamp)
    return new Response(JSON.stringify({ error: 'Stale or invalid timestamp' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const valid = await verifyStandardWebhook(body, webhookId, timestamp, signature, secret)
  if (!valid) {
    console.error('Invalid webhook signature')
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Log webhook-id para rastreabilidade (sem dados pessoais)
  console.log('Processing webhook:', webhookId)

  // Tipagem do payload do Supabase Auth Hook (Standard Webhooks format)
  interface WebhookPayload {
    type?: string
    action_type?: string
    email?: string
    user?: { email?: string; id?: string }
    email_data?: {
      email_action_type?: string
      email?: string
      new_email?: string
      token_hash?: string
      redirect_to?: string
      otp?: string
    }
  }

  let payload: WebhookPayload
  try {
    payload = JSON.parse(body) as WebhookPayload
    console.log('Webhook payload received, keys:', Object.keys(payload))
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Removed: was duplicating key log above

  const emailType = payload.email_data?.email_action_type ?? payload.type ?? payload.action_type
  const recipientEmail = payload.user?.email ?? payload.email_data?.email ?? payload.email

  // SEC-A: Valida que recipientEmail é uma string de email válida antes de tentar enviar.
  // Sem esta checagem, um payload corrompido com email undefined causaria envio para "undefined".
  if (!recipientEmail || typeof recipientEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    console.error('Invalid or missing recipient email in payload')
    return new Response(JSON.stringify({ error: 'Invalid recipient email' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // SEC-B: confirmationUrl - redirect_to vem do payload (controlado pelo Supabase),
  // mas pode conter valores arbitrários. Garantimos que só usamos URLs do próprio domínio.
  // Um redirect_to malicioso em email de confirmação levaria o usuário para site de phishing.
  const rawRedirectTo = payload.email_data?.redirect_to
  let confirmationUrl: string
  if (payload.email_data?.token_hash) {
    const safeType = encodeURIComponent(String(emailType || ''))
    const safeHash = encodeURIComponent(String(payload.email_data.token_hash))
    confirmationUrl = `https://${ROOT_DOMAIN}/auth/confirm?token_hash=${safeHash}&type=${safeType}`
  } else if (rawRedirectTo && typeof rawRedirectTo === 'string') {
    // Só aceita URLs do próprio domínio para prevenir open redirect em emails
    try {
      const parsed = new URL(rawRedirectTo)
      if (parsed.hostname === ROOT_DOMAIN || parsed.hostname === `www.${ROOT_DOMAIN}`) {
        confirmationUrl = rawRedirectTo
      } else {
        console.error('redirect_to domain not allowed:', parsed.hostname)
        confirmationUrl = `https://${ROOT_DOMAIN}`
      }
    } catch {
      confirmationUrl = `https://${ROOT_DOMAIN}`
    }
  } else {
    confirmationUrl = `https://${ROOT_DOMAIN}`
  }

  console.log('Processing email type:', emailType) // FIX: removed recipient email from logs (privacy)

  const EmailTemplate = EMAIL_TEMPLATES[emailType]
  if (!EmailTemplate) {
    console.error('Unknown email type:', emailType)
    return new Response(
      JSON.stringify({ error: `Unknown email type: ${emailType}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const templateProps = {
    siteName: SITE_NAME,
    siteUrl: `https://${ROOT_DOMAIN}`,
    recipient: recipientEmail,
    confirmationUrl,
    token: payload.email_data?.otp,
    email: recipientEmail,
    newEmail: payload.email_data?.new_email,
  }

  const html = await renderAsync(React.createElement(EmailTemplate, templateProps))
  const text = await renderAsync(React.createElement(EmailTemplate, templateProps), {
    plainText: true,
  })

  let result: { message_id?: string }
  try {
    result = await sendEmail({
      to: recipientEmail,
      from: `${SITE_NAME} <${FROM_EMAIL}>`,
      subject: EMAIL_SUBJECTS[emailType] || 'Notificação',
      html,
      text,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send email'
    console.error('Email send error:', message)
    return new Response(JSON.stringify({ error: 'Failed to send email' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  console.log('Email sent successfully:', result.message_id)

  return new Response(
    JSON.stringify({ success: true, message_id: result.message_id }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req.headers.get('origin') ?? '');
  const url = new URL(req.url)

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    return await handleWebhook(req, corsHeaders)
  } catch (error) {
    // SECURITY: loga internamente mas não expõe mensagem de erro ao chamador.
    // Este hook é chamado pelo Supabase internamente, mas mesmo assim não deve
    // vazar detalhes de stack trace ou mensagens internas.
    console.error('Webhook handler error:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
