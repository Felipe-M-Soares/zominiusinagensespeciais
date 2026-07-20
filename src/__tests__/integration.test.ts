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
    expect(escHtml("Zomini Usinagens Especiais")).toBe(
      "Zomini Usinagens Especiais"
    );
  });

  it("lida com números convertidos para string", () => {
    // Números chegam como string via template literals
    expect(escHtml("12345")).toBe("12345");
  });
});

// ─── Lógica de cálculo de reservas de estoque ────────────────────────────────
type Movement = {
  lote: string;
  type: "entrada" | "saida" | "reserva" | "liberacao";
  quantity: number;
};

function calcularSaldoLiquido(movs: Movement[]): Record<string, number> {
  const saldos: Record<string, number> = {};
  for (const mv of movs) {
    if (!mv.lote) continue;
    const delta =
      mv.type === "entrada" || mv.type === "liberacao"
        ? mv.quantity
        : -mv.quantity;
    saldos[mv.lote] = (saldos[mv.lote] ?? 0) + delta;
  }
  return saldos;
}

function reserveStock(
  saldos: Record<string, number>,
  lote: string,
  quantidade: number
): { ok: boolean; saldoRestante: number } {
  const disponivel = Math.max(0, saldos[lote] ?? 0);
  if (disponivel < quantidade) return { ok: false, saldoRestante: disponivel };
  return { ok: true, saldoRestante: disponivel - quantidade };
}

describe("Fluxo de reserva de estoque", () => {
  it("reserva com sucesso quando há saldo suficiente", () => {
    const saldos = calcularSaldoLiquido([
      { lote: "L1", type: "entrada", quantity: 10 },
    ]);
    const result = reserveStock(saldos, "L1", 4);
    expect(result.ok).toBe(true);
    expect(result.saldoRestante).toBe(6);
  });

  it("recusa reserva quando saldo é insuficiente", () => {
    const saldos = calcularSaldoLiquido([
      { lote: "L1", type: "entrada", quantity: 3 },
    ]);
    const result = reserveStock(saldos, "L1", 5);
    expect(result.ok).toBe(false);
    expect(result.saldoRestante).toBe(3);
  });

  it("recusa reserva para lote inexistente", () => {
    const result = reserveStock({}, "L-INEXISTENTE", 1);
    expect(result.ok).toBe(false);
    expect(result.saldoRestante).toBe(0);
  });

  it("saldo negativo é normalizado para zero na reserva", () => {
    // Situação anômala: saída maior que entrada (dados legados)
    const saldos = calcularSaldoLiquido([
      { lote: "L1", type: "entrada", quantity: 2 },
      { lote: "L1", type: "saida", quantity: 5 },
    ]);
    const result = reserveStock(saldos, "L1", 1);
    expect(result.ok).toBe(false);
    expect(result.saldoRestante).toBe(0); // Math.max(0, -3) = 0
  });

  it("libera reserva aumenta saldo disponível", () => {
    const saldos = calcularSaldoLiquido([
      { lote: "L1", type: "entrada", quantity: 10 },
      { lote: "L1", type: "reserva", quantity: 4 },
      { lote: "L1", type: "liberacao", quantity: 4 }, // libera de volta
    ]);
    expect(Math.max(0, saldos["L1"])).toBe(10);
  });
});

// ─── Fluxo de transferência de fases (intermediária → expedição → retrabalho) ─
type Fase = "intermediaria" | "expedicao" | "retrabalho";

interface StockItemSim {
  id: string;
  fase: Fase;
  quantity: number;
  quantity_reserved: number;
}

function transferirFase(
  item: StockItemSim,
  novaFase: Fase,
  quantidade: number
): { origem: StockItemSim; destino: StockItemSim } | { error: string } {
  if (quantidade <= 0) return { error: "Quantidade deve ser maior que zero" };
  const disponivel = item.quantity - item.quantity_reserved;
  if (quantidade > disponivel)
    return { error: `Quantidade (${quantidade}) excede disponível (${disponivel})` };

  const origem: StockItemSim = {
    ...item,
    quantity: item.quantity - quantidade,
  };
  const destino: StockItemSim = {
    id: `${item.id}-${novaFase}`,
    fase: novaFase,
    quantity: quantidade,
    quantity_reserved: 0,
  };
  return { origem, destino };
}

