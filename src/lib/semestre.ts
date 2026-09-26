/**
 * Dados consolidados do semestre de produção (Desempenho → Semestre e
 * apresentação para reunião). Usa as mesmas RPCs do painel mensal —
 * resumo_mensal_producao (1 por mês) + calcular_oee (semestre inteiro).
 */
import { supabase } from "@/integrations/supabase/client";
import { META_SEMESTRE_CODIGO, periodoSemestre } from "@/components/producao/MetasPanel";

export const MESES_CURTOS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

export interface OEE {
  hr_planejadas: number; hr_paradas: number; hr_disponiveis: number;
  disponibilidade: number; performance: number; qualidade: number; oee: number;
  qtde_planejada: number; qtde_produzida: number; total_refugo: number;
}
export interface MesSemestre extends OEE { mes: number; label: string; temDados: boolean; }
export interface MaquinaSemestre { maquina: string; horas: number; produzido: number; planejado: number; performance: number; }
export interface ItemTipo { tipo: string; valor: number; ocorrencias: number; }

export interface DadosSemestre {
  semestre: 1 | 2; ano: number; ini: string; fim: string;
  geral: OEE;
  meses: MesSemestre[];
  maquinas: MaquinaSemestre[];
  paradas: ItemTipo[];   // valor = horas
  refugos: ItemTipo[];   // valor = peças
  metaProdutividade: number | null;
  geradoEm: Date;
}

const num = (v: unknown) => Number(v) || 0;
function oee(o: unknown): OEE {
  const x = (o ?? {}) as Record<string, unknown>;
  return {
    hr_planejadas: num(x.hr_planejadas), hr_paradas: num(x.hr_paradas), hr_disponiveis: num(x.hr_disponiveis),
    disponibilidade: num(x.disponibilidade), performance: num(x.performance), qualidade: num(x.qualidade), oee: num(x.oee),
    qtde_planejada: num(x.qtde_planejada), qtde_produzida: num(x.qtde_produzida), total_refugo: num(x.total_refugo),
  };
}

export function semestreAtual(d = new Date()): { semestre: 1 | 2; ano: number } {
  return { semestre: d.getMonth() < 6 ? 1 : 2, ano: d.getFullYear() };
}

export async function carregarSemestre(semestre: 1 | 2, ano: number): Promise<DadosSemestre> {
  const per = periodoSemestre(semestre, ano);
  const mesesNums = semestre === 1 ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12];

  const [geralRes, metaRes, ...mensais] = await Promise.all([
    supabase.rpc("calcular_oee", { p_data_ini: per.ini, p_data_fim: per.fim }),
    supabase.from("metas_producao").select("meta_oee_pct")
      .eq("ano", ano).eq("mes", semestre === 1 ? 1 : 7).eq("maquina_codigo", META_SEMESTRE_CODIGO).maybeSingle(),
    ...mesesNums.map(m => supabase.rpc("resumo_mensal_producao", { p_mes: m, p_ano: ano })),
  ]);
  if (geralRes.error) throw geralRes.error;

  const porMaquina = new Map<string, MaquinaSemestre>();
  const paradas = new Map<string, ItemTipo>();
  const refugos = new Map<string, ItemTipo>();

  const meses: MesSemestre[] = mensais.map((r, i) => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    for (const m of (d.por_maquina as Record<string, unknown>[] | undefined) ?? []) {
      const k = String(m.maquina ?? "—");
      const cur = porMaquina.get(k) ?? { maquina: k, horas: 0, produzido: 0, planejado: 0, performance: 0 };
      cur.horas += num(m.hr_planejadas); cur.produzido += num(m.qtde_produzida); cur.planejado += num(m.qtde_planejada);
      porMaquina.set(k, cur);
    }
    for (const p of (d.paradas_por_tipo as Record<string, unknown>[] | undefined) ?? []) {
      const k = String(p.tipo ?? "Outros");
      const cur = paradas.get(k) ?? { tipo: k, valor: 0, ocorrencias: 0 };
      cur.valor += num(p.total_horas); cur.ocorrencias += num(p.ocorrencias);
      paradas.set(k, cur);
    }
    for (const p of (d.refugos_por_tipo as Record<string, unknown>[] | undefined) ?? []) {
      const k = String(p.tipo ?? "Outros");
      const cur = refugos.get(k) ?? { tipo: k, valor: 0, ocorrencias: 0 };
      cur.valor += num(p.total); cur.ocorrencias += num(p.ocorrencias);
      refugos.set(k, cur);
    }
    const g = oee(d.geral);
    return { ...g, mes: mesesNums[i], label: MESES_CURTOS[mesesNums[i] - 1], temDados: g.hr_planejadas > 0 };
  });

  const maquinas = [...porMaquina.values()]
    .map(m => ({ ...m, performance: m.planejado > 0 ? (m.produzido / m.planejado) * 100 : 0 }))
    .sort((a, b) => a.maquina.localeCompare(b.maquina));

  return {
    semestre, ano, ini: per.ini, fim: per.fim,
    geral: oee(geralRes.data),
    meses, maquinas,
    paradas: [...paradas.values()].sort((a, b) => b.valor - a.valor),
    refugos: [...refugos.values()].sort((a, b) => b.valor - a.valor),
    metaProdutividade: metaRes.data ? num((metaRes.data as { meta_oee_pct?: number }).meta_oee_pct) || null : null,
    geradoEm: new Date(),
  };
}

export const fmtPct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;
export const fmtNum = (v: number) => Math.round(v).toLocaleString("pt-BR");
export const fmtHoras = (v: number) => `${v.toFixed(1).replace(".", ",")} h`;
