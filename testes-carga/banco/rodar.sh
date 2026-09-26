#!/usr/bin/env bash
# Teste de carga do BANCO, 100% local (não toca no Supabase real).
# Cria um Postgres temporário, aplica TODAS as migrations do projeto, gera
# 50 usuários + 6 meses de histórico e simula uso simultâneo.
#
# Requisitos: PostgreSQL 15+ instalado (initdb, pg_ctl, psql, pgbench no PATH).
# Uso:  bash testes-carga/banco/rodar.sh [usuarios=50] [segundos=120]
set -euo pipefail
USUARIOS="${1:-50}"; SEG="${2:-120}"
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"; AQUI="$RAIZ/testes-carga/banco"
TMP="$(mktemp -d)"; PORTA=55432
trap 'pg_ctl -D "$TMP/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
initdb -D "$TMP/data" -U postgres -A trust >/dev/null
pg_ctl -D "$TMP/data" -o "-p $PORTA -k $TMP -c max_connections=$((USUARIOS + 20))" -l "$TMP/log" start >/dev/null
PSQL="psql -h $TMP -p $PORTA -U postgres -q -v ON_ERROR_STOP=1"
$PSQL -c "CREATE DATABASE carga" >/dev/null
$PSQL -d carga -f "$AQUI/stub-supabase.sql" >/dev/null 2>&1
for f in "$RAIZ"/supabase/migrations/*.sql; do echo "migration: $(basename "$f")"; $PSQL -d carga -f "$f" >/dev/null 2>"$TMP/err" || { cat "$TMP/err"; exit 1; }; done
$PSQL -d carga -f "$AQUI/seed.sql" >/dev/null
cd "$AQUI"
B="pgbench -h $TMP -p $PORTA -U postgres -n -j 2"
echo; echo "== ESTRESSE: $USUARIOS usuários sem pausa por ${SEG}s =="
$B -c "$USUARIOS" -T "$SEG" -f lancar.sql@3 -f abrir_diario.sql@5 -f desempenho.sql@1 -f editar.sql@1 -f parada.sql@1 carga | grep -E "processed|^number of failed|^latency average|^tps"
echo; echo "== USO REAL: $USUARIOS usuários, 1 ação a cada 10s cada, por ${SEG}s =="
$B -c "$USUARIOS" -T "$SEG" --rate "$(( USUARIOS / 10 ))" -f lancar.sql@3 -f abrir_diario.sql@5 -f desempenho.sql@1 -f editar.sql@1 -f parada.sql@1 carga | grep -E "processed|^number of failed|^latency average|^tps"
echo; echo "== INTEGRIDADE =="
$PSQL -d carga -Atc "SELECT 'lotes duplicados: ' || count(*) FROM (SELECT lote FROM apontamentos_producao WHERE lote NOT LIKE 'L%' GROUP BY lote HAVING count(*) > 1) d;
                     SELECT 'paradas sem apontamento: ' || count(*) FROM apontamento_paradas p LEFT JOIN apontamentos_producao a ON a.id = p.apontamento_id WHERE a.id IS NULL;"
grep -cE "deadlock|ERROR" "$TMP/log" | sed 's/^/erros no log do banco: /'
