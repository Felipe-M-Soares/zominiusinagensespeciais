# Changelog

Histórico de decisões técnicas e correções relevantes do projeto. Este arquivo
existe para tirar dos comentários inline do código as explicações de "o que
quebrava antes e por que a solução atual é assim" — o código mantém apenas um
resumo curto do "porquê atual"; o histórico completo do problema original fica
aqui.

- **Tipos do Supabase desatualizados (`types.ts`):** a função RPC
  `remove_pedido_item` existe e funciona no banco (criada em
  `20260029000000_seguranca.sql`), mas não estava no arquivo de tipos
  gerado, causando um falso erro de compilação em todo lugar que a chamava.
  Adicionada a assinatura correta manualmente. O ideal é rodar
  `supabase gen types typescript` contra o projeto real periodicamente para
  manter esse arquivo sincronizado — ele é gerado automaticamente e não
  deveria precisar de edição manual como esta.

## Código morto

- **`SepararLotesModal`** (`src/components/stock/SepararLotesModal.tsx`):
  encontrado sem nenhuma referência em todo o projeto durante a divisão de
  `PedidosEstoquePanel.tsx`. Mantido em arquivo próprio, marcado como não
  utilizado, para decisão consciente da equipe (reativar ou remover) em vez
  de apagar um recurso sem confirmação.

## Segurança

- **Token bancário em texto puro (Financeiro):** a coluna `token_api` de
  `financeiro_contas_bancarias` guardava o token de integração bancária sem
  criptografia. Migrada para o Supabase Vault; a coluna original foi
  removida. O frontend hoje só manipula `token_api_secret_id` (referência),
  nunca o valor real. Ver `supabase/migrations/20260040000000_correcoes_pendentes.sql`.
- **Políticas RLS abertas (`USING (true)`):** `financeiro_lancamentos`,
  `nfe_sequencia`, `pedidos_comerciais` e `pedido_itens` tinham policies que
  permitiam a qualquer usuário autenticado ler/gravar todas as linhas,
  independente do papel. Substituídas por checagens de papel via
  `has_any_role()`. Ver `supabase/migrations/20260043000000_seguranca_final_hardening.sql`.
- **Funções `SECURITY DEFINER` sem `search_path` fixo:**
  `resolve_ncm_device_by_id`, `get_total_stock_quantity` e
  `get_devices_regularizacao_counts` foram corrigidas com
  `ALTER FUNCTION ... SET search_path = public`. Ver
  `supabase/migrations/20260044000000_seguranca_revisao_final.sql`.
- **Rate limiting em memória nas Edge Functions administrativas:**
  `admin-create-user`, `admin-reset-password` e `delete-account` usavam um
  `Map` local, que não é confiável entre cold starts / múltiplas instâncias.
  Migrado para a função `check_rate_limit` (persistida em `rate_limit_log`),
  com uma chave sintética por IP (`ip_rate_limit_key`). Ver
  `supabase/migrations/20260048000000_rate_limit_edge_admin.sql`.
- **Mensagens de erro internas expostas ao cliente:** `admin-create-user` e
  `import-devices` devolviam `error.message` bruto do Postgres/Supabase no
  corpo da resposta. Padronizado para logar o detalhe no servidor e devolver
  uma mensagem genérica ao cliente, como já era feito em
  `admin-reset-password` e `delete-account`.

## Infraestrutura / build

- **CORS "Failed to send a request to the Edge Function":** a versão antiga
  de `_shared/cors.ts` devolvia `Access-Control-Allow-Origin: null` quando a
  origem não batia com o secret `ALLOWED_ORIGIN` — como esse secret raramente
  é atualizado com o domínio real do deploy (preview da Vercel, produção,
  domínio próprio), o preflight `OPTIONS` falhava e toda chamada de Edge
  Function quebrava. A correção faz o header sempre refletir a origem do
  request quando `ALLOWED_ORIGIN` não está configurado. A segurança dessas
  funções não depende do CORS — cada uma valida o JWT e o papel do usuário no
  banco antes de agir. **Configurar `ALLOWED_ORIGIN` em produção continua
  recomendado.**
- **`fetch()` direto trocado por `supabase.functions.invoke()`:** o `fetch()`
  disparava preflight CORS que dependia do secret `ALLOWED_ORIGIN` estar
  sincronizado com a URL do deploy. `supabase.functions.invoke()` usa o
  cliente oficial, envia o JWT automaticamente e o CDN do Supabase já trata o
  CORS para chamadas autenticadas via `apikey`.
- **Bug do Radix UI (pointer-events preso):** ao combinar `Dialog` +
  `AlertDialog` + `Select` na mesma tela (ex.: Admin › Usuários), fechar um
  modal podia deixar `pointer-events: none` preso no `<body>`, travando toda
  a interface até um F5. `PointerEventsWatchdog` (em `src/App.tsx`) observa o
  `<body>` e limpa o estilo quando não há modal de fato aberto.
- **Fallback de sessão offline:** `getSession()` do `supabase-js` tenta
  renovar o token contra o servidor quando ele expira; sem rede, isso falha e
  a função resolve com `session: null` mesmo com um `refresh_token` válido
  salvo localmente. `readRawSessionFromStorage()` lê a sessão direto do
  `localStorage` como rede de segurança, usada só quando
  `navigator.onLine === false`. Não substitui a validação real do servidor —
  é só para não deslogar um operador em campo por falta de conexão.

## Dependências

- `pdfjs-dist`, `nanoid`, `postcss-selector-parser`: atualizados via
  `npm audit fix` (correções não breaking).
- `react-router-dom`: mantido na 6.30.6 (última patch da linha 6.x). A
  vulnerabilidade remanescente só tem correção na v7, que quebra a API do
  `BrowserRouter` usada neste projeto (prop `future`); a migração para v7
  fica registrada como item de backlog dedicado, não uma correção pontual.
