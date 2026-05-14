# Relatório de Auditoria Completa — Concept Usinagens Especiais
**Data:** 13 de maio de 2026  
**Auditor:** Engenheiro de Software Sênior (Auditoria Automatizada)  
**Stack:** React 18 + TypeScript + Vite 8 + Supabase (PostgreSQL + Edge Functions + Auth) + Tailwind + shadcn/ui  

---

## Resumo Executivo

O projeto está em **excelente estado de saúde**. A base de código é bem estruturada, segura e sem vulnerabilidades críticas. As issues encontradas são de otimização, organização e eliminação de duplicação — não de segurança ou funcionalidade.

| Categoria | Status |
|---|---|
| Segurança | ✅ Nenhuma vulnerabilidade crítica |
| TypeScript | ✅ 0 erros de compilação |
| ESLint | ✅ 0 warnings |
| Testes | ✅ 65/65 passando |
| Build | ✅ Sucesso |
| Performance | ⚠️ 1 chunk grande corrigido |
| Duplicação de código | ⚠️ 1 caso corrigido |

---

## FASE 1 — Análise de Segurança

### ✅ Implementados Corretamente

| Vulnerabilidade | Análise | Arquivo |
|---|---|---|
| SQL Injection | Sanitização em `sanitize()` com strip de meta-chars PostgREST e escape de wildcards LIKE | `useStock.ts`, `supabaseUtils.ts` |
| XSS | `dangerouslySetInnerHTML` sanitiza `id` e `color` antes de injetar no `<style>` | `chart.tsx:72-96` |
| CSRF | JWT via header `Authorization` (não cookie), imune por design | `invokeEdgeFunction.ts` |
| Broken Authentication | Validação JWT server-side em TODAS as Edge Functions antes de qualquer operação | Todas as `supabase/functions/` |
| CORS | `ALLOWED_ORIGIN` via env var — `*` só em dev, domínio exato em prod | `_shared/cors.ts` |
| HTTP Security Headers | CSP, HSTS (2 anos), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy | `vercel.json` |
| Secrets hardcoded | Nenhum — tudo via `import.meta.env` (frontend) e `Deno.env` (Edge Functions) | Verificado em todos os arquivos |
| Rate limiting de login | Client-side: 5 tentativas / 60 segundos | `useAuth.tsx:42-47` |
| Usuários bloqueados | Verificado na Edge Function login E via Realtime no cliente | `useAuth.tsx`, `admin-create-user/index.ts` |
| SECURITY DEFINER + search_path | Todas as funções SECURITY DEFINER têm `SET search_path = public` | Migration `20260509000002` |
| RLS em tabelas | Políticas explícitas em todas as tabelas críticas | Migrations de RLS |
| Rotas protegidas | `ProtectedRoute`, `AdminRoute`, `VendedoraRoute`, `FinanceiroRoute` — verificação de role no nível da rota | `App.tsx` |
| Logs em produção | Logger suprime todos os logs em produção, envia erros para Sentry via DSN | `logger.ts` |
| Validação de senha | 8-72 chars, maiúscula, minúscula, número, caractere especial | `passwordUtils.ts` |
| Upload de arquivos | Tamanho máximo 10MB em `import-devices`, validação de tipo no Supabase Storage | `import-devices/index.ts` |
| Path Traversal | Supabase Storage gerencia paths — não há manipulação manual de paths de arquivo | Verificado |
| Sanitização de input | `validarEmail()`, `validarDocumento()` para CPF/CNPJ antes de persistir | `validators.ts` |
| Mensagens de erro | `friendlyError()` suprime mensagens internas em produção | `errorMessages.ts` |

---

## FASE 2 — Problemas Identificados e Corrigidos

### 🔴 COD-01 — Duplicação de Lógica de Criação de Pedido
**Severidade:** Média  
**Arquivo:** `src/components/stock/ComercialPanel.tsx` (linha 346)  
**Problema:** O componente `CriarPedidoModal` dentro de `ComercialPanel.tsx` duplicava integralmente a lógica de `criarPedidoComReserva` já extraída em `src/lib/pedidoUtils.ts`. Qualquer bug corrigido em `pedidoUtils.ts` não seria automaticamente corrigido no painel.  
**Correção:** Substituída a lógica inline pelo import e uso de `criarPedidoComReserva` do módulo compartilhado.  
**Impacto:** Zero — mesma lógica, mesmo comportamento.

