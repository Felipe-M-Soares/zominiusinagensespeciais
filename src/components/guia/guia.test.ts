import { describe, expect, it } from "vitest";
import {
  FAQ_GUIA, FLUXO_VENDA, GLOSSARIO_GUIA, PERFIS_GUIA, SECOES_GUIA, ancoraTarefa, normalizarBusca,
} from "./conteudo";
import { filtrarFaq, filtrarSecoes, perfilUsa } from "./busca";
import { APP_ROLES } from "@/types/roles";

const ancoras = SECOES_GUIA.flatMap(s => s.tarefas.map(t => ancoraTarefa(s.id, t.id)));

describe("Guia de uso — conteúdo", () => {
  it("âncoras são únicas e só usam letras minúsculas, números e hífen", () => {
    expect(new Set(ancoras).size).toBe(ancoras.length);
    for (const a of ancoras) expect(a).toMatch(/^[a-z0-9-]+$/);
  });

  it("links do fluxo e das perguntas apontam para tarefas que existem", () => {
    for (const e of FLUXO_VENDA) if (e.ancora) expect(ancoras).toContain(e.ancora);
    for (const p of FAQ_GUIA) if (p.ancora) expect(ancoras).toContain(p.ancora);
  });

  it("toda tarefa tem passos e todo perfil está descrito", () => {
    for (const s of SECOES_GUIA) for (const t of s.tarefas) expect(t.passos.length).toBeGreaterThan(0);
    expect(PERFIS_GUIA.map(p => p.role).sort()).toEqual([...APP_ROLES].sort());
    expect(GLOSSARIO_GUIA.length).toBeGreaterThan(10);
  });

  it("não expõe nada operacional sensível", () => {
    const tudo = JSON.stringify({ SECOES_GUIA, FAQ_GUIA, GLOSSARIO_GUIA, FLUXO_VENDA, PERFIS_GUIA });
    expect(tudo).not.toMatch(/supabase|service.?role|edge function|https?:\/\/|\bsql\b|\btoken\b|\brpc\b/i);
  });
});

describe("Guia de uso — busca e perfis", () => {
  it("busca ignora acento e maiúsculas", () => {
    expect(normalizarBusca("Expedição NF-e")).toBe("expedicao nf-e");
    const r = filtrarSecoes(SECOES_GUIA, { q: "EXPEDICAO", role: "admin", soMeuPerfil: false });
    expect(r.length).toBeGreaterThan(0);
  });

  it("admin vê tudo; gerente vê tudo menos o que é só de admin", () => {
    expect(perfilUsa("admin", ["admin"])).toBe(true);
    expect(perfilUsa("gerente", ["admin"])).toBe(false);
    expect(perfilUsa("gerente", ["estoque"])).toBe(true);
    const total = SECOES_GUIA.reduce((n, s) => n + s.tarefas.length, 0);
    const admin = filtrarSecoes(SECOES_GUIA, { q: "", role: "admin", soMeuPerfil: true }).reduce((n, s) => n + s.tarefas.length, 0);
    expect(admin).toBe(total);
    const ger = filtrarSecoes(SECOES_GUIA, { q: "", role: "gerente", soMeuPerfil: true });
    expect(ger.find(s => s.secao.id === "admin")).toBeUndefined();
  });

  it("vendedora vê Comercial e Primeiros passos, mas não Estoque", () => {
    const ids = filtrarSecoes(SECOES_GUIA, { q: "", role: "comercial", soMeuPerfil: true }).map(s => s.secao.id);
    expect(ids).toContain("comercial");
    expect(ids).toContain("inicio");
    expect(ids).not.toContain("estoque");
    expect(ids).not.toContain("financeiro");
    // Tarefa só de gerente/admin dentro do Comercial fica escondida.
    const com = filtrarSecoes(SECOES_GUIA, { q: "", role: "comercial", soMeuPerfil: true }).find(s => s.secao.id === "comercial")!;
    expect(com.tarefas.map(t => t.id)).not.toContain("clientes-repetidos");
    expect(filtrarFaq(FAQ_GUIA, { q: "", role: "comercial", soMeuPerfil: true }).every(p => !p.perfis || p.perfis.includes("comercial"))).toBe(true);
  });

  it("sem o filtro de perfil, qualquer um pode ler o guia inteiro", () => {
    const ids = filtrarSecoes(SECOES_GUIA, { q: "", role: "estoque", soMeuPerfil: false }).map(s => s.secao.id);
    expect(ids).toEqual(SECOES_GUIA.map(s => s.id));
  });
});
