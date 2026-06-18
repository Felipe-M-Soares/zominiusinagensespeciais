/**
 * ARCH-002 FIX: Unit tests for device mapping and filtering logic.
 */
import { describe, it, expect } from "vitest";

// ─── toBool (from import-devices Edge Function, mirrored here for testing) ───
function toBool(val: string | boolean | undefined, def = false): boolean {
  if (typeof val === "boolean") return val;
  if (!val) return def;
  const v = String(val).toLowerCase().trim();
  return v === "true" || v === "sim" || v === "1" || v === "yes";
}

describe("toBool", () => {
  it("handles boolean true", () => expect(toBool(true)).toBe(true));
  it("handles boolean false", () => expect(toBool(false)).toBe(false));
  it("handles string 'true'", () => expect(toBool("true")).toBe(true));
  it("handles string 'sim'", () => expect(toBool("sim")).toBe(true));
  it("handles string '1'", () => expect(toBool("1")).toBe(true));
  it("handles string 'yes'", () => expect(toBool("yes")).toBe(true));
  it("handles string 'false'", () => expect(toBool("false")).toBe(false));
  it("handles undefined with default", () => expect(toBool(undefined, true)).toBe(true));
  it("handles empty string", () => expect(toBool("")).toBe(false));
});

// ─── Filtering logic (mirrors useFilteredDevices core logic) ─────────────────
interface DeviceMin {
  model: string;
  reference: string;
  udi_di: string;
  primary_material: string;
  sterile: boolean;
  single_use: boolean;
}

function filterDevices(devices: DeviceMin[], search: string): DeviceMin[] {
  const q = search.toLowerCase().trim();
  if (!q) return devices;
  return devices.filter(
    (d) =>
      d.model.toLowerCase().includes(q) ||
      d.reference.toLowerCase().includes(q) ||
      d.udi_di.includes(q) ||
      d.primary_material.toLowerCase().includes(q)
  );
}

const sampleDevices: DeviceMin[] = [
  { model: "Implante Cônico", reference: "IC-001", udi_di: "00123", primary_material: "Titânio", sterile: true, single_use: false },
  { model: "Pilar Universal", reference: "PU-002", udi_di: "00456", primary_material: "Zircônia", sterile: false, single_use: true },
  { model: "Mini Implante", reference: "MI-003", udi_di: "00789", primary_material: "Titânio", sterile: true, single_use: false },
];

describe("filterDevices", () => {
  it("returns all when search is empty", () => {
    expect(filterDevices(sampleDevices, "")).toHaveLength(3);
  });

  it("filters by model (case-insensitive)", () => {
    const result = filterDevices(sampleDevices, "implante");
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.model)).toContain("Implante Cônico");
    expect(result.map((d) => d.model)).toContain("Mini Implante");
  });

  it("filters by UDI-DI", () => {
    const result = filterDevices(sampleDevices, "00456");
    expect(result).toHaveLength(1);
    expect(result[0].reference).toBe("PU-002");
  });

  it("filters by material", () => {
    const result = filterDevices(sampleDevices, "zircônia");
    expect(result).toHaveLength(1);
    expect(result[0].reference).toBe("PU-002");
  });

  it("returns empty when no match", () => {
    expect(filterDevices(sampleDevices, "inexistente")).toHaveLength(0);
  });
});