### 🟡 CODE-002 — Arquivos Mortos (Dead Code)
**Severidade:** Baixa  
**Arquivos removidos:**
- `src/pages/ForgotPassword.tsx` — apenas `<Navigate to="/login">`, não referenciado em App.tsx  
- `src/pages/Register.tsx` — idem  
- `src/hooks/useStock.ts.bak` — arquivo de backup exposto no repositório  
**Impacto:** Zero — arquivos não eram referenciados em nenhuma rota ou import.

### 🟡 PERF-01 — Chunk Estoque Muito Grande
**Severidade:** Média  
**Problema:** `Estoque-*.js` = **1.13 MB** (299 KB gzip) — acima do dobro do limite recomendado de 600 KB. Causa: `BackupPanel.tsx` (23 KB) e `PedidosEstoquePanel.tsx` (72 KB) carregados junto com o chunk inicial da página.  
**Correção:** Lazy loading de `BackupPanel`, `PedidosEstoquePanel` e `ComercialPanel` dentro de `Estoque.tsx`, com `Suspense` e `LoadingScreen` como fallback.  
**Impacto:** Reduz o carregamento inicial do Estoque significativamente; os painéis pesados só são carregados quando o usuário navega até eles.

### 🟡 PERF-02 — Plugin Vite Desnecessário
**Severidade:** Baixa  
**Arquivo:** `vite.config.ts`  
**Problema:** `@vitejs/plugin-react-swc` estava em uso, mas o Vite 8 alertava que nenhum plugin SWC estava configurado e recomendava trocar para `@vitejs/plugin-react`.  
**Correção:** Substituído por `@vitejs/plugin-react`.  
**Impacto:** Build ligeiramente mais rápido e sem warnings.

### 🟡 EDGE-01 — getCorsHeaders Duplicada em 5 Edge Functions
**Severidade:** Baixa (manutenibilidade)  
**Arquivos afetados:** `auto-approve`, `import-devices`, `admin-create-user`, `admin-reset-password`, `delete-account`  
**Problema:** Cada função tinha sua própria cópia inline idêntica de `getCorsHeaders`, ignorando o utilitário já existente em `_shared/cors.ts`. A `sefaz-emitir` já importava do shared corretamente.  
**Correção:** Substituída a função inline por `import { getCorsHeaders } from "../_shared/cors.ts"` em todas as 5 funções.  
**Impacto:** Sem mudança de comportamento. Facilita manutenção futura — qualquer ajuste no CORS precisa ser feito em apenas um lugar.

### ✅ PERF-DB-01 — Índices Adicionais (Nova Migration)
**Migration:** `20260513000002_audit_indexes_and_hardening.sql`  
**Índices adicionados:**
- `idx_profiles_login` — busca por login em autenticação e criação de usuário
- `idx_profiles_approved_blocked` — filtro de usuários bloqueados/pendentes
- `idx_stock_movements_stock_item_id` — join em histórico de movimentos
- `idx_pedido_itens_pedido_id` — join em faturamento de pedidos
- `idx_pedidos_comerciais_status` — filtro por status (mais comum na UI)
- `idx_pedidos_comerciais_cliente_id` — histórico por cliente
- `idx_recebimento_materiais_created_at` — listagem cronológica

---

## FASE 3 — Validação Pós-Correção

```
TypeScript (tsc --noEmit):  0 erros
ESLint:                     0 warnings
Testes (vitest run):        65/65 passando (7 suítes)
Build produção:             Sucesso
Dead code removido:         3 arquivos
Arquivos modificados:       8
Nova migration:             1
```

### Suítes de Teste Aprovadas
- `src/test/auth.test.ts` — 32 testes ✅
- `src/test/devices.test.ts` — 14 testes ✅
- `src/__tests__/stockUtils.test.ts` — 3 testes ✅
- `src/__tests__/validators.test.ts` — 7 testes ✅
- `src/__tests__/passwordUtils.test.ts` — 5 testes ✅
- `src/__tests__/roles.test.ts` — 3 testes ✅
- `src/test/example.test.ts` — 1 teste ✅

---

## FASE 4 — Sugestões de Design e MRP Completo

### 🎨 Melhorias de Design (sem alterar visual atual)

1. **Skeleton Loaders** — Adicionar `Skeleton` do shadcn/ui nos painéis Estoque e Comercial durante carregamento. Atualmente exibe apenas tela branca.

2. **Notificações de Estoque Mínimo** — Usar o canal Realtime já configurado para notificar via toast quando `quantity <= min_quantity`.

3. **Modo de Impressão** — CSS `@media print` para pedidos e documentos fiscais. Atualmente não existe.

