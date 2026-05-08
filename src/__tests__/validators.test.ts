import { describe, it, expect } from "vitest";
import { validarEmail, validarDocumento } from "@/lib/validators";

// BUG-11: Tests for critical input validators (SEG-06)
describe("validarEmail", () => {
  it("accepts valid emails", () => {
    expect(validarEmail("user@example.com")).toBe(true);
    expect(validarEmail("user+tag@sub.domain.com")).toBe(true);
  });
  it("rejects invalid emails", () => {
    expect(validarEmail("notanemail")).toBe(false);
    expect(validarEmail("missing@tld")).toBe(false);
    expect(validarEmail("@nodomain.com")).toBe(false);
  });
  it("accepts empty string (field is optional)", () => {
    expect(validarEmail("")).toBe(true);
  });
});

describe("validarDocumento", () => {
  it("accepts valid 11-digit CPF", () => {
    expect(validarDocumento("12345678901")).toBe(true);
    expect(validarDocumento("123.456.789-01")).toBe(true); // with formatting
  });
  it("accepts valid 14-digit CNPJ", () => {
    expect(validarDocumento("12345678000195")).toBe(true);
    expect(validarDocumento("12.345.678/0001-95")).toBe(true);
  });
  it("rejects invalid lengths", () => {
    expect(validarDocumento("123")).toBe(false);
    expect(validarDocumento("1234567890")).toBe(false); // 10 digits
    expect(validarDocumento("1234567890123")).toBe(false); // 13 digits
  });
  it("accepts empty string (field is optional)", () => {
    expect(validarDocumento("")).toBe(true);
  });
});
