# Guia de Contribuição e Boas Práticas

## Padrões de Código

### TypeScript
- Tipagem explícita em interfaces e retornos de função
- Evitar `as any` — usar interfaces tipadas para retornos do Supabase
- Preferir `unknown` a `any` em `catch (e: unknown)`

### Nomenclatura
```typescript
// Componentes: PascalCase
export function PedidoCard() {}

// Hooks: camelCase com prefixo use
export function useStock() {}

// Funções utilitárias: camelCase descritivo
export function sanitizeQuery(raw: string): string {}

// Constantes: SCREAMING_SNAKE_CASE
const MAX_BODY_BYTES = 20 * 1024 * 1024;

// Interfaces: PascalCase sem prefixo I
interface PedidoItem {}
```

### Comentários
- **Comentar o "por quê"**, não o "o quê"
- Remover tags de tracking (BUG-XX, CODE-XX) — usar CHANGELOG.md
- JSDoc em funções utilitárias exportadas
- Comentários de segurança obrigatórios em validações

```typescript
// ❌ Ruim
const q = s.trim().slice(0, 200); // trim e slice

// ✅ Bom
// Limita a 200 chars para evitar queries absurdamente longas no PostgREST
const q = s.trim().slice(0, 200);
```

---

## Segurança — Regras Obrigatórias

### Todo input do usuário deve ser sanitizado antes de:
1. Ir para uma query Supabase → usar `sanitizeQuery()`
2. Ser interpolado em HTML → usar `escHtml()`
3. Ser salvo como nome de arquivo → sanitizar caracteres especiais

### Nunca:
- Usar `eval()`, `Function()`, ou `innerHTML` com dados do usuário
- Armazenar senhas, tokens ou secrets no localStorage
- Fazer fetch para URLs fornecidas pelo usuário sem validar com `isWebhookUrlSafe()`
- Usar `===` para comparar HMACs (usar `crypto.subtle.verify`)

---

## Estrutura de Commits

```
tipo(escopo): descrição curta em português

Exemplos:
feat(estoque): adicionar filtro por fase na listagem
fix(auth): corrigir redirecionamento de roles novos
security(edge): adicionar rate limiting por IP
refactor(lib): centralizar lógica de paginação
test(validators): adicionar casos de CPF inválido
docs: atualizar README com novos módulos
```

---

## Adicionando Novos Roles

Ao adicionar um role, atualizar **obrigatoriamente** estes 4 arquivos:

1. `src/types/roles.ts` — tipo `AppRole`, `APP_ROLES`, `ROLE_LABELS`, `ROLE_ROUTES`
2. `src/components/AppShell.tsx` — array `NAV_ITEMS` com roles permitidos
3. `src/App.tsx` — `RoleGuard` nas rotas e `IndexRoute` para redirecionamento
4. `supabase/functions/admin-create-user/index.ts` — lista `validRole`

E executar: `npm run test` para garantir que `roles.test.ts` passa.

---

## Adicionando Edge Functions

```typescript
// Template mínimo para nova Edge Function
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

// Rate limit por IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(ip: string, max = 20, windowMs = 60_000): boolean {
  const now = Date.now();
  const e = rateLimitMap.get(ip);
  if (!e || now > e.resetAt) { rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs }); return true; }
  if (e.count >= max) return false;
  e.count++; return true;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });

  // Rate limit
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(ip)) return new Response(JSON.stringify({ error: "Too many requests" }), { status: 429, headers: corsHeaders });

  // Body size limit
  const buf = await req.arrayBuffer();
  if (buf.byteLength > 16 * 1024) return new Response(JSON.stringify({ error: "Body too large" }), { status: 413, headers: corsHeaders });

  // Validar JWT
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  // ... resto da lógica
});
```

---

## Testes

### Executar todos os testes
```bash
npm run test
```

### Ao criar nova funcionalidade
Adicionar testes em `src/__tests__/` cobrindo:
- Caso feliz (comportamento esperado)
- Casos de borda (string vazia, null, valores extremos)
- Casos de segurança (XSS, SQL injection, valores maliciosos)

### Ao corrigir um bug
Adicionar teste que reproduz o bug **antes** de corrigi-lo.