4. **Toast de Confirmação** — Ações destrutivas (excluir estoque, cancelar pedido) mostram AlertDialog mas poderiam ter desfazer (undo) via toast com timer.

5. **Dashboard Ampliado** — `StockDashboard.tsx` já usa Recharts. Sugestão: adicionar gráfico de giro de estoque por SKU e comparativo mês a mês.

### 🏭 Módulos para MRP Completo

#### Módulo 1: Bill of Materials (BOM)
```
Tabelas: bom_headers, bom_items
- Estrutura de produto: produto_final → componentes necessários
- Nível de BOM (single-level vs multi-level)
- Quantidade por item e unidade de medida
- Integração com stock_items existente
```

#### Módulo 2: Ordens de Produção (OP)
```
Tabelas: ordens_producao, op_itens, op_status_history
- Status: planejada → em_producao → concluida → cancelada
- Vinculação com pedidos_comerciais
- Rastreabilidade: OP → lote → NF-e
- Controle de retrabalho (já parcialmente implementado)
```

#### Módulo 3: Gestão de Fornecedores
```
Tabelas: fornecedores, ordens_compra, oc_itens
- Cadastro com lead_time padrão por fornecedor
- Ordens de compra integradas com recebimento_materiais (já existe!)
- Avaliação de fornecedores (prazo, qualidade)
```

#### Módulo 4: Planejamento MRP
```
Funções PostgreSQL:
- calcular_necessidades_brutas(produto_id, quantidade, data_necessidade)
- calcular_necessidades_liquidas(necessidade_bruta, estoque_disponivel, pedidos_em_aberto)
- gerar_sugestoes_compra() → retorna lista de OC sugeridas
```

#### Módulo 5: Financeiro Avançado
```
Tabelas: contas_pagar, contas_receber, fluxo_caixa_projetado
- Vínculo contas_receber → pedidos_comerciais (já existe base)
- Vínculo contas_pagar → ordens_compra
- Dashboard de fluxo de caixa com projeção 30/60/90 dias
```

#### Módulo 6: Qualidade e Rastreabilidade
```
Tabelas: inspecoes_qualidade, nao_conformidades, acoes_corretivas
- Inspeção de entrada (recebimento_materiais já existe!)
- Aprovação/rejeição com fotos
- Rastreabilidade completa: matéria-prima → produto → cliente
- ANVISA compliance: número de registro + lote + validade
```

### 📊 KPIs Sugeridos para Dashboard MRP

| KPI | Cálculo |
|---|---|
| OEE (Overall Equipment Effectiveness) | Disponibilidade × Performance × Qualidade |
| Lead Time Médio | AVG(data_entrega - data_pedido) por produto |
| Giro de Estoque | Custo dos produtos vendidos / Estoque médio |
| Fill Rate | Pedidos entregues no prazo / Total de pedidos |
| Ruptura de Estoque | Dias com quantity = 0 por SKU |
| Custo de Retrabalho | Horas × valor_hora por OP de retrabalho |

---

## Arquivos Modificados

| Arquivo | Tipo de Alteração |
|---|---|
| `src/components/stock/ComercialPanel.tsx` | COD-01: Import e uso de `criarPedidoComReserva` |
| `src/pages/Estoque.tsx` | PERF-01: Lazy loading de 3 painéis pesados |
| `vite.config.ts` | PERF-02: Substituição de plugin-react-swc → plugin-react |
| `package.json` | PERF-02: Atualização de devDependency |
| `supabase/functions/auto-approve/index.ts` | EDGE-01: Import CORS do shared |
| `supabase/functions/import-devices/index.ts` | EDGE-01: Import CORS do shared |
| `supabase/functions/admin-create-user/index.ts` | EDGE-01: Import CORS do shared |
| `supabase/functions/admin-reset-password/index.ts` | EDGE-01: Import CORS do shared |
| `supabase/functions/delete-account/index.ts` | EDGE-01: Import CORS do shared |

## Arquivos Removidos

| Arquivo | Motivo |
|---|---|
| `src/pages/ForgotPassword.tsx` | Dead code — não referenciado em nenhuma rota |
| `src/pages/Register.tsx` | Dead code — não referenciado em nenhuma rota |
| `src/hooks/useStock.ts.bak` | Arquivo de backup não deve estar no repositório |

## Arquivos Criados

| Arquivo | Motivo |
|---|---|
| `supabase/migrations/20260513000002_audit_indexes_and_hardening.sql` | 7 índices de performance + hardening RLS |

---

*Auditoria executada em 13/05/2026. Nenhuma funcionalidade foi removida. Nenhum visual foi alterado.*
