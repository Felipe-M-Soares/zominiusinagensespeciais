/**
 * Tests for WhatsApp notification logic
 */
import { describe, it, expect } from "vitest";

// Normaliza número de telefone para formato internacional BR
function normalizePhoneBR(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  return `55${digits}`;
}

// Valida se o número tem formato mínimo para WhatsApp BR
function isValidWhatsappNumber(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  // Brasil: 55 + DDD (2) + número (8 ou 9) = 12 ou 13 dígitos
  if (digits.startsWith("55")) {
    return digits.length === 12 || digits.length === 13;
  }
  // Sem código de país: DDD (2) + número (8 ou 9) = 10 ou 11 dígitos
  return digits.length === 10 || digits.length === 11;
}

// Monta payload do template WhatsApp
interface WaTemplatePayload {
  nome: string;
  pedidoId: string;
  totalPecas?: number;
}

function buildWaTemplateComponents(data: WaTemplatePayload) {
  return [
    {
      type: "body",
      parameters: [
        { type: "text", text: data.nome },
        { type: "text", text: data.pedidoId.slice(0, 8).toUpperCase() },
        { type: "text", text: data.totalPecas?.toString() ?? "—" },
      ],
    },
  ];
}

describe("normalizePhoneBR", () => {
  it("keeps BR code if already present", () => {
    expect(normalizePhoneBR("5511999887766")).toBe("5511999887766");
  });
  it("adds 55 prefix when missing", () => {
    expect(normalizePhoneBR("11999887766")).toBe("5511999887766");
  });
  it("strips formatting characters", () => {
    expect(normalizePhoneBR("(11) 9 9988-7766")).toBe("5511999887766");
  });
  it("strips dashes and dots", () => {
    expect(normalizePhoneBR("+55 11 99988-7766")).toBe("5511999887766");
  });
});

describe("isValidWhatsappNumber", () => {
  it("accepts valid 13-digit BR number (with 55)", () => {
    expect(isValidWhatsappNumber("5511999887766")).toBe(true);
  });
  it("accepts valid 11-digit BR number (without 55)", () => {
    expect(isValidWhatsappNumber("11999887766")).toBe(true);
  });
  it("accepts valid 10-digit BR number (landline without 55)", () => {
    expect(isValidWhatsappNumber("1133334444")).toBe(true);
  });
  it("rejects too short number", () => {
    expect(isValidWhatsappNumber("119998")).toBe(false);
  });
  it("rejects empty string", () => {
    expect(isValidWhatsappNumber("")).toBe(false);
  });
});

describe("buildWaTemplateComponents", () => {
  it("builds correct template with all fields", () => {
    const comps = buildWaTemplateComponents({
      nome: "João Silva",
      pedidoId: "abc12345-6789",
      totalPecas: 5,
    });
    expect(comps[0].parameters[0].text).toBe("João Silva");
    expect(comps[0].parameters[1].text).toBe("ABC12345");
    expect(comps[0].parameters[2].text).toBe("5");
  });

  it("uses — when totalPecas is not provided", () => {
    const comps = buildWaTemplateComponents({ nome: "Maria", pedidoId: "xyz" });
    expect(comps[0].parameters[2].text).toBe("—");
  });

  it("truncates pedidoId to 8 chars uppercase", () => {
    const comps = buildWaTemplateComponents({
      nome: "Test",
      pedidoId: "abcdefgh-ijkl-mnop",
    });
    expect(comps[0].parameters[1].text).toBe("ABCDEFGH");
  });
});
