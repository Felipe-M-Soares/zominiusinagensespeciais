# Auditoria e revisão — setembro/2026

Resumo do que foi encontrado e corrigido. Tudo foi validado com `tsc` (0 erros),
ESLint (0 erros), Vitest (117 testes), `vite build` e aplicação de **todas as
migrations em um Postgres limpo** com stubs de `auth`/`storage` do Supabase.

## 1. Falhas que quebravam o app ou o deploy

| # | Problema | Correção |
|---|---|---|
| 1 | **Deploy do banco falhava em projeto novo**: `20260029_seguranca.sql` criava policies em `apontamentos_producao`, tabela que só nasce em `20260030_producao.sql` (`relation does not exist`). | Bloco de policies de produção movido para o fim de `20260030_producao.sql` (idempotente). |
| 2 | **Build de tipos quebrado** (`tsc`): RPC `remove_pedido_item` não existia em `types.ts`; tipos listavam overloads e funções já removidas do banco. | `types.ts` alinhado às migrations. |
| 3 | **Hook React chamado condicionalmente** em `ComercialPanel` (`useConfirmEnter` depois de um `return`) — erro de runtime se a permissão mudasse. | Hooks movidos para antes do early-return. |
| 4 | **Excluir usuário falhava** para quem já criou pedido/lançamento: várias FKs para `auth.users` sem `ON DELETE`. | FKs convertidas para `ON DELETE SET NULL` (histórico preservado). |
| 5 | **Página "Guia de uso" nunca exibia o PDF**: CSP `object-src 'none'` + `X-Frame-Options: DENY` no próprio PDF. | CSP ajustada e cabeçalho específico para o PDF. |
| 6 | **Sentry bloqueado pela CSP** (domínio de ingestão ausente). | Domínios `*.ingest.sentry.io` liberados em `connect-src`. |
| 7 | Filtro de ano de Produção/Metas fixo até **2027**. | Lista de anos gerada dinamicamente. |
| 8 | Painéis de Produção quebravam (tela "Algo deu errado") se a RPC voltasse sem dados. | Checagens defensivas. |

## 2. Segurança e vazamento de dados

| # | Problema | Correção |
|---|---|---|
| 1 | **Funções expostas à chave pública (anon)**: qualquer pessoa com a URL + anon key (que está no JavaScript do site) podia chamar `calcular_oee`, `resumo_mensal_producao`, `get_lotes_intermediario`, `peek_next_nf_number` e **`get_next_nf_number` — "queimando" números de NF-e** — além de `sync_stock_items_from_devices`/`atualizar_status_*`. | `EXECUTE` revogado do `anon`/`PUBLIC` em todas as funções do schema `public` (exceto `keep_alive`), e padrão futuro ajustado. `get_next_nf_number` agora exige usuário aprovado. |
| 2 | Buckets `devices-images` e `email-assets` permitiam **listar todos os arquivos sem login**. | Listagem só autenticada (URLs públicas continuam funcionando). |
| 3 | Admin excluía cliente apagando **todos os pedidos, inclusive faturados com NF-e**, sem devolver reservas de estoque (corrompia `quantity_reserved`). | `excluirClienteSeguro()`: recusa se houver pedido não cancelado. |
| 4 | Sem role (ou falha ao buscá-lo) o app assumia **"estoque"** para qualquer usuário. | Fail-closed + cache do último role por usuário (continua funcionando offline). |
| 5 | Perfis Comercial/Financeiro/Processos caíam na tela **Componentes**, que não é deles. | Cada perfil vai para a própria tela inicial; `RoleGuard` idem. |
| 6 | `admin-create-user`: checagem de login com `ILIKE` (`_` é curinga → falso "login em uso"); usuário ficava órfão se o perfil falhasse; mensagens internas do servidor devolvidas ao navegador. | `.eq`, rollback do usuário no Auth, mensagens genéricas + log. |
| 7 | Edge Functions **`delete-account` e `import-devices` sem uso** e com `verify_jwt = false` (superfície de ataque desnecessária). | Removidas do código e do `config.toml`. |
| 8 | Campos NCM/CFOP interpolados sem escape em janelas de impressão (HTML). | `escHtml` aplicado. |
| 9 | Script de deploy citava uma senha padrão (`Admin@2024`) que não existe mais. | Instruções corrigidas. |
| 10 | Dados órfãos: `profiles`/`user_roles` sem usuário, `rate_limit_log` antigo, overloads antigos de funções. | Limpeza idempotente na migration. |

## 3. Supabase sem pausar (plano Free)

`public.keep_alive()` + tabela `system_heartbeat`, chamados por:
- GitHub Actions (`.github/workflows/supabase-keepalive.yml`) a cada 2 dias, com retry;
- Vercel Cron (`api/keep-alive.js`) diariamente, protegido por `CRON_SECRET`.

