# Zomini Usinagens Especiais — ERP Interno

Sistema ERP interno para gestão de dispositivos médicos com conformidade ANVISA.

## Stack

- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS + Radix UI
- **Backend**: Supabase (PostgreSQL + Auth + Storage + Edge Functions)
- **Deploy**: Vercel (frontend) + Supabase Cloud
- **CI**: GitHub Actions (lint + testes + type-check)

## Módulos

| Módulo | Roles com Acesso |
|--------|-----------------|
| Componentes | admin, estoque, qualidade, producao |
| Estoque | admin, estoque, qualidade |
| Qualidade | admin, qualidade |
| Comercial | admin, comercial |
| Financeiro | admin, financeiro |
| Produção | admin, producao |
| Admin | admin |

## Desenvolvimento Local

```bash
# Instalar dependências
npm install

# Iniciar dev server
npm run dev

# Verificar tipos
npm run type-check

# Lint
npm run lint

# Testes
npm test
```

## Deploy

O deploy é automático via **Vercel Git Integration** — qualquer push na branch `main`
dispara um deploy de produção. Não use o GitHub Actions para deploy.

### Variáveis de Ambiente (Vercel)

| Variável | Onde encontrar |
|----------|---------------|
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API (anon key) |
| `VITE_SITE_URL` | URL do projeto no Vercel |

## Banco de Dados

```bash
# Aplicar migrations
supabase link --project-ref SEU_PROJECT_REF
supabase db push

# Deploy das Edge Functions
supabase functions deploy --all
```

Ver `SUPABASE_SETUP.md` para guia completo de setup.

## Segurança

- RLS habilitado em todas as tabelas
- Rate limiting por usuário (sliding window, banco)
- Rate limiting client-side no login (backoff exponencial)
- CSP, HSTS, X-Frame-Options configurados no Vercel
- Senhas hasheadas com bcrypt (Supabase Auth)
- Tokens JWT com expiração automática
- Auditoria de ações críticas em `audit_log` (retido 90 dias)

## Roles

| Role | Acesso |
|------|--------|
| `admin` | Total |
| `estoque` | Componentes, Estoque |
| `qualidade` | Componentes, Estoque, Qualidade |
| `comercial` | Comercial |
| `financeiro` | Financeiro |
| `producao` | Componentes, Produção |
