import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import type { Device } from "@/types/device";

export type DbDevice = Tables<"devices">;
export type Filters = {
  material: string;
  classification: string;
  sterile: string;
  single_use: string;
  exocad: string;
};

const PAGE_SIZE = 60;

function toDevice(d: DbDevice): Device {
  return {
    udi_di: d.udi_di,
    reference: d.reference,
    model: d.model,
    brand_name: d.brand_name,
    internal_code: d.internal_code,
    anvisa_registration: d.anvisa_registration,
    manufacturer_country: d.manufacturer_country,
    classification_code: d.classification_code,
    risk_class: d.risk_class,
    sterile: d.sterile,
    single_use: d.single_use,
    implantable: d.implantable,
    intended_use: d.intended_use,
    body_region: d.body_region,
    primary_material: d.primary_material,
    secondary_material: d.secondary_material,
    surface_treatment: d.surface_treatment,
    exocad_compatibility: d.exocad_compatibility,
    compatible_systems: d.compatible_systems,
    icon_url: d.icon_url,
  };
}

async function queryDevices(
  search: string,
  filters: Filters,
  letter: string,
  offset: number,
  signal: AbortSignal
): Promise<{ data: Device[]; count: number }> {
  let query = supabase
    .from("devices")
    .select("*", { count: "exact" })
    .order("model")
    .range(offset, offset + PAGE_SIZE - 1);

  const q = search.trim();
  if (q) {
    query = query.or(
      [
        `model.ilike.%${q}%`,
        `reference.ilike.%${q}%`,
        `udi_di.ilike.%${q}%`,
        `internal_code.ilike.%${q}%`,
        `anvisa_registration.ilike.%${q}%`,
        `brand_name.ilike.%${q}%`,
        `primary_material.ilike.%${q}%`,
        `exocad_compatibility.ilike.%${q}%`,
      ].join(",")
    );
  }

  // FIX: filtro de letra só se aplica quando NÃO há busca por texto,
  // para não conflitar com a busca multi-campo e retornar count errado.
  if (!q && letter && letter !== "#") {
    query = query.ilike("model", `${letter}%`);
  }
  if (!q && letter === "#") {
    // Modelos que não começam com letra A-Z
    query = query.not("model", "ilike", "a%")
      .not("model", "ilike", "b%").not("model", "ilike", "c%")
      .not("model", "ilike", "d%").not("model", "ilike", "e%")
      .not("model", "ilike", "f%").not("model", "ilike", "g%")
      .not("model", "ilike", "h%").not("model", "ilike", "i%")
      .not("model", "ilike", "j%").not("model", "ilike", "k%")
      .not("model", "ilike", "l%").not("model", "ilike", "m%")
      .not("model", "ilike", "n%").not("model", "ilike", "o%")
      .not("model", "ilike", "p%").not("model", "ilike", "q%")
      .not("model", "ilike", "r%").not("model", "ilike", "s%")
      .not("model", "ilike", "t%").not("model", "ilike", "u%")
      .not("model", "ilike", "v%").not("model", "ilike", "w%")
      .not("model", "ilike", "x%").not("model", "ilike", "y%")
      .not("model", "ilike", "z%");
  }

  if (filters.material) query = query.eq("primary_material", filters.material);
  if (filters.classification) query = query.eq("classification_code", filters.classification);
  if (filters.sterile === "true") query = query.eq("sterile", true);
  if (filters.sterile === "false") query = query.eq("sterile", false);
  if (filters.single_use === "true") query = query.eq("single_use", true);
  if (filters.single_use === "false") query = query.eq("single_use", false);
  if (filters.exocad) query = query.eq("exocad_compatibility", filters.exocad);

  const { data, error, count } = await query;

  if (signal.aborted) return { data: [], count: 0 };
  if (error) throw error;

  return { data: (data ?? []).map(toDevice), count: count ?? 0 };
}