Configuração: secrets `SUPABASE_URL` e `SUPABASE_ANON_KEY` no GitHub.

## 4. Design e usabilidade

- **Modo escuro corrigido**: `--muted-foreground` era branco (98%) e `--muted` cinza 45% — não havia hierarquia de texto. Paleta nova com neutros levemente frios, bordas mais leves e sombras suaves.
- **Contraste**: botão primário (ciano) passou no WCAG AA para texto branco.
- **Abas dos módulos** (PageNav/StockNav): rótulos legíveis (13px, antes 8–9px e escondidos no celular), nomes completos ("Intermediário", "Retrabalho", "Recebimento"), acessíveis por teclado (setas/Home/End) e com a aba ativa rolando para a vista.
- **Tamanho mínimo de texto** elevado para 10px em todo o app (≈100 ocorrências de 8–9px).
- **Login redesenhado**: segue o tema claro/escuro, erro exibido no formulário, aviso de Caps Lock, aviso de "sem internet", botões acessíveis; painel lateral com a identidade laranja da Zomini.
- **Toasts no celular** voltaram a mostrar o texto (antes só um ícone — a mensagem de erro ficava escondida) e seguem o tema do app (antes `next-themes` sem provider).
- **Menu lateral**: mostra o nome do usuário (não o e-mail interno), lembra se estava recolhido, tooltips para todos os itens recolhidos, estado ativo consistente, `Esc` fecha o menu mobile, `aria-current`/`aria-label`.
- **Cadastro de cliente**: máscara de CPF/CNPJ e telefone, validação de dígito verificador e **preenchimento automático pelo CNPJ** (BrasilAPI/Receita). CEP via BrasilAPI com fallback ViaCEP.
- `prefers-reduced-motion` respeitado; foco visível por teclado.

## 5. Performance e ferramentas

- **Fontes self-hosted** (`@fontsource-variable`: Inter, Space Grotesk, JetBrains Mono) em vez de 5 famílias do Google Fonts: sem bloqueio de renderização, funciona offline no PWA e sem enviar IP a terceiros (LGPD). Removidas Lato e EB Garamond (sem uso real).
- **Precache do PWA 5,1 MB → 3,0 MB**: Excel/PDF/html2canvas carregam só quando usados.
- Logo em WebP (128 KB → 20 KB).
- Fundo com gradiente único (antes 4 gradientes com `background-attachment: fixed`, que forçava repaint no scroll em celulares).
- Dependências removidas: `next-themes`, `@testing-library/react`, `@tailwindcss/typography` (sem uso).

## 6. Arquivos removidos (sem uso)

`public/sw.js` (conflitava com o SW gerado pelo vite-plugin-pwa), `public/site.webmanifest` e o manifest em base64 do `index.html` (duplicavam o manifest gerado, com nome "Concept"), `public/placeholder.svg`, `public/favicon.png` (cópia do ícone 512), `src/App.css`, `logo_concept*.png`, `logo_zomini_dark.png` (idêntico ao principal), 48 imports não usados, e testes "espelho" que testavam cópias das funções em vez do código real.

## 7. README

Não existia README no projeto. Criado com setup, variáveis (`.env.example`),
perfis/rotas, migrations, Edge Functions e seus secrets, keep-alive e deploy.
Também adicionados `.gitignore` (não havia — risco de commitar `.env`).

## 8. Recomendações (não aplicadas — exigem decisão ou acesso externo)

- **Guia de uso (PDF)** está desatualizado: não cita o módulo Processos e usa nomes antigos de abas do Financeiro/Estoque. Regerar o PDF.
- **Separar páginas gigantes** (`Financeiro.tsx` 3.5 mil linhas, `PedidosEstoquePanel.tsx` 2.9 mil) em componentes menores e migrar os `fetch` manuais para **TanStack Query** (já instalado e quase sem uso) — cache, retry e revalidação automáticos.
- **ExcelJS (945 KB)** → avaliar `write-excel-file`/SheetJS para exportações simples; manter ExcelJS só para importação.
- **Atualizações maiores**: React 19, Tailwind 4, Recharts 3, Sentry 10, `@vitejs/plugin-react` 6 (bloqueado hoje por conflito de peer do Babel com o Workbox) — cada uma pede teste manual dedicado.
- `admin_create_user` (SQL) insere direto em `auth.users` sem `auth.identities`; o app usa a Edge Function, então a RPC pode ser removida.
- Ativar **"Leaked password protection"** e **MFA para admin** no Supabase Auth.
- Restringir CORS das Edge Functions com `ALLOWED_ORIGIN` (domínio de produção + previews).
