/**
 * Validação e análise de força de senha.
 * Fonte única — importado por AdminUsers.tsx e pelos testes.
 */

export interface PasswordStrength {
  score: number;
  label: string;
  color: string;
}

/** Retorna null se a senha for válida, ou uma string de erro se inválida. */
export function validatePassword(pwd: string): string | null {
  if (pwd.length < 8)            return "Senha muito curta — mínimo 8 caracteres.";
  if (pwd.length > 72)           return "Senha longa demais — máximo 72 caracteres.";
  if (!/[A-Z]/.test(pwd))        return "Precisa de ao menos 1 letra maiúscula.";
  if (!/[a-z]/.test(pwd))        return "Precisa de ao menos 1 letra minúscula.";
  if (!/[0-9]/.test(pwd))        return "Precisa de ao menos 1 número.";
  if (!/[^A-Za-z0-9]/.test(pwd)) return "Precisa de ao menos 1 caractere especial (!@#$%...).";
  return null;
}

export function passwordStrength(pwd: string): PasswordStrength {
  let score = 0;
  if (pwd.length >= 8)  score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  const levels: PasswordStrength[] = [
    { score: 0, label: "",           color: "" },
    { score: 1, label: "Muito fraca", color: "bg-destructive" },
    { score: 2, label: "Fraca",      color: "bg-orange-400" },
    { score: 3, label: "Razoável",   color: "bg-warning" },
    { score: 4, label: "Boa",        color: "bg-success" },
    { score: 5, label: "Forte",      color: "bg-success" },
  ];
  return { ...levels[score], score };
}
