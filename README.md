<div align="center">
  <h1>🔧 Zomini Usinagens Especiais</h1>
  <p><strong>Sistema de Gestão Industrial — Dispositivos Médicos</strong></p>
  <p>
    <img src="https://img.shields.io/badge/React-18.3-61DAFB?logo=react" />
    <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript" />
    <img src="https://img.shields.io/badge/Supabase-2.98-3ECF8E?logo=supabase" />
    <img src="https://img.shields.io/badge/Vite-8.0-646CFF?logo=vite" />
    <img src="https://img.shields.io/badge/Testes-135%2F135-22c55e" />
  </p>
</div>

---

## Visão Geral

Sistema web completo de gestão industrial para a **Zomini Usinagens Especiais**, fabricante de dispositivos médicos implantáveis de alta precisão (parafusos, implantes e componentes ortopédicos em titânio e aço cirúrgico).

O sistema cobre todo o ciclo operacional: **componentes ANVISA → estoque → produção → comercial → financeiro → qualidade**, com rastreabilidade total por lote, conformidade regulatória e operação offline.

---

## Módulos do Sistema

| Módulo | Descrição | Acesso |
|--------|-----------|--------|
| **Componentes** | Catálogo de dispositivos com UDI, GTIN, dados ANVISA e documentação | estoque, qualidade, producao, admin |
| **Estoque** | Controle por lote e fase (intermediária, expedição, retrabalho), movimentações, dashboard | estoque, qualidade, admin |
| **Qualidade** | Pipeline de regularização ANVISA (4 fases), rastreamento UDI, integração GS1 | qualidade, admin |
| **Comercial** | Pedidos por conta de vendedora, clientes, reserva automática de estoque, exportação Excel | comercial, admin |
| **Financeiro** | Emissão de NF-e, controle bancário, faturamento, webhook de integração | financeiro, admin |
| **Produção** | Apontamento de produção, planejamento, máquinas, paradas, qualidade industrial, relatórios | producao, admin |
| **Admin** | Gestão de usuários, dispositivos, importação CSV/Excel/JSON, backup | admin |

---

## Perfis de Acesso (Roles)

| Role | Módulos acessíveis |
|------|--------------------|
| `admin` | Tudo |
| `estoque` | Componentes, Estoque |
| `qualidade` | Componentes, Estoque, Qualidade |
| `comercial` | Comercial (isolado por conta — cada usuário vê só seus pedidos) |
| `financeiro` | Financeiro |
| `producao` | Componentes, Produção |

---

## Stack Tecnológica

### Frontend
- **React 18** + **TypeScript 5** — SPA com tipagem estrita
- **Vite 8** — build ultra-rápido com code splitting por domínio
- **Tailwind CSS** + **shadcn/ui** — design system consistente
- **React Router 6** — roteamento client-side com guards por role
- **TanStack Query 5** — cache e sincronização de estado servidor
- **PWA** (vite-plugin-pwa) — instalável, funciona offline

### Backend
- **Supabase** (PostgreSQL 15) — banco relacional com RLS por row
- **Supabase Auth** — autenticação JWT com refresh automático
- **Supabase Edge Functions** (Deno) — lógica server-side segura
- **Supabase Realtime** — atualizações em tempo real via WebSocket
- **Supabase Storage** — armazenamento de manuais, catálogos e backups

### Integrações
- **Resend** — envio de emails transacionais (confirmação, recovery)
- **ExcelJS** — exportação de relatórios `.xlsx`
- **GS1 Brasil** — verificação e cadastro de GTIN/EAN
- **Capacitor** — empacotamento Android (PWA nativo)

---

## Arquitetura

```
src/
├── components/
│   ├── admin/          # Gestão de usuários e dispositivos
│   ├── producao/       # Painéis do módulo de produção
│   ├── stock/          # Modais e painéis do estoque
│   └── ui/             # Componentes shadcn/ui
├── hooks/
│   ├── useAuth.tsx     # Contexto de autenticação + roles
│   ├── useStock.ts     # Estado e operações do estoque
│   └── useOfflineSync.ts # Sincronização offline (IndexedDB)
├── lib/
│   ├── escHtml.ts      # Sanitização XSS para templates HTML
│   ├── logger.ts       # Logger centralizado (console + Sentry)
│   ├── lote.ts         # Validação e formatação de lotes
│   ├── pedidoUtils.ts  # Criação atômica de pedidos
│   ├── sanitize.ts     # Sanitização de queries PostgREST
│   ├── supabaseUtils.ts # Paginação e busca no Supabase
│   └── validators.ts   # Validação de CPF, CNPJ, email
├── pages/
│   ├── Comercial.tsx   # Módulo comercial completo
│   ├── Estoque.tsx     # Módulo de estoque
│   ├── Financeiro.tsx  # Módulo financeiro
│   ├── Producao.tsx    # Módulo de produção
│   └── Qualidade.tsx   # Módulo de qualidade/ANVISA
└── types/
    └── roles.ts        # Definição canônica dos roles
```

---

## Instalação e Desenvolvimento

### Pré-requisitos
- Node.js 20.x
- npm 10+
- Projeto Supabase criado

### Configuração local

```bash
git clone <URL_DO_REPOSITÓRIO>
cd zominiusinagensespeciais

# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp .env.example .env.local
# Editar .env.local com suas credenciais

# Iniciar servidor de desenvolvimento
npm run dev
```

### Variáveis de ambiente (`.env.local`)

```env
VITE_SUPABASE_URL=https://SEU_PROJECT_ID.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sua_anon_key
VITE_SENTRY_DSN=https://...@sentry.io/...   # opcional
```

---

## Scripts disponíveis

```bash
npm run dev        # Servidor de desenvolvimento (localhost:8080)
npm run build      # Build de produção
npm run preview    # Preview do build de produção
npm run test       # Executa todos os testes (135 testes)
npm run lint       # ESLint
```

---

## Deploy na Vercel

Ver **[DEPLOY.md](./DEPLOY.md)** para guia completo.

Resumo:
1. Conectar repositório na Vercel
2. Configurar variáveis de ambiente
3. Deploy automático a cada push na branch `main`

---

## Testes

```bash
npm run test
# 10 arquivos, 135 testes — todos passando
```

Cobertura:
- Autenticação e autorização
- Roles e permissões
- Validação de CPF/CNPJ (dígitos verificadores)
- Sanitização XSS e SQL injection
- Força de senha
- Segurança: XSS, injeção, rate limiting, timing attacks
- Operações de estoque (saldo por lote)

---

## Segurança

Ver **[SECURITY.md](./SECURITY.md)** para política completa.

Destaques:
- JWT validado server-side em todas as Edge Functions
- Rate limiting por IP (10 req/min para operações admin)
- Body size limit em todas as endpoints (proteção DDoS)
- Cabeçalhos HTTP de segurança (CSP, HSTS, COOP, X-Frame-Options)
- Sanitização XSS em todos os templates de impressão
- CPF/CNPJ validados com dígitos verificadores
- Backoff exponencial no login

---

## Licença

Proprietário — Zomini Usinagens Especiais. Todos os direitos reservados.
