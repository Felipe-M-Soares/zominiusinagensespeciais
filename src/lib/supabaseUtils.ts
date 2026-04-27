import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";

/**
 * CODE-001 FIX: Single shared implementation of paginated "fetch all" from Supabase.
 *
 * PERF-001 NOTE: For large datasets (10 000+ records) prefer server-side pagination
 * with fetchDevicesPage() below. Use this only when you need all records in memory.
 *
 * FIX: Adicionado limite MAX_PAGES para evitar loop infinito caso o Supabase retorne
 * dados corrompidos ou a paginação falhe silenciosamente (ex.: sempre retorna batchSize
 * rows mesmo na última página).
 */
export async function fetchAllPages<T>(
  table: string,
  orderBy = "model",
  batchSize = 1000
): Promise<T[]> {
  const MAX_PAGES = 100; // proteção contra loop infinito: máximo 100.000 registros
  let all: T[] = [];
  let from = 0;
  let page = 0;

  while (page < MAX_PAGES) {
    const { data, error } = await supabase
      .from(table)
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
    logger.warn(`fetchAllPages: limite de ${MAX_PAGES} páginas atingido para tabela "${table}". Dados podem estar incompletos.`);
  }

  return all;
}

/**
 * PERF-001 / PERF-003 FIX: Server-side paginated fetch with optional search filter.
 * Use this in AdminDevices instead of loading everything into memory.
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
    // SECURITY: sanitiza a busca antes de interpolar na string PostgREST.
    // Caracteres como `,` `(` `)` têm significado sintático no parser e
    // podem injetar condições adicionais na query se não forem removidos.
    const safe = search.trim()
      .slice(0, 200)
      .replace(/[(),]/g, "")
      .replace(/[%_\\]/g, "\\$&");

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
