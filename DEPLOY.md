# Deploy na Vercel — Guia Completo

## Pré-requisitos

- Conta na [Vercel](https://vercel.com)
- Projeto no [Supabase](https://supabase.com) configurado
- Conta no [Resend](https://resend.com) para envio de emails (plano gratuito disponível)

---

## 1. Variáveis de Ambiente na Vercel

No painel da Vercel → seu projeto → **Settings → Environment Variables**, adicione:

| Nome | Valor |
|------|-------|
| `VITE_SUPABASE_URL` | `https://SEU_PROJECT_ID.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | sua `anon key` do Supabase |
| `VITE_SITE_URL` | URL canônica do site, ex: `https://conceptusinagensespeciais.vercel.app` |

> ⚠️ Nunca commite o arquivo `.env` no repositório. Use sempre as env vars da Vercel.

---

## 2. Variáveis de Ambiente nas Edge Functions (Supabase)

No painel do Supabase → **Edge Functions → Manage secrets**, adicione:

| Nome | Valor | Usado em |
|------|-------|----------|
| `RESEND_API_KEY` | chave da API do Resend | `auth-email-hook` |
| `HOOK_SECRET` | string aleatória segura (≥32 chars) | `auth-email-hook` |
| `ALLOWED_ORIGIN` | `https://conceptusinagensespeciais.vercel.app` | todas as funções |

Gere um `HOOK_SECRET` seguro com:
```bash
openssl rand -hex 32
```

---

## 3. Configurar o Auth Email Hook no Supabase

1. Deploy da Edge Function:
```bash
supabase functions deploy auth-email-hook
```

2. No Supabase → **Authentication → Hooks**:
   - Ative o hook `Send Email`
   - Selecione a função `auth-email-hook`
   - Adicione o `HOOK_SECRET` como segredo do webhook

---

## 4. Deploy das demais Edge Functions

```bash
supabase functions deploy admin-reset-password
supabase functions deploy delete-account
supabase functions deploy import-devices
```

---

## 5. Deploy na Vercel

### Via CLI:
```bash
npm install -g vercel
vercel --prod
```

### Via GitHub (recomendado):
1. Faça push do projeto para um repositório GitHub
2. Na Vercel, importe o repositório
3. Configure as variáveis de ambiente (passo 1)
4. O `vercel.json` já está configurado com:
   - Roteamento SPA (todas as rotas apontam para `index.html`)
   - Headers de segurança (CSP, HSTS, X-Frame-Options, etc.)
   - Cache otimizado para assets estáticos

---

## 6. Configurar domínio personalizado (opcional)

Na Vercel → **Settings → Domains**, adicione seu domínio.

Após configurar, atualize `ALLOWED_ORIGIN` nas Edge Functions para o novo domínio.

---

## Checklist de Segurança

- [ ] `.env` não está no repositório (está no `.gitignore`)
- [ ] `VITE_SUPABASE_PUBLISHABLE_KEY` é a chave **anon** (nunca a `service_role`)
- [ ] `HOOK_SECRET` configurado no Supabase com valor forte
- [ ] `ALLOWED_ORIGIN` configurado com a URL exata da Vercel (sem barra no final)
- [ ] RLS (Row Level Security) ativado em todas as tabelas do Supabase
- [ ] Source maps desativados no build de produção (já configurado no `vite.config.ts`)

---

## SEG-06 · Rate Limiting Server-Side (Supabase Auth)

O rate limiting client-side implementado em `useAuth.tsx` é apenas uma
melhoria de UX (feedback imediato). Para proteção real contra força bruta,
**configure o rate limiting server-side no painel do Supabase**:

1. Acesse: **Supabase Dashboard → Authentication → Rate Limits**
2. Configurações recomendadas:
   - **Sign ins**: 5-10 por hora por IP
   - **Password recoveries**: 2-3 por hora
3. Considere habilitar CAPTCHA (hCaptcha ou Turnstile) para logins suspeitos:
   - **Authentication → Settings → Enable CAPTCHA protection**

O rate limiting server-side é independente do frontend e não pode ser
bypassado por chamadas diretas à API.
