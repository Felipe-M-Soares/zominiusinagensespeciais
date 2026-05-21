/**
 * ExcelStockImport — importa lotes via planilha Excel (.xlsx/.xls)
 * ou via PDF de "SALDO DE ESTOQUE" (relatório IPS/ERP).
 *
 * Regra de peça não cadastrada:
 *   Se a peça não for encontrada no banco, ela é criada automaticamente
 *   com nome (model) e referência (reference) vindos da planilha/PDF.
 *   Os demais campos obrigatórios ficam com "—" como placeholder até
 *   que o usuário complete o cadastro depois.
 */

import { useRef, useState, useCallback } from "react";
import ExcelJS from "exceljs";
import * as pdfjsLib from "pdfjs-dist";
import { supabase } from "@/integrations/supabase/client";
import { registerMovement } from "@/hooks/useStock";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  FileSpreadsheet, Upload, Download, CheckCircle2,
  XCircle, AlertTriangle, Loader2, ChevronDown, ChevronUp,
  X, Eye, ArrowRight, RefreshCw, FileText, PlusCircle,
} from "lucide-react";

// Worker do pdfjs — usa o worker incluído no pacote via blob
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.js",
  import.meta.url
).toString();

// ── Tipos ──────────────────────────────────────────────────────────────────────

type Fase = "intermediaria" | "expedicao";

interface ParsedRow {
  line: number;
  nome: string;
  referencia: string;
  lote: string;
  quantidade: number | null;
  fase: Fase | null;
  parseError?: string;
}

type ImportStatus = "pending" | "ok" | "created" | "notfound" | "error";
interface ImportResult extends ParsedRow {
  status: ImportStatus;
  message?: string;
  deviceModel?: string;
}

interface Props { open: boolean; onClose: () => void; onSuccess: () => void; }

// ── Helpers ────────────────────────────────────────────────────────────────────

function normalizeFase(raw: string): Fase | null {
  const v = raw.trim().toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "");
  if (["intermediario","intermediaria","inter","i"].includes(v)) return "intermediaria";
  if (["expedicao","exp","e"].includes(v)) return "expedicao";
  return null;
}

function normalizeStr(s: string) {
  return s.trim().toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

function cellStr(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "result" in v)
    return String((v as ExcelJS.CellFormulaValue).result ?? "");
  if (typeof v === "object" && "text" in v)
    return String((v as ExcelJS.CellRichTextValue).text ?? "");
  return String(v).trim();
}

// ── Parser PDF de Saldo de Estoque ────────────────────────────────────────────

async function parsePdfSaldo(
  file: File,
  onProgress: (pct: number) => void
): Promise<ParsedRow[]> {
  const buf  = await file.arrayBuffer();
  const pdf  = await pdfjsLib.getDocument({ data: buf }).promise;
  const total = pdf.numPages;

  const rows: ParsedRow[] = [];
  let lineCounter = 0;

  const LOTE_RE  = /^\s*\d{17}\s+(\S+)\s+.+\bUN\b\s+(\d+)\s+(\d+)\s+(\d+)\s*$/;
  const ITEM_RE  = /^\d{6}\s*-\s*(.+)$/;
  const ADDR_RE  = /ENDERECO\s*:/i;

  let currentItem: string | null = null;
  let currentFase: Fase | null   = null;

  for (let p = 1; p <= total; p++) {
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();

    interface TItem { str: string; transform: number[] }
    const items = (content.items as TItem[]).filter(i => i.str.trim());

    const byY = new Map<number, TItem[]>();
    for (const item of items) {
      const y = Math.round(item.transform[5]);
      const key = [...byY.keys()].find(k => Math.abs(k - y) <= 3) ?? y;
      if (!byY.has(key)) byY.set(key, []);
      byY.get(key)!.push(item);
    }

    const lines = [...byY.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, its]) =>
        its.sort((a, b) => a.transform[4] - b.transform[4])
           .map(i => i.str).join(" ").trim()
      )
      .filter(Boolean);

    for (const line of lines) {
      lineCounter++;

      const mItem = line.match(ITEM_RE);
      if (mItem) { currentItem = mItem[1].trim(); currentFase = null; continue; }

      if (ADDR_RE.test(line)) {
        currentFase = line.includes("INT") ? "intermediaria" : "expedicao";
        continue;
      }

      const mLote = line.match(LOTE_RE);
      if (mLote && currentItem && currentFase) {
        const saldo = parseInt(mLote[4], 10);
        if (saldo <= 0) continue;

        rows.push({
          line: lineCounter,
          nome: currentItem,
          lote: mLote[1],
          quantidade: saldo,
          fase: currentFase,
        });
      }
    }

    onProgress(Math.round((p / total) * 100));
  }

  return rows;
}

