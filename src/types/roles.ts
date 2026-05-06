/**
 * Tipo canônico para roles da aplicação.
 * Importar daqui em vez de duplicar a union em cada arquivo.
 */
export type AppRole = "admin" | "funcionario" | "vendedora" | "financeiro";

export const APP_ROLES: AppRole[] = ["admin", "funcionario", "vendedora", "financeiro"];

export const ROLE_LABELS: Record<AppRole, string> = {
  admin:       "Admin",
  funcionario: "Funcionário",
  vendedora:   "Vendedora",
  financeiro:  "Financeiro",
};
