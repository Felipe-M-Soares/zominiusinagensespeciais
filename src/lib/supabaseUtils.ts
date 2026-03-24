import { supabase } from "@/integrations/supabase/client";

/**
 * CODE-001 FIX: Single shared implementation of paginated "fetch all" from Supabase.
 * Previously duplicated identically in useDevices.ts and AdminDevices.tsx.
 *
 * PERF-001 NOTE: For large datasets (10 000+ records) prefer server-side pagination
 * with fetchDevicesPage() below. Use this only when you need all records in memory.
 */
export async function fetchAllPages<T>(
  table: string,
  orderBy = "model",
  batchSize = 1000
): Promise<T[]> {
  let all: T[] = [];
  let from = 0;

  while (true) {
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
    // Server-side search on the most common fields
    query = query.or(
      `model.ilike.%${search}%,reference.ilike.%${search}%,udi_di.ilike.%${search}%`
    );
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: (data ?? []) as T[], count: count ?? 0 };
}
