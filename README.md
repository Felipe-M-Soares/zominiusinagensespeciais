# Zomini ERP

Sistema de gestão (PWA) da Zomini Usinagens Especiais: estoque, produção,
qualidade, comercial e financeiro.

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Backend | Supabase |
| Hospedagem | Vercel |
| Testes | Vitest |

## Desenvolvimento

Pré-requisitos: **Node 22** e npm 10+.

```bash
npm ci
cp .env.example .env   # preencha com os valores do ambiente
npm run dev
```

| Script | O que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | build de produção |
| `npm run preview` | serve o build localmente |
| `npm run type-check` | checagem de tipos |
| `npm run lint` | ESLint |
| `npm test` | testes |

As variáveis de ambiente estão descritas em `.env.example`. Nunca commite o
arquivo `.env`.

## Estrutura

```
api/                   funções serverless (Vercel)
public/                ícones e arquivos estáticos
src/
  components/          interface por módulo
  hooks/               hooks React
  integrations/        cliente do backend
  lib/                 utilitários
  pages/               uma página por rota
  types/               tipos compartilhados
supabase/
  migrations/          schema do banco
  functions/           Edge Functions
.github/workflows/     rotinas automáticas
```

## Deploy, banco e configuração

Instruções de implantação, criação de administrador, secrets e manutenção
ficam no **documento interno de operação**, fora deste repositório. Solicite
ao responsável técnico.

## Segurança

Encontrou um problema de segurança? Não abra issue pública — comunique
diretamente o responsável técnico.
