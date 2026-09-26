# Zomini ERP — Zomini Usinagens Especiais

Sistema de gestão (PWA) para usinagem de componentes médicos/odontológicos:
estoque por fase e lote, produção (apontamento, OEE, paradas, refugo), qualidade
e conformidade ANVISA/GS1, comercial (clientes e pedidos) e financeiro (NF-e,
contas, fluxo de caixa).

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + TypeScript + Vite 8 + Tailwind CSS + Radix UI (shadcn/ui) |
| Dados | Supabase (Postgres + RLS, Auth, Storage, Realtime, Edge Functions em Deno) |
| Hospedagem | Vercel (SPA + função `/api/keep-alive` + Vercel Cron) |
| Offline | PWA (Workbox) + IndexedDB para apontamentos de produção sem internet |
| Testes | Vitest + jsdom |

---

## Módulos e perfis de acesso

| Módulo (rota) | Perfis com acesso |
|---|---|
| Componentes — base ANVISA (`/`) | admin, estoque, qualidade, produção |
| Estoque (`/estoque`) | admin, estoque, qualidade |
| Qualidade (`/qualidade`) | admin, qualidade |
| Comercial (`/comercial`) | admin, comercial |
| Financeiro (`/financeiro`) | admin, financeiro |
| Produção (`/producao`) | admin, produção |
| Processos (`/processos`) | admin, processos, produção |
| Admin (`/admin`) | admin |

A fonte da verdade no frontend é `src/types/roles.ts` (`ROLE_ROUTES`); cada
perfil é levado automaticamente para a própria tela inicial após o login. A
segurança real está no banco (RLS + checagem de papel dentro das RPCs).

Login é por **usuário**, não por e-mail: internamente o Supabase Auth usa
`<login>@interno.conceptus` (não altere esse domínio — os usuários existentes
dependem dele).

---

## Rodando localmente

Pré-requisitos: **Node 22** e npm 10+.

```bash
npm ci
cp .env.example .env      # preencha VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev               # http://localhost:8080
```

| Script | O que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | build de produção (gera também o service worker do PWA) |
| `npm run preview` | serve o build localmente |
| `npm run type-check` | checagem de tipos TypeScript |
| `npm run lint` | ESLint |
| `npm test` | testes (Vitest) |

### Variáveis de ambiente

Veja `.env.example`. Obrigatórias: `VITE_SUPABASE_URL` e
`VITE_SUPABASE_PUBLISHABLE_KEY` (chave **pública** anon — nunca a service_role).
Opcionais: `VITE_COMPANY_*` (dados impressos nos PDFs), `VITE_LICENSED_TO`,
`VITE_SENTRY_DSN`, `VITE_ENABLE_SYSTEM_HEALTH`. Na Vercel, `CRON_SECRET`.

---

## Banco de dados (Supabase)

As migrations ficam em `supabase/migrations/` e são **idempotentes** (podem
ser reaplicadas). Projeto novo:

```bash
supabase link --project-ref <project-ref>
bash supabase/DEPLOY_ALL_MIGRATIONS.sh   # = supabase db push
```

Projeto já existente: a revisão de set/2026 foi integrada ao **final** de
`20260046000000_desenhos_tecnicos.sql` (seção "REVISÃO GERAL"). Se esse arquivo
já tinha sido aplicado, copie a seção e execute no SQL Editor.

Primeiro administrador: crie o usuário em *Authentication → Users* com e-mail
`admin@interno.conceptus` e rode no SQL Editor:

```sql
UPDATE public.user_roles SET role = 'admin' WHERE user_id = '<id do usuário>';
UPDATE public.profiles   SET login = 'admin', approved = true WHERE user_id = '<id do usuário>';
```

### Edge Functions (`supabase/functions/`)

