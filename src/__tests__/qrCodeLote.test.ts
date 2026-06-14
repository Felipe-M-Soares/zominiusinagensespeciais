/**
 * Tests for QR Code lote URL generation and validation
 */
import { describe, it, expect } from "vitest";

// Lógica pura de geração de URL de rastreabilidade
function buildRastrUrl(origin: string, lote: string): string {
  return `${origin}/qualidade?tab=rastreabilidade&lote=${encodeURIComponent(lote)}`;
}

// Sanitiza nome do arquivo para download
function sanitizeLoteFilename(lote: string): string {
  return `qr-lote-${lote.replace(/[^a-z0-9]/gi, "_")}.png`;
}

// Valida formato de lote (YYMMDD-NN/L)
function isValidLoteFormat(lote: string): boolean {
  return /^\d{6}-\d{2}(\/[A-Za-z])?$/.test(lote);
}

describe("QRCodeLote — URL building", () => {
  it("builds correct URL for simple lote", () => {
    const url = buildRastrUrl("https://app.example.com", "230601-01");
    expect(url).toBe("https://app.example.com/qualidade?tab=rastreabilidade&lote=230601-01");
  });

  it("encodes special characters in lote", () => {
    const url = buildRastrUrl("https://app.example.com", "230601-01/A");
    expect(url).toContain("230601-01%2FA");
    expect(decodeURIComponent(url.split("lote=")[1])).toBe("230601-01/A");
  });

  it("handles lotes with spaces", () => {
    const url = buildRastrUrl("https://app.example.com", "23 06 01");
    expect(url).toContain("23%2006%2001");
  });
});

describe("QRCodeLote — filename sanitization", () => {
  it("creates safe filename from simple lote", () => {
    expect(sanitizeLoteFilename("230601-01")).toBe("qr-lote-230601_01.png");
  });

  it("replaces slashes in filename", () => {
    expect(sanitizeLoteFilename("230601-01/A")).toBe("qr-lote-230601_01_A.png");
  });

  it("replaces spaces in filename", () => {
    expect(sanitizeLoteFilename("23 06 01")).toBe("qr-lote-23_06_01.png");
  });

  it("keeps alphanumeric chars", () => {
    expect(sanitizeLoteFilename("ABC123")).toBe("qr-lote-ABC123.png");
  });
});

describe("Lote format validation", () => {
  it("accepts valid lote format YYMMDD-NN", () => {
    expect(isValidLoteFormat("230601-01")).toBe(true);
  });

  it("accepts valid lote format YYMMDD-NN/L", () => {
    expect(isValidLoteFormat("230601-01/A")).toBe(true);
    expect(isValidLoteFormat("260614-12/B")).toBe(true);
  });

  it("rejects invalid formats", () => {
    expect(isValidLoteFormat("LOTE-001")).toBe(false);
    expect(isValidLoteFormat("2306")).toBe(false);
    expect(isValidLoteFormat("")).toBe(false);
  });
});
