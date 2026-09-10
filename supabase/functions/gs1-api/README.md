# gs1-api

Edge Function — proxy seguro para as APIs GS1 Brasil. Cobre 3 APIs:

- **CNP** (Cadastro Nacional de Produtos) — GET/POST/PATCH de produtos
- **Provider** (Verified by GS1) — GET `/provider/v2/verified`
- **Provider Other Keys** — GET `/provider-otherKeys/searchByKey`

Auth: OAuth 2.0 (`client_credentials` + `password`). O token é obtido na
primeira requisição e cacheado em memória por 55 minutos.

## Deploy

```
supabase functions deploy gs1-api
```

## Secrets obrigatórios

| Secret | Descrição |
|---|---|
| `GS1_CLIENT_ID` | `client_id` fornecido pela GS1 Brasil |
| `GS1_CLIENT_SECRET` | `client_secret` fornecido pela GS1 Brasil |
| `GS1_USERNAME` | E-mail cadastrado no CNP (cnp.gs1br.org) |
| `GS1_PASSWORD` | Senha do portal CNP |
| `GS1_ENV` | `producao` \| `homologacao` (default: `homologacao`) |
| `ALLOWED_ORIGIN` | Domínio do frontend |
