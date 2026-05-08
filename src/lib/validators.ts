/**
 * SEG-06: Input validators for client data.
 * Validates CPF/CNPJ and email format before persisting to the database.
 */

/** Returns true if email is empty/omitted or matches a basic email pattern. */
export function validarEmail(e: string): boolean {
  return !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/** Returns true if documento is empty/omitted or is a valid CPF (11 digits) or CNPJ (14 digits). */
export function validarDocumento(d: string): boolean {
  const digits = d.replace(/\D/g, "");
  return !d || digits.length === 11 || digits.length === 14;
}
