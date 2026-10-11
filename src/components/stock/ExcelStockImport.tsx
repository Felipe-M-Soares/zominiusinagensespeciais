/**
 * ExcelStockImport — importa o estoque a partir do PDF "SALDO DE ESTOQUE"
 * (ERP antigo) ou da planilha modelo (.xlsx).
 *
 * Fluxo:
 *  1. O arquivo é lido no navegador (pdfjs / exceljs) e agrupado por peça →
 *     fase (Intermediário / Expedição) → lote. Outros endereços do PDF
 *     (ferramentas, uso e consumo, recebimento...) são ignorados.
 *  2. Pré-visualização com os totais. Entra o SALDO (QTD − RESERVA): o que
 *     está reservado no ERP antigo já foi separado para venda.
 *  3. Envio em blocos para a RPC `importar_saldo_estoque`, que acha ou cadastra
 *     a peça (nome + referência, regularização "pendente"), cria o item de
 *     estoque da fase e deixa o saldo de cada lote igual ao do arquivo.
 *     Reimportar o mesmo arquivo não duplica.
 *
 * Antes cada lote era gravado pelo navegador: peças novas recebiam udi_di "—"
 * (campo único — só a primeira entrava) e o stock_movement_atomic barrava após
 * 60 lotes por minuto.
 */

import { useRef, useState, useCallback, useMemo } from "react";
import ExcelJS from "exceljs";
import * as pdfjsLib from "pdfjs-dist";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  linhasDaPagina, lerLinhasSaldo, resumoSaldo,
  type ItemTexto, type PecaSaldo, type FaseSaldo, type LoteSaldo, type ResultadoSaldo,
} from "@/lib/saldoEstoquePdf";
import {
  FileSpreadsheet, Upload, Download, CheckCircle2, XCircle, AlertTriangle, Loader2,
  ChevronDown, ChevronUp, X, Eye, ArrowRight, RefreshCw, FileText, PlusCircle, Info,
} from "lucide-react";

// Worker do pdfjs — usa o worker incluído no pacote
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const MAX_FILE_BYTES = 30 * 1024 * 1024; // proteção contra arquivo gigante
const MAX_ROWS = 20_000;
/** Peças por chamada à RPC — mantém cada chamada bem abaixo do timeout do Supabase. */
const BLOCO = 100;

interface Props { open: boolean; onClose: () => void; onSuccess: () => void; }

interface ResultadoBloco {
  ok?: boolean; error?: string;
  criadas?: number; existentes?: number; lotes_ajustados?: number;
  unidades_entrada?: number; unidades_saida?: number;
  novas?: { nome: string; referencia: string }[];
  erros?: { nome: string; codigo_erp: string | null; erro: string }[];
}
interface Totais {
  criadas: number; existentes: number; lotes: number; entrada: number; saida: number;
  novas: { nome: string; referencia: string }[];
  erros: { nome: string; erro: string }[];
}
const TOTAIS_ZERO: Totais = { criadas: 0, existentes: 0, lotes: 0, entrada: 0, saida: 0, novas: [], erros: [] };

// ── Helpers ────────────────────────────────────────────────────────────────────

function normalizeFase(raw: string): FaseSaldo | null {
  const v = raw.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "");
  if (["intermediario", "intermediaria", "inter", "int", "i"].includes(v)) return "intermediaria";
  if (["expedicao", "exp", "e"].includes(v)) return "expedicao";
  return null;
}
const normCodigo = (s: string) => s.replace(/\s+/g, "").toUpperCase();
/** Referência "de código" (ANM 4520AT) — as antigas ("Ø4.5 AT") não identificam a peça. */
const ehCodigo = (s: string) => /^[A-Z]{2,10}\d{3,}[A-Z0-9]*$/.test(normCodigo(s));

function cellStr(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "result" in v) return String((v as ExcelJS.CellFormulaValue).result ?? "");
  if (typeof v === "object" && "richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map(r => r.text).join("").trim();
  if (typeof v === "object" && "text" in v) return String((v as ExcelJS.CellHyperlinkValue).text ?? "");
  return String(v).trim();
}

