# 🚀 Guia de Deploy — Novo Projeto Supabase

## Visão Geral

Este guia cobre **tudo** necessário para subir o projeto do zero no Supabase como um projeto novo.

---

## 1. Criar Projeto no Supabase

1. Acesse [supabase.com/dashboard](https://supabase.com/dashboard)
2. Clique em **New Project**
3. Escolha organização, nome do projeto e **senha do banco** (guarde!)
4. Região: **South America (São Paulo)** — `sa-east-1`
5. Aguarde ~2 minutos até o projeto ficar pronto

---

## 2. Instalar Supabase CLI

```bash
# macOS / Linux
brew install supabase/tap/supabase

# Windows (via scoop)
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# Verificar instalação
supabase --version
```

---

## 3. Linkar o Projeto Local

```bash
# Login na conta Supabase
supabase login

# No diretório raiz do projeto:
supabase link --project-ref SEU_PROJECT_REF
# O project-ref está na URL do painel: supabase.com/dashboard/project/SEU_PROJECT_REF
```

---

## 4. Aplicar Todas as Migrations (uma vez)

```bash
# Aplica todas as 22 migrations em ordem
supabase db push
```

Isso criará:
- Todas as tabelas (users, devices, stock, comercial, financeiro, producao, qualidade…)
- Todas as RLS policies
- Todas as funções e triggers
- **A conta admin inicial** (ver seção abaixo)

---

## 5. Conta de Admin Inicial

Após as migrations, uma conta admin é criada automaticamente:

| Campo  | Valor              |
|--------|--------------------|
| Login  | `admin`            |
| Senha  | `Admin@2024`       |
| Email  | `admin@interno.conceptus` |

> ⚠️ **MUDE A SENHA NO PRIMEIRO LOGIN.** O sistema forçará a troca (`must_change_password = true`).

Para trocar via SQL (opcional, antes do primeiro login):
```sql
SELECT public.admin_reset_password(
  (SELECT id FROM auth.users WHERE email = 'admin@interno.conceptus'),
  'SuaNovaSenhaForte@2026'
);
```

---

## 6. Deploy das Edge Functions

```bash
# Deploy de todas as Edge Functions
supabase functions deploy admin-create-user
supabase functions deploy admin-reset-password
supabase functions deploy auth-email-hook
supabase functions deploy auto-approve
supabase functions deploy delete-account
supabase functions deploy import-devices
supabase functions deploy sefaz-emitir
```

---

## 7. Configurar Variáveis de Ambiente

### No Vercel (Frontend)

Vá em **Project Settings > Environment Variables** e adicione:

| Variável | Onde encontrar |
|----------|---------------|
| `VITE_SUPABASE_URL` | Supabase > Project Settings > API > Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase > Project Settings > API > anon/public key |
| `VITE_SITE_URL` | URL do seu projeto no Vercel (ex: `https://meu-app.vercel.app`) |
| `VITE_SENTRY_DSN` | Opcional — deixe vazio para desativar monitoramento de erros |

### No Supabase (Edge Functions Secrets)

Vá em **Project Settings > Edge Functions > Secrets** e adicione:

| Secret | Valor |
|--------|-------|
| `ALLOWED_ORIGIN` | URL do Vercel (ex: `https://meu-app.vercel.app`) |

> As variáveis `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são preenchidas **automaticamente** pelo Supabase nas Edge Functions.

---

## 8. Configurar Auth

No painel do Supabase, vá em **Authentication > URL Configuration**:

- **Site URL**: `https://meu-app.vercel.app`
- **Redirect URLs**: adicione `https://meu-app.vercel.app/**`

---

## 9. Storage Buckets

As migrations criam os buckets automaticamente. Verifique em **Storage** que os buckets foram criados:
- `manuals`
- `catalogs`
- `devices`

---

## 10. Verificar Funcionamento

Após tudo configurado:

1. Acesse o app no Vercel
2. Faça login com `admin` / `Admin@2024`
3. Troque a senha quando solicitado
4. Crie os demais usuários em **Admin > Usuários**

### Roles disponíveis:
| Role | Acesso |
|------|--------|
| `admin` | Tudo |
| `estoque` | Componentes, Estoque |
| `qualidade` | Componentes, Estoque, Qualidade |
| `comercial` | Comercial |
| `financeiro` | Financeiro |
| `producao` | Componentes, Produção |

---

## Troubleshooting

**Erro "extension pgcrypto does not exist"**  
→ No painel Supabase > Database > Extensions, ative `pgcrypto` e `pg_trgm` manualmente.

**Migration falha em auth.users**  
→ O Supabase hospedado permite INSERT em `auth.users` apenas via service role. Se der erro, rode o script de seed diretamente no SQL Editor do painel com permissão de service role.

**Edge Function com erro de CORS**  
→ Verifique se `ALLOWED_ORIGIN` está igual ao `VITE_SITE_URL` (sem barra final).

