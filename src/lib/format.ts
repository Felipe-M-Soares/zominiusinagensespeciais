/**
 * src/lib/format.ts
 *
 * Formatadores compartilhados. Antes desta unificação, a mesma formatação de
 * moeda BRL (Intl.NumberFormat via toLocaleString) estava reimplementada de
 * forma idêntica em 5 arquivos diferentes (Financeiro.tsx, TabelaPrecos.tsx,
 * pedidoPdf.ts, FluxoCaixaPanel.tsx, DevolucaoTrocaPanel.tsx) — cada um com
 * seu próprio nome de função (fmtCurrency, fmtMoeda, BRL...). Centralizar
 * aqui evita divergência de comportamento entre telas e reduz código repetido.
 */
export function formatBRL(v: number): string {
  return (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