async function lerPdf(file: File, onProgress: (pct: number) => void): Promise<ResultadoSaldo> {
  const tarefa = pdfjsLib.getDocument({ data: await file.arrayBuffer() });
  const pdf = await tarefa.promise;
  const linhas: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    linhas.push(...linhasDaPagina(content.items as ItemTexto[]));
    page.cleanup();
    if (p % 5 === 0 || p === pdf.numPages) onProgress(Math.round((p / pdf.numPages) * 100));
  }
  await tarefa.destroy();
  return lerLinhasSaldo(linhas);
}

/** Planilha modelo: Peça | Referência | Lote | Quantidade | Fase */
async function lerExcel(file: File): Promise<{ pecas: PecaSaldo[]; erros: string[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Planilha vazia");
  const porPeca = new Map<string, PecaSaldo>();
  const erros: string[] = [];
  let linhas = 0;
  ws.eachRow((row, n) => {
    const nome = cellStr(row.getCell(1)), ref = cellStr(row.getCell(2)), lote = cellStr(row.getCell(3));
    const qtdTxt = cellStr(row.getCell(4)), faseTxt = cellStr(row.getCell(5));
    if (n === 1 && /pe[cç]a|nome|modelo|refer/i.test(nome)) return;
    if (!nome && !lote && !qtdTxt) return;
    if (++linhas > MAX_ROWS) return;
    const qtd = Math.round(parseFloat(qtdTxt.replace(/\./g, "").replace(",", ".")));
    const fase = normalizeFase(faseTxt);
    if (!nome) { erros.push(`Linha ${n}: peça sem nome`); return; }
    if (!lote) { erros.push(`Linha ${n}: lote ausente`); return; }
    if (!Number.isFinite(qtd) || qtd < 0) { erros.push(`Linha ${n}: quantidade inválida "${qtdTxt}"`); return; }
    if (!fase) { erros.push(`Linha ${n}: fase inválida "${faseTxt}" (use intermediario ou expedicao)`); return; }
    const chave = `${nome.toUpperCase()}|${normCodigo(ref)}`;
    const peca = porPeca.get(chave) ?? { codigoErp: "", nome, referencia: ref, referencias: ref ? [ref] : [], fases: {} };
    porPeca.set(chave, peca);
    const lotes = (peca.fases[fase] ??= []);
    const l = lotes.find(x => x.lote === lote);
    if (l) { l.qtd += qtd; l.saldo += qtd; } else lotes.push({ lote, qtd, reserva: 0, saldo: qtd });
  });
  if (linhas > MAX_ROWS) throw new Error(`Mais de ${MAX_ROWS.toLocaleString("pt-BR")} linhas`);
  return { pecas: [...porPeca.values()], erros };
}

/** Monta o que vai para a RPC. Códigos repetidos entre peças do arquivo não servem para buscar. */
function montarEnvio(pecas: PecaSaldo[], usarQtdTotal: boolean) {
  const uso = new Map<string, number>();
  for (const p of pecas) for (const r of new Set(p.referencias.filter(ehCodigo).map(normCodigo))) uso.set(r, (uso.get(r) ?? 0) + 1);
  return pecas.map(p => ({
    codigo_erp: p.codigoErp || null,
    nome: p.nome,
    referencia: p.referencia,
    referencias: p.referencias.filter(r => ehCodigo(r) && uso.get(normCodigo(r)) === 1),
    fases: Object.fromEntries((Object.entries(p.fases) as [FaseSaldo, LoteSaldo[]][]).map(([f, ls]) =>
      [f, ls.map(l => ({ lote: l.lote, quantidade: usarQtdTotal ? l.qtd : l.saldo }))])),
  }));
}

async function downloadTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Importação");
  ws.columns = [
    { header: "Peça (nome/modelo)", key: "peca", width: 38 },
    { header: "Referência",         key: "ref",  width: 20 },
    { header: "Lote",               key: "lote", width: 20 },
    { header: "Quantidade",         key: "qtd",  width: 14 },
    { header: "Fase",               key: "fase", width: 18 },
  ];
  ws.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B21B6" } };
    cell.alignment = { horizontal: "center" };
  });
  ws.addRow({ peca: "ANALOGO CM Ø4.5/5.0 AT",  ref: "ANM 4520AT",  lote: "2202241-01", qtd: 58,  fase: "expedicao" });
  ws.addRow({ peca: "ANALOGO DIGITAL CM GM N", ref: "ADMGM 0016N", lote: "2111251-05", qtd: 116, fase: "intermediario" });
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url; a.download = "template-importacao-estoque.xlsx"; a.click();
  URL.revokeObjectURL(url);
}

