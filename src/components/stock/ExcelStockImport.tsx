/**
 * ExcelStockImport — importa lotes do intermediário e expedição via planilha Excel.
 *
 * Formato esperado:
 *   Coluna A: nome da peça  (model — texto livre, busca por similaridade)
 *   Coluna B: lote          (ex: 0101261-01)
 *   Coluna C: quantidade    (número inteiro)
 *   Coluna D: fase          ("intermediario" ou "expedicao")
 *
 * O componente:
 *  1. Lê o .xlsx com SheetJS (já instalado no projeto via exceljs/xlsx)
 *  2. Faz preview dos dados antes de importar
 *  3. Busca o stock_item correspondente (device + fase) no banco
 *  4. Registra entrada com registerMovement
 *  5. Mostra resultado linha a linha
 */

import { useRef, useState, useCallback } from "react";
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

// ── Tipos ────────────────────────────────────────────────────────────────────

type Fase = "intermediaria" | "expedicao";

interface ParsedRow {
  line: number;
  rawNome: string;
  rawLote: string;
  rawQtd: string;
  rawFase: string;
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeFase(raw: string): Fase | null {
  const v = raw.trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[çÇ]/g, "c")
    .replace(/\s+/g, "");
  if (v === "intermediario" || v === "intermediaria" || v === "inter" || v === "i") return "intermediaria";
  if (v === "expedicao" || v === "expedicao" || v === "exp" || v === "e" || v === "expedicao") return "expedicao";
  return null;
}