| Função | Uso | Secrets |
|---|---|---|
| `admin-create-user` | cria usuário (tela Admin → Usuários) | automáticos do Supabase |
| `admin-reset-password` | redefine senha de usuário | automáticos do Supabase |
| `sefaz-emitir` | emite NF-e/NFC-e | `SEFAZ_PFX_BASE64`, `SEFAZ_PFX_SENHA`, `SEFAZ_CNPJ`, `SEFAZ_RAZAO_SOCIAL`, `SEFAZ_IE`, `SEFAZ_UF`, `SEFAZ_C_MUN`, `SEFAZ_MUNICIPIO`, `SEFAZ_LOGRADOURO`, `SEFAZ_NUMERO`, `SEFAZ_BAIRRO`, `SEFAZ_CEP`, `SEFAZ_CRT`, `SEFAZ_TP_AMB` (2 = homologação) |
| `sefaz-emitir-devolucao` | NF-e de devolução/troca | mesmos da `sefaz-emitir` |
| `gs1-api` | consulta/cadastro GTIN na GS1 Brasil | `GS1_CLIENT_ID`, `GS1_CLIENT_SECRET`, `GS1_USERNAME`, `GS1_PASSWORD`, `GS1_ENV` |

Opcionais em todas: `ALLOWED_ORIGIN` / `ALLOWED_ORIGIN_REGEX` (restringir CORS)
e `DEBUG_EDGE_LOGS=true` (logs detalhados).

```bash
supabase functions deploy
supabase secrets set SEFAZ_TP_AMB=2 ...
```

> As funções `delete-account` e `import-devices` foram removidas do código (não
> eram chamadas pelo app). Se ainda estiverem publicadas no projeto, remova:
> `supabase functions delete delete-account` e `supabase functions delete import-devices`.

---

## Evitar que o Supabase pause (plano Free)

Projetos Free são pausados após ~7 dias sem atividade. Há duas camadas de
proteção que chamam a função `public.keep_alive()` (grava um heartbeat em
`system_heartbeat`, não expõe dados):

1. **GitHub Actions** — `.github/workflows/supabase-keepalive.yml`, a cada 2 dias.
   Configure em *Settings → Secrets and variables → Actions*:
   `SUPABASE_URL` e `SUPABASE_ANON_KEY`. Teste em *Actions → Supabase keep-alive → Run workflow*.
2. **Vercel Cron** — `api/keep-alive.js`, 1×/dia (definido em `vercel.json`).
   Usa as mesmas variáveis `VITE_SUPABASE_*` da Vercel; defina `CRON_SECRET`
   para que só a Vercel consiga chamar o endpoint.

O GitHub desliga workflows agendados em repositórios sem commits por 60 dias —
por isso a segunda camada.

---

## Deploy (Vercel)

- Framework: **Vite** · Build: `npm run build` · Output: `dist`
- Variáveis: as do `.env.example`
- `vercel.json` define rewrites da SPA, cabeçalhos de segurança (CSP, HSTS,
  X-Frame-Options…), cache dos assets e o cron do keep-alive.

---

## Estrutura

```
api/                      função serverless da Vercel (keep-alive)
public/                   ícones do PWA, robots.txt, guia-de-uso.pdf
src/
  components/             UI por módulo (admin, stock, comercial, financeiro, producao, qualidade, ui)
  hooks/                  useAuth, useStock, useOfflineSync, useNotifications…
  integrations/supabase/  cliente e tipos gerados do banco
  lib/                    utilitários (tema, PDFs, validações, BrasilAPI, logger…)
  pages/                  uma página por rota
  types/                  tipos compartilhados (roles, device, comercial)
  __tests__/, test/       testes (Vitest)
supabase/
  migrations/             schema, RLS e RPCs (idempotentes)
  functions/              Edge Functions (Deno)
.github/workflows/        keep-alive do Supabase
```

Tipos do banco: após mudar o schema, regenere com
`supabase gen types typescript --project-id <ref> > src/integrations/supabase/types.ts`.

---

## Segurança — resumo

- RLS habilitado em todas as tabelas; escrita sensível só via RPCs `SECURITY DEFINER` com checagem de papel.
- A chave anon (pública, vai no bundle) **não executa nenhuma função** além de `keep_alive`.
- Edge Functions de admin validam o JWT e o papel `admin` no banco.
- CSP restritiva na Vercel; fontes self-hosted (nenhuma requisição a Google Fonts).
- Sessão offline só para a UI; toda operação real exige token válido no servidor.
