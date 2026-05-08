import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Download,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface ImportRow {
  line: number;
  udi_di?: string;
  reference?: string;
  model?: string;
  quantity?: number;
  min_quantity?: number;
  location?: string;
  notes?: string;
}

interface ImportResult {
  line: number;
  model: string;
  reference: string;
  status: "ok" | "notfound" | "error";
  message?: string;
  quantity: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

// ─── Normaliza header CSV (mesmo padrão do AdminDevices) ──────────────────────
function normalizeHeader(h: string): string {
  return h
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

// Extrai valor de célula CSV (tira aspas)
function parseCell(v: string): string {
  return v.trim().replace(/^["']|["']$/g, "").trim();
}

// Lê arquivo com encoding correto (UTF-8 → Windows-1252 → ISO-8859-1)
function readWithEncoding(file: File, enc: string): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = (e) => res((e.target?.result as string) ?? "");
    r.onerror = () => rej(new Error("Erro ao ler arquivo"));
    r.readAsText(file, enc);
  });
}

function looksCorrupted(s: string) {
  return (
    /[\u00c2\u00c3\u00c4\u00c5\u00c6\u00c7][\u0080-\u00bf]/.test(s) ||
    s.includes("\uFFFD")
  );
}

// ─── Componente ───────────────────────────────────────────────────────────────
export function StockCsvImport({ open, onClose, onSuccess }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [showDetails, setShowDetails] = useState(false);
  const [done, setDone] = useState(false);

  function reset() {
    setResults([]);
    setDone(false);
    setShowDetails(false);
    setImportProgress(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleClose() {
    reset();
    onClose();
  }

  // ── Download template CSV ──────────────────────────────────────────────────
  function downloadTemplate() {
    const header = "udi_di,reference,model,quantity,min_quantity,location,notes";
    const example = [
      "00000000001234,REF-001,Implante Exemplo,10,2,Armário A-1,Lote inicial",
      "00000000005678,REF-002,Parafuso Titânio,25,5,Gaveta B-3,",
    ].join("\n");
    const blob = new Blob([header + "\n" + example], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo_importacao_estoque.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Processa o arquivo ─────────────────────────────────────────────────────
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || importing) return;

    // SEG-05: Validate both extension and MIME type
    const ALLOWED_MIME = ["text/csv", "text/plain", "application/csv", "application/vnd.ms-excel", ""];
    if (!file.name.toLowerCase().endsWith(".csv") ||
        (file.type && !ALLOWED_MIME.includes(file.type))) {
      toast.error("Apenas arquivos .csv são aceitos.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Arquivo muito grande. Máximo: 5 MB.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    setImporting(true);
    setDone(false);
    setResults([]);

    try {
      // 1. Lê com encoding correto
      let text = await readWithEncoding(file, "UTF-8");
      if (looksCorrupted(text)) {
        const w = await readWithEncoding(file, "windows-1252");
        text = looksCorrupted(w) ? await readWithEncoding(file, "ISO-8859-1") : w;
      }

      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) {
        toast.error("CSV vazio ou sem dados após o cabeçalho.");
        return;
      }

      // 2. Parse cabeçalho
      const delim = lines[0].includes(";") ? ";" : ",";
      const headers = lines[0].split(delim).map(normalizeHeader);

      // Mapeamento de variantes aceitas
      const COL: Record<string, string[]> = {
        udi_di:       ["udi_di", "udidi", "udi"],
        reference:    ["reference", "referencia", "ref", "codigo"],
        model:        ["model", "modelo", "nome", "descricao"],
        quantity:     ["quantity", "quantidade", "qty", "qtd", "qtde"],
        min_quantity: ["min_quantity", "quantidade_minima", "minimo", "min", "estoque_minimo"],
        location:     ["location", "localizacao", "local", "armario", "gaveta"],
        notes:        ["notes", "notas", "obs", "observacao", "observacoes"],
      };

      // Monta índice de coluna
      const idx: Record<string, number> = {};
      for (const [field, variants] of Object.entries(COL)) {
        const found = headers.findIndex((h) => variants.includes(h));
        if (found >= 0) idx[field] = found;
      }

      // Valida que tem pelo menos um identificador
      const hasUdi  = idx.udi_di    !== undefined;
      const hasRef  = idx.reference !== undefined;
      if (!hasUdi && !hasRef) {
        toast.error(
          "CSV precisa ter pelo menos uma das colunas: udi_di, reference.\n" +
          `Detectado: ${headers.slice(0, 8).join(", ")}`
        );
        return;
      }

      // 3. Parse das linhas de dados
      const rows: ImportRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(delim).map(parseCell);
        if (cells.every((c) => !c)) continue; // linha em branco

        const row: ImportRow = { line: i + 1 };
        if (idx.udi_di    !== undefined) row.udi_di       = cells[idx.udi_di]    ?? "";
        if (idx.reference !== undefined) row.reference    = cells[idx.reference] ?? "";
        if (idx.model     !== undefined) row.model        = cells[idx.model]     ?? "";
        if (idx.quantity  !== undefined) {
          const n = parseInt(cells[idx.quantity] ?? "0");
          row.quantity = isNaN(n) ? 0 : Math.min(Math.max(0, n), 999_999);
        }
        if (idx.min_quantity !== undefined) {
          const n = parseInt(cells[idx.min_quantity] ?? "0");
          row.min_quantity = isNaN(n) ? 0 : Math.min(Math.max(0, n), 999_999);
        }
        if (idx.location !== undefined) row.location = (cells[idx.location] ?? "").slice(0, 200).replace(/[<>"']/g, "");
        if (idx.notes    !== undefined) row.notes    = (cells[idx.notes] ?? "").slice(0, 500).replace(/[<>"']/g, "");
        rows.push(row);
      }

      if (rows.length === 0) {
        toast.error("Nenhuma linha de dado encontrada no CSV.");
        return;
      }

      // 4. Processa em batches de 50 para suportar arquivos grandes (5000+ linhas)
      const BATCH_SIZE = 50;
      const res: ImportResult[] = [];
      setImportProgress({ current: 0, total: rows.length });

      for (let batchStart = 0; batchStart < rows.length; batchStart += BATCH_SIZE) {
        const batch = rows.slice(batchStart, batchStart + BATCH_SIZE);

        // Coleta todos os UDIs e referências do batch para busca em bloco
        const udis = batch.filter(r => r.udi_di).map(r => r.udi_di!);
        const refs = batch.filter(r => !r.udi_di && r.reference).map(r => r.reference!);

        // Busca devices em bloco (uma query por batch, não uma por linha)
        const deviceMap = new Map<string, { id: string; model: string; reference: string }>();

        if (udis.length > 0) {
          const { data: byUdi } = await supabase
            .from("devices")
            .select("id, model, reference, udi_di")
            .in("udi_di", udis);
          for (const d of byUdi ?? []) {
            if (d.udi_di) deviceMap.set(`udi:${d.udi_di}`, d);
          }
        }

        if (refs.length > 0) {
          const { data: byRef } = await supabase
            .from("devices")
            .select("id, model, reference")
            .in("reference", refs);
          for (const d of byRef ?? []) {
            deviceMap.set(`ref:${d.reference.toLowerCase()}`, d);
          }
        }

        // Busca stock_items existentes em bloco para o batch
        const deviceIds = [...deviceMap.values()].map(d => d.id);
        const existingItemsMap = new Map<string, { id: string; quantity: number }>();

        if (deviceIds.length > 0) {
          const { data: existingItems } = await supabase
            .from("stock_items")
            .select("id, quantity, device_id")
            .in("device_id", deviceIds)
            .eq("fase", "intermediaria");
          for (const item of existingItems ?? []) {
            existingItemsMap.set(item.device_id, item);
          }
        }

        // Separa inserções e atualizações
        const toInsert: { device_id: string; quantity: number; min_quantity: number; location: string | null; notes: string | null; fase: string }[] = [];
        const toUpdate: { id: string; patch: Record<string, unknown> }[] = [];

        for (const row of batch) {
          const lookupKey = row.udi_di
            ? `udi:${row.udi_di}`
            : `ref:${(row.reference ?? "").toLowerCase()}`;
          const device = deviceMap.get(lookupKey);

          if (!device) {
            res.push({
              line: row.line,
              model: row.model ?? row.reference ?? row.udi_di ?? "?",
              reference: row.reference ?? row.udi_di ?? "?",
              status: "notfound",
              message: "Dispositivo não encontrado no catálogo",
              quantity: row.quantity ?? 0,
            });
            continue;
          }

          const existing = existingItemsMap.get(device.id);

          if (existing) {
            const patch: Record<string, unknown> = {};
            if (row.quantity !== undefined) patch.quantity = row.quantity;
            if (row.min_quantity !== undefined) patch.min_quantity = row.min_quantity;
            if (row.location) patch.location = row.location;
            if (row.notes) patch.notes = row.notes;
            toUpdate.push({ id: existing.id, patch });
          } else {
            toInsert.push({
              device_id: device.id,
              quantity: row.quantity ?? 0,
              min_quantity: row.min_quantity ?? 0,
              location: row.location || null,
              notes: row.notes || null,
              fase: "intermediaria",
            });
          }

          res.push({
            line: row.line,
            model: device.model ?? row.model ?? "?",
            reference: device.reference ?? row.reference ?? "?",
            status: "ok",
            quantity: row.quantity ?? 0,
          });
        }

        // Executa inserções em bloco
        if (toInsert.length > 0) {
          const { error: insErr } = await supabase.from("stock_items").insert(toInsert);
          if (insErr) {
            // Marca as linhas inseridas como erro
            const insertedModels = new Set(toInsert.map(i => i.device_id));
            for (const r of res) {
              if (r.status === "ok" && insertedModels.has(r.reference)) {
                r.status = "error";
                r.message = insErr.message;
              }
            }
          }
        }

        // Executa atualizações individualmente (cada uma pode ter patch diferente)
        for (const { id, patch } of toUpdate) {
          const { error: upErr } = await supabase.from("stock_items").update(patch).eq("id", id);
          if (upErr) {
            // Apenas loga, não bloqueia o restante
            logger.warn("Erro ao atualizar item:", id, upErr.message);
          }
        }

        // Atualiza progresso
        setImportProgress({ current: Math.min(batchStart + BATCH_SIZE, rows.length), total: rows.length });
      }

      setResults(res);
      setDone(true);

      const ok  = res.filter((r) => r.status === "ok").length;
      const err = res.filter((r) => r.status !== "ok").length;

      if (ok > 0) {
        toast.success(`${ok} peça${ok > 1 ? "s" : ""} importada${ok > 1 ? "s" : ""}${err > 0 ? ` · ${err} com problema` : ""}`);
        onSuccess();
      } else {
        toast.error("Nenhuma peça foi importada. Verifique os erros.");
      }
    } catch (err) {
      logger.error(err);
      toast.error("Erro ao processar o arquivo.");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const okCount  = results.filter((r) => r.status === "ok").length;
  const errCount = results.filter((r) => r.status !== "ok").length;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md p-0 rounded-2xl overflow-hidden border-border/30">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-3">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
          <div className="relative">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                Importar Estoque via CSV
              </DialogTitle>
            </DialogHeader>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Adiciona ou atualiza peças usando um arquivo CSV
            </p>
          </div>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {/* Colunas aceitas */}
          {!done && (
            <div className="rounded-xl bg-muted/20 border border-border/30 p-3 space-y-2">
              <p className="text-[11px] font-semibold text-foreground">Colunas aceitas no CSV:</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {[
                  ["udi_di / udi",          "Identificador UDI *"],
                  ["reference / ref",        "Referência *"],
                  ["quantity / quantidade",  "Quantidade inicial"],
                  ["min_quantity / minimo",  "Estoque mínimo"],
                  ["location / local",       "Localização"],
                  ["notes / obs",            "Observações"],
                ].map(([col, desc]) => (
                  <div key={col} className="flex flex-col">
                    <span className="text-[10px] font-mono text-primary/80">{col}</span>
                    <span className="text-[10px] text-muted-foreground/70">{desc}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground/60 pt-1">
                * Pelo menos um obrigatório para identificar a peça no catálogo.
                Se a peça já está no estoque, os campos fornecidos são atualizados.
              </p>
            </div>
          )}

          {/* Resultado da importação */}
          {done && (
            <div className="space-y-3">
              {/* Resumo */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-success/8 border border-success/25 px-3 py-2.5 text-center">
                  <p className="text-[10px] text-success/70 font-medium">Importadas</p>
                  <p className="text-[20px] font-bold text-success">{okCount}</p>
                </div>
                <div className={cn(
                  "rounded-xl border px-3 py-2.5 text-center",
                  errCount > 0 ? "bg-destructive/8 border-destructive/25" : "bg-muted/20 border-border/30"
                )}>
                  <p className={cn("text-[10px] font-medium", errCount > 0 ? "text-destructive/70" : "text-muted-foreground")}>
                    Com problema
                  </p>
                  <p className={cn("text-[20px] font-bold", errCount > 0 ? "text-destructive" : "text-muted-foreground")}>
                    {errCount}
                  </p>
                </div>
              </div>

              {/* Detalhes toggle */}
              {results.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowDetails(!showDetails)}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full"
                >
                  {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {showDetails ? "Ocultar" : "Ver"} detalhes ({results.length} linhas)
                </button>
              )}

              {showDetails && (
                <div className="max-h-[220px] overflow-y-auto space-y-1 rounded-xl border border-border/30 p-2">
                  {results.map((r) => (
                    <div key={r.line} className={cn(
                      "flex items-start gap-2 px-2 py-1.5 rounded-lg text-[11px]",
                      r.status === "ok"       ? "bg-success/5"     :
                      r.status === "notfound" ? "bg-warning/5"     :
                                                "bg-destructive/5"
                    )}>
                      {r.status === "ok"
                        ? <CheckCircle2  className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />
                        : r.status === "notfound"
                        ? <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                        : <XCircle       className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />}
                      <div className="min-w-0 flex-1">
                        <span className="font-medium text-foreground line-clamp-1">{r.model}</span>
                        <span className="text-muted-foreground/60 ml-1 font-mono">{r.reference}</span>
                        {r.status === "ok" && (
                          <span className="text-success/70 ml-1">· {r.quantity} un.</span>
                        )}
                        {r.message && (
                          <p className="text-[10px] text-muted-foreground/70 mt-0.5">{r.message}</p>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground/40 shrink-0">L{r.line}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Barra de progresso — visível apenas durante importações grandes */}
          {importing && importProgress && importProgress.total > 100 && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Processando linhas...</span>
                <span>{Math.round((importProgress.current / importProgress.total) * 100)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground/60">
                {importProgress.current} de {importProgress.total} linhas processadas
              </p>
            </div>
          )}

          {/* Botões */}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-9 rounded-xl text-xs"
              onClick={downloadTemplate}
            >
              <Download className="h-3.5 w-3.5" />
              Baixar modelo
            </Button>

            {!done ? (
              <Button
                className="flex-1 h-9 rounded-xl gap-1.5 text-xs font-semibold"
                onClick={() => fileRef.current?.click()}
                disabled={importing}
              >
                {importing ? (
                  <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                {importing
                  ? importProgress
                    ? `Importando... ${importProgress.current}/${importProgress.total}`
                    : "Preparando..."
                  : "Selecionar CSV"}
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  className="flex-1 h-9 rounded-xl gap-1.5 text-xs"
                  onClick={reset}
                >
                  <Upload className="h-3.5 w-3.5" />
                  Importar outro
                </Button>
                <Button
                  className="flex-1 h-9 rounded-xl text-xs"
                  onClick={handleClose}
                >
                  Fechar
                </Button>
              </>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFile}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
