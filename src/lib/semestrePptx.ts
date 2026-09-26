/**
 * Gera a apresentação (.pptx) do desempenho semestral para a reunião mestra.
 * Gráficos são NATIVOS do PowerPoint (editáveis: dá para trocar cor, título,
 * clicar e ver os valores). Biblioteca carregada só quando o usuário baixa.
 */
import type { DadosSemestre } from "@/lib/semestre";
import type PptxGenJSType from "pptxgenjs";
type Slide = ReturnType<PptxGenJSType["addSlide"]>;
import { fmtHoras, fmtNum, fmtPct } from "@/lib/semestre";
import logoUrl from "@/assets/logo_zomini.png";
import { COMPANY_NAME } from "@/lib/appInfo";

const C = {
  ink: "1F2430", muted: "6B7280", line: "E5E7EB", bg: "F6F7F9",
  primary: "0B7FB0", primaryLight: "9CCFE6", brand: "EF6A1F",
  good: "16A34A", warn: "D97706", bad: "DC2626",
};
const FONT = "Calibri";

function corOee(v: number) { return v >= 85 ? C.good : v >= 65 ? C.warn : C.bad; }

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(blob); });
  } catch { return null; }
}

export async function gerarApresentacaoSemestre(d: DadosSemestre): Promise<void> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pres.author = COMPANY_NAME;
  pres.company = COMPANY_NAME;
  const titulo = `Desempenho da Produção — ${d.semestre}º Semestre ${d.ano}`;
  pres.title = titulo;

  const logo = await toDataUrl(logoUrl);
  const periodo = `${d.meses[0].label}–${d.meses[d.meses.length - 1].label}/${d.ano}`;
  const mesesComDados = d.meses.filter(m => m.temDados);
  // Nos gráficos, vai só até o último mês com lançamento (meses futuros não
  // aparecem como zero).
  const ultimo = d.meses.map(m => m.temDados).lastIndexOf(true);
  const mesesGraf = d.meses.slice(0, Math.max(0, ultimo) + 1);

  pres.defineSlideMaster({
    title: "PADRAO",
    background: { color: "FFFFFF" },
    objects: [
      { rect: { x: 0, y: 7.1, w: 13.33, h: 0.4, fill: { color: C.bg } } },
      { text: { text: `${COMPANY_NAME} · ${titulo}`, options: { x: 0.5, y: 7.12, w: 9, h: 0.35, fontFace: FONT, fontSize: 10, color: C.muted } } },
      ...(logo ? [{ image: { data: logo, x: 11.6, y: 7.16, w: 1.14, h: 0.3 } }] : []),
    ],
    slideNumber: { x: 10.9, y: 7.16, fontFace: FONT, fontSize: 10, color: C.muted },
  });

  const cabecalho = (s: Slide, t: string, sub?: string) => {
    s.addText(t, { x: 0.5, y: 0.35, w: 12.3, h: 0.6, fontFace: FONT, fontSize: 26, bold: true, color: C.ink });
    if (sub) s.addText(sub, { x: 0.5, y: 0.95, w: 12.3, h: 0.4, fontFace: FONT, fontSize: 13, color: C.muted });
    s.addShape(pres.ShapeType.rect, { x: 0.5, y: 1.4, w: 0.8, h: 0.06, fill: { color: C.brand }, line: { color: C.brand } });
  };
  const semDados = (s: Slide) =>
    s.addText("Sem lançamentos neste período.", { x: 0.5, y: 3.2, w: 12.3, h: 0.6, align: "center", fontFace: FONT, fontSize: 18, color: C.muted });

  // 1. Capa
  {
    const s = pres.addSlide();
    s.background = { color: "0C1220" };
    s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: C.brand }, line: { color: C.brand } });
    if (logo) s.addImage({ data: logo, x: 0.9, y: 0.8, w: 2.66, h: 0.7 });
    s.addText("Reunião de resultados", { x: 0.9, y: 2.6, w: 11, h: 0.5, fontFace: FONT, fontSize: 18, color: "9CA3AF" });
    s.addText(`Desempenho da Produção`, { x: 0.9, y: 3.1, w: 11, h: 0.9, fontFace: FONT, fontSize: 44, bold: true, color: "FFFFFF" });
    s.addText(`${d.semestre}º Semestre de ${d.ano}  ·  ${periodo}`, { x: 0.9, y: 4.0, w: 11, h: 0.6, fontFace: FONT, fontSize: 24, color: C.brand });
    s.addText(`Gerado em ${d.geradoEm.toLocaleDateString("pt-BR")} às ${d.geradoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
      { x: 0.9, y: 6.5, w: 11, h: 0.4, fontFace: FONT, fontSize: 12, color: "6B7280" });
  }

  // 2. Resumo executivo (KPIs)
  {
    const s = pres.addSlide({ masterName: "PADRAO" });
    cabecalho(s, "Resumo do semestre", `${periodo} · ${mesesComDados.length} de ${d.meses.length} meses com lançamentos`);
    const g = d.geral;
    const kpis: Array<{ l: string; v: string; c?: string }> = [
      { l: "OEE", v: fmtPct(g.oee), c: corOee(g.oee) },
      { l: "Disponibilidade", v: fmtPct(g.disponibilidade), c: corOee(g.disponibilidade) },
      { l: "Performance", v: fmtPct(g.performance), c: corOee(Math.min(g.performance, 100)) },
      { l: "Qualidade", v: fmtPct(g.qualidade), c: corOee(g.qualidade) },
      { l: "Peças produzidas", v: fmtNum(g.qtde_produzida) },
      { l: "Peças planejadas", v: fmtNum(g.qtde_planejada) },
      { l: "Refugo", v: `${fmtNum(g.total_refugo)} pç` },
      { l: "Horas paradas", v: fmtHoras(g.hr_paradas) },
    ];
    kpis.forEach((k, i) => {
      const col = i % 4, row = Math.floor(i / 4);
      const x = 0.5 + col * 3.1, y = 1.8 + row * 1.9;
      s.addShape(pres.ShapeType.roundRect, { x, y, w: 2.9, h: 1.65, rectRadius: 0.12, fill: { color: C.bg }, line: { color: C.line } });
      s.addText(k.l.toUpperCase(), { x: x + 0.2, y: y + 0.15, w: 2.5, h: 0.35, fontFace: FONT, fontSize: 11, bold: true, color: C.muted });
      s.addText(k.v, { x: x + 0.2, y: y + 0.55, w: 2.5, h: 0.8, fontFace: FONT, fontSize: 30, bold: true, color: k.c ?? C.ink });
    });
    {
      const meta = d.metaOee;
      const ok = d.geral.oee >= meta;
      const perda = Math.max(0, d.oeeSemParadas - d.geral.oee);
      s.addText([
        { text: "Meta de OEE do semestre: ", options: { color: C.muted } },
        { text: `${fmtPct(meta)}  ·  realizado ${fmtPct(d.geral.oee)}  `, options: { bold: true, color: C.ink } },
        { text: ok ? "✔ meta atingida" : `✖ faltam ${(meta - d.geral.oee).toFixed(1).replace(".", ",")} pontos`, options: { bold: true, color: ok ? C.good : C.bad } },
      ], { x: 0.5, y: 5.6, w: 12.3, h: 0.45, fontFace: FONT, fontSize: 16 });
      s.addText(`Sem as paradas o OEE seria ${fmtPct(d.oeeSemParadas)} — as ${fmtHoras(d.geral.hr_paradas)} paradas custaram ${perda.toFixed(1).replace(".", ",")} pontos.`,
        { x: 0.5, y: 6.02, w: 12.3, h: 0.4, fontFace: FONT, fontSize: 13, color: C.muted });
    }
    s.addText("OEE = Disponibilidade × Performance × Qualidade", { x: 0.5, y: 6.5, w: 12.3, h: 0.4, fontFace: FONT, fontSize: 11, color: C.muted, italic: true });
  }

  // 3. OEE mês a mês
  {
    const s = pres.addSlide({ masterName: "PADRAO" });
    cabecalho(s, "Evolução do OEE mês a mês", "Disponibilidade, performance, qualidade e OEE (%)");
    if (mesesComDados.length === 0) semDados(s);
    else {
      const labels = mesesGraf.map(m => m.label);
      s.addChart(pres.ChartType.line, [
        { name: "OEE", labels, values: mesesGraf.map(m => +m.oee.toFixed(1)) },
        { name: "Disponibilidade", labels, values: mesesGraf.map(m => +m.disponibilidade.toFixed(1)) },
        { name: "Performance", labels, values: mesesGraf.map(m => +m.performance.toFixed(1)) },
        { name: "Qualidade", labels, values: mesesGraf.map(m => +m.qualidade.toFixed(1)) },
      ], {
        x: 0.5, y: 1.7, w: 12.3, h: 5.2,
        chartColors: [C.primary, "7C3AED", C.brand, C.good],
        lineSize: 2, lineDataSymbol: "circle", lineDataSymbolSize: 8,
        showLegend: true, legendPos: "b", legendFontFace: FONT, legendFontSize: 12,
        catAxisLabelFontFace: FONT, catAxisLabelFontSize: 12, valAxisLabelFontFace: FONT, valAxisLabelFontSize: 11,
        valAxisMinVal: 0, valGridLine: { color: C.line, size: 1 }, catGridLine: { style: "none" },
        showValue: false,
      });
    }
  }

  // 4. Produção mês a mês
  {
    const s = pres.addSlide({ masterName: "PADRAO" });
    cabecalho(s, "Produção mês a mês", "Peças produzidas × planejadas");
    if (mesesComDados.length === 0) semDados(s);
    else {
      const labels = mesesGraf.map(m => m.label);
      s.addChart(pres.ChartType.bar, [
        { name: "Produzido", labels, values: mesesGraf.map(m => Math.round(m.qtde_produzida)) },
        { name: "Planejado", labels, values: mesesGraf.map(m => Math.round(m.qtde_planejada)) },
      ], {
        x: 0.5, y: 1.7, w: 12.3, h: 5.2, barDir: "col", barGapWidthPct: 60,
        chartColors: [C.primary, "C7CDD6"],
        showLegend: true, legendPos: "b", legendFontFace: FONT, legendFontSize: 12,
        catAxisLabelFontFace: FONT, catAxisLabelFontSize: 12, valAxisLabelFontFace: FONT, valAxisLabelFontSize: 11,
        valGridLine: { color: C.line, size: 1 },
        showValue: true, dataLabelFontSize: 10, dataLabelFontFace: FONT, dataLabelColor: C.ink, dataLabelFormatCode: "#,##0",
      });
    }
  }

  // 5. Por máquina
  {
    const s = pres.addSlide({ masterName: "PADRAO" });
    cabecalho(s, "Desempenho por máquina", "Performance = produzido ÷ planejado no semestre");
    if (d.maquinas.length === 0) semDados(s);
    else {
      const labels = d.maquinas.map(m => m.maquina);
      s.addChart(pres.ChartType.bar, [{ name: "Performance (%)", labels, values: d.maquinas.map(m => +m.performance.toFixed(1)) }], {
        x: 0.5, y: 1.7, w: 6.4, h: 5.2, barDir: "bar", chartColors: [C.primary],
        showLegend: false, catAxisLabelFontFace: FONT, catAxisLabelFontSize: 12, valAxisLabelFontFace: FONT, valAxisLabelFontSize: 11,
        valGridLine: { color: C.line, size: 1 }, valAxisMinVal: 0,
        showValue: true, dataLabelFontSize: 11, dataLabelFontFace: FONT, dataLabelColor: C.ink, dataLabelFormatCode: "0.0",
      });
      const head = ["Máquina", "Horas", "Produzido", "Planejado", "Perf."].map(t => ({ text: t, options: { bold: true, color: "FFFFFF", fill: { color: C.ink } } }));
      const rows = d.maquinas.map(m => [m.maquina, fmtHoras(m.horas), fmtNum(m.produzido), fmtNum(m.planejado), fmtPct(m.performance)]);
      s.addTable([head, ...rows.map(r => r.map(t => ({ text: t })))], {
        x: 7.2, y: 1.8, w: 5.6, fontFace: FONT, fontSize: 12, color: C.ink,
        border: { type: "solid", color: C.line, pt: 1 }, rowH: 0.36, align: "center", valign: "middle",
        autoPage: false,
      });
    }
  }

  // 6. Paradas e refugo
  {
    const s = pres.addSlide({ masterName: "PADRAO" });
    cabecalho(s, "Principais perdas", "Paradas (horas) e refugo (peças) no semestre");
    const topP = d.paradas.slice(0, 8);
    const topR = d.refugos.slice(0, 8);
    if (topP.length === 0 && topR.length === 0) semDados(s);
    if (topP.length) {
      s.addText("Paradas por motivo", { x: 0.5, y: 1.6, w: 6.2, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: C.ink });
      s.addChart(pres.ChartType.bar, [{ name: "Horas", labels: topP.map(p => p.tipo).reverse(), values: topP.map(p => +p.valor.toFixed(1)).reverse() }], {
        x: 0.5, y: 2.0, w: 6.2, h: 4.9, barDir: "bar", chartColors: [C.warn], showLegend: false,
        catAxisLabelFontFace: FONT, catAxisLabelFontSize: 11, valAxisLabelFontSize: 10, valGridLine: { color: C.line, size: 1 },
        showValue: true, dataLabelFontSize: 10, dataLabelColor: C.ink, dataLabelFormatCode: "0.0",
      });
    }
    if (topR.length) {
      s.addText("Refugo por tipo", { x: 7.0, y: 1.6, w: 5.8, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: C.ink });
      s.addChart(pres.ChartType.bar, [{ name: "Peças", labels: topR.map(p => p.tipo).reverse(), values: topR.map(p => Math.round(p.valor)).reverse() }], {
        x: 7.0, y: 2.0, w: 5.8, h: 4.9, barDir: "bar", chartColors: [C.bad], showLegend: false,
        catAxisLabelFontFace: FONT, catAxisLabelFontSize: 11, valAxisLabelFontSize: 10, valGridLine: { color: C.line, size: 1 },
        showValue: true, dataLabelFontSize: 10, dataLabelColor: C.ink, dataLabelFormatCode: "#,##0",
      });
    }
  }

  // 6b. Tempo por peça
  if (d.tempos.length > 0) {
    const s = pres.addSlide({ masterName: "PADRAO" });
    cabecalho(s, "Tempo por peça", "Calculado automaticamente a cada lançamento · primeiro × último mês em que a peça rodou");
    const ciclo = (m: number) => m < 1 ? `${Math.round(m * 60)} s/pç` : `${m.toFixed(2).replace(".", ",")} min/pç`;
    const head = ["Peça", "Descrição", "Início", "Agora", "Variação", "Peças"]
      .map(t => ({ text: t, options: { bold: true, color: "FFFFFF", fill: { color: C.ink } } }));
    const rows = d.tempos.slice(0, 10).map(t => [
      { text: t.produto, options: { bold: true } },
      { text: t.descricao.slice(0, 40) },
      { text: `${ciclo(t.cicloIni)} (${t.mesIni})` },
      { text: `${ciclo(t.cicloFim)} (${t.mesFim})` },
      { text: t.mesIni === t.mesFim ? "—" : `${t.variacaoPct > 0 ? "+" : ""}${t.variacaoPct.toFixed(1).replace(".", ",")}%`,
        options: { bold: true, color: t.variacaoPct < -2 ? C.good : t.variacaoPct > 2 ? C.bad : C.muted } },
      { text: fmtNum(t.pecas) },
    ]);
    s.addTable([head, ...rows], {
      x: 0.5, y: 1.8, w: 12.3, colW: [1.6, 4.1, 1.9, 1.9, 1.4, 1.4], fontFace: FONT, fontSize: 12, color: C.ink,
      border: { type: "solid", color: C.line, pt: 1 }, rowH: 0.42, valign: "middle", autoPage: false,
    });
    s.addText("Variação negativa (verde) = a peça passou a ser produzida mais rápido.", { x: 0.5, y: 6.6, w: 12.3, h: 0.35, fontFace: FONT, fontSize: 11, italic: true, color: C.muted });
  }

  // 7. Tabela mensal
  {
    const s = pres.addSlide({ masterName: "PADRAO" });
    cabecalho(s, "Detalhamento mensal");
    const head = ["Mês", "Horas", "Paradas", "Disp.", "Perf.", "Qual.", "OEE", "Produzido", "Refugo"]
      .map(t => ({ text: t, options: { bold: true, color: "FFFFFF", fill: { color: C.ink } } }));
    const rows = d.meses.map(m => m.temDados
      ? [m.label, fmtHoras(m.hr_planejadas), fmtHoras(m.hr_paradas), fmtPct(m.disponibilidade), fmtPct(m.performance), fmtPct(m.qualidade), fmtPct(m.oee), fmtNum(m.qtde_produzida), fmtNum(m.total_refugo)]
      : [m.label, "—", "—", "—", "—", "—", "—", "—", "—"]);
    const g = d.geral;
    const total = ["Semestre", fmtHoras(g.hr_planejadas), fmtHoras(g.hr_paradas), fmtPct(g.disponibilidade), fmtPct(g.performance), fmtPct(g.qualidade), fmtPct(g.oee), fmtNum(g.qtde_produzida), fmtNum(g.total_refugo)]
      .map(t => ({ text: t, options: { bold: true, fill: { color: C.bg } } }));
    s.addTable([head, ...rows.map(r => r.map(t => ({ text: t }))), total], {
      x: 0.5, y: 1.8, w: 12.3, fontFace: FONT, fontSize: 13, color: C.ink,
      border: { type: "solid", color: C.line, pt: 1 }, rowH: 0.5, align: "center", valign: "middle", autoPage: false,
    });
  }

  await pres.writeFile({ fileName: `Desempenho-Producao-${d.ano}-S${d.semestre}.pptx` });
}