// ── Busca ou cria stock_item no Supabase ───────────────────────────────────────

/** Retorna { id, model, created } — created=true se a peça foi criada agora */
async function findOrCreateStockItem(
  nome: string,
  lote: string,
  fase: Fase
): Promise<{ id: string; model: string; created: boolean } | null> {
  const nomeNorm = normalizeStr(nome);

  // 1. Tenta encontrar device existente pelo nome
  const { data: devices } = await supabase
    .from("devices")
    .select("id, model")
    .ilike("model", `%${nomeNorm}%`)
    .limit(10);

  let deviceId: string | null = null;
  let deviceModel: string = nome;

  if (devices?.length) {
    // Encontrou dispositivo(s) — tenta achar o stock_item correspondente
    for (const dev of devices as { id: string; model: string }[]) {
      const { data: si } = await supabase
        .from("stock_items")
        .select("id")
        .eq("device_id", dev.id)
        .eq("fase", fase)
        .maybeSingle();
      if (si) return { id: si.id, model: dev.model, created: false };
    }

    // Device existe mas não tem stock_item para essa fase — cria o stock_item
    const best = (devices as { id: string; model: string }[]).find(
      d => normalizeStr(d.model) === nomeNorm
    ) ?? (devices as { id: string; model: string }[])[0];

    deviceId    = best.id;
    deviceModel = best.model;
  } else {
    // 2. Peça não existe no banco — cria o device com nome e referência
    //    Campos obrigatórios sem info real recebem "—" como placeholder
    const PLACEHOLDER = "—";
    const { data: newDevice, error: devErr } = await supabase
      .from("devices")
      .insert({
        model:                  nome,
        reference:              lote,         // usa o lote como referência inicial
        internal_code:          PLACEHOLDER,
        brand_name:             PLACEHOLDER,
        anvisa_registration:    PLACEHOLDER,
        classification_code:    PLACEHOLDER,
        risk_class:             PLACEHOLDER,
        intended_use:           PLACEHOLDER,
        primary_material:       PLACEHOLDER,
        manufacturer_country:   PLACEHOLDER,
        body_region:            PLACEHOLDER,
        udi_di:                 PLACEHOLDER,
        exocad_compatibility:   PLACEHOLDER,
        implantable:            false,
        single_use:             false,
        sterile:                false,
      })
      .select("id, model")
      .single();

    if (devErr || !newDevice) return null;

    deviceId    = newDevice.id;
    deviceModel = newDevice.model;
  }

  // 3. Cria (ou recupera) o stock_item para o device + fase
  const { data: upserted } = await supabase
    .from("stock_items")
    .upsert(
      { device_id: deviceId, quantity: 0, min_quantity: 0, fase },
      { onConflict: "device_id,fase" }
    )
    .select("id")
    .single();

  return upserted
    ? { id: upserted.id, model: deviceModel, created: !devices?.length }
    : null;
}

// ── Template Excel ─────────────────────────────────────────────────────────────

async function downloadTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Importação");
  ws.columns = [
    { header: "Peça (nome/modelo)", key: "peca", width: 38 },
    { header: "Referência",          key: "ref",  width: 20 },
    { header: "Lote",               key: "lote", width: 20 },
    { header: "Quantidade",         key: "qtd",  width: 14 },
    { header: "Fase",               key: "fase", width: 18 },
  ];
  ws.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B21B6" } };
    cell.alignment = { horizontal: "center" };
  });
  ws.addRow({ peca: "IMPLANTE COCLEAR IC-200",   ref: "UCIR 4018C", lote: "0101261-01", qtd: 50, fase: "intermediario" });
  ws.addRow({ peca: "PROCESSADOR DE SOM PS-300", ref: "UCIR 3015C", lote: "0202362-02", qtd: 30, fase: "expedicao" });
  const buf  = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "template-importacao-estoque.xlsx"; a.click();
  URL.revokeObjectURL(url);
}

// ── Componente principal ───────────────────────────────────────────────────────

