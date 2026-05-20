/**
 * ExcelStockImport — importa lotes do intermediário e expedição via planilha Excel.
 *
 * Usa exceljs (já instalado no projeto) para leitura do .xlsx.
 *
 * Formato esperado:
 *   Coluna A: nome da peça  (model)
 *   Coluna B: lote          (ex: 0101261-01)
 *   Coluna C: quantidade    (número inteiro > 0)
 *   Coluna D: fase          ("intermediario" ou "expedicao")
 */

import { useRef, useState, useCallback } from "react";
import ExcelJS from "exceljs";
import { supabase } from "@/integrations/supabase/client";
import { registerMovement } from "@/hooks/useStock";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  FileSpreadsheet, Upload, Download, CheckCircle2,
  XCircle, AlertTriangle, Loader2, ChevronDown, ChevronUp,
  X, Eye, ArrowRight, RefreshCw,
} from "lucide-react";

// ── Tipos ─────────────────────────────────────────────────────────────────────

type Fase = "intermediaria" | "expedicao";

interface ParsedRow {
  line: number;
  nome: string;
  lote: string;
  quantidade: number | null;
  fase: Fase | null;
  parseError?: string;
}

type ImportStatus = "pending" | "ok" | "notfound" | "error";

interface ImportResult extends ParsedRow {
  status: ImportStatus;
  message?: string;
  deviceModel?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeFase(raw: string): Fase | null {
  const v = raw.trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");
  if (["intermediario","intermediaria","inter","i"].includes(v)) return "intermediaria";
  if (["expedicao","exp","e"].includes(v)) return "expedicao";
  return null;
}

function normalizeStr(s: string) {
  return s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

function cellStr(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "result" in v) return String((v as ExcelJS.CellFormulaValue).result ?? "");
  if (typeof v === "object" && "text" in v) return String((v as ExcelJS.CellRichTextValue).text ?? "");
  return String(v).trim();
}

async function findStockItem(nomeNorm: string, fase: Fase): Promise<{ id: string; model: string } | null> {
  const { data: devices } = await supabase
    .from("devices")
    .select("id, model")
    .ilike("model", `%${nomeNorm}%`)
    .limit(10);

  if (!devices || devices.length === 0) return null;

  for (const dev of devices as { id: string; model: string }[]) {
    const { data: si } = await supabase
      .from("stock_items")
      .select("id")
      .eq("device_id", dev.id)
      .eq("fase", fase)
      .maybeSingle();
    if (si) return { id: si.id, model: dev.model };
  }

  // Tenta criar o stock_item se encontrou o device mas não tinha o item para essa fase
  const exact = (devices as { id: string; model: string }[]).find(
    d => normalizeStr(d.model) === nomeNorm
  ) ?? (devices as { id: string; model: string }[])[0];

  if (exact) {
    const { data: upserted } = await supabase
      .from("stock_items")
      .upsert({ device_id: exact.id, quantity: 0, min_quantity: 0, fase }, { onConflict: "device_id,fase" })
      .select("id")
      .single();
    if (upserted) return { id: upserted.id, model: exact.model };
  }

  return null;
}

// ── Template download (gera xlsx com exceljs) ─────────────────────────────────

async function downloadTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Importação");

  ws.columns = [
    { header: "Peça (nome/modelo)", key: "peca", width: 38 },
    { header: "Lote",               key: "lote", width: 20 },
    { header: "Quantidade",         key: "qtd",  width: 14 },
    { header: "Fase",               key: "fase", width: 18 },
  ];

  // Estilo do cabeçalho
  ws.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B21B6" } };
    cell.alignment = { horizontal: "center" };
  });

  // Exemplos
  ws.addRow({ peca: "IMPLANTE COCLEAR IC-200",   lote: "0101261-01", qtd: 50, fase: "intermediario" });
  ws.addRow({ peca: "PROCESSADOR DE SOM PS-300", lote: "0202362-02", qtd: 30, fase: "expedicao" });
  ws.addRow({ peca: "BOBINA MAGNETICA BM-100",   lote: "0303463-03", qtd: 20, fase: "intermediario" });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "template-importacao-estoque.xlsx"; a.click();
  URL.revokeObjectURL(url);
}

