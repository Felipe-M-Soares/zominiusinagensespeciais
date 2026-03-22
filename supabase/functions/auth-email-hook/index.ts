import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { SignupEmail } from '../_shared/email-templates/signup.tsx'
import { InviteEmail } from '../_shared/email-templates/invite.tsx'
import { MagicLinkEmail } from '../_shared/email-templates/magic-link.tsx'
import { RecoveryEmail } from '../_shared/email-templates/recovery.tsx'
import { EmailChangeEmail } from '../_shared/email-templates/email-change.tsx'
import { ReauthenticationEmail } from '../_shared/email-templates/reauthentication.tsx'

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? 'https://conceptusinagensespeciais-lac.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EMAIL_SUBJECTS: Record<string, string> = {
  signup: 'Confirme seu email',
  invite: 'Você foi convidado',
  magiclink: 'Seu link de acesso',
  recovery: 'Redefinir sua senha',
  email_change: 'Confirme a alteração de email',
  reauthentication: 'Seu código de verificação',
}

const EMAIL_TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
}

const SITE_NAME = "Concept Usinagens Especiais"
const ROOT_DOMAIN = "conceptusinagensespeciais-lac.vercel.app"
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
    const error = await response.text()
    throw new Error(`Resend API error: ${error}`)
  }

  const data = await response.json()
  return { message_id: data.id }
}

async function handleWebhook(req: Request): Promise<Response> {
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

  // Reject stale requests (older than 5 minutes)
  const ts = parseInt(timestamp, 10)
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    console.error('Stale timestamp:', timestamp)
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

  let payload: any
  try {
    payload = JSON.parse(body)
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  console.log('Webhook payload keys:', Object.keys(payload))

  const emailType = payload.email_data?.email_action_type ?? payload.type ?? payload.action_type
  const recipientEmail = payload.email_data?.email ?? payload.email
  const confirmationUrl = payload.email_data?.token_hash
    ? `https://${ROOT_DOMAIN}/auth/confirm?token_hash=${payload.email_data.token_hash}&type=${emailType}`
    : payload.email_data?.redirect_to ?? `https://${ROOT_DOMAIN}`

  console.log('Processing email:', { emailType, recipient: recipientEmail })

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
  const url = new URL(req.url)

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    return await handleWebhook(req)
  } catch (error) {
    console.error('Webhook handler error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
