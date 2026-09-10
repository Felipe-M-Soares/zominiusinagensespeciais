# sefaz-emitir

Edge Function de integração SEFAZ NF-e / NFC-e. Assinatura digital via Web
Crypto API nativa do Deno (RSA-SHA1 conforme SEFAZ). Ambiente padrão:
Homologação (`SEFAZ_TP_AMB=2`).

## Deploy

```
supabase functions deploy sefaz-emitir
```

## Secrets obrigatórios

Configurar com `supabase secrets set KEY=VALUE`:

| Secret | Descrição |
|---|---|
| `SEFAZ_PFX_BASE64` | Certificado A1 em base64 (`base64 -i cert.pfx`) |
| `SEFAZ_PFX_SENHA` | Senha do `.pfx` |
| `SEFAZ_CNPJ` | 14 dígitos, sem pontuação |
| `SEFAZ_RAZAO_SOCIAL` | Razão social do emitente |
| `SEFAZ_IE` | Inscrição estadual (ou `ISENTO`) |
| `SEFAZ_UF` | UF emitente, ex.: `SP` |
| `SEFAZ_C_MUN` | Código IBGE do município, ex.: `3550308` |
| `SEFAZ_MUNICIPIO` | Nome do município |
| `SEFAZ_LOGRADOURO` | Endereço do emitente |
| `SEFAZ_NUMERO` | Número do endereço |
| `SEFAZ_BAIRRO` | Bairro |
| `SEFAZ_CEP` | 8 dígitos, sem hífen |
| `SEFAZ_CRT` | `1` = Simples Nacional \| `3` = Regime Normal |
| `SEFAZ_TP_AMB` | `2` = Homologação \| `1` = Produção |
| `ALLOWED_ORIGIN` | Domínio do frontend (ou `*` em dev) |
| `DEBUG` | `true` para logar XML de resposta |

**Antes de trocar `SEFAZ_TP_AMB` para `1` (produção):** validar uma emissão
completa em homologação, incluindo o fluxo de devolução/troca
(`sefaz-emitir-devolucao`).
