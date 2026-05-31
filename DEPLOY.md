# Guia de Deploy — Zomini Usinagens Especiais

## Deploy na Vercel (Frontend)

### 1. Conectar repositório
1. Acesse [vercel.com](https://vercel.com) → **Add New Project**
2. Conecte o repositório GitHub
3. Framework: **Vite** (detectado automaticamente)

### 2. Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Variável | Valor |
|----------|-------|
| `VITE_SUPABASE_URL` | `https://SEU_PROJECT.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Anon key do Supabase |
| `VITE_SENTRY_DSN` | DSN do Sentry (opcional, para monitoramento) |

> ⚠️ **Nunca commite `.env` no repositório.** Use apenas as env vars da Vercel.

### 3. Deploy
```bash
# Deploy automático: push na branch main
git push origin main

# Deploy manual
npx vercel --prod
```

---

## Configuração do Supabase

### 1. Edge Functions — Secrets obrigatórios

No painel do Supabase → **Edge Functions → Manage secrets**:

| Secret | Descrição |
|--------|-----------|
| `ALLOWED_ORIGIN` | URL exata do frontend em produção (ex: `https://app.zomini.com.br`) |
| `RESEND_API_KEY` | Chave da API Resend para envio de emails |
| `HOOK_SECRET` | Secret do webhook de email (Supabase Authentication → Hooks) |
| `ROOT_DOMAIN` | Domínio raiz (ex: `app.zomini.com.br`) |
| `FROM_EMAIL` | Email remetente (ex: `noreply@zomini.com.br`) |

### 2. Deploy das Edge Functions

```bash
# Instalar Supabase CLI
npm install -g supabase

# Login
supabase login

# Deploy de uma função específica
supabase functions deploy admin-create-user
supabase functions deploy auto-approve
supabase functions deploy auth-email-hook
supabase functions deploy import-devices
supabase functions deploy admin-reset-password
supabase functions deploy delete-account

# Deploy de todas as funções
supabase functions deploy
```

### 3. Hook de Email (Supabase Auth)

Em **Supabase → Authentication → Hooks**:
- Hook: `Send Email`
- Endpoint: `https://SEU_PROJECT.supabase.co/functions/v1/auth-email-hook`
- Header: `Authorization: Bearer <HOOK_SECRET>`

### 4. Migration SQL (executar no SQL Editor do Supabase)

```sql
-- Funções aggregate para performance (evita paginação no cliente)
-- Arquivo: supabase/migrations/20260531_performance_functions.sql
```

Copiar e executar o conteúdo do arquivo de migration acima.

---

## Deploy Android (Capacitor)

```bash
# Build do frontend
npm run build

# Sincronizar com Capacitor
npx cap sync android

# Abrir no Android Studio
npx cap open android

# No Android Studio: Build → Generate Signed APK
```

---

## Checklist de Deploy para Produção

- [ ] `ALLOWED_ORIGIN` configurado com URL exata (não `*`)
- [ ] Todas as Edge Functions deployadas
- [ ] Hook de email configurado e testado
- [ ] Migration SQL executada no banco
- [ ] Variáveis de ambiente na Vercel configuradas
- [ ] Domínio customizado configurado na Vercel (se aplicável)
- [ ] `npm run test` — 135/135 passando
- [ ] Build sem erros: `npm run build`

---

## Monitoramento

- **Logs**: Supabase Dashboard → Edge Functions → Logs
- **Erros JS**: Sentry (se `VITE_SENTRY_DSN` configurado)
- **Uptime**: Vercel Analytics ou UptimeRobot
- **Banco**: Supabase Dashboard → Database → Query Performance

