/** Detecção de cadastros de cliente repetidos (mesmo CPF/CNPJ ou mesmo nome). */
import type { Cliente } from "@/types/comercial";

const soDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
export const normalizarNome = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(ltda|me|epp|eireli|s\.?a\.?|sa)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Agrupa clientes repetidos: primeiro por documento, depois por nome normalizado. */
export function agruparDuplicados(clientes: Cliente[]): Cliente[][] {
  const pai = new Map<string, string>();
  const achar = (id: string): string => { const p = pai.get(id) ?? id; if (p === id) return id; const r = achar(p); pai.set(id, r); return r; };
  const unir = (a: string, b: string) => { const ra = achar(a), rb = achar(b); if (ra !== rb) pai.set(rb, ra); };
  const porChave = new Map<string, string>();
  for (const c of clientes) {
    const doc = soDigitos(c.documento);
    const chaves = [doc.length >= 11 ? `d:${doc}` : null, normalizarNome(c.nome).length >= 3 ? `n:${normalizarNome(c.nome)}` : null];
    for (const k of chaves) {
      if (!k) continue;
      const outro = porChave.get(k);
      if (outro) unir(outro, c.id); else porChave.set(k, c.id);
    }
  }
  const grupos = new Map<string, Cliente[]>();
  for (const c of clientes) {
    const r = achar(c.id);
    if (!grupos.has(r)) grupos.set(r, []);
    grupos.get(r)!.push(c);
  }
  return [...grupos.values()].filter(g => g.length > 1);
}

