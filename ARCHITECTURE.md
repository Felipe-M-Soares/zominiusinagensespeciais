# Arquitetura do Sistema — Zomini Usinagens Especiais

## Diagrama de Alto Nível

```
┌─────────────────────────────────────────────────────────┐
│                    USUÁRIO / BROWSER                     │
│              React SPA (PWA + Capacitor)                │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS / WebSocket
┌────────────────────────▼────────────────────────────────┐
│                      VERCEL CDN                          │
│  Static Assets + Security Headers (CSP, HSTS, etc.)    │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                     SUPABASE                             │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │   Auth JWT  │  │  PostgreSQL  │  │    Storage    │  │
│  │  + Realtime │  │  + RLS/RPCs  │  │ (manuais,     │  │
│  └─────────────┘  └──────────────┘  │  backups)     │  │
│                                      └───────────────┘  │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Edge Functions (Deno)               │   │
│  │  admin-create-user │ auto-approve │ import-devs  │   │
│  │  auth-email-hook   │ admin-reset  │ delete-acct  │   │
│  └──────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│               INTEGRAÇÕES EXTERNAS                       │
│   Resend (email)  │  GS1 Brasil  │  Sentry (erros)     │
└─────────────────────────────────────────────────────────┘
```

---

## Fluxo de Autenticação

```
1. Usuário digita login + senha
2. useAuth.signIn() → supabase.auth.signInWithPassword()
3. Supabase valida e retorna JWT
4. fetchRoleAndApproval() busca role e status em paralelo
5. Role determina quais rotas são acessíveis (RoleGuard)
6. Realtime WebSocket monitora mudanças de status (bloqueio/aprovação)
```

---

## Fluxo de Criação de Pedido Comercial

```
1. Vendedora seleciona cliente + peças + quantidades
2. criarPedidoComReserva() (pedidoUtils.ts)
   a. INSERT pedidos_comerciais
   b. INSERT pedido_itens (rollback do pedido se falhar)
   c. RPC reserve_stock() para cada item (atômico no banco)
3. Peças ficam com quantity_reserved incrementado
4. Admin (estoque) separa fisicamente e fatura
5. Status → "faturado", quantity decrementado definitivamente
```

---

## Fluxo de Estoque por Lote

```
Recebimento → Intermediária → Expedição → Venda/Entrega
                    ↕
                Retrabalho (defeito detectado)
```

Cada movimentação é registrada em `stock_movements` com:
- `stock_item_id` (referência ao item)
- `lote` (rastreabilidade)
- `type` (entrada/saída)
- `quantity`
- `fase` (intermediaria/expedicao/retrabalho)

---

## Banco de Dados — Tabelas Principais

| Tabela | Descrição |
|--------|-----------|
| `devices` | Catálogo de dispositivos médicos |
| `devices_regularizacao` | Pipeline ANVISA (fases 1-5) |
| `stock_items` | Itens em estoque por fase |
| `stock_movements` | Histórico de movimentações |
| `pedidos_comerciais` | Pedidos de vendedoras |
| `pedido_itens` | Itens de cada pedido |
| `clientes` | Cadastro de clientes |
| `profiles` | Perfis de usuário (login, display_name) |
| `user_roles` | Role de cada usuário |
| `apontamentos_producao` | Registros de produção |
| `ordens_planejamento` | Ordens de produção planejadas |
| `contas_bancarias` | Contas e configurações financeiras |
| `pedidos_financeiro` | Pedidos no módulo financeiro |

---

## Edge Functions

| Função | Responsabilidade | Auth requerida |
|--------|-----------------|----------------|
| `admin-create-user` | Cria usuário + role + perfil | Admin JWT |
| `admin-reset-password` | Redefine senha de usuário | Admin JWT |
| `auto-approve` | Auto-aprovação após 55s | Próprio usuário JWT |
| `import-devices` | Importação CSV/JSON/ANVISA | Admin JWT |
| `delete-account` | Remove conta completa | Admin JWT |
| `auth-email-hook` | Templates de email transacional | Webhook secret HMAC |

---

## Padrões de Código

### Paginação Supabase
O Supabase retorna máximo 1000 rows por query. Para datasets maiores:
```typescript
// Usar fetchAllPages() de supabaseUtils.ts
const items = await fetchAllPages<MyType>("minha_tabela", "created_at");

// Ou para somas, usar sumColumnPaginated()
const total = await sumColumnPaginated("stock_items", "quantity", {
  column: "quantity", operator: "gt", value: 0
});
```

### Sanitização de Input
```typescript
// Buscas de texto → sanitizeQuery()
import { sanitizeQuery } from "@/lib/sanitize";
const safe = sanitizeQuery(userInput);
query.ilike("model", `%${safe}%`);

// Templates HTML → escHtml()
import { escHtml } from "@/lib/escHtml";
const html = `<td>${escHtml(item.nome)}</td>`;
```

### Roles em Componentes
```typescript
// Nunca hardcodar strings de role — importar do tipo canônico
import type { AppRole } from "@/types/roles";
import { ROLE_LABELS } from "@/types/roles";

// Verificar via useAuth()
const { isAdmin, role } = useAuth();
if (!isAdmin && role !== "estoque") return null;
```

---

## Decisões de Arquitetura

### Por que Supabase?
- PostgreSQL gerenciado com RLS (Row Level Security) nativo
- Auth + Storage + Realtime em um só serviço
- Edge Functions em Deno (TypeScript nativo, sem cold start significativo)
- Plano gratuito generoso para MVP, escala facilmente

### Por que Vite + React (SPA) em vez de Next.js?
- Sistema interno — SEO não é requisito
- SPA simplifica o deploy (arquivos estáticos na Vercel)
- Code splitting manual no Vite dá controle total sobre chunks

### Por que PWA + Capacitor?
- Produção precisa funcionar offline (sem internet no chão de fábrica)
- Capacitor permite distribuir como APK Android sem loja
- PWA installable no desktop também

### Por que não usar localStorage para sessão?
- Supabase gerencia sessão em cookie httpOnly automaticamente
- localStorage seria acessível por JS (XSS poderia roubar sessão)