export function useDevices(search: string, filters: Filters, letter: string) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offsetRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Serializa filters para uso estável em deps
  const filtersKey = JSON.stringify(filters);

  // Quando search/filters/letter mudam: recomeça do zero
  useEffect(() => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    offsetRef.current = 0;
    setDevices([]);
    setTotalCount(0);
    setError(null);
    setLoading(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentFilters = JSON.parse(filtersKey) as Filters;

    queryDevices(search, currentFilters, letter, 0, controller.signal)
      .then(({ data, count }) => {
        if (controller.signal.aborted) return;
        setDevices(data);
        setTotalCount(count);
        offsetRef.current = data.length;
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error("Device fetch error:", err);
        setError("Erro ao carregar dispositivos.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filtersKey, letter]);

  // FIX: loadMore usa refs para evitar deps instáveis (objetos/funções)
  const searchRef = useRef(search);
  const filtersRef = useRef(filters);
  const letterRef = useRef(letter);
  useEffect(() => { searchRef.current = search; }, [search]);
  useEffect(() => { filtersRef.current = filters; }, [filters]);
  useEffect(() => { letterRef.current = letter; }, [letter]);

  const loadMore = useCallback(() => {
    if (loadingMore) return;
    const controller = new AbortController();
    setLoadingMore(true);

    queryDevices(searchRef.current, filtersRef.current, letterRef.current, offsetRef.current, controller.signal)
      .then(({ data, count }) => {
        if (controller.signal.aborted) return;
        setDevices((prev) => [...prev, ...data]);
        setTotalCount(count);
        offsetRef.current += data.length;
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error("loadMore error:", err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingMore(false);
      });
  }, [loadingMore]);

  const hasMore = devices.length < totalCount;

  return { devices, totalCount, loading, loadingMore, error, loadMore, hasMore };
}

export function useDeviceOptions() {
  const [options, setOptions] = useState({
    materials: [] as string[],
    classifications: [] as string[],
    exocadOptions: [] as string[],
    availableLetters: new Set<string>(),
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      supabase.from("devices").select("primary_material").order("primary_material"),
      supabase.from("devices").select("classification_code").order("classification_code"),
      supabase.from("devices").select("exocad_compatibility").not("exocad_compatibility", "is", null),
      supabase.from("devices").select("model").order("model"),
    ]).then(([matRes, classRes, exocadRes, modelRes]) => {
      if (cancelled) return;

      // FIX: trata erros de cada query individualmente em vez de engolir silenciosamente
      if (matRes.error) console.error("useDeviceOptions materials error:", matRes.error);
      if (classRes.error) console.error("useDeviceOptions classifications error:", classRes.error);
      if (exocadRes.error) console.error("useDeviceOptions exocad error:", exocadRes.error);
      if (modelRes.error) console.error("useDeviceOptions models error:", modelRes.error);

      const materials = [
        ...new Set(
          (matRes.data ?? []).map((d: any) => d.primary_material).filter(Boolean)
        ),
      ] as string[];
      const classifications = [
        ...new Set(
          (classRes.data ?? []).map((d: any) => d.classification_code).filter(Boolean)
        ),
      ] as string[];
      const exocadOptions = [
        ...new Set(
          (exocadRes.data ?? [])
            .map((d: any) => d.exocad_compatibility)
            .filter((v: any) => v && v !== "N.A")
        ),
      ] as string[];
      const letters = new Set<string>();
      (modelRes.data ?? []).forEach((d: any) => {
        const c = (d.model ?? "").charAt(0).toUpperCase();
        letters.add(/[A-Z]/.test(c) ? c : "#");
      });
      setOptions({ materials, classifications, exocadOptions, availableLetters: letters });
    }).catch((err) => {
      // FIX: captura erros de rede que antes eram silenciosos
      console.error("useDeviceOptions fetch error:", err);
    });
    return () => { cancelled = true; };
  }, []);

  return options;
}

// Mantido para compatibilidade com outros componentes que possam usar
export function useFilteredDevices(
  devices: Device[],
  search: string,
  filters: Filters,
  letter: string
) {
  return useMemo(() => {
    const q = search.toLowerCase().trim();
    return devices.filter((d) => {
      if (letter) {
        const firstChar = d.model.charAt(0).toUpperCase();
        if (letter === "#") { if (/[A-Z]/.test(firstChar)) return false; }
        else { if (firstChar !== letter) return false; }
      }
      if (q) {
        const match =
          d.model.toLowerCase().includes(q) ||
          d.reference.toLowerCase().includes(q) ||
          d.udi_di.includes(q) ||
          d.internal_code.includes(q) ||
          d.anvisa_registration.includes(q) ||
          d.primary_material.toLowerCase().includes(q) ||
          (d.exocad_compatibility?.toLowerCase() ?? "").includes(q) ||
          (d.brand_name?.toLowerCase() ?? "").includes(q) ||
          (d.body_region?.toLowerCase() ?? "").includes(q);
        if (!match) return false;
      }
      if (filters.material && d.primary_material !== filters.material) return false;
      if (filters.classification && d.classification_code !== filters.classification) return false;
      if (filters.sterile === "true" && !d.sterile) return false;
      if (filters.sterile === "false" && d.sterile) return false;
      if (filters.single_use === "true" && !d.single_use) return false;
      if (filters.single_use === "false" && d.single_use) return false;
      if (filters.exocad && d.exocad_compatibility !== filters.exocad) return false;
      return true;
    });
  }, [devices, search, filters, letter]);
}
