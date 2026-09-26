/**
 * Testes das funções reais adicionadas/corrigidas na revisão de set/2026.
 * (Os testes antigos de "espelho" — que copiavam a função para dentro do
 * teste em vez de importá-la — foram removidos: passavam mesmo com o código
 * do app quebrado.)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getStoredTheme, applyTheme, resolveTheme } from "@/lib/theme";
import { getHomeRoute, canAccessRoute, APP_ROLES } from "@/types/roles";
import { formatarDocumento, formatarTelefone, somenteDigitos, buscarCep, buscarCnpj } from "@/lib/brasilApi";

describe("tema", () => {
  beforeEach(() => { localStorage.removeItem("theme"); document.documentElement.classList.remove("dark"); });

  it("padrão é claro quando nada foi salvo", () => {
    expect(getStoredTheme()).toBe("light");
  });

  it("ignora valor inválido salvo", () => {
    localStorage.setItem("theme", "azul-piscina");
    expect(getStoredTheme()).toBe("light");
  });

  it("applyTheme('dark') aplica a classe e persiste", () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("resolveTheme('system') segue o sistema operacional", () => {
    const mm = vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) => ({ matches: q.includes("dark"), media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
    );
    expect(resolveTheme("system")).toBe("dark");
    mm.mockRestore();
  });
});

describe("rota inicial por perfil", () => {
  it("cada perfil cai numa rota que ele pode acessar", () => {
    for (const r of APP_ROLES) {
      expect(canAccessRoute(r, getHomeRoute(r))).toBe(true);
    }
  });

  it("comercial/financeiro/processos NÃO caem em Componentes", () => {
    expect(getHomeRoute("comercial")).toBe("/comercial");
    expect(getHomeRoute("financeiro")).toBe("/financeiro");
    expect(getHomeRoute("processos")).toBe("/processos");
    expect(canAccessRoute("comercial", "/")).toBe(false);
  });

  it("sem perfil não acessa nada; admin acessa tudo", () => {
    expect(canAccessRoute(null, "/")).toBe(false);
    expect(canAccessRoute("admin", "/financeiro")).toBe(true);
  });
});

describe("máscaras de documento e telefone", () => {
  it("formata CPF e CNPJ progressivamente", () => {
    expect(formatarDocumento("12345678909")).toBe("123.456.789-09");
    expect(formatarDocumento("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatarDocumento("123")).toBe("123");
  });

  it("formata telefone fixo e celular", () => {
    expect(formatarTelefone("1133334444")).toBe("(11) 3333-4444");
    expect(formatarTelefone("11987654321")).toBe("(11) 98765-4321");
  });

  it("somenteDigitos remove máscara", () => {
    expect(somenteDigitos("11.222.333/0001-81")).toBe("11222333000181");
  });
});

describe("consultas CEP/CNPJ (BrasilAPI com fallback)", () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => { globalThis.fetch = origFetch; });

  it("CEP: usa ViaCEP quando a BrasilAPI falha", async () => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("brasilapi")) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ logradouro: "Rua A", bairro: "Centro", localidade: "Caxias do Sul", uf: "RS" }), { status: 200 });
    }) as typeof fetch;
    const r = await buscarCep("95010-000");
    expect(r?.municipio).toBe("Caxias do Sul");
    expect(r?.uf).toBe("RS");
  });

  it("CEP inválido não faz requisição", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    expect(await buscarCep("123")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("CNPJ: normaliza endereço e telefone", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      razao_social: "EMPRESA TESTE LTDA", cep: "95010000", descricao_tipo_de_logradouro: "RUA",
      logradouro: "SINIMBU", numero: "100", bairro: "CENTRO", municipio: "CAXIAS DO SUL", uf: "rs",
      ddd_telefone_1: "5432221111", email: "CONTATO@TESTE.COM.BR", descricao_situacao_cadastral: "ATIVA",
    }), { status: 200 })) as typeof fetch;
    const r = await buscarCnpj("11.222.333/0001-81");
    expect(r?.razaoSocial).toBe("EMPRESA TESTE LTDA");
    expect(r?.logradouro).toBe("Rua Sinimbu");
    expect(r?.municipio).toBe("Caxias do Sul");
    expect(r?.uf).toBe("RS");
    expect(r?.telefone).toBe("(54) 3222-1111");
    expect(r?.email).toBe("contato@teste.com.br");
  });
});
