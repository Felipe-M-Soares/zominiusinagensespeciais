#!/bin/bash
# =============================================================================
# Deploy todas as migrations de uma vez no Supabase (novo projeto)
# Uso: bash supabase/DEPLOY_ALL_MIGRATIONS.sh
#
# Pré-requisitos:
#   1. Instalar Supabase CLI: https://supabase.com/docs/guides/cli
#   2. Fazer login: supabase login
#   3. Linkar projeto: supabase link --project-ref SEU_PROJECT_REF
# =============================================================================

set -e

echo "🚀 Iniciando deploy de migrations..."
echo ""

# Verifica se supabase CLI está instalado
if ! command -v supabase &> /dev/null; then
  echo "❌ supabase CLI não encontrado."
  echo "   Instale em: https://supabase.com/docs/guides/cli/getting-started"
  exit 1
fi

# Push todas as migrations em ordem
supabase db push

echo ""
echo "✅ Migrations aplicadas com sucesso!"
echo ""
echo "📋 Próximos passos:"
echo "   1. Faça login no app com: login=admin / senha=Admin@2024"
echo "   2. Troque a senha IMEDIATAMENTE no primeiro acesso"
echo "   3. Configure as variáveis de ambiente no Vercel/hosting"
