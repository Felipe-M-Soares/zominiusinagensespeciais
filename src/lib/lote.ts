// Helpers compartilhados para validação e formatação de lotes
// Formato aceito: DDMMYYS-NN ou DDMMYYS-NN/A (ex: 0101261-01 ou 0101261-01/A)
// TAMBÉM aceito: DDMMYY-NN ou DDMMYY-NN/A, sem o dígito de turno — usado para
// peças de terceiros (ex.: chaves) que não têm turno de produção próprio.
// Ex: 010126-01 ou 010126-01/A

export const LOTE_REGEX = /^\d{6,7}-\d{2}([/][A-Za-z])?$/;

export function formatLote(raw: string): string {
  let v = raw.toUpperCase().replace(/[^0-9\-/A-Z]/g, "");
  if (!v.includes("-")) {
    // 9+ dígitos seguidos: DDMMYYS (7) + pelo menos os 2 da sequência
    if (/^\d{9,}/.test(v)) v = v.slice(0, 7) + "-" + v.slice(7);
    // exatamente 8 dígitos seguidos: só pode ser DDMMYY (6, sem turno) + NN (2)
    else if (/^\d{8}$/.test(v)) v = v.slice(0, 6) + "-" + v.slice(6);
  }
  return v.slice(0, 13);
}

export function loteValido(lote: string): boolean {
  return LOTE_REGEX.test(lote);
}

/** Retorna "empty" | "valid" | "invalid" para uso em campos de formulário. */
export function loteStatus(lote: string): "empty" | "valid" | "invalid" {
  if (!lote) return "empty";
  return LOTE_REGEX.test(lote) ? "valid" : "invalid";
}

/** Conjunto de valores placeholder que não devem ser exibidos na UI. */
export const LOTE_INDEFINIDO = new Set(["a-definir", "a definir", "sem lote"]);

/**
 * Retorna o lote formatado para exibição, ou null se for placeholder.
 * Use em todo render: {displayLote(l.lote) ?? <fallback>}
 */
export function displayLote(lote: string | null | undefined): string | null {
  if (!lote) return null;
  const trimmed = lote.trim();
  if (LOTE_INDEFINIDO.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

/**
 * Normaliza o lote para comparação de duplicidade.
 * Ex.: 0101261-01 e 0101261-01/A pertencem ao mesmo lote-base.
 */
export function loteBase(lote: string | null | undefined): string {
  return (lote ?? "").trim().toUpperCase().replace(/\/[A-Z]$/, "");
}

export function mesmoLoteBase(a: string | null | undefined, b: string | null | undefined): boolean {
  const baseA = loteBase(a);
  const baseB = loteBase(b);
  return Boolean(baseA && baseB && baseA === baseB);
}
