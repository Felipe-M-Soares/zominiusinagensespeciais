/**
 * Informações de versão e licenciamento do app — fonte única de verdade.
 *
 * APP_VERSION: atualizar manualmente a cada release significativa.
 *
 * LICENSED_TO: nome da empresa licenciada, lido de uma variável de ambiente
 * (VITE_LICENSED_TO) para que cada deploy/cliente (instância própria de
 * Supabase + Vercel) possa configurar o próprio nome sem editar código.
 * Se não configurada, mostra um valor padrão neutro — nunca quebra a tela.
 *
 * Isto é puramente informativo (mostrado em "Sobre o sistema"), não é um
 * mecanismo de bloqueio: não impede nem restringe nenhuma função do app.
 */

export const APP_VERSION = "1.0.0";

export const APP_NAME = "Zomini ERP";

export const LICENSED_TO: string =
  (import.meta.env.VITE_LICENSED_TO as string | undefined)?.trim() || "Licença não configurada";

/**
 * Dados da empresa emissora, usados em documentos gerados pelo sistema
 * (ex: PDF de pedido/orçamento). Por padrão usa o mesmo nome da licença
 * (VITE_LICENSED_TO) — configurável separadamente via VITE_COMPANY_NAME
 * apenas se alguém precisar de um nome de exibição diferente do nome do
 * licenciado (ex: revenda).
 */
export const COMPANY_NAME: string =
  (import.meta.env.VITE_COMPANY_NAME as string | undefined)?.trim() || LICENSED_TO;
export const COMPANY_DOCUMENT: string =
  (import.meta.env.VITE_COMPANY_DOCUMENT as string | undefined)?.trim() || "";
export const COMPANY_ADDRESS: string =
  (import.meta.env.VITE_COMPANY_ADDRESS as string | undefined)?.trim() || "";
export const COMPANY_PHONE: string =
  (import.meta.env.VITE_COMPANY_PHONE as string | undefined)?.trim() || "";
export const COMPANY_EMAIL: string =
  (import.meta.env.VITE_COMPANY_EMAIL as string | undefined)?.trim() || "";

/** Data de build real, injetada em tempo de compilação por vite.config.ts. */
export const BUILD_DATE: string =
  typeof __BUILD_DATE__ !== "undefined" ? __BUILD_DATE__ : "—";
