/**
 * Tipo canônico para roles da aplicação.
 * Importar daqui em vez de duplicar a union em cada arquivo.
 *
 * Permissões por role:
 *  estoque    → Componentes, Estoque
 *  qualidade  → Componentes, Estoque, Qualidade
 *  comercial  → Comercial (isolado por conta)
 *  financeiro → Financeiro
 *  producao   → Componentes, Produção
 *  processos  → Processos
 *  gerente    → Todos os módulos (estoque, qualidade, comercial, financeiro,
 *               produção, processos) com as funções de cada perfil — SEM a
 *               área Admin (usuários, limpezas de histórico, configurações).
 *  admin      → Tudo
 */
export type AppRole =
  | "admin"
  | "estoque"
  | "qualidade"
  | "comercial"
  | "financeiro"
  | "producao"
  | "processos"
  | "gerente";

export const APP_ROLES: AppRole[] = [
  "admin",
  "estoque",
  "qualidade",
  "comercial",
  "financeiro",
  "producao",
  "processos",
  "gerente",
];

export const ROLE_LABELS: Record<AppRole, string> = {
  admin:      "Admin",
  estoque:    "Estoque",
  qualidade:  "Qualidade",
  comercial:  "Comercial",
  financeiro: "Financeiro",
  producao:   "Produção",
  processos:  "Processos",
  gerente:    "Gerente (tudo menos Admin)",
};

/** Rotas acessíveis por role (além do admin que acessa tudo) */
export const ROLE_ROUTES: Record<AppRole, string[]> = {
  admin:      ["/", "/estoque", "/qualidade", "/comercial", "/financeiro", "/producao", "/processos", "/admin"],
  estoque:    ["/", "/estoque"],
  qualidade:  ["/", "/estoque", "/qualidade"],
  comercial:  ["/comercial"],
  financeiro: ["/financeiro"],
  producao:   ["/", "/producao", "/processos"],
  processos:  ["/processos"],
  gerente:    ["/", "/estoque", "/qualidade", "/comercial", "/financeiro", "/producao", "/processos"],
};

/**
 * Tela inicial de cada perfil. Usado após o login, no clique do logo e quando
 * o RoleGuard barra uma rota — antes todos iam para "/" (Componentes), então
 * Comercial/Financeiro/Processos caíam numa tela que nem aparece no menu deles.
 */
export function getHomeRoute(role: AppRole | null | undefined): string {
  if (!role) return "/";
  return ROLE_ROUTES[role]?.[0] ?? "/";
}

/** Se o perfil pode abrir a rota (admin pode tudo). */
export function canAccessRoute(role: AppRole | null | undefined, path: string): boolean {
  if (!role) return false;
  if (role === "admin") return true;
  return (ROLE_ROUTES[role] ?? []).includes(path);
}

/**
 * O perfil tem as permissões de algum dos perfis listados?
 * - admin: sempre.
 * - gerente: tem as permissões de todos os perfis operacionais, nunca as
 *   exclusivas de admin (lista só com "admin" → false).
 */
export function temPapel(role: AppRole | string | null | undefined, ...perfis: AppRole[]): boolean {
  if (!role) return false;
  if (role === "admin") return true;
  if (role === "gerente") return perfis.some(p => p !== "admin");
  return perfis.includes(role as AppRole);
}
