/**
 * supabaseUtils — Utilitários de acesso ao banco de dados
 *
 * Funções reutilizáveis para paginação, busca e agregação via Supabase/PostgREST.
 * Centralizam lógica comum para evitar duplicação em páginas e hooks.
 */

import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
import { sanitizeQuery } from "@/lib/sanitize";
import type { Database } from "@/integrations/supabase/types";

type TableName = keyof Database["public"]["Tables"] | keyof Database["public"]["Views"];

/**
 * Busca todos os registros de uma tabela paginando de 1000 em 1000.
 *
 * O Supabase retorna no máximo 1000 rows por requisição por padrão.
 * Esta função itera até obter todos, com proteção contra loop infinito (MAX_PAGES).
 *
 * Para datasets muito grandes (100k+), prefira uma RPC SQL com aggregate.
 */
export async function fetchAllPages<T>(
  table: TableName,
  orderBy = "model",
  batchSize = 1000
): Promise<T[]> {
  const MAX_PAGES = 100; // cap: 100.000 registros
  let all: T[] = [];
  let from = 0;
  let page = 0;

  while (page < MAX_PAGES) {
    // select("*") é proposital: fetchAllPages é genérico (usado com tipos T
    // diferentes para tabelas/views distintas) — restringir colunas aqui
    // exigiria um parâmetro de coluna por chamada, mudança maior de escopo.
    const { data, error } = await supabase
      .from(table as keyof Database["public"]["Tables"])
      .select("*")
      .order(orderBy)
      .range(from, from + batchSize - 1);

    if (error) throw error;
    const rows = (data ?? []) as T[];
    all = all.concat(rows);
    if (rows.length < batchSize) break;
    from += batchSize;
    page++;
  }

  if (page >= MAX_PAGES) {
    logger.warn(`fetchAllPages: limite de ${MAX_PAGES} páginas atingido para "${table}".`);
  }

  return all;
}

/**
 * Busca uma página de dispositivos com filtro de texto e contagem total.
 * Usado em AdminDevices para paginação server-side (evita carregar tudo em memória).
 */
export async function fetchDevicesPage<T>(
  search: string,
  page: number,
  pageSize = 100
): Promise<{ data: T[]; count: number }> {
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("devices")
    .select("*", { count: "exact" })
    .order("model")
    .range(from, to);

  if (search.trim()) {
    const safe = sanitizeQuery(search);
    if (safe) {
      query = query.or(
        [
          `model.ilike.%${safe}%`,
          `reference.ilike.%${safe}%`,
          `udi_di.ilike.%${safe}%`,
          `internal_code.ilike.%${safe}%`,
          `anvisa_registration.ilike.%${safe}%`,
          `brand_name.ilike.%${safe}%`,
          `primary_material.ilike.%${safe}%`,
        ].join(",")
      );
    }
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: (data ?? []) as T[], count: count ?? 0 };
}

/**
 * Soma todos os valores de uma coluna numérica paginando para contornar
 * o limite de 1000 rows do Supabase por requisição.
 *
 * Prefira uma RPC SQL com SUM() quando disponível — é muito mais eficiente.
 * Esta função é o fallback quando não há RPC disponível.
 */
export async function sumColumnPaginated(
  table: TableName,
  column: string,
  filter?: { column: string; operator: "gt" | "gte" | "lt" | "lte"; value: number }
): Promise<number> {
  const MAX_PAGES = 200;
  const PAGE_SIZE = 1000;
  let soma = 0;
  let from = 0;
  let page = 0;

  while (page < MAX_PAGES) {
    let query = supabase.from(table as keyof Database["public"]["Tables"]).select(column).range(from, from + PAGE_SIZE - 1);
    if (filter) {
      query = query[filter.operator](filter.column, filter.value) as typeof query;
    }
    const { data, error } = await query;
    if (error) { logger.error("sumColumnPaginated error:", error); break; }
    const rows = (data ?? []) as unknown as Record<string, number>[];
    soma += rows.reduce((s, r) => s + (r[column] ?? 0), 0);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
    page++;
  }
  return soma;
}