function normalizeStr(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

function parseQtd(raw: string): number | null {
  const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
  return isNaN(n) || n <= 0 ? null : n;
}

// Encontra stock_item pelo model da peça e fase
async function findStockItem(
  nomeNorm: string,
  fase: Fase
): Promise<{ id: string; model: string } | null> {
  // Busca devices cujo model normalizado contém o texto digitado
  const { data: devices } = await supabase
    .from("devices")
    .select("id, model, reference")
    .ilike("model", `%${nomeNorm}%`)
    .limit(10);

  if (!devices || devices.length === 0) return null;

  // Para cada device, verifica se existe stock_item nessa fase
  for (const dev of devices as { id: string; model: string; reference: string }[]) {
    const { data: si } = await supabase
      .from("stock_items")
      .select("id")
      .eq("device_id", dev.id)
      .eq("fase", fase)
      .maybeSingle();
    if (si) return { id: si.id, model: dev.model };
  }

  // Se não encontrou stock_item, tenta match exato pelo model
  const exact = (devices as { id: string; model: string }[]).find(
    d => normalizeStr(d.model) === nomeNorm
  );
  if (exact) {
    // Cria o stock_item se não existir (upsert)
    const { data: upserted } = await supabase
      .from("stock_items")
      .upsert(
        { device_id: exact.id, quantity: 0, min_quantity: 0, fase },
        { onConflict: "device_id,fase" }
      )
      .select("id")
      .single();
    if (upserted) return { id: upserted.id, model: exact.model };
  }

  return null;
}

// ── Template Excel ───────────────────────────────────────────────────────────

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const rows = [
    ["Peça (nome/modelo)", "Lote", "Quantidade", "Fase"],
    ["IMPLANTE COCLEAR IC-200", "0101261-01", 50, "intermediario"],
    ["PROCESSADOR DE SOM PS-300", "0202362-02", 30, "expedicao"],
    ["BOBINA MAGNETICA BM-100", "0303463-03", 20, "intermediario"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Larguras das colunas
  ws["!cols"] = [{ wch: 36 }, { wch: 18 }, { wch: 14 }, { wch: 18 }];

  XLSX.utils.book_append_sheet(wb, ws, "Importação");
  XLSX.writeFile(wb, "template-importacao-estoque.xlsx");
}

// ── Componente ───────────────────────────────────────────────────────────────

export function ExcelStockImport({ open, onClose, onSuccess }: Props) {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"idle" | "preview" | "importing" | "done">("idle");
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // ── Reset ─────────────────────────────────────────────────────────────────
  function reset() {
    setStep("idle");
    setParsedRows([]);
    setResults([]);
    setShowErrors(false);
    setImportProgress({ current: 0, total: 0 });
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleClose() { reset(); onClose(); }

  // ── Ler arquivo Excel ─────────────────────────────────────────────────────
  const parseFile = useCallback((file: File) => {
    if (!file.name.match(/\.(xlsx|xls|ods)$/i)) {
      toast.error("Formato inválido. Use .xlsx, .xls ou .ods");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as string[][];

        // Detecta se primeira linha é cabeçalho
        const firstRow = raw[0]?.map(c => String(c).trim().toLowerCase()) ?? [];
        const hasHeader = firstRow.some(c =>
          ["peça", "peca", "lote", "quantidade", "qtd", "fase"].some(k => c.includes(k))
        );
        const dataRows = hasHeader ? raw.slice(1) : raw;

        const parsed: ParsedRow[] = dataRows
          .map((row, i) => {
            const rawNome = String(row[0] ?? "").trim();
            const rawLote = String(row[1] ?? "").trim();
            const rawQtd  = String(row[2] ?? "").trim();
            const rawFase = String(row[3] ?? "").trim();

            if (!rawNome && !rawLote && !rawQtd) return null; // linha vazia

            const nome      = rawNome;
            const lote      = rawLote;
            const quantidade = parseQtd(rawQtd);
            const fase       = normalizeFase(rawFase);

            let parseError: string | undefined;
            if (!nome) parseError = "Nome da peça ausente";
            else if (!lote) parseError = "Lote ausente";
            else if (quantidade === null) parseError = `Quantidade inválida: "${rawQtd}"`;
            else if (fase === null) parseError = `Fase inválida: "${rawFase}" (use "intermediario" ou "expedicao")`;

            return {
              line: i + (hasHeader ? 2 : 1),
              rawNome, rawLote, rawQtd, rawFase,
              nome, lote, quantidade, fase,
              parseError,
            } satisfies ParsedRow;
          })
          .filter(Boolean) as ParsedRow[];

        if (parsed.length === 0) {
          toast.error("Nenhuma linha de dados encontrada na planilha.");
          return;
        }

        setParsedRows(parsed);
        setStep("preview");
      } catch (err) {
        toast.error("Erro ao ler planilha. Verifique o formato do arquivo.");
        console.error(err);
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  // ── Drag & Drop ───────────────────────────────────────────────────────────
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }

  // ── Importar ──────────────────────────────────────────────────────────────
  async function handleImport() {
    const validRows = parsedRows.filter(r => !r.parseError);
    if (validRows.length === 0) { toast.error("Nenhuma linha válida para importar."); return; }

    setStep("importing");
    setImportProgress({ current: 0, total: validRows.length });

    const importResults: ImportResult[] = [...parsedRows.map(r => ({
      ...r,
      status: r.parseError ? "error" as ImportStatus : "pending" as ImportStatus,
      message: r.parseError,
    }))];
    setResults(importResults);

    let okCount = 0;
    let errCount = parsedRows.filter(r => r.parseError).length;

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      const nomeNorm = normalizeStr(row.nome);

      try {
        // Busca o stock_item
        const found = await findStockItem(nomeNorm, row.fase!);

        const resultIdx = importResults.findIndex(
          r => r.line === row.line
        );

        if (!found) {
          importResults[resultIdx] = {
            ...importResults[resultIdx],
            status: "notfound",
            message: `Peça "${row.nome}" não encontrada no banco para fase "${row.fase}"`,
          };
          errCount++;
        } else {
          // Registra a entrada
          const res = await registerMovement(
            found.id,
            "entrada",
            row.quantidade!,
            `Importação via planilha Excel — lote: ${row.lote}`,
            user?.id ?? null,
            null,
            row.lote
          );

          if (res.ok) {
            importResults[resultIdx] = {
              ...importResults[resultIdx],
              status: "ok",
              deviceModel: found.model,
              message: `+${row.quantidade} unidades registradas em "${found.model}"`,
            };
            okCount++;
          } else {
            importResults[resultIdx] = {
              ...importResults[resultIdx],
              status: "error",
              message: res.error ?? "Erro ao registrar movimento",
            };
            errCount++;
          }
        }
      } catch (err) {
        const resultIdx = importResults.findIndex(r => r.line === row.line);
        importResults[resultIdx] = {
          ...importResults[resultIdx],
          status: "error",
          message: "Erro inesperado",
        };
        errCount++;
      }

      setResults([...importResults]);
      setImportProgress({ current: i + 1, total: validRows.length });

      // Pequena pausa para não sobrecarregar o banco
      if (i < validRows.length - 1) await new Promise(r => setTimeout(r, 80));
    }

    setStep("done");

    if (okCount > 0) {
      toast.success(`${okCount} lote${okCount > 1 ? "s" : ""} importado${okCount > 1 ? "s" : ""} com sucesso!`);
      onSuccess();
    }
    if (errCount > 0) {
      toast.error(`${errCount} linha${errCount > 1 ? "s" : ""} com erro.`);
    }
  }

  if (!open) return null;

  // ── Estatísticas do preview ───────────────────────────────────────────────
  const parseErrors  = parsedRows.filter(r => r.parseError);
  const validRows    = parsedRows.filter(r => !r.parseError);
  const interRows    = validRows.filter(r => r.fase === "intermediaria");
  const expRows      = validRows.filter(r => r.fase === "expedicao");

  // ── Estatísticas pós-importação ───────────────────────────────────────────
  const resOk       = results.filter(r => r.status === "ok");
  const resNotFound = results.filter(r => r.status === "notfound");
  const resError    = results.filter(r => r.status === "error");
  const resPending  = results.filter(r => r.status === "pending");

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl bg-card border border-border/30 shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in slide-in-from-bottom-4 duration-200">

        {/* ── Cabeçalho ── */}
        <div className="px-5 py-4 border-b border-border/30 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <FileSpreadsheet className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-sm font-semibold">Importar via Excel</p>
                <p className="text-[11px] text-muted-foreground">
                  Intermediário e Expedição — por lote e quantidade
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Conteúdo ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* ── STEP: idle — drop zone ── */}
          {step === "idle" && (
            <>
              {/* Template download */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border/30">
                <div>
                  <p className="text-xs font-semibold">Baixar modelo de planilha</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Colunas: Peça · Lote · Quantidade · Fase
                  </p>
                </div>
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  Baixar modelo
                </button>
              </div>

              {/* Drop zone */}
              <label
                className={cn(
                  "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 cursor-pointer transition-all",
                  isDragging
                    ? "border-emerald-500 bg-emerald-500/5"
                    : "border-border/60 hover:border-emerald-500/60 hover:bg-muted/20"
                )}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <div className={cn(
                  "h-14 w-14 rounded-2xl flex items-center justify-center transition-colors",
                  isDragging ? "bg-emerald-500/15" : "bg-muted/40"
                )}>
                  <Upload className={cn("h-7 w-7 transition-colors", isDragging ? "text-emerald-500" : "text-muted-foreground")} />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold">
                    {isDragging ? "Solte o arquivo aqui" : "Arraste o arquivo ou clique para selecionar"}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Suporta .xlsx, .xls e .ods
                  </p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.ods"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f); }}
                />
              </label>

              {/* Instruções */}
              <div className="rounded-xl border border-border/30 bg-muted/20 p-4 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Formato da planilha</p>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { col: "A", label: "Peça", desc: "Nome/modelo exato" },
                    { col: "B", label: "Lote", desc: "Ex: 0101261-01" },
                    { col: "C", label: "Quantidade", desc: "Número inteiro" },
                    { col: "D", label: "Fase", desc: '"intermediario" ou "expedicao"' },
                  ].map(({ col, label, desc }) => (
                    <div key={col} className="rounded-lg bg-card border border-border/30 p-2.5 text-center">
                      <div className="text-[10px] font-bold text-primary/70 mb-1">Col. {col}</div>
                      <div className="text-xs font-semibold">{label}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── STEP: preview ── */}
          {step === "preview" && (
            <>
              {/* Resumo */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: "Total de linhas", value: parsedRows.length, color: "text-foreground" },
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

              {/* Erros de parse */}
              {parseErrors.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between px-4 py-2.5 text-left"
                    onClick={() => setShowErrors(v => !v)}
                  >
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

              {/* Tabela preview */}
              <div className="rounded-xl border border-border/30 overflow-hidden">
                <div className="bg-muted/30 px-3 py-2 flex items-center gap-1.5 border-b border-border/20">
                  <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground">Pré-visualização</span>
                  <span className="text-[10px] text-muted-foreground/60 ml-1">({validRows.length} linhas válidas)</span>
                </div>
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/50">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground">#</th>
                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Peça</th>
                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Lote</th>
                        <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Qtd.</th>
                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Fase</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/20">
                      {validRows.map(r => (
                        <tr key={r.line} className="hover:bg-muted/20">
                          <td className="px-3 py-2 text-muted-foreground">{r.line}</td>
                          <td className="px-3 py-2 font-medium max-w-[180px] truncate" title={r.nome}>{r.nome}</td>
                          <td className="px-3 py-2 font-mono text-muted-foreground">{r.lote}</td>
                          <td className="px-3 py-2 text-right font-bold">{r.quantidade}</td>
                          <td className="px-3 py-2">
                            <span className={cn(
                              "inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold",
                              r.fase === "intermediaria"
                                ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                                : "bg-violet-500/10 text-violet-600 dark:text-violet-400"
                            )}>
                              {r.fase === "intermediaria" ? "Intermediário" : "Expedição"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* ── STEP: importing / done ── */}
          {(step === "importing" || step === "done") && (
            <>
              {/* Barra de progresso */}
              {step === "importing" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Importando...
                    </span>
                    <span>{importProgress.current}/{importProgress.total}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                      style={{ width: `${importProgress.total ? (importProgress.current / importProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Resumo final */}
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

              {/* Lista de resultados */}
              <div className="rounded-xl border border-border/30 overflow-hidden">
                <div className="bg-muted/30 px-3 py-2 border-b border-border/20 text-xs font-semibold text-muted-foreground">
                  Resultado por linha
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-border/20">
                  {results.map(r => (
                    <div key={r.line} className="flex items-start gap-2.5 px-3 py-2.5">
                      {r.status === "ok" && <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />}
                      {r.status === "notfound" && <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />}
                      {r.status === "error" && <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />}
                      {r.status === "pending" && <Loader2 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5 animate-spin" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] text-muted-foreground">Ln {r.line}</span>
                          <span className="text-xs font-medium truncate">{r.deviceModel ?? r.nome}</span>
                          {r.lote && <span className="text-[10px] font-mono text-muted-foreground">· {r.lote}</span>}
                          {r.quantidade && <span className="text-[10px] font-bold">· {r.quantidade} un.</span>}
                        </div>
                        {r.message && (
                          <p className={cn("text-[10px] mt-0.5", r.status === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                            {r.message}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Rodapé com ações ── */}
        <div className="px-5 py-4 border-t border-border/30 shrink-0 flex items-center justify-between gap-3">
          {step === "idle" && (
            <>
              <button type="button" onClick={handleClose} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted/30 transition-colors">
                Cancelar
              </button>
              <span />
            </>
          )}

          {step === "preview" && (
            <>
              <button
                type="button"
                onClick={reset}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted/30 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Trocar arquivo
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={validRows.length === 0}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
              >
                <ArrowRight className="h-4 w-4" />
                Importar {validRows.length} linha{validRows.length > 1 ? "s" : ""}
              </button>
            </>
          )}

          {step === "importing" && (
            <span className="text-xs text-muted-foreground">Processando, aguarde...</span>
          )}

          {step === "done" && (
            <>
              <button type="button" onClick={reset} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted/30 transition-colors">
                <RefreshCw className="h-3.5 w-3.5" /> Nova importação
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="px-5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition-colors"
              >
                Concluir
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
