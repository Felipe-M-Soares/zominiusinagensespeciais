import { useState, useEffect, useMemo } from "react";
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

export function useDevices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAllDevices = async () => {
      const BATCH = 1000;
      let all: DbDevice[] = [];
      let from = 0;

      while (true) {
        const { data, error: dbError } = await supabase
          .from("devices")
          .select("*")
          .order("model")
          .range(from, from + BATCH - 1);

        if (dbError) {
          console.error("Device fetch error:", dbError);
          setError("Erro ao carregar dispositivos.");
          setLoading(false);
          return;
        }

        const rows = data ?? [];
        all = all.concat(rows);
        if (rows.length < BATCH) break;
        from += BATCH;
      }

      console.log(`Loaded ${all.length} devices from database`);
      setDevices(all.map(toDevice));
      setLoading(false);
    };
    fetchAllDevices();
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
  return useMemo(() => {
    const q = search.toLowerCase().trim();
    return devices.filter((d) => {
      if (letter) {
        const firstChar = d.model.charAt(0).toUpperCase();
        if (letter === "#") {
          if (/[A-Z]/.test(firstChar)) return false;
        } else {
          if (firstChar !== letter) return false;
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
          d.exocad_compatibility.toLowerCase().includes(q) ||
          d.brand_name.toLowerCase().includes(q) ||
          d.body_region.toLowerCase().includes(q);
        if (!matchesSearch) return false;
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
