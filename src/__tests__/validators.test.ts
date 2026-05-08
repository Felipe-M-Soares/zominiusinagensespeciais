import { describe, it, expect } from "vitest";
import { validarEmail, validarDocumento } from "@/lib/validators";

// BUG-02 FIX: Tests updated to use CPFs/CNPJs with valid check digits.
// Previously, validators only checked length — any 11-digit string passed.
// Now full digit verification is performed.

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
  // Valid CPF: 529.982.247-25 — dígitos verificadores corretos
  it("accepts a valid CPF (with check digits)", () => {
    expect(validarDocumento("52998224725")).toBe(true);
    expect(validarDocumento("529.982.247-25")).toBe(true); // with formatting
  });

  // Invalid CPF: correct length but wrong check digits
  it("rejects CPF with invalid check digits", () => {
    expect(validarDocumento("12345678901")).toBe(false);
    expect(validarDocumento("123.456.789-01")).toBe(false);
  });

  // Rejects repeated-digit CPFs like 000.000.000-00, 111.111.111-11
  it("rejects repeated-digit CPFs", () => {
    expect(validarDocumento("00000000000")).toBe(false);
    expect(validarDocumento("11111111111")).toBe(false);
    expect(validarDocumento("99999999999")).toBe(false);
  });

  // Valid CNPJ: 11.222.333/0001-81 — dígitos verificadores corretos
  it("accepts a valid CNPJ (with check digits)", () => {
    expect(validarDocumento("11222333000181")).toBe(true);
    expect(validarDocumento("11.222.333/0001-81")).toBe(true); // with formatting
  });

  // Invalid CNPJ: correct length but wrong check digits
  it("rejects CNPJ with invalid check digits", () => {
    expect(validarDocumento("12345678000100")).toBe(false);
    expect(validarDocumento("12.345.678/0001-00")).toBe(false);
  });

  // Rejects repeated-digit CNPJs
  it("rejects repeated-digit CNPJs", () => {
    expect(validarDocumento("00000000000000")).toBe(false);
    expect(validarDocumento("11111111111111")).toBe(false);
  });

  it("rejects invalid lengths", () => {
    expect(validarDocumento("123")).toBe(false);
    expect(validarDocumento("1234567890")).toBe(false); // 10 digits
    expect(validarDocumento("1234567890123")).toBe(false); // 13 digits
  });

  it("accepts empty string (field is optional)", () => {
    expect(validarDocumento("")).toBe(true);
    expect(validarDocumento("  ")).toBe(true);
  });
});