// ── Componente principal ──────────────────────────────────────────────────────

export function ExcelStockImport({ open, onClose, onSuccess }: Props) {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep]       = useState<"idle" | "preview" | "importing" | "done">("idle");
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [isDragging, setIsDragging] = useState(false);

  function reset() {
    setStep("idle"); setParsedRows([]); setResults([]);
    setShowErrors(false); setProgress({ current: 0, total: 0 });
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleClose() { reset(); onClose(); }

  // ── Parse arquivo com exceljs ─────────────────────────────────────────────

  const parseFile = useCallback(async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      toast.error("Formato inválido. Use .xlsx ou .xls"); return;
    }
    try {
      const buf = await file.arrayBuffer();
      const wb  = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const ws = wb.worksheets[0];
      if (!ws) { toast.error("Planilha vazia ou inválida."); return; }

      const rows: ParsedRow[] = [];
      ws.eachRow((row, rowNum) => {
        // Pula cabeçalho (linha 1 se for texto)
        if (rowNum === 1) {
          const first = cellStr(row.getCell(1)).toLowerCase();
          if (["peça","peca","nome","modelo","model"].some(k => first.includes(k))) return;
        }

        const rawNome = cellStr(row.getCell(1));
        const rawLote = cellStr(row.getCell(2));
        const rawQtd  = cellStr(row.getCell(3));
        const rawFase = cellStr(row.getCell(4));

        if (!rawNome && !rawLote && !rawQtd) return; // linha vazia

        const quantidade = parseInt(rawQtd.replace(/[^\d]/g, ""), 10);
        const fase       = normalizeFase(rawFase);

        let parseError: string | undefined;
        if (!rawNome) parseError = "Nome da peça ausente";
        else if (!rawLote) parseError = "Lote ausente";
        else if (isNaN(quantidade) || quantidade <= 0) parseError = `Quantidade inválida: "${rawQtd}"`;
        else if (!fase) parseError = `Fase inválida: "${rawFase}" — use "intermediario" ou "expedicao"`;

        rows.push({ line: rowNum, nome: rawNome, lote: rawLote,
          quantidade: isNaN(quantidade) ? null : quantidade, fase, parseError });
      });

      if (rows.length === 0) { toast.error("Nenhuma linha de dados encontrada."); return; }
      setParsedRows(rows);
      setStep("preview");
    } catch (err) {
      toast.error("Erro ao ler planilha. Verifique o arquivo.");
      console.error(err);
    }
  }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }

  // ── Importar ──────────────────────────────────────────────────────────────

  async function handleImport() {
    const valid = parsedRows.filter(r => !r.parseError);
    if (!valid.length) { toast.error("Nenhuma linha válida."); return; }

    setStep("importing");
    setProgress({ current: 0, total: valid.length });

    const res: ImportResult[] = parsedRows.map(r => ({
      ...r, status: r.parseError ? "error" : "pending", message: r.parseError,
    }));
    setResults([...res]);

    let ok = 0, err = res.filter(r => r.status === "error").length;

    for (let i = 0; i < valid.length; i++) {
      const row = valid[i];
      const idx = res.findIndex(r => r.line === row.line);
      try {
        const found = await findStockItem(normalizeStr(row.nome), row.fase!);
        if (!found) {
          res[idx] = { ...res[idx], status: "notfound", message: `"${row.nome}" não encontrada para fase "${row.fase}"` };
          err++;
        } else {
          const mv = await registerMovement(found.id, "entrada", row.quantidade!,
            `Importação via planilha — lote: ${row.lote}`, user?.id ?? null, null, row.lote);
          if (mv.ok) {
            res[idx] = { ...res[idx], status: "ok", deviceModel: found.model,
              message: `+${row.quantidade} un. em "${found.model}"` };
            ok++;
          } else {
            res[idx] = { ...res[idx], status: "error", message: mv.error ?? "Erro ao registrar" };
            err++;
          }
        }
      } catch {
        res[idx] = { ...res[idx], status: "error", message: "Erro inesperado" };
        err++;
      }
      setResults([...res]);
      setProgress({ current: i + 1, total: valid.length });
      if (i < valid.length - 1) await new Promise(r => setTimeout(r, 80));
    }

    setStep("done");
    if (ok > 0) { toast.success(`${ok} lote${ok > 1 ? "s" : ""} importado${ok > 1 ? "s" : ""}!`); onSuccess(); }
    if (err > 0) toast.error(`${err} linha${err > 1 ? "s" : ""} com erro.`);
  }

  if (!open) return null;

  const parseErrors = parsedRows.filter(r => r.parseError);
  const validRows   = parsedRows.filter(r => !r.parseError);
  const interRows   = validRows.filter(r => r.fase === "intermediaria");
  const expRows     = validRows.filter(r => r.fase === "expedicao");
  const resOk       = results.filter(r => r.status === "ok");
  const resNotFound = results.filter(r => r.status === "notfound");
  const resError    = results.filter(r => r.status === "error");

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl bg-card border border-border/30 shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in slide-in-from-bottom-4 duration-200">

        {/* Cabeçalho */}
        <div className="px-5 py-4 border-b border-border/30 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <FileSpreadsheet className="h-4 w-4 text-emerald-500" />
            </div>
            <div>
              <p className="text-sm font-semibold">Importar via Excel</p>
              <p className="text-[11px] text-muted-foreground">Intermediário e Expedição — por lote e quantidade</p>
            </div>
          </div>
          <button type="button" onClick={handleClose}
            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* ── idle ── */}
          {step === "idle" && (<>
            {/* Template */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border/30">
              <div>
                <p className="text-xs font-semibold">Baixar modelo de planilha</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Colunas: Peça · Lote · Quantidade · Fase</p>
              </div>
              <button type="button" onClick={downloadTemplate}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors">
                <Download className="h-3.5 w-3.5" /> Baixar modelo
              </button>
            </div>

            {/* Drop zone */}
            <label
              className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 cursor-pointer transition-all",
                isDragging ? "border-emerald-500 bg-emerald-500/5" : "border-border/60 hover:border-emerald-500/60 hover:bg-muted/20")}
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}>
              <div className={cn("h-14 w-14 rounded-2xl flex items-center justify-center transition-colors",
                isDragging ? "bg-emerald-500/15" : "bg-muted/40")}>
                <Upload className={cn("h-7 w-7 transition-colors", isDragging ? "text-emerald-500" : "text-muted-foreground")} />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold">{isDragging ? "Solte o arquivo aqui" : "Arraste ou clique para selecionar"}</p>
                <p className="text-[11px] text-muted-foreground mt-1">Suporta .xlsx e .xls</p>
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f); }} />
            </label>

            {/* Instruções */}
            <div className="rounded-xl border border-border/30 bg-muted/20 p-4 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Formato da planilha</p>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { col: "A", label: "Peça",       desc: "Nome/modelo" },
                  { col: "B", label: "Lote",        desc: "Ex: 0101261-01" },
                  { col: "C", label: "Quantidade",  desc: "Número inteiro" },
                  { col: "D", label: "Fase",        desc: '"intermediario" ou "expedicao"' },
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

          {/* ── preview ── */}
          {step === "preview" && (<>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "Total", value: parsedRows.length, color: "text-foreground" },
                { label: "Válidas", value: validRows.length, color: "text-emerald-600 dark:text-emerald-400" },
                { label: "Intermediário", value: interRows.length, color: "text-blue-600 dark:text-blue-400" },
                { label: "Expedição", value: expRows.length, color: "text-violet-600 dark:text-violet-400" },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-xl border border-border/30 bg-muted/20 p-3 text-center">
                  <div className={cn("text-xl font-bold tabular-nums", color)}>{value}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
                </div>
              ))}
            </div>

            {parseErrors.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
                <button type="button" onClick={() => setShowErrors(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-left">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                      {parseErrors.length} linha{parseErrors.length > 1 ? "s" : ""} com erro — serão ignoradas
                    </span>
                  </div>
                  {showErrors ? <ChevronUp className="h-3.5 w-3.5 text-amber-500" /> : <ChevronDown className="h-3.5 w-3.5 text-amber-500" />}
                </button>
                {showErrors && (
                  <div className="border-t border-amber-500/20 px-4 py-2 space-y-1">
                    {parseErrors.map(r => (
                      <div key={r.line} className="text-[11px] text-amber-700 dark:text-amber-400">
                        <span className="font-semibold">Linha {r.line}:</span> {r.parseError}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="rounded-xl border border-border/30 overflow-hidden">
              <div className="bg-muted/30 px-3 py-2 flex items-center gap-1.5 border-b border-border/20">
                <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground">Pré-visualização — {validRows.length} linhas válidas</span>
              </div>
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/50">
                    <tr>
                      {["#","Peça","Lote","Qtd.","Fase"].map(h => (
                        <th key={h} className="text-left px-3 py-2 font-semibold text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {validRows.map(r => (
                      <tr key={r.line} className="hover:bg-muted/20">
                        <td className="px-3 py-2 text-muted-foreground">{r.line}</td>
                        <td className="px-3 py-2 font-medium max-w-[160px] truncate" title={r.nome}>{r.nome}</td>
                        <td className="px-3 py-2 font-mono text-muted-foreground">{r.lote}</td>
                        <td className="px-3 py-2 font-bold">{r.quantidade}</td>
                        <td className="px-3 py-2">
                          <span className={cn("inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold",
                            r.fase === "intermediaria"
                              ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                              : "bg-violet-500/10 text-violet-600 dark:text-violet-400")}>
                            {r.fase === "intermediaria" ? "Intermediário" : "Expedição"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>)}

          {/* ── importing / done ── */}
          {(step === "importing" || step === "done") && (<>
            {step === "importing" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />Importando...</span>
                  <span>{progress.current}/{progress.total}</span>
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
                  { label: "Importados", value: resOk.length, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
                  { label: "Não encontrados", value: resNotFound.length, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
                  { label: "Erros", value: resError.length, color: "text-destructive", bg: "bg-destructive/10 border-destructive/20" },
                ].map(({ label, value, color, bg }) => (
                  <div key={label} className={cn("rounded-xl border p-3 text-center", bg)}>
                    <div className={cn("text-2xl font-bold tabular-nums", color)}>{value}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-xl border border-border/30 overflow-hidden">
              <div className="bg-muted/30 px-3 py-2 border-b border-border/20 text-xs font-semibold text-muted-foreground">
                Resultado por linha
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-border/20">
                {results.map(r => (
                  <div key={r.line} className="flex items-start gap-2.5 px-3 py-2.5">
                    {r.status === "ok"       && <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />}
                    {r.status === "notfound" && <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />}
                    {r.status === "error"    && <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />}
                    {r.status === "pending"  && <Loader2 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5 animate-spin" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] text-muted-foreground">Ln {r.line}</span>
                        <span className="text-xs font-medium truncate">{r.deviceModel ?? r.nome}</span>
                        {r.lote && <span className="text-[10px] font-mono text-muted-foreground">· {r.lote}</span>}
                        {r.quantidade && <span className="text-[10px] font-bold">· {r.quantidade} un.</span>}
                      </div>
                      {r.message && (
                        <p className={cn("text-[10px] mt-0.5",
                          r.status === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
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
          {step === "idle" && (
            <button type="button" onClick={handleClose}
              className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted/30 transition-colors">
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
              Importar {validRows.length} linha{validRows.length !== 1 ? "s" : ""}
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
