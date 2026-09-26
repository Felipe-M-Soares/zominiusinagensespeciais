# Testes de carga

| Teste | Onde roda | Para quê |
|---|---|---|
| `banco/rodar.sh` | Postgres local temporário | Valida o banco (migrations, regras, gatilhos, travas) com N usuários simultâneos. Não toca no Supabase. |
| `k6-50-usuarios.js` | Contra um projeto Supabase | Mede o sistema real (API, autenticação, rede, banco) com 50 usuários. |

```bash
# local (precisa do PostgreSQL instalado)
bash testes-carga/banco/rodar.sh 50 120

# real (precisa do k6: https://k6.io/docs/get-started/installation/)
k6 run -e SUPABASE_URL=... -e SUPABASE_ANON_KEY=... -e USUARIOS="email:senha" testes-carga/k6-50-usuarios.js
# depois, no SQL Editor: testes-carga/limpar-dados-teste.sql
```

Use um usuário de teste com papel **produção**. Prefira rodar num projeto cópia ou fora do horário de trabalho.
