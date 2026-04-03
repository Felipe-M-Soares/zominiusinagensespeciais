# Concept Usinagens Especiais

Base de dados de dispositivos dentários com conformidade ANVISA.

## Tecnologias

- React + TypeScript
- Vite
- Tailwind CSS
- shadcn/ui

## Setup local

```sh
git clone <YOUR_GIT_URL>
cd <YOUR_PROJECT_NAME>
npm install
npm run dev
```

## Build para produção

```sh
npm run build
```

## App Android (Capacitor)

```sh
npx cap add android
npm run build
npx cap sync android
npx cap open android
```

## Migração: Remoção de dependências Lovable

Este projeto foi migrado para remover dependências do Lovable:

### O que foi removido
- `@lovable.dev/cloud-auth-js` — pacote NPM removido de `package.json`
- `src/integrations/lovable/` — pasta inteira removida
- `npm:@lovable.dev/email-js` — da Edge Function `auth-email-hook`
- `npm:@lovable.dev/webhooks-js` — da Edge Function `auth-email-hook`

### O que foi substituído
- **`auth-email-hook`**: Reescrita para usar verificação de assinatura nativa (Web Crypto API) e envio de email via **Resend** (`RESEND_API_KEY`)
- **OAuth Google**: Já usava `supabase.auth.signInWithOAuth` diretamente — nenhuma mudança necessária

### Variáveis de ambiente necessárias na Edge Function
Adicione no painel do Supabase → Edge Functions → Secrets:
- `RESEND_API_KEY` — chave da API do [Resend](https://resend.com) para envio de emails
- `HOOK_SECRET` — segredo para verificar webhooks do Supabase (substitui `LOVABLE_API_KEY`)

### Configurar o hook no Supabase
Em Authentication → Hooks, aponte para a Edge Function `auth-email-hook` e use o `HOOK_SECRET` como chave.
