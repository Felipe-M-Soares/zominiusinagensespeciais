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
    expect(validarDocumento("12345678909")).toBe(true);           // valid CPF
    expect(validarDocumento("123.456.789-09")).toBe(true);        // formatted
    expect(validarDocumento("529.982.247-25")).toBe(true);        // another valid CPF
  });
  it("accepts valid 14-digit CNPJ", () => {
    expect(validarDocumento("11222333000181")).toBe(true);         // valid CNPJ
    expect(validarDocumento("11.222.333/0001-81")).toBe(true);    // formatted
  });
  it("rejects invalid lengths", () => {
    expect(validarDocumento("123")).toBe(false);
    expect(validarDocumento("1234567890")).toBe(false); // 10 digits
    expect(validarDocumento("1234567890123")).toBe(false); // 13 digits
  });
  it("accepts empty string (field is optional)", () => {
    expect(validarDocumento("")).toBe(true);
  });
  it("rejects CPF with all same digits (000...0)", () => {
    expect(validarDocumento("00000000000")).toBe(false);
    expect(validarDocumento("11111111111")).toBe(false);
  });
  it("rejects CPF with wrong check digits", () => {
    expect(validarDocumento("12345678900")).toBe(false); // wrong check digits
  });
  it("accepts a valid CPF", () => {
    expect(validarDocumento("529.982.247-25")).toBe(true);
  });
  it("accepts a valid CNPJ", () => {
    expect(validarDocumento("11.222.333/0001-81")).toBe(true);
  });
  it("rejects CNPJ with all same digits", () => {
    expect(validarDocumento("00000000000000")).toBe(false);
  });
});
