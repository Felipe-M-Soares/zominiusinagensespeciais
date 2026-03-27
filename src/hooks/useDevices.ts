import { useState, useEffect, useMemo, useDeferredValue } from "react";
import { fetchAllPages } from "@/lib/supabaseUtils";
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

export function useDevices() {
const [devices, setDevices] = useState<Device[]>([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);

useEffect(() => {
  // FIX: isMounted flag evita setState em componente desmontado (memory leak / React warning).
  // Isso pode ocorrer se o usuário navegar para outra página antes do fetch terminar.
  let isMounted = true;
  fetchAllPages<DbDevice>("devices", "model")
    .then((all) => {
      if (!isMounted) return;
      setDevices(all.map(toDevice));
      setLoading(false);
    })
    .catch((err) => {
      if (!isMounted) return;
      console.error("Device fetch error:", err);
      setError("Erro ao carregar dispositivos.");
      setLoading(false);
    });
  return () => { isMounted = false; };
}, []);

return { devices, loading, error };
}

export type Filters = {
material: string;
classification: string;
sterile: string;
single_use: string;
exocad: string;
};

export function useFilteredDevices(
devices: Device[],
search: string,
filters: Filters,
letter: string
) {
// PERF-002 FIX: Defer expensive filter computation so keystrokes stay responsive.
// React 18 useDeferredValue schedules the re-computation at lower priority,
// preventing blocking the main thread on every keystroke with large datasets.
const deferredSearch = useDeferredValue(search);
const deferredFilters = useDeferredValue(filters);
const deferredLetter = useDeferredValue(letter);

return useMemo(() => {
  const q = deferredSearch.toLowerCase().trim();
  return devices.filter((d) => {
    if (deferredLetter) {
      const firstChar = d.model.charAt(0).toUpperCase();
      if (deferredLetter === "#") {
        if (/[A-Z]/.test(firstChar)) return false;
      } else {
        if (firstChar !== deferredLetter) return false;
      }
    }

    if (q) {
      const matchesSearch =
        d.model.toLowerCase().includes(q) ||
        d.reference.toLowerCase().includes(q) ||
        d.udi_di.includes(q) ||
        d.internal_code.includes(q) ||
        d.anvisa_registration.includes(q) ||
        d.primary_material.toLowerCase().includes(q) ||
        // FIX: estes campos podem ser null vindo do banco — sem ?. causaria TypeError
        // quebrando toda a pesquisa silenciosamente
        (d.exocad_compatibility?.toLowerCase() ?? "").includes(q) ||
        (d.brand_name?.toLowerCase() ?? "").includes(q) ||
        (d.body_region?.toLowerCase() ?? "").includes(q);
      if (!matchesSearch) return false;
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

export function useDeviceOptions(devices: Device[]) {
return useMemo(() => {
  const materials = new Set<string>();
  const classifications = new Set<string>();
  const exocadOptions = new Set<string>();
  const letters = new Set<string>();

  devices.forEach((d) => {
    materials.add(d.primary_material);
    classifications.add(d.classification_code);
    if (d.exocad_compatibility && d.exocad_compatibility !== "N.A") {
      exocadOptions.add(d.exocad_compatibility);
    }
    const firstChar = d.model.charAt(0).toUpperCase();
    if (/[A-Z]/.test(firstChar)) {
      letters.add(firstChar);
    } else {
      letters.add("#");
    }
  });

  return {
    materials: Array.from(materials).sort(),
    classifications: Array.from(classifications).sort(),
    exocadOptions: Array.from(exocadOptions).sort(),
    availableLetters: letters,
  };
}, [devices]);
}