const fmt = (n: number) => n.toLocaleString("pt-BR");

// ── Componente ─────────────────────────────────────────────────────────────────

export function ExcelStockImport({ open, onClose, onSuccess }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"idle" | "lendo" | "preview" | "importing" | "done">("idle");
  const [fileMode, setFileMode] = useState<"excel" | "pdf">("pdf");
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [leitura, setLeitura] = useState<ResultadoSaldo | null>(null);
  const [errosLeitura, setErrosLeitura] = useState<string[]>([]);
  // O reservado no ERP antigo já está separado para venda: entra só o SALDO.
  const usarQtdTotal = false;
  const [pct, setPct] = useState(0);
  const [progresso, setProgresso] = useState({ atual: 0, total: 0 });
  const [totais, setTotais] = useState<Totais>(TOTAIS_ZERO);
  const [mostrar, setMostrar] = useState<"" | "ignorados" | "erros" | "novas" | "falhas">("");
  const [isDragging, setIsDragging] = useState(false);

  const pecas = useMemo(() => leitura?.pecas ?? [], [leitura]);
  const resumo = useMemo(() => resumoSaldo(pecas, usarQtdTotal), [pecas, usarQtdTotal]);
  const temReserva = useMemo(() => pecas.some(p => Object.values(p.fases).some(ls => ls?.some(l => l.reserva > 0))), [pecas]);

  function reset() {
    setStep("idle"); setLeitura(null); setErrosLeitura([]); setPct(0); setMostrar("");
    setProgresso({ atual: 0, total: 0 }); setTotais(TOTAIS_ZERO);
    if (fileRef.current) fileRef.current.value = "";
  }
  const handleClose = () => { if (step !== "importing") { reset(); onClose(); } };

  const handleFile = useCallback(async (file: File) => {
    if (file.size > MAX_FILE_BYTES) { toast.error("Arquivo muito grande. Limite: 30MB."); return; }
    const ehPdf = /\.pdf$/i.test(file.name);
    if (!ehPdf && !/\.xlsx$/i.test(file.name)) { toast.error("Use o PDF de Saldo de Estoque ou uma planilha .xlsx"); return; }
    setNomeArquivo(file.name); setFileMode(ehPdf ? "pdf" : "excel"); setStep("lendo"); setPct(0);
    try {
      if (ehPdf) {
        const r = await lerPdf(file, setPct);
        if (!r.pecas.length) { toast.error("Nenhuma peça de Intermediário ou Expedição encontrada no PDF."); setStep("idle"); return; }
        setLeitura(r); setErrosLeitura([]);
      } else {
        const { pecas: ps, erros } = await lerExcel(file);
        if (!ps.length) { toast.error(erros[0] ?? "Nenhuma linha válida na planilha."); setStep("idle"); return; }
        setLeitura({ pecas: ps, pecasIgnoradas: 0, enderecosIgnorados: {}, lotesSemNumero: [] }); setErrosLeitura(erros);
      }
      setStep("preview");
    } catch (e) {
      toast.error(ehPdf ? "Não foi possível ler o PDF. Confira se é o relatório SALDO DE ESTOQUE." : "Não foi possível ler a planilha.");
      logger.error("Erro ao ler arquivo de estoque", e); setStep("idle");
    }
  }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files[0]; if (f) handleFile(f);
  }

  async function handleImport() {
    if (!navigator.onLine) { toast.error("Sem internet — a importação precisa de conexão."); return; }
    const envio = montarEnvio(pecas, usarQtdTotal);
    const blocos = Math.ceil(envio.length / BLOCO);
    setStep("importing"); setProgresso({ atual: 0, total: envio.length });
    const acc: Totais = { ...TOTAIS_ZERO, novas: [], erros: [] };
    const origem = `${fileMode === "pdf" ? "PDF" : "Excel"} ${nomeArquivo}`.slice(0, 80);

    for (let b = 0; b < blocos; b++) {
      const bloco = envio.slice(b * BLOCO, (b + 1) * BLOCO);
      let res: ResultadoBloco | null = null;
      for (let tentativa = 0; tentativa < 3 && !res?.ok; tentativa++) {
        const { data, error } = await supabase.rpc("importar_saldo_estoque", { p_pecas: bloco, p_origem: origem });
        res = error ? { ok: false, error: error.message } : (data as ResultadoBloco);
        if (!res?.ok && /permiss|autentic/i.test(res?.error ?? "")) break; // não adianta repetir
        if (!res?.ok) await new Promise(r => setTimeout(r, 1500 * (tentativa + 1)));
      }
      if (!res?.ok) {
        for (const p of bloco) acc.erros.push({ nome: p.nome, erro: res?.error ?? "Falha ao enviar" });
        if (/permiss|autentic/i.test(res?.error ?? "")) { toast.error(res?.error ?? "Sem permissão"); break; }
      } else {
        acc.criadas += res.criadas ?? 0; acc.existentes += res.existentes ?? 0; acc.lotes += res.lotes_ajustados ?? 0;
        acc.entrada += res.unidades_entrada ?? 0; acc.saida += res.unidades_saida ?? 0;
        acc.novas.push(...(res.novas ?? []));
        acc.erros.push(...(res.erros ?? []).map(e => ({ nome: e.nome, erro: e.erro })));
      }
      setTotais({ ...acc });
      setProgresso({ atual: Math.min(envio.length, (b + 1) * BLOCO), total: envio.length });
    }

    setStep("done");
    if (acc.criadas + acc.existentes > 0) {
      toast.success(`${fmt(acc.criadas + acc.existentes)} peças processadas · ${fmt(acc.lotes)} lotes ajustados`);
      onSuccess();
    }
    if (acc.erros.length) toast.error(`${fmt(acc.erros.length)} peça${acc.erros.length > 1 ? "s" : ""} com erro`);
  }

  if (!open) return null;

  const ignoradosLista = Object.entries(leitura?.enderecosIgnorados ?? {}).sort((a, b) => b[1] - a[1]);
  const lotesIgnorados = ignoradosLista.reduce((s, [, n]) => s + n, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl bg-card border border-border/30 shadow-2xl flex flex-col max-h-[92vh] animate-in fade-in slide-in-from-bottom-4 duration-200 overflow-hidden">

        {/* Cabeçalho */}
        <div className="px-5 py-4 border-b border-border/30 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Importar estoque (PDF ou Excel)</p>
              <p className="text-[11px] text-muted-foreground truncate">
                {nomeArquivo && step !== "idle" ? nomeArquivo : "Intermediário e Expedição — por peça e lote"}
              </p>
            </div>
          </div>
          <button type="button" onClick={handleClose} disabled={step === "importing"} aria-label="Fechar"
            className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* ─ ESCOLHER ARQUIVO ─ */}
          {step === "idle" && (<>
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
              <FileText className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
              <div className="text-[11px] text-muted-foreground space-y-1">
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">PDF "SALDO DE ESTOQUE" do sistema antigo</p>
                <p>Lê todas as peças dos endereços <b>EXP</b> (Expedição) e <b>INT</b> (Intermediário) com seus lotes. Ferramentas, uso e consumo e outros endereços são ignorados.</p>
                <p>Peças que ainda não existem no app são <b>cadastradas com nome e referência</b> e ficam com regularização <b>pendente</b>. O saldo de cada lote fica igual ao do arquivo — importar de novo não duplica.</p>
              </div>
            </div>

            <label
              className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 cursor-pointer transition-all",
                isDragging ? "border-emerald-500 bg-emerald-500/5" : "border-border/60 hover:border-emerald-500/60 hover:bg-muted/20")}
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}>
              <div className={cn("h-14 w-14 rounded-2xl flex items-center justify-center", isDragging ? "bg-emerald-500/15" : "bg-muted/40")}>
                <Upload className={cn("h-7 w-7", isDragging ? "text-emerald-500" : "text-muted-foreground")} />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold">{isDragging ? "Solte aqui" : "Arraste ou clique para selecionar"}</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  <span className="font-semibold text-blue-600">.pdf</span> (Saldo de Estoque) ou <span className="font-semibold text-emerald-600">.xlsx</span>
                </p>
              </div>
              <input ref={fileRef} type="file" accept=".pdf,.xlsx" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </label>

            <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-muted/30 border border-border/30">
              <div>
                <p className="text-xs font-semibold">Sem o PDF? Use a planilha modelo</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Colunas: Peça · Referência · Lote · Quantidade · Fase</p>
              </div>
              <button type="button" onClick={downloadTemplate}
                className="flex items-center gap-1.5 px-3 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors shrink-0">
                <Download className="h-3.5 w-3.5" /> Baixar modelo
              </button>
            </div>
          </>)}

          {/* ─ LENDO ─ */}
          {step === "lendo" && (
            <div className="flex flex-col items-center justify-center py-16 gap-6">
              <div className="h-16 w-16 rounded-2xl bg-blue-500/10 flex items-center justify-center">
                <FileText className="h-8 w-8 text-blue-500" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-semibold">Lendo {fileMode === "pdf" ? "o PDF" : "a planilha"}...</p>
                <p className="text-xs text-muted-foreground">{fileMode === "pdf" ? "Página por página — o relatório completo leva alguns segundos" : "Aguarde"}</p>
              </div>
              {fileMode === "pdf" && (
                <div className="w-full max-w-xs space-y-2">
                  <div className="h-2.5 rounded-full bg-muted/50 overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all duration-200" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-center text-xs text-muted-foreground">{pct}%</p>
                </div>
              )}
            </div>
          )}

          {/* ─ PRÉ-VISUALIZAÇÃO ─ */}
          {step === "preview" && (<>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "Peças",          value: resumo.pecas,      color: "text-foreground" },
                { label: "Lotes c/ saldo", value: resumo.lotes,      color: "text-foreground" },
                { label: "Intermediário",  value: resumo.lotesInter, color: "text-blue-600 dark:text-blue-400", sub: "lotes" },
                { label: "Expedição",      value: resumo.lotesExp,   color: "text-violet-600 dark:text-violet-400", sub: "lotes" },
              ].map(({ label, value, color, sub }) => (
                <div key={label} className="rounded-xl border border-border/30 bg-muted/20 p-3 text-center">
                  <div className={cn("text-xl font-bold tabular-nums", color)}>{fmt(value)}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{label}{sub ? ` (${sub})` : ""}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-center tabular-nums">
              Total de <b className="text-foreground">{fmt(resumo.unidades)}</b> unidades · {fmt(resumo.pecas - resumo.comSaldo)} peças sem saldo (entram só no cadastro)
            </p>

            {temReserva && (
              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
                Importa a coluna SALDO (QTD − RESERVA): o que está reservado já foi separado para venda e não entra no estoque.
              </p>
            )}

            <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
              <PlusCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                Peças já cadastradas no app são reconhecidas pelo código de referência (ex.: ANM 4520AT) ou pelo nome. As demais são cadastradas com nome e referência, com regularização pendente — complete depois em Componentes.
              </p>
            </div>

            {(lotesIgnorados > 0 || (leitura?.lotesSemNumero.length ?? 0) > 0 || errosLeitura.length > 0) && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
                {lotesIgnorados > 0 && (
                  <button type="button" onClick={() => setMostrar(m => m === "ignorados" ? "" : "ignorados")}
                    className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left">
                    <span className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
                      <Info className="h-3.5 w-3.5 shrink-0" />
                      {fmt(lotesIgnorados)} lotes de outros endereços ignorados ({fmt(leitura?.pecasIgnoradas ?? 0)} itens só fora de EXP/INT)
                    </span>
                    {mostrar === "ignorados" ? <ChevronUp className="h-3.5 w-3.5 text-amber-500" /> : <ChevronDown className="h-3.5 w-3.5 text-amber-500" />}
                  </button>
                )}
                {mostrar === "ignorados" && (
                  <div className="border-t border-amber-500/20 px-4 py-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
                    {ignoradosLista.map(([end, n]) => (
                      <p key={end} className="text-[11px] text-amber-700 dark:text-amber-400 flex justify-between gap-2"><span className="truncate">{end}</span><span className="tabular-nums">{n}</span></p>
                    ))}
                  </div>
                )}
                {(leitura?.lotesSemNumero.length ?? 0) > 0 && (
                  <p className="px-4 py-2 border-t border-amber-500/20 text-[11px] text-amber-700 dark:text-amber-400">
                    {leitura!.lotesSemNumero.length} lote(s) sem número de lote não entram (o app exige lote): {leitura!.lotesSemNumero.slice(0, 3).map(l => l.nome).join(", ")}
                  </p>
                )}
                {errosLeitura.length > 0 && (<>
                  <button type="button" onClick={() => setMostrar(m => m === "erros" ? "" : "erros")}
                    className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left border-t border-amber-500/20">
                    <span className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5" /> {errosLeitura.length} linha(s) da planilha com erro — ignoradas
                    </span>
                    {mostrar === "erros" ? <ChevronUp className="h-3.5 w-3.5 text-amber-500" /> : <ChevronDown className="h-3.5 w-3.5 text-amber-500" />}
                  </button>
                  {mostrar === "erros" && (
                    <div className="border-t border-amber-500/20 px-4 py-2 space-y-0.5 max-h-40 overflow-y-auto">
                      {errosLeitura.map(e => <p key={e} className="text-[11px] text-amber-700 dark:text-amber-400">{e}</p>)}
                    </div>
                  )}
                </>)}
              </div>
            )}

            <div className="rounded-xl border border-border/30 overflow-hidden">
              <div className="bg-muted/30 px-3 py-2 flex items-center gap-1.5 border-b border-border/20">
                <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground">Pré-visualização — {fmt(pecas.length)} peças</span>
              </div>
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                    <tr>
                      {["Peça", "Referência", "Inter.", "Exp."].map(h => (
                        <th key={h} className={cn("px-3 py-2 font-semibold text-muted-foreground", h.length < 7 ? "text-right" : "text-left")}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {pecas.slice(0, 300).map(p => {
                      const soma = (f: FaseSaldo) => (p.fases[f] ?? []).reduce((s, l) => s + (usarQtdTotal ? l.qtd : l.saldo), 0);
                      const lotes = (f: FaseSaldo) => (p.fases[f] ?? []).filter(l => (usarQtdTotal ? l.qtd : l.saldo) > 0).length;
                      return (
                        <tr key={`${p.codigoErp}|${p.nome}`} className="hover:bg-muted/20">
                          <td className="px-3 py-2 font-medium max-w-[220px] truncate" title={p.nome}>{p.nome}</td>
                          <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground whitespace-nowrap">{p.referencia || "—"}</td>
                          {(["intermediaria", "expedicao"] as FaseSaldo[]).map(f => (
                            <td key={f} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                              {p.fases[f] ? <><b>{fmt(soma(f))}</b><span className="text-[10px] text-muted-foreground"> ({lotes(f)} lt)</span></> : <span className="text-muted-foreground">—</span>}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                    {pecas.length > 300 && (
                      <tr><td colSpan={4} className="px-3 py-3 text-center text-[11px] text-muted-foreground">+ {fmt(pecas.length - 300)} peças (todas serão importadas)</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>)}

          {/* ─ IMPORTANDO / FIM ─ */}
          {(step === "importing" || step === "done") && (<>
            {step === "importing" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Importando — não feche esta janela</span>
                  <span className="tabular-nums">{fmt(progresso.atual)} / {fmt(progresso.total)} peças</span>
                </div>
                <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                    style={{ width: `${progresso.total ? (progresso.atual / progresso.total) * 100 : 0}%` }} />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "Já existiam",    value: totais.existentes, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
                { label: "Cadastradas",    value: totais.criadas,    color: "text-blue-600 dark:text-blue-400",       bg: "bg-blue-500/10 border-blue-500/20" },
                { label: "Lotes ajustados", value: totais.lotes,     color: "text-foreground",                         bg: "bg-muted/20 border-border/30" },
                { label: "Erros",          value: totais.erros.length, color: totais.erros.length ? "text-destructive" : "text-muted-foreground", bg: totais.erros.length ? "bg-destructive/10 border-destructive/20" : "bg-muted/20 border-border/30" },
              ].map(({ label, value, color, bg }) => (
                <div key={label} className={cn("rounded-xl border p-3 text-center", bg)}>
                  <div className={cn("text-2xl font-bold tabular-nums", color)}>{fmt(value)}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-center tabular-nums">
              +{fmt(totais.entrada)} unidades lançadas{totais.saida > 0 ? ` · −${fmt(totais.saida)} ajustadas para baixo` : ""}
            </p>

            {step === "done" && totais.novas.length > 0 && (
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 overflow-hidden">
                <button type="button" onClick={() => setMostrar(m => m === "novas" ? "" : "novas")}
                  className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left">
                  <span className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-400">
                    <PlusCircle className="h-3.5 w-3.5" /> {fmt(totais.novas.length)} peças cadastradas com regularização pendente
                  </span>
                  {mostrar === "novas" ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
                {mostrar === "novas" && (
                  <div className="border-t border-blue-500/20 px-4 py-2 space-y-0.5 max-h-48 overflow-y-auto">
                    {totais.novas.slice(0, 500).map((n, i) => (
                      <p key={i} className="text-[11px] flex justify-between gap-3"><span className="truncate">{n.nome}</span><span className="font-mono text-muted-foreground shrink-0">{n.referencia || "sem referência"}</span></p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {totais.erros.length > 0 && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 overflow-hidden">
                <button type="button" onClick={() => setMostrar(m => m === "falhas" ? "" : "falhas")}
                  className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left">
                  <span className="flex items-center gap-2 text-xs font-semibold text-destructive">
                    <XCircle className="h-3.5 w-3.5" /> {fmt(totais.erros.length)} peça(s) não importada(s)
                  </span>
                  {mostrar === "falhas" ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
                {mostrar === "falhas" && (
                  <div className="border-t border-destructive/20 px-4 py-2 space-y-0.5 max-h-48 overflow-y-auto">
                    {totais.erros.slice(0, 300).map((e, i) => (
                      <p key={i} className="text-[11px]"><b>{e.nome}</b> — <span className="text-muted-foreground">{e.erro}</span></p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {step === "done" && totais.erros.length === 0 && (
              <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-emerald-600">
                <CheckCircle2 className="h-4 w-4" /> Importação concluída
              </p>
            )}
          </>)}
        </div>

        {/* Rodapé */}
        <div className="px-5 py-4 border-t border-border/30 shrink-0 flex items-center justify-between gap-3">
          {(step === "idle" || step === "lendo") && (
            <button type="button" onClick={handleClose} disabled={step === "lendo"}
              className="px-4 h-10 rounded-xl text-sm text-muted-foreground hover:bg-muted/30 transition-colors disabled:opacity-50">
              Cancelar
            </button>
          )}
          {step === "preview" && (<>
            <button type="button" onClick={reset}
              className="flex items-center gap-1.5 px-4 h-10 rounded-xl text-sm text-muted-foreground hover:bg-muted/30 transition-colors">
              <RefreshCw className="h-3.5 w-3.5" /> Trocar arquivo
            </button>
            <button type="button" onClick={handleImport} disabled={pecas.length === 0}
              className="flex items-center gap-2 px-5 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors disabled:opacity-50">
              <ArrowRight className="h-4 w-4" />
              Importar {fmt(pecas.length)} peças
            </button>
          </>)}
          {step === "importing" && <span className="text-xs text-muted-foreground">Processando, aguarde...</span>}
          {step === "done" && (<>
            <button type="button" onClick={reset}
              className="flex items-center gap-1.5 px-4 h-10 rounded-xl text-sm text-muted-foreground hover:bg-muted/30 transition-colors">
              <RefreshCw className="h-3.5 w-3.5" /> Nova importação
            </button>
            <button type="button" onClick={handleClose}
              className="px-5 h-10 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition-colors">
              Concluir
            </button>
          </>)}
        </div>
      </div>
    </div>
  );
}
