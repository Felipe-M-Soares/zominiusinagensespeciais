/**
 * SEG-06 / BUG-02 FIX: Input validators for client data.
 * Validates CPF/CNPJ with full digit verification (not just length),
 * and email format before persisting to the database.
 */

/** Returns true if email is empty/omitted or matches a basic email pattern. */
export function validarEmail(e: string): boolean {
  return !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/**
 * BUG-02 FIX: Valida CPF com verificação dos dígitos verificadores.
 * Antes, apenas o comprimento era verificado — aceitava "00000000000" como válido.
 */
function validarCPF(digits: string): boolean {
  // Rejeita sequências óbvias como 000.000.000-00, 111.111.111-11, etc.
  if (/^(\d)\1{10}$/.test(digits)) return false;

  // Primeiro dígito verificador
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += +digits[i] * (10 - i);
  let remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== +digits[9]) return false;

  // Segundo dígito verificador
  sum = 0;
  for (let i = 0; i < 10; i++) sum += +digits[i] * (11 - i);
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  return remainder === +digits[10];
}

/**
 * BUG-02 FIX: Valida CNPJ com verificação dos dígitos verificadores.
 */
function validarCNPJ(digits: string): boolean {
  // Rejeita sequências repetidas
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const calc = (d: string, weights: number[]) => {
    const sum = weights.reduce((acc, w, i) => acc + +d[i] * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  return calc(digits, w1) === +digits[12] && calc(digits, w2) === +digits[13];
}

/**
 * Returns true if documento is empty/omitted or is a valid CPF (11 digits) or CNPJ (14 digits).
 * Full digit-verification is performed — not just length check.
 */
export function validarDocumento(d: string): boolean {
  if (!d || !d.trim()) return true;
  const digits = d.replace(/\D/g, "");
  if (digits.length === 11) return validarCPF(digits);
  if (digits.length === 14) return validarCNPJ(digits);
  return false;
}
