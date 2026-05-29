# Relatório de Auditoria de Segurança — CORRIGIDO
**Data auditoria:** 29/05/2026  
**Data correção:** 29/05/2026  
**Status:** ✅ Todos os 7 pontos corrigidos

---

## Resultado Final: APROVADO

| # | Vulnerabilidade | Risco | Status | Arquivo(s) |
|---|---|---|---|---|
| SEG-01 | SSRF via webhook URL | Médio | ✅ Corrigido | `Financeiro.tsx` |
| SEG-02 | RPCs sem auth.uid() guard | Médio | ✅ Corrigido | Migration 016 |
| SEG-03 | pdfjs-dist CVE-2024-4367 | Médio | ✅ Corrigido | `package.json` + `ExcelStockImport.tsx` |
| SEG-04 | error.message em toasts | Baixo | ✅ Corrigido | `Financeiro.tsx` + `errorMessages.ts` |
| SEG-05 | Upload sem MIME check | Baixo | ✅ Corrigido | `AdminDevices.tsx` + `ExcelStockImport.tsx` |
| SEG-06 | Capacitor sem HTTPS | Baixo | ✅ Corrigido | `capacitor.config.ts` |
| SEG-07 | Sem rate limit server-side | Médio | ✅ Corrigido | Migration 017 |

---

## Detalhes de cada correção

### SEG-01 — SSRF via Webhook URL
**Arquivo:** `src/pages/Financeiro.tsx`  
**Correção:** Função `isWebhookUrlSafe()` valida:
- Protocolo HTTPS obrigatório
- Bloqueio de: `localhost`, `127.x`, `10.x`, `192.168.x`, `172.16-31.x`, `169.254.x`, `*.local`, `0.0.0.0`
- Validação aplicada tanto no save quanto no teste

### SEG-02 — RPCs SECURITY DEFINER sem auth guard
**Migration:** `20260016000000_security_rpc_guards.sql`  
**Funções corrigidas (7):**
- `increment_stock_quantity` → `RAISE EXCEPTION` se `auth.uid() IS NULL`
- `reserve_stock` → retorna erro JSON se não autenticado
- `stock_movement_atomic` → guard + validação de tipo e qty
- `cancel_pedido` → guard + check de role (admin OU vendedora dona)
- `faturar_pedido` → guard + verifica role `admin`/`financeiro`
- `sync_stock_items_from_devices` → guard + `is_admin_user()`
- `get_lotes_intermediario` → `WHERE auth.uid() IS NOT NULL`

### SEG-03 — pdfjs-dist CVE-2024-4367
**Arquivos:** `package.json`, `src/components/stock/ExcelStockImport.tsx`  
**Correção:** `pdfjs-dist@^3.11.174` → `^4.4.168` (CVE corrigido na v4.2.67+)  
**API:** Worker atualizado de URL string para import ESM `?url` (API v4)

### SEG-04 — error.message exposto em toasts
**Arquivos:** `src/pages/Financeiro.tsx`, `src/lib/errorMessages.ts`  
**Correção:** Todos os `toast.error("... " + error.message)` substituídos por `friendlyError(err)`.  
`friendlyError()` melhorado: em produção retorna apenas mensagem genérica; em dev mostra detalhes completos incluindo `code`, `details` e `hint` do PostgrestError.

### SEG-05 — Upload valida só extensão, sem MIME
**Arquivos:** `src/components/admin/AdminDevices.tsx`, `src/components/stock/ExcelStockImport.tsx`  
**Correção:** Adicionada validação `file.type` com allowlist de MIMEs válidos para cada tipo de arquivo (JSON, CSV, XLSX/XLS). Arquivo rejeitado se `file.type` não vazio e fora da lista.

### SEG-06 — Capacitor sem HTTPS
**Arquivo:** `capacitor.config.ts`  
**Correção:**
```ts
server: { androidScheme: 'https', allowNavigation: ['*.supabase.co'] }
ios: { limitsNavigationsToAppBoundDomains: true }
```

### SEG-07 — Sem rate limit server-side (DDoS)
**Migration:** `20260017000000_ddos_rate_limiting.sql`  
**Implementação:** Tabela `rate_limit_log` com sliding window de 60s e limpeza automática por trigger.  
**Limites por ação:**
| Ação | Limite | Janela |
|---|---|---|
| `stock_movement_atomic` | 60 req | 60s |
| `reserve_stock` | 20 req | 60s |
| `cancel_pedido` | 10 req | 60s |
| `faturar_pedido_sefaz` | 5 req | 60s |
| `marcar_pedido_pronto` | 30 req | 60s |
| `import_devices` | 3 req | 5min |

Rate limit integrado nas RPCs: `stock_movement_atomic`, `cancel_pedido`, `faturar_pedido_sefaz`.

---

## Testes pendentes (requerem ambiente de execução)
| Teste | Ferramenta |
|---|---|
| Penetration test das Edge Functions | OWASP ZAP / Burp Suite |
| Bypass de RLS via SQL crafted | pgTAP |
| JWT manipulation / algorithm confusion | jwt_tool |
| Session fixation após password reset | Manual |
| Timing attack em login (user enumeration) | script curl |
| PDF malicioso pós-upgrade pdfjs v4 | PoC CVE-2024-4367 |