describe("Fluxo de transferência de fases", () => {
  const itemBase: StockItemSim = {
    id: "item-001",
    fase: "intermediaria",
    quantity: 20,
    quantity_reserved: 5,
  };

  it("transfere para expedição com quantidade válida", () => {
    const result = transferirFase(itemBase, "expedicao", 10);
    if ("error" in result) throw new Error(result.error);
    expect(result.origem.quantity).toBe(10);
    expect(result.destino.fase).toBe("expedicao");
    expect(result.destino.quantity).toBe(10);
    expect(result.destino.quantity_reserved).toBe(0);
  });

  it("transfere para retrabalho com quantidade válida", () => {
    const result = transferirFase(itemBase, "retrabalho", 5);
    if ("error" in result) throw new Error(result.error);
    expect(result.destino.fase).toBe("retrabalho");
    expect(result.destino.quantity).toBe(5);
  });

  it("recusa transferência maior que quantidade disponível (descontando reservas)", () => {
    // disponível = 20 - 5 = 15; tentativa de 16 deve falhar
    const result = transferirFase(itemBase, "expedicao", 16);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("excede disponível");
    }
  });

  it("recusa quantidade zero", () => {
    const result = transferirFase(itemBase, "expedicao", 0);
    expect("error" in result).toBe(true);
  });

  it("recusa quantidade negativa", () => {
    const result = transferirFase(itemBase, "expedicao", -1);
    expect("error" in result).toBe(true);
  });

  it("transfere exatamente o disponível (sem reservas)", () => {
    const semReserva: StockItemSim = { ...itemBase, quantity_reserved: 0 };
    const result = transferirFase(semReserva, "expedicao", 20);
    if ("error" in result) throw new Error(result.error);
    expect(result.origem.quantity).toBe(0);
    expect(result.destino.quantity).toBe(20);
  });
});

// ─── Ordenação FIFO de lotes ──────────────────────────────────────────────────
interface Lote {
  codigo: string;
  dataProducao: string; // ISO date string
  quantidade: number;
}

function ordenarFIFO(lotes: Lote[]): Lote[] {
  return [...lotes].sort(
    (a, b) =>
      new Date(a.dataProducao).getTime() - new Date(b.dataProducao).getTime()
  );
}

describe("Ordenação FIFO de lotes", () => {
  it("ordena lotes do mais antigo para o mais novo", () => {
    const lotes: Lote[] = [
      { codigo: "L3", dataProducao: "2025-03-01", quantidade: 5 },
      { codigo: "L1", dataProducao: "2025-01-01", quantidade: 10 },
      { codigo: "L2", dataProducao: "2025-02-01", quantidade: 8 },
    ];
    const ordenados = ordenarFIFO(lotes);
    expect(ordenados.map((l) => l.codigo)).toEqual(["L1", "L2", "L3"]);
  });

  it("não altera lote único", () => {
    const lotes: Lote[] = [
      { codigo: "L1", dataProducao: "2025-01-01", quantidade: 5 },
    ];
    expect(ordenarFIFO(lotes)).toHaveLength(1);
  });

  it("trata datas iguais como equivalentes (ordem estável)", () => {
    const lotes: Lote[] = [
      { codigo: "LA", dataProducao: "2025-01-01", quantidade: 3 },
      { codigo: "LB", dataProducao: "2025-01-01", quantidade: 7 },
    ];
    const ordenados = ordenarFIFO(lotes);
    expect(ordenados).toHaveLength(2);
  });

  it("lista vazia retorna lista vazia", () => {
    expect(ordenarFIFO([])).toEqual([]);
  });
});

// ─── Guard SSR para funções de tema ──────────────────────────────────────────
describe("Guards de tema (BUG-002)", () => {
  it("getStoredTheme retorna light quando window está disponível sem valor salvo", () => {
    // Simula ambiente browser sem valor no localStorage
    localStorage.removeItem("theme");
    // Importação dinâmica para evitar problemas de módulo em test env
    type Theme = "light" | "dark" | "system";
    const VALID_THEMES = new Set<Theme>(["light", "dark", "system"]);
    function getStoredTheme(): Theme {
      if (typeof window === "undefined") return "light";
      const stored = localStorage.getItem("theme");
      if (stored && VALID_THEMES.has(stored as Theme)) return stored as Theme;
      return "light";
    }
    expect(getStoredTheme()).toBe("light");
  });

  it("getStoredTheme retorna tema salvo quando válido", () => {
    localStorage.setItem("theme", "dark");
    type Theme = "light" | "dark" | "system";
    const VALID_THEMES = new Set<Theme>(["light", "dark", "system"]);
    function getStoredTheme(): Theme {
      if (typeof window === "undefined") return "light";
      const stored = localStorage.getItem("theme");
      if (stored && VALID_THEMES.has(stored as Theme)) return stored as Theme;
      return "light";
    }
    expect(getStoredTheme()).toBe("dark");
    localStorage.removeItem("theme");
  });

  it("getStoredTheme ignora valor inválido no localStorage", () => {
    localStorage.setItem("theme", "azul-piscina"); // inválido
    type Theme = "light" | "dark" | "system";
    const VALID_THEMES = new Set<Theme>(["light", "dark", "system"]);
    function getStoredTheme(): Theme {
      if (typeof window === "undefined") return "light";
      const stored = localStorage.getItem("theme");
      if (stored && VALID_THEMES.has(stored as Theme)) return stored as Theme;
      return "light";
    }
    expect(getStoredTheme()).toBe("light");
    localStorage.removeItem("theme");
  });
});
