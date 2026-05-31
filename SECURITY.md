# Política de Segurança — Zomini Usinagens Especiais

## Visão Geral

Este documento descreve as medidas de segurança implementadas no sistema, os vetores de ataque protegidos e os procedimentos de resposta a incidentes.

---

## Medidas Implementadas

### Autenticação e Autorização

| Medida | Implementação |
|--------|---------------|
| JWT validado server-side | Todas as Edge Functions validam o token via `userClient.auth.getUser()` antes de qualquer operação |
| Roles verificados no banco | `user_roles` consultado com service role key — não confia no client |
| Rate limiting no login | 5 tentativas / 60s com backoff exponencial (dobra a cada falha, cap 5 min) |
| Rate limiting nas APIs | 10 req/min (admin-create-user), 5 req/5min (auto-approve) por IP |
| must_change_password | Novos usuários criados com flag — obrigados a trocar no 1º acesso |
| Bloqueio de conta | Admin pode bloquear usuário; bloqueio impede auto-aprovação e login |

### Proteção contra Injeção

| Vetor | Proteção |
|-------|----------|
| XSS em templates HTML | `escHtml()` em todos os campos antes de `document.write()` |
| SQL/PostgREST injection | `sanitizeQuery()` em todas as buscas de texto livre |
| Prototype pollution | JSON.parse apenas em contextos controlados, sem `Object.assign` de input externo |
| Path traversal | Nomes de arquivo sanitizados (`safeFilename`) antes de download |

### Proteção contra DDoS

| Vetor | Proteção |
|-------|----------|
| Body grande | Limite de 4–8KB nas Edge Functions antes do `req.json()` |
| Upload de arquivo | Limite de 20MB por arquivo (Excel/PDF/CSV) |
| Linhas excessivas | Limite de 10.000 linhas por importação |
| Requisições em massa | Rate limiting por IP em todas as Edge Functions |
| Brute force login | Backoff exponencial + lock client-side |

### Cabeçalhos HTTP (vercel.json)

```
Content-Security-Policy        — default-src 'self', sem eval
Strict-Transport-Security      — max-age=63072000; includeSubDomains; preload
X-Frame-Options                — DENY (anti-clickjacking)
X-Content-Type-Options         — nosniff
Cross-Origin-Opener-Policy     — same-origin (anti-Spectre/XS-Leaks)
Cross-Origin-Resource-Policy   — same-origin
Referrer-Policy                — strict-origin-when-cross-origin
Permissions-Policy             — camera=(), microphone=(), geolocation=(), payment=()
X-Robots-Tag                   — noindex, nofollow (sistema interno)
```

### Webhook SSRF

O webhook de integração (Financeiro) é validado antes de salvar e antes de chamar:
- Protocolo obrigatório: `https:`
- IPs internos bloqueados: `127.x`, `10.x`, `192.168.x`, `172.16-31.x`, `169.254.x`, `localhost`

### Assinatura de Webhook

O hook de email do Supabase usa comparação de HMAC com `crypto.subtle.verify()` (constant-time) — não usa `===` (vulnerável a timing attacks).

---

## Variáveis Sensíveis

| Variável | Onde fica | Nunca vai para |
|----------|-----------|----------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Secrets | Frontend, logs, respostas |
| `RESEND_API_KEY` | Supabase Secrets | Frontend |
| `HOOK_SECRET` | Supabase Secrets | Frontend |
| `ALLOWED_ORIGIN` | Supabase Secrets | Frontend |
| `VITE_SUPABASE_URL` | Vercel Env | Código-fonte |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Vercel Env | Código-fonte (anon key — pública por design) |

---

## Configuração Obrigatória em Produção

```bash
# Supabase → Edge Functions → Manage secrets
ALLOWED_ORIGIN=https://seu-dominio.com.br   # NUNCA deixar como *
RESEND_API_KEY=re_...
HOOK_SECRET=v1,whsec_...
ROOT_DOMAIN=seu-dominio.com.br
FROM_EMAIL=noreply@seu-dominio.com.br
```

---

## Reportar Vulnerabilidade

Encontrou uma vulnerabilidade? Entre em contato diretamente com o responsável técnico antes de divulgar publicamente. Não abra issues públicas com detalhes de segurança.

---

## Histórico de Auditorias

| Data | Escopo | Resultado |
|------|--------|-----------|
| 2026-05-31 | Auditoria completa: XSS, DDoS, timing attacks, injeção, roles | 135/135 testes, score 82/100 |

