/**
 * src/lib/cfop.ts
 *
 * Detecção de UF do cliente a partir de um endereço em texto livre, e
 * adaptação do CFOP para intra/interestadual (5xxx → 6xxx quando a operação
 * cruza fronteira estadual).
 *
 * Antes desta unificação, essa lógica estava duplicada quase que
 * identicamente em dois lugares (Financeiro.tsx > initDados, e
 * PedidosEstoquePanel.tsx > handleImprimir) — cada um com sua própria regex,
 * ligeiramente diferente uma da outra. Isso é um risco real: uma mudança de
 * regra em um lugar não se propaga para o outro, então o mesmo pedido podia,
 * em teoria, ser classificado como intra/interestadual de forma diferente
 * dependendo da tela. Centralizar aqui garante que as duas telas usem
 * exatamente a mesma regra.
 */

const UF_EMPRESA_PADRAO = "SP";

/** Extrai a sigla de UF (2 letras maiúsculas) de um endereço em texto livre. */
export function detectarUF(endereco: string | null | undefined): string | null {
  const e = endereco ?? "";
  // Formatos: "... São Paulo/SP ...", "... — SP ...", "/SP", "SP — CEP", "-SP"
  const m = e.match(/[\s/\-,]([A-Z]{2})(?:\s|$|—|\s*CEP)/);
  if (m) return m[1];
  // Fallback: sigla ao final, ex. "... Indaiatuba/SP"
  const m2 = e.match(/\/([A-Z]{2})/);
  if (m2) return m2[1];
  return null;
}

/**
 * Adapta um CFOP base (tipicamente 5xxx, venda dentro do estado) para o
 * equivalente interestadual (6xxx) quando a UF do cliente diverge da UF do
 * emitente. CFOPs de operação com exterior (6xxx/7xxx) já informados são
 * mantidos como estão.
 */
export function adaptarCFOP(
  cfopOriginal: string | null | undefined,
  ufCliente: string | null,
  ufEmpresa: string = UF_EMPRESA_PADRAO,
  cfopPadrao = "5102",
): string {
  const isInterestadual = !!ufCliente && ufCliente !== ufEmpresa;
  const c = (cfopOriginal ?? cfopPadrao).toString().trim();
  if (!c || c === "—") return isInterestadual ? "6" + cfopPadrao.slice(1) : cfopPadrao;
  if (c.startsWith("6") || c.startsWith("7")) return c;
  if (isInterestadual && c.startsWith("5")) return "6" + c.slice(1);
  return c;
}
