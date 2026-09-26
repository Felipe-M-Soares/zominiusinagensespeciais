import { describe, it, expect } from "vitest";
import { escHtml } from "@/lib/escHtml";

// ─── escHtml — prevenção de XSS em templates de impressão ────────────────────
describe("escHtml", () => {
  it("escapa & antes de qualquer outro caractere (sem double-escape)", () => {
    expect(escHtml("a & b")).toBe("a &amp; b");
    expect(escHtml("&amp;")).toBe("&amp;amp;");
  });

  it("escapa < e >", () => {
    expect(escHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;"
    );
  });

  it("escapa aspas duplas e simples", () => {
    expect(escHtml(`"onclick="alert(1)`)).toBe("&quot;onclick=&quot;alert(1)");
    expect(escHtml("it's fine")).toBe("it&#39;s fine");
  });

  it("escapa uma string com todos os caracteres especiais", () => {
    expect(escHtml(`<b class="x" id='y'>&`)).toBe(
      "&lt;b class=&quot;x&quot; id=&#39;y&#39;&gt;&amp;"
    );
  });

  it("retorna string vazia para null e undefined", () => {
    expect(escHtml(null)).toBe("");
    expect(escHtml(undefined)).toBe("");
    expect(escHtml("")).toBe("");
  });

  it("não altera texto sem caracteres especiais", () => {
    expect(escHtml("Concept Usinagens Especiais")).toBe(
      "Concept Usinagens Especiais"
    );
  });

  it("lida com números convertidos para string", () => {
    // Números chegam como string via template literals
    expect(escHtml("12345")).toBe("12345");
  });
});
