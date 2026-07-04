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
 *  admin      → Tudo
 */
export type AppRole =
  | "admin"
  | "estoque"
  | "qualidade"
  | "comercial"
  | "financeiro"
  | "producao"
  | "processos";

export const APP_ROLES: AppRole[] = [
  "admin",
  "estoque",
  "qualidade",
  "comercial",
  "financeiro",
  "producao",
  "processos",
];

export const ROLE_LABELS: Record<AppRole, string> = {
  admin:      "Admin",
  estoque:    "Estoque",
  qualidade:  "Qualidade",
  comercial:  "Comercial",
  financeiro: "Financeiro",
  producao:   "Produção",
  processos:  "Processos",
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
};
