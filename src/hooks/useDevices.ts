import { useState, useEffect, useMemo, useDeferredValue, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import type { Device } from "@/types/device";

export type DbDevice = Tables<"devices">;

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

const PAGE_SIZE = 60;

export type Filters = {
material: string;
classification: string;
sterile: string;
single_use: string;
exocad: string;
};

// PERF: Busca server-side paginada — nunca carrega tudo na memória.
// Substitui o fetchAllPages que trazia todos os registros de uma vez.
export function useDevices(search: string, filters: Filters, letter: string) {
const [devices, setDevices] = useState<Device[]>([]);
const [totalCount, setTotalCount] = useState(0);
const [loading, setLoading] = useState(true);
const [loadingMore, setLoadingMore] = useState(false);
const [error, setError] = useState<string | null>(null);
const [offset, setOffset] = useState(0);
const abortRef = useRef<AbortController | null>(null);

const fetchPage = useCallback(async (currentOffset: number, replace: boolean) => {
  // Cancela requisição anterior se ainda em andamento
  if (abortRef.current) abortRef.current.abort();
  const controller = new AbortController();
  abortRef.current = controller;

  if (replace) setLoading(true); else setLoadingMore(true);

  try {
    let query = supabase
      .from("devices")
      .select("*", { count: "exact" })
      .order("model")
      .range(currentOffset, currentOffset + PAGE_SIZE - 1);

    const q = search.trim();
    if (q) {
      query = query.or([
        `model.ilike.%${q}%`,
        `reference.ilike.%${q}%`,
        `udi_di.ilike.%${q}%`,
        `internal_code.ilike.%${q}%`,
        `anvisa_registration.ilike.%${q}%`,
        `brand_name.ilike.%${q}%`,
        `primary_material.ilike.%${q}%`,
        `exocad_compatibility.ilike.%${q}%`,
      ].join(","));
    }

    if (letter) {
      if (letter === "#") {
        // modelos que não começam com letra A-Z
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
      } else {
        query = query.ilike("model", `${letter}%`);
      }
    }

    if (filters.material) query = query.eq("primary_material", filters.material);
    if (filters.classification) query = query.eq("classification_code", filters.classification);
    if (filters.sterile === "true") query = query.eq("sterile", true);
    if (filters.sterile === "false") query = query.eq("sterile", false);
    if (filters.single_use === "true") query = query.eq("single_use", true);
    if (filters.single_use === "false") query = query.eq("single_use", false);
    if (filters.exocad) query = query.eq("exocad_compatibility", filters.exocad);

    const { data, error: err, count } = await query;
    if (controller.signal.aborted) return;
    if (err) throw err;

    const mapped = (data ?? []).map(toDevice);
    setDevices(prev => replace ? mapped : [...prev, ...mapped]);
    setTotalCount(count ?? 0);
    setOffset(currentOffset + mapped.length);
  } catch (err: any) {
    if (controller.signal.aborted) return;
    console.error("Device fetch error:", err);
    setError("Erro ao carregar dispositivos.");
  } finally {
    if (!controller.signal.aborted) {
      setLoading(false);
      setLoadingMore(false);
    }
  }
}, [search, filters, letter]);

// Reinicia quando filtros mudam
useEffect(() => {
  setOffset(0);
  setDevices([]);
  fetchPage(0, true);
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [search, filters, letter]);

const loadMore = useCallback(() => {
  fetchPage(offset, false);
}, [fetchPage, offset]);

const hasMore = devices.length < totalCount;

return { devices, totalCount, loading, loadingMore, error, loadMore, hasMore };
}

// Hook para opções de filtro — carrega apenas os valores únicos, não todos os registros
export function useDeviceOptions() {
const [options, setOptions] = useState({
  materials: [] as string[],
  classifications: [] as string[],
  exocadOptions: [] as string[],
  availableLetters: new Set<string>(),
});

useEffect(() => {
  // Busca apenas os campos necessários para os filtros, sem trazer dados completos
  Promise.all([
    supabase.from("devices").select("primary_material").order("primary_material"),
    supabase.from("devices").select("classification_code").order("classification_code"),
    supabase.from("devices").select("exocad_compatibility").not("exocad_compatibility", "is", null),
    supabase.from("devices").select("model").order("model"),
  ]).then(([matRes, classRes, exocadRes, modelRes]) => {
    const materials = [...new Set((matRes.data ?? []).map((d: any) => d.primary_material).filter(Boolean))];
    const classifications = [...new Set((classRes.data ?? []).map((d: any) => d.classification_code).filter(Boolean))];
    const exocadOptions = [...new Set((exocadRes.data ?? [])
      .map((d: any) => d.exocad_compatibility)
      .filter((v: any) => v && v !== "N.A"))];
    const letters = new Set<string>();
    (modelRes.data ?? []).forEach((d: any) => {
      const c = (d.model ?? "").charAt(0).toUpperCase();
      letters.add(/[A-Z]/.test(c) ? c : "#");
    });
    setOptions({ materials, classifications, exocadOptions, availableLetters: letters });
  });
}, []);

return options;
}

// Mantido para compatibilidade mas não mais usado na Index — pode ser removido futuramente
export type { Filters as FilterType };
export function useFilteredDevices(devices: Device[], search: string, filters: Filters, letter: string) {
const deferredSearch = useDeferredValue(search);
const deferredFilters = useDeferredValue(filters);
const deferredLetter = useDeferredValue(letter);
return useMemo(() => {
  const q = deferredSearch.toLowerCase().trim();
  return devices.filter((d) => {
    if (deferredLetter) {
      const firstChar = d.model.charAt(0).toUpperCase();
      if (deferredLetter === "#") { if (/[A-Z]/.test(firstChar)) return false; }
      else { if (firstChar !== deferredLetter) return false; }
    }
    if (q) {
      const match = d.model.toLowerCase().includes(q) || d.reference.toLowerCase().includes(q) ||
        d.udi_di.includes(q) || d.internal_code.includes(q) || d.anvisa_registration.includes(q) ||
        d.primary_material.toLowerCase().includes(q) ||
        (d.exocad_compatibility?.toLowerCase() ?? "").includes(q) ||
        (d.brand_name?.toLowerCase() ?? "").includes(q) ||
        (d.body_region?.toLowerCase() ?? "").includes(q);
      if (!match) return false;
    }
    if (deferredFilters.material && d.primary_material !== deferredFilters.material) return false;
    if (deferredFilters.classification && d.classification_code !== deferredFilters.classification) return false;
    if (deferredFilters.sterile === "true" && !d.sterile) return false;
    if (deferredFilters.sterile === "false" && d.sterile) return false;
    if (deferredFilters.single_use === "true" && !d.single_use) return false;
    if (deferredFilters.single_use === "false" && d.single_use) return false;
    if (deferredFilters.exocad && d.exocad_compatibility !== deferredFilters.exocad) return false;
    return true;
  });
}, [devices, deferredSearch, deferredFilters, deferredLetter]);
}
