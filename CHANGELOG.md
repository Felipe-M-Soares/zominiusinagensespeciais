# Changelog — Zomini Usinagens Especiais

## [Auditoria 2026-05-31]

### Críticos corrigidos
- **P0-01**: Edge function `admin-create-user` não inseria `user_roles` para roles != "admin"
- **P0-02**: Rollback parcial adicionado em `pedidoUtils.ts` quando insert de itens falha
- **BUG-03**: `prazoEntrega` faltava no destructuring de `pedidoUtils.ts` causando ReferenceError
- **BUG-02**: `profile` não existia em `useAuth()` mas era usado em `Producao.tsx` causando crash

### Segurança corrigida
- **SEC-03**: Validação de CPF/CNPJ agora verifica dígitos verificadores (algoritmo Receita Federal)
- **SEC-01**: Comentário de segurança adicionado ao CORS — ALLOWED_ORIGIN deve ser configurado

### Qualidade corrigida
- **DUP-01**: Funções `esc()` locais substituídas por import de `escHtml` centralizado
- **DUP-02**: Loops de paginação inline em `Qualidade.tsx` usam helpers centralizados
- **QUA-03**: `finally { setLoading(false) }` adicionado onde ausente
- **ARQ-03**: Aviso de sincronização adicionado em `supabase/types.ts`

### Performance
- **PERF-04**: Migration SQL criada com funções aggregate `get_total_stock_quantity()` e `get_devices_regularizacao_counts()`

### Roles
- Roles antigos (`funcionario`, `vendedora`) substituídos pelos novos 6 roles em todos os arquivos
- Navegação filtrada por role em `AppShell.tsx`
- Redirecionamento automático por role em `App.tsx`

## Pendente (requer ação manual)
- Configurar `ALLOWED_ORIGIN` no painel do Supabase
- Mover `token_api` de NF-e para Supabase Vault
- Executar migration SQL no Supabase para funções aggregate
- Deploy de `admin-create-user` edge function após correção P0-01
- Atualizar `pdfjs-dist` de 3.11 para 4.x+
