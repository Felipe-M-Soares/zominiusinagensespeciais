import { describe, it, expect } from "vitest";
import { APP_ROLES, ROLE_LABELS } from "@/types/roles";
import type { AppRole } from "@/types/roles";

// BUG-11: Tests for role definitions — SEG-02 regression guard
describe("APP_ROLES", () => {
  const EXPECTED: AppRole[] = ["admin", "funcionario", "vendedora", "financeiro"];

  it("contains all expected roles", () => {
    for (const role of EXPECTED) {
      expect(APP_ROLES).toContain(role);
    }
  });

  it("has a label for every role", () => {
    for (const role of APP_ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });

  it("includes financeiro (SEG-02 regression)", () => {
    expect(APP_ROLES).toContain("financeiro");
    expect(ROLE_LABELS.financeiro).toBe("Financeiro");
  });
});
