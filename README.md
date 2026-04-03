# Concept Usinagens Especiais

Base de dados de dispositivos dentários com conformidade ANVISA.

## Tecnologias

- React + TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- Supabase (banco de dados, autenticação, storage)

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

## Variáveis de ambiente (Edge Functions)

Adicione no painel do Supabase → Edge Functions → Secrets:

- `RESEND_API_KEY` — chave da API do [Resend](https://resend.com) para envio de emails transacionais
- `HOOK_SECRET` — segredo para verificar webhooks do Supabase (Authentication → Hooks)

## Configurar o hook de email no Supabase

Em **Authentication → Hooks**, aponte para a Edge Function `auth-email-hook` e configure o `HOOK_SECRET` como chave.
