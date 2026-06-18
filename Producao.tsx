/**
 * Mapa de erros do Supabase Auth traduzidos para português.
 * Fonte única — importado por useAuth.tsx e pelos testes.
 * NUNCA duplicar este mapa em outros arquivos.
 */
export const ERROR_MAP: Record<string, string> = {
  "Invalid login credentials":   "Login ou senha incorretos.",
  "Invalid email or password":   "Login ou senha incorretos.",
  "invalid_credentials":         "Login ou senha incorretos.",
  "Password should be at least 6 characters": "A senha deve ter no mínimo 6 caracteres.",
  "Password should be at least 8 characters": "A senha deve ter no mínimo 8 caracteres.",
  "User not found":              "Usuário não encontrado.",
  "Too many requests":           "Muitas tentativas. Aguarde alguns minutos.",
  "Session expired":             "Sua sessão expirou. Faça login novamente.",
  "User is not authorized":      "Sem permissão para realizar esta ação.",
  "New password should be different from the old password": "A nova senha deve ser diferente da atual.",
  "Auth session missing":        "Sessão não encontrada. Faça login novamente.",
};

export function translateError(message: string): string {
  if (ERROR_MAP[message]) return ERROR_MAP[message];
  for (const [key, value] of Object.entries(ERROR_MAP)) {
    if (message.toLowerCase().includes(key.toLowerCase())) return value;
  }
  return message;
}
