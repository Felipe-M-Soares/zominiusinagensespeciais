/**
 * SEG-06: Input validators for client data.
 * Validates CPF/CNPJ (with check digits) and email format before persisting.
 */

/** Returns true if email is empty/omitted or matches a basic email pattern. */
export function validarEmail(e: string): boolean {
  return !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/** Validates CPF check digits (algoritmo Receita Federal). */
function validarCPF(digits: string): boolean {
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false; // rejeita 000...0, 111...1, etc.
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i]) * (10 - i);
  let check = (sum * 10) % 11;
  if (check === 10 || check === 11) check = 0;
  if (check !== parseInt(digits[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i]) * (11 - i);
  check = (sum * 10) % 11;
  if (check === 10 || check === 11) check = 0;
  return check === parseInt(digits[10]);
}

/** Validates CNPJ check digits (algoritmo Receita Federal). */
function validarCNPJ(digits: string): boolean {
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;
  const calc = (d: string, weights: number[]) =>
    weights.reduce((s, w, i) => s + parseInt(d[i]) * w, 0);
  const mod = (n: number) => { const r = n % 11; return r < 2 ? 0 : 11 - r; };
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  if (mod(calc(digits, w1)) !== parseInt(digits[12])) return false;
  return mod(calc(digits, w2)) === parseInt(digits[13]);
}

/**
 * Returns true if documento is empty/omitted, or is a valid CPF (11 digits)
 * or CNPJ (14 digits) — including check digit validation.
 */
export function validarDocumento(d: string): boolean {
  if (!d) return true;
  const digits = d.replace(/\D/g, "");
  if (digits.length === 11) return validarCPF(digits);
  if (digits.length === 14) return validarCNPJ(digits);
  return false;
}