export function ExcelStockImport({ open, onClose, onSuccess }: Props) {
  const { user }  = useAuth();
  const fileRef   = useRef<HTMLInputElement>(null);

  const [step,       setStep]       = useState<"idle"|"parsing-pdf"|"preview"|"importing"|"done">("idle");
  const [fileMode,   setFileMode]   = useState<"excel"|"pdf">("excel");
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [results,    setResults]    = useState<ImportResult[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [progress,   setProgress]   = useState({ current: 0, total: 0 });
  const [pdfPct,     setPdfPct]     = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  function reset() {
    setStep("idle"); setParsedRows([]); setResults([]);
    setShowErrors(false); setProgress({ current: 0, total: 0 }); setPdfPct(0);
    if (fileRef.current) fileRef.current.value = "";
  }
  const handleClose = () => { reset(); onClose(); };

  // ── Parse Excel ─────────────────────────────────────────────────────────────

  const parseExcel = useCallback(async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) { toast.error("Use .xlsx ou .xls"); return; }
    try {
      const buf = await file.arrayBuffer();
      const wb  = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const ws = wb.worksheets[0];
      if (!ws) { toast.error("Planilha vazia."); return; }

      const rows: ParsedRow[] = [];
      ws.eachRow((row, rowNum) => {
        if (rowNum === 1) {
          const h = cellStr(row.getCell(1)).toLowerCase();
          if (["peça","peca","nome","modelo","referencia","referência"].some(k => h.includes(k))) return;
        }
        const n = cellStr(row.getCell(1));
        const r = cellStr(row.getCell(2));
        const l = cellStr(row.getCell(3));
        const q = cellStr(row.getCell(4));
        const f = cellStr(row.getCell(5));
        if (!n && !l && !q) return;

        const qtd  = parseInt(q.replace(/[^\d]/g, ""), 10);
        const fase = normalizeFase(f);
        let parseError: string | undefined;
        if (!n)                            parseError = "Nome ausente";
        else if (!l)                       parseError = "Lote ausente";
        else if (isNaN(qtd) || qtd <= 0)  parseError = `Quantidade inválida: "${q}"`;
        else if (!fase)                    parseError = `Fase inválida: "${f}"`;

        rows.push({ line: rowNum, nome: n, referencia: r, lote: l,
          quantidade: isNaN(qtd) ? null : qtd, fase, parseError });
      });

      if (!rows.length) { toast.error("Nenhuma linha encontrada."); return; }
      setFileMode("excel"); setParsedRows(rows); setStep("preview");
    } catch (e) { toast.error("Erro ao ler planilha."); console.error(e); }
  }, []);

  // ── Parse PDF ────────────────────────────────────────────────────────────────

  const parsePdf = useCallback(async (file: File) => {
    setFileMode("pdf"); setStep("parsing-pdf"); setPdfPct(0);
    try {
      const rows = await parsePdfSaldo(file, setPdfPct);
      if (!rows.length) {
        toast.error("Nenhum lote com saldo > 0 encontrado no PDF.");
        setStep("idle"); return;
      }
      setParsedRows(rows); setStep("preview");
    } catch (e) {
      toast.error("Erro ao processar PDF. Verifique se é o relatório de saldo correto.");
      console.error(e); setStep("idle");
    }
  }, []);

  const handleFile = useCallback((file: File) => {
    if (file.name.match(/\.pdf$/i)) parsePdf(file); else parseExcel(file);
  }, [parseExcel, parsePdf]);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files[0]; if (f) handleFile(f);
  }

  // ── Importar ─────────────────────────────────────────────────────────────────

  async function handleImport() {
    const valid = parsedRows.filter(r => !r.parseError);
    if (!valid.length) { toast.error("Nenhuma linha válida."); return; }

    setStep("importing");
    setProgress({ current: 0, total: valid.length });

    const res: ImportResult[] = parsedRows.map(r => ({
      ...r, status: r.parseError ? "error" : "pending", message: r.parseError,
    }));
    setResults([...res]);

    let ok = 0, created = 0, err = res.filter(r => r.status === "error").length;

    for (let i = 0; i < valid.length; i++) {
      const row = valid[i];
      const idx = res.findIndex(r => r.line === row.line);
      try {
        const found = await findOrCreateStockItem(row.nome, row.referencia ?? "", row.lote, row.fase!);
        if (!found) {
          res[idx] = { ...res[idx], status: "error",
            message: `Não foi possível criar "${row.nome}"` };
          err++;
        } else {
          const mv = await registerMovement(
            found.id, "entrada", row.quantidade!,
            `Importação ${fileMode === "pdf" ? "PDF Saldo" : "Excel"} — lote: ${row.lote}`,
            user?.id ?? null, null, row.lote
          );
          if (mv.ok) {
            if (found.created) {
              res[idx] = { ...res[idx], status: "created", deviceModel: found.model,
                message: `Peça criada e +${row.quantidade} un. registradas` };
              created++;
            } else {
              res[idx] = { ...res[idx], status: "ok", deviceModel: found.model,
                message: `+${row.quantidade} un. em "${found.model}"` };
              ok++;
            }
          } else {
            res[idx] = { ...res[idx], status: "error", message: mv.error ?? "Erro" };
            err++;
          }
        }
      } catch {
        res[idx] = { ...res[idx], status: "error", message: "Erro inesperado" };
        err++;
      }
      setResults([...res]);
      setProgress({ current: i + 1, total: valid.length });
      if (i < valid.length - 1) await new Promise(r => setTimeout(r, 60));
    }

    setStep("done");
    const total = ok + created;
    if (total > 0) {
      const parts = [];
      if (ok > 0)      parts.push(`${ok} atualizado${ok > 1 ? "s" : ""}`);
      if (created > 0) parts.push(`${created} criado${created > 1 ? "s" : ""}`);
      toast.success(`${parts.join(" · ")}!`);
      onSuccess();
    }
    if (err > 0) toast.error(`${err} com erro.`);
  }

  if (!open) return null;

  const parseErrors  = parsedRows.filter(r => r.parseError);
  const validRows    = parsedRows.filter(r => !r.parseError);
  const interRows    = validRows.filter(r => r.fase === "intermediaria");
  const expRows      = validRows.filter(r => r.fase === "expedicao");
  const resOk        = results.filter(r => r.status === "ok");
  const resCreated   = results.filter(r => r.status === "created");
  const resError     = results.filter(r => r.status === "error");

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl bg-card border border-border/30 shadow-2xl flex flex-col max-h-[92vh] animate-in fade-in slide-in-from-bottom-4 duration-200 overflow-hidden">

        {/* Cabeçalho */}
        <div className="px-5 py-4 border-b border-border/30 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <FileSpreadsheet className="h-4 w-4 text-emerald-500" />
            </div>
            <div>
              <p className="text-sm font-semibold">Importar Excel ou PDF</p>
              <p className="text-[11px] text-muted-foreground">
                {step === "preview" && fileMode === "pdf"
                  ? `PDF de Saldo — ${validRows.length} lotes com saldo disponível`
                  : "Intermediário e Expedição — por lote e quantidade"}
              </p>
            </div>
          </div>
          <button type="button" onClick={handleClose}
            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* ─ IDLE ─ */}
          {step === "idle" && (<>
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border/30">
              <div>
                <p className="text-xs font-semibold">Baixar modelo Excel</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Colunas: Peça · Lote · Quantidade · Fase</p>
              </div>
              <button type="button" onClick={downloadTemplate}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors">
                <Download className="h-3.5 w-3.5" /> Baixar modelo
              </button>
            </div>

            {/* Aviso sobre criação automática de peças */}
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
              <PlusCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Peças não cadastradas são criadas automaticamente</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Se uma peça da planilha não existir no app, ela será criada com o nome e a referência informados.
                  Os demais campos poderão ser preenchidos depois no cadastro de dispositivos.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
              <FileText className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">PDF de Saldo de Estoque aceito</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Arraste o relatório PDF (SALDO DE ESTOQUE do IPS). O app lê todos os lotes com saldo {">"} 0, detecta Intermediário ou Expedição automaticamente e importa direto.
                </p>
              </div>
            </div>

            <label
              className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 cursor-pointer transition-all",
                isDragging ? "border-emerald-500 bg-emerald-500/5" : "border-border/60 hover:border-emerald-500/60 hover:bg-muted/20")}
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}>
              <div className={cn("h-14 w-14 rounded-2xl flex items-center justify-center",
                isDragging ? "bg-emerald-500/15" : "bg-muted/40")}>
                <Upload className={cn("h-7 w-7", isDragging ? "text-emerald-500" : "text-muted-foreground")} />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold">{isDragging ? "Solte aqui" : "Arraste ou clique para selecionar"}</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  <span className="font-semibold text-emerald-600">.xlsx / .xls</span>
                  {" "}ou{" "}
                  <span className="font-semibold text-blue-600">.pdf</span>
                  {" "}(Saldo de Estoque)
                </p>
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.pdf" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </label>

            <div className="rounded-xl border border-border/30 bg-muted/20 p-4 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Formato Excel (se não usar PDF)</p>
              <div className="grid grid-cols-5 gap-2">
                {[
                  { col: "A", label: "Peça",       desc: "Nome/modelo" },
                  { col: "B", label: "Referência",  desc: "Ex: UCIR 4018C" },
                  { col: "C", label: "Lote",        desc: "Ex: 0101261-01" },
                  { col: "D", label: "Quantidade",  desc: "Número inteiro" },
                  { col: "E", label: "Fase",        desc: '"intermediario" / "expedicao"' },
                ].map(({ col, label, desc }) => (
                  <div key={col} className="rounded-lg bg-card border border-border/30 p-2.5 text-center">
                    <div className="text-[10px] font-bold text-primary/70 mb-1">Col. {col}</div>
                    <div className="text-xs font-semibold">{label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 break-words">{desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </>)}

          {/* ─ PARSING PDF ─ */}
          {step === "parsing-pdf" && (
            <div className="flex flex-col items-center justify-center py-16 gap-6">
              <div className="h-16 w-16 rounded-2xl bg-blue-500/10 flex items-center justify-center">
                <FileText className="h-8 w-8 text-blue-500" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-semibold">Lendo PDF de Saldo de Estoque...</p>
                <p className="text-xs text-muted-foreground">Processando página por página — aguarde</p>
              </div>
              <div className="w-full max-w-xs space-y-2">
                <div className="h-2.5 rounded-full bg-muted/50 overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all duration-200"
                    style={{ width: `${pdfPct}%` }} />
                </div>
                <p className="text-center text-xs text-muted-foreground">{pdfPct}% concluído</p>
              </div>
            </div>
          )}

          {/* ─ PREVIEW ─ */}
          {step === "preview" && (<>
            <div className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border",
              fileMode === "pdf"
                ? "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20"
                : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20")}>
              {fileMode === "pdf" ? <FileText className="h-3.5 w-3.5" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
              {fileMode === "pdf" ? "PDF — Saldo de Estoque" : "Planilha Excel"}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "Total lotes",    value: validRows.length,   color: "text-foreground" },
                { label: "C/ erro",        value: parseErrors.length, color: parseErrors.length ? "text-amber-600" : "text-muted-foreground" },
                { label: "Intermediário",  value: interRows.length,   color: "text-blue-600 dark:text-blue-400" },
                { label: "Expedição",      value: expRows.length,     color: "text-violet-600 dark:text-violet-400" },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-xl border border-border/30 bg-muted/20 p-3 text-center">
                  <div className={cn("text-xl font-bold tabular-nums", color)}>{value}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
                </div>
              ))}
            </div>

            {/* Aviso de criação automática no preview */}
            <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
              <PlusCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                Peças não encontradas no app serão criadas automaticamente com nome e referência. Complete o cadastro depois em Dispositivos.
              </p>
            </div>

            {parseErrors.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
                <button type="button" onClick={() => setShowErrors(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                      {parseErrors.length} linha{parseErrors.length > 1 ? "s" : ""} com erro — ignoradas
                    </span>
                  </div>
                  {showErrors ? <ChevronUp className="h-3.5 w-3.5 text-amber-500" /> : <ChevronDown className="h-3.5 w-3.5 text-amber-500" />}
                </button>
                {showErrors && (
                  <div className="border-t border-amber-500/20 px-4 py-2 space-y-1">
                    {parseErrors.map(r => (
                      <p key={r.line} className="text-[11px] text-amber-700 dark:text-amber-400">
                        <span className="font-semibold">Linha {r.line}:</span> {r.parseError}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="rounded-xl border border-border/30 overflow-hidden">
              <div className="bg-muted/30 px-3 py-2 flex items-center gap-1.5 border-b border-border/20">
                <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground">
                  Pré-visualização — {validRows.length} lotes válidos
                </span>
              </div>
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/50">
                    <tr>
                      {["#","Peça","Lote","Saldo","Fase"].map(h => (
                        <th key={h} className="text-left px-3 py-2 font-semibold text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {validRows.slice(0, 300).map(r => (
                      <tr key={r.line} className="hover:bg-muted/20">
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">{r.line}</td>
                        <td className="px-3 py-2 font-medium max-w-[180px] truncate" title={r.nome}>{r.nome}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{r.lote}</td>
                        <td className="px-3 py-2 font-bold">{r.quantidade}</td>
                        <td className="px-3 py-2">
                          <span className={cn("inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold",
                            r.fase === "intermediaria"
                              ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                              : "bg-violet-500/10 text-violet-600 dark:text-violet-400")}>
                            {r.fase === "intermediaria" ? "Inter." : "Exp."}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {validRows.length > 300 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-3 text-center text-[11px] text-muted-foreground">
                          + {validRows.length - 300} lotes adicionais (todos serão importados)
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>)}

          {/* ─ IMPORTING / DONE ─ */}
          {(step === "importing" || step === "done") && (<>
            {step === "importing" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Importando...
                  </span>
                  <span>{progress.current} / {progress.total}</span>
                </div>
                <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                    style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }} />
                </div>
              </div>
            )}

            {step === "done" && (
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Atualizados",   value: resOk.length,      color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
                  { label: "Peças criadas", value: resCreated.length,  color: "text-blue-600 dark:text-blue-400",       bg: "bg-blue-500/10 border-blue-500/20" },
                  { label: "Erros",         value: resError.length,    color: "text-destructive",                        bg: "bg-destructive/10 border-destructive/20" },
                ].map(({ label, value, color, bg }) => (
                  <div key={label} className={cn("rounded-xl border p-3 text-center", bg)}>
                    <div className={cn("text-2xl font-bold tabular-nums", color)}>{value}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
                  </div>
                ))}
              </div>
            )}

            {step === "done" && resCreated.length > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
                <PlusCircle className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
                <p className="text-[11px] text-blue-700 dark:text-blue-400">
                  {resCreated.length} peça{resCreated.length > 1 ? "s foram criadas" : " foi criada"} com nome e referência. Complete o cadastro em <strong>Admin → Dispositivos</strong>.
                </p>
              </div>
            )}

            <div className="rounded-xl border border-border/30 overflow-hidden">
              <div className="bg-muted/30 px-3 py-2 border-b border-border/20 text-xs font-semibold text-muted-foreground">
                Resultado por lote
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-border/20">
                {results.map(r => (
                  <div key={r.line} className="flex items-start gap-2.5 px-3 py-2.5">
                    {r.status === "ok"      && <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />}
                    {r.status === "created" && <PlusCircle   className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />}
                    {r.status === "error"   && <XCircle      className="h-4 w-4 text-destructive shrink-0 mt-0.5" />}
                    {r.status === "pending" && <Loader2      className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5 animate-spin" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-medium truncate">{r.deviceModel ?? r.nome}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">· {r.lote}</span>
                        {r.quantidade != null && <span className="text-[10px] font-bold">· {r.quantidade} un.</span>}
                      </div>
                      {r.message && (
                        <p className={cn("text-[10px] mt-0.5",
                          r.status === "ok"      ? "text-emerald-600 dark:text-emerald-400" :
                          r.status === "created" ? "text-blue-600 dark:text-blue-400" :
                          "text-muted-foreground")}>
                          {r.message}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>)}
        </div>

        {/* Rodapé */}
        <div className="px-5 py-4 border-t border-border/30 shrink-0 flex items-center justify-between gap-3">
          {(step === "idle" || step === "parsing-pdf") && (
            <button type="button" onClick={handleClose} disabled={step === "parsing-pdf"}
              className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted/30 transition-colors disabled:opacity-50">
              Cancelar
            </button>
          )}
          {step === "preview" && (<>
            <button type="button" onClick={reset}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted/30 transition-colors">
              <RefreshCw className="h-3.5 w-3.5" /> Trocar arquivo
            </button>
            <button type="button" onClick={handleImport} disabled={validRows.length === 0}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors disabled:opacity-50">
              <ArrowRight className="h-4 w-4" />
              Importar {validRows.length} lote{validRows.length !== 1 ? "s" : ""}
            </button>
          </>)}
          {step === "importing" && (
            <span className="text-xs text-muted-foreground">Processando, aguarde...</span>
          )}
          {step === "done" && (<>
            <button type="button" onClick={reset}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted/30 transition-colors">
              <RefreshCw className="h-3.5 w-3.5" /> Nova importação
            </button>
            <button type="button" onClick={handleClose}
              className="px-5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition-colors">
              Concluir
            </button>
          </>)}
        </div>
      </div>
    </div>
  );
}
