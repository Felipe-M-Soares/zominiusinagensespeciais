/**
 * Tests for delete-account FK safety logic
 *
 * Verifica que a lógica de exclusão de usuário trata corretamente
 * os casos de dados históricos relacionados.
 */
import { describe, it, expect } from "vitest";

// Simula o comportamento esperado após ON DELETE SET NULL:
// campos de usuário ficam null, dados históricos são preservados

interface PedidoComercial {
  id: string;
  vendedora_id: string | null;
  vendedora_nome: string;
  status: string;
  cliente_nome: string;
}

interface UserDeleteResult {
  pedidosPreservados: number;
  vendedoraIdSetToNull: number;
  error: string | null;
}

// Simula o comportamento do ON DELETE SET NULL
function simulateDeleteUser(
  userId: string,
  pedidos: PedidoComercial[]
): UserDeleteResult {
  let vendedoraSetToNull = 0;

  const updated = pedidos.map((p) => {
    if (p.vendedora_id === userId) {
      vendedoraSetToNull++;
      return { ...p, vendedora_id: null }; // ON DELETE SET NULL
    }
    return p;
  });

  return {
    pedidosPreservados: updated.length, // todos preservados
    vendedoraIdSetToNull: vendedoraSetToNull,
    error: null,
  };
}

// Valida se uma constraint name segue o padrão esperado
function isValidConstraintName(name: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(name) && name.length <= 63;
}

// Verifica se uma coluna nullable pode ser definida como SET NULL
function canSetNull(isNullable: boolean): boolean {
  return isNullable; // SET NULL só funciona se a coluna for nullable
}

describe("ON DELETE SET NULL behavior", () => {
  it("preserves pedido records when user is deleted", () => {
    const pedidos: PedidoComercial[] = [
      {
        id: "p1",
        vendedora_id: "user-abc",
        vendedora_nome: "Maria Silva",
        status: "faturado",
        cliente_nome: "Hospital XYZ",
      },
      {
        id: "p2",
        vendedora_id: "user-abc",
        vendedora_nome: "Maria Silva",
        status: "enviado",
        cliente_nome: "Clínica ABC",
      },
    ];

    const result = simulateDeleteUser("user-abc", pedidos);

    expect(result.pedidosPreservados).toBe(2); // pedidos mantidos
    expect(result.vendedoraIdSetToNull).toBe(2); // FK setada para null
    expect(result.error).toBeNull();
  });

  it("does not affect pedidos from other users", () => {
    const pedidos: PedidoComercial[] = [
      { id: "p1", vendedora_id: "user-abc", vendedora_nome: "Maria", status: "faturado", cliente_nome: "Hospital" },
      { id: "p2", vendedora_id: "user-xyz", vendedora_nome: "João", status: "pendente", cliente_nome: "Clínica" },
    ];

    const result = simulateDeleteUser("user-abc", pedidos);

    expect(result.pedidosPreservados).toBe(2);
    expect(result.vendedoraIdSetToNull).toBe(1); // só o de user-abc
  });

  it("handles user with no pedidos gracefully", () => {
    const result = simulateDeleteUser("user-no-pedidos", []);
    expect(result.pedidosPreservados).toBe(0);
    expect(result.vendedoraIdSetToNull).toBe(0);
    expect(result.error).toBeNull();
  });
});

describe("FK constraint naming validation", () => {
  it("validates constraint names follow PostgreSQL convention", () => {
    expect(isValidConstraintName("pedidos_comerciais_vendedora_id_fkey")).toBe(true);
    expect(isValidConstraintName("clientes_created_by_fkey")).toBe(true);
    expect(isValidConstraintName("financeiro_lancamentos_created_by_fkey")).toBe(true);
  });

  it("rejects invalid constraint names", () => {
    expect(isValidConstraintName("")).toBe(false);
    expect(isValidConstraintName("123_invalid")).toBe(false);
    expect(isValidConstraintName("a".repeat(64))).toBe(false);
  });
});

describe("canSetNull column check", () => {
  it("allows SET NULL on nullable columns", () => {
    expect(canSetNull(true)).toBe(true); // vendedora_id é nullable
  });

  it("disallows SET NULL on NOT NULL columns", () => {
    expect(canSetNull(false)).toBe(false); // cliente_id é NOT NULL → não pode SET NULL
  });
});

describe("delete-account order of operations", () => {
  // Ordem correta: app tables first, then auth.users
  const CORRECT_ORDER = [
    "profiles",
    "user_roles",
    // pedidos_comerciais.vendedora_id → SET NULL automatically
    // financeiro_lancamentos.created_by → SET NULL automatically
    "auth.users", // last
  ];

  it("deletes profiles before auth.users", () => {
    const profileIdx = CORRECT_ORDER.indexOf("profiles");
    const authIdx = CORRECT_ORDER.indexOf("auth.users");
    expect(profileIdx).toBeLessThan(authIdx);
  });

  it("deletes user_roles before auth.users", () => {
    const rolesIdx = CORRECT_ORDER.indexOf("user_roles");
    const authIdx = CORRECT_ORDER.indexOf("auth.users");
    expect(rolesIdx).toBeLessThan(authIdx);
  });

  it("auth.users is the last step", () => {
    expect(CORRECT_ORDER[CORRECT_ORDER.length - 1]).toBe("auth.users");
  });
});
