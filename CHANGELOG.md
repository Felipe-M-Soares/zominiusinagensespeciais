# Changelog — Zomini Usinagens Especiais

Todas as mudanças significativas são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

---

## [2.0.0] — 2026-05-31

### Adicionado
- Sistema de roles com 6 perfis: `admin`, `estoque`, `qualidade`, `comercial`, `financeiro`, `producao`
- Aba GS1 no módulo Qualidade com links diretos ao portal CNP e verificação de GTIN
- KPI "Total de Peças" no pipeline de qualidade (soma real do estoque via paginação)
- Rate limiting por IP nas Edge Functions (`admin-create-user`, `auto-approve`)
- Backoff exponencial no login após 5 tentativas (dobra a cada falha, cap 5 min)
- Cabeçalhos `Cross-Origin-Opener-Policy` e `Cross-Origin-Resource-Policy` contra XS-Leaks
- Limite de 20MB por arquivo e 10.000 linhas por importação Excel/PDF
- 29 testes de segurança cobrindo XSS, injeção, timing attacks, CPF/CNPJ
- Migrations SQL com funções aggregate `get_total_stock_quantity()` e `get_devices_regularizacao_counts()`
- Documentação completa: README, SECURITY, ARCHITECTURE, DEPLOY, CONTRIBUTING

### Corrigido
- **Crítico**: Edge function não inseria role no banco para usuários não-admin (apenas admin era salvo)
- **Crítico**: Timing attack em HMAC do webhook — substituído `===` por `crypto.subtle.verify()`
- **Crítico**: Body sem limite de tamanho nas Edge Functions (DDoS)
- CPF/CNPJ agora valida dígitos verificadores (algoritmo Receita Federal)
- Produção não carregava para admin (referência a `profile` inexistente em `useAuth`)
- Paginação Supabase em Qualidade.tsx mostrava exatamente 1000 peças (limite padrão)
- Campo prazo de entrega removido do modal de pedido (não era necessário)

### Removido
- Roles antigos: `funcionario`, `vendedora` — substituídos pelos 6 novos roles
- Comentários de tracking interno (BUG-XX, CODE-XX, PERF-XX) — movidos para este changelog
- Props `isAdmin` não utilizadas em `ControlePanel` e `RelatoriosPanel`
- Campo "Prazo de entrega" no modal de criação de pedido

### Segurança
- CORS `ALLOWED_ORIGIN` documentado como obrigatório (não deixar `*` em produção)
- Todas as funções `esc()` locais substituídas por `escHtml()` centralizado
- Loops de paginação duplicados substituídos por `fetchAllPages()` compartilhado
- Rollback parcial adicionado na criação de pedido (evita pedidos órfãos no banco)

---

## [1.5.0] — 2026-05-29

### Adicionado
- Validação de dígitos verificadores CPF/CNPJ
- Proteção SSRF no webhook financeiro (`isWebhookUrlSafe`)
- Limite de 5MB no upload de CSV (`StockCsvImport`)
- Rate limiting client-side no login (5 tentativas/60s)

### Corrigido
- `prazoEntrega` faltava no destructuring de `pedidoUtils.ts` — crash ao criar pedido
- `profile` não existia em `useAuth()` — crash em `Producao.tsx`
- Links GS1 com 404 — substituídos pelas URLs corretas do portal

---

## [1.0.0] — 2026-01-01

### Adicionado
- Módulo de componentes ANVISA com pipeline de regularização (fases 1-5)
- Módulo de estoque com controle por lote e fase
- Módulo comercial com reserva atômica de estoque
- Módulo financeiro com emissão NF-e
- Módulo de produção com apontamento offline (IndexedDB)
- PWA instalável com sincronização offline
- Autenticação por login interno (sem email externo)
- Importação de dispositivos via CSV, Excel e JSON ANVISA

