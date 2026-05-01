// Helpers compartilhados para validação e formatação de lotes
// Formato aceito: DDMMYYS-NN ou DDMMYYS-NN/A (ex: 0101261-01 ou 0101261-01/A)

export const LOTE_REGEX = /^\d{7}-\d{2}([/][A-Za-z])?$/;

export function formatLote(raw: string): string {
  let v = raw.toUpperCase().replace(/[^0-9\-/A-Z]/g, "");
  if (/^\d{8,}/.test(v)) v = v.slice(0, 7) + "-" + v.slice(7);
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
