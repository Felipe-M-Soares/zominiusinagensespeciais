/**
 * ImportadorPPI51 — Importa dados históricos do arquivo Excel PPI-51
 * Mapeia as colunas do PPI-51 para as tabelas do banco automaticamente.
 */

import { useState, useCallback } from "react";
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import ExcelJS from "exceljs";
import { useTranslation } from "react-i18next";

interface RowPPI51 {
  seq: number;
  data: string;
  turno: string;
  maquina: string;
  equipamento: string;
  produto: string;
  descricao: string;
  qtde_hora: number;
  hr_planejadas: number;
  qtde_prevista: number;
  qtde_plan_disp: number;
  qtde_produzida: number;
  hr_parada: number[];          // 10 colunas
  total_hr_parada: number;
  tempo_disponivel: number;
  refugo: number[];             // 5 colunas
  total_refugo: number;
  lote: string;
  comprimento_mm: number;
  descricao_mp: string;
  lote_mp: string;
  consumo_mp_metros: number;
  cycle_time_min: number;
  lead_time_horas: number;
  horario_inicio: number;
  horario_fim: number;
}

// Tipos de parada na ordem das colunas 18-27 do PPI-51
const TIPOS_PARADA = [
  "Refeição","Café","Limpeza","Manut de Máq","Ajuste de Máq",
  "Liberação de Máq","SetUp","Troca P/ Quebra de Ferr","Troca Preventiva","Outros"
];
const TIPOS_REFUGO = ["Fora do Dimensional","Gap","Amassado","Falha de Usinagem","Outros"];

function parseRow(row: (string|number|Date|null|undefined)[]): RowPPI51 | null {
  const seq = Number(row[0]);
  if (!seq || isNaN(seq)) return null;

  // Data: pode ser string "DD/MM/YYYY" ou objeto Date
  let data = "";
  if (row[1] instanceof Date) {
    data = row[1].toISOString().split("T")[0];
  } else if (typeof row[1] === "string") {
    const parts = row[1].split("/");
    if (parts.length === 3) data = `${parts[2]}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}`;
  }
  if (!data) return null;

  const hr_parada = [18,19,20,21,22,23,24,25,26,27].map(i => Number(row[i]) || 0);
  const refugo    = [30,31,32,33,34].map(i => Number(row[i]) || 0);

  return {
    seq,
    data,
    turno:           String(row[6] || "").trim(),
    maquina:         String(row[7] || "").trim(),
    equipamento:     String(row[8] || "").trim(),
    produto:         String(row[10] || "").trim(),
    descricao:       String(row[11] || "").trim(),
    qtde_hora:       Number(row[13]) || 0,
    hr_planejadas:   Number(row[14]) || 0,
    qtde_prevista:   Number(row[15]) || 0,
    qtde_plan_disp:  Number(row[16]) || 0,
    qtde_produzida:  Number(row[17]) || 0,
    hr_parada,
    total_hr_parada: Number(row[28]) || 0,
    tempo_disponivel: Number(row[29]) || 0,
    refugo,
    total_refugo:    Number(row[35]) || 0,
    lote:            String(row[36] || "").trim(),
    comprimento_mm:  Number(row[37]) || 0,
    descricao_mp:    String(row[38] || "").trim(),
    lote_mp:         String(row[39] || "").trim(),
    consumo_mp_metros: Number(row[40]) || 0,
    cycle_time_min:  Number(row[41]) || 0,
    lead_time_horas: Number(row[42]) || 0,
    horario_inicio:  Number(row[43]) || 0,
    horario_fim:     Number(row[44]) || 0,
  };
}

interface ImportResult { total: number; importados: number; erros: number; detalhes: string[]; }

export function ImportadorPPI51({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [file, setFile]         = useState<File | null>(null);
  const [preview, setPreview]   = useState<RowPPI51[]>([]);
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<ImportResult | null>(null);

  const handleFile = useCallback(async (f: File) => {
    // Valida tamanho máximo: 50MB (arquivo xlsm grande pode travar o browser)
    if (f.size > 50 * 1024 * 1024) {
      toast.error(t("importadorPPI51.toastFileTooLarge"));
      return;
    }
    // Valida extensão
    if (!/\.(xlsm|xlsx|xls)$/i.test(f.name)) {
      toast.error(t("importadorPPI51.toastInvalidFile"));
      return;
    }
    setFile(f);
    setResult(null);
    setLoading(true);
    try {
      const buf = await f.arrayBuffer();
      const wb  = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);

      // Tenta a aba Dados_Produção, senão usa a primeira aba com dados
      const ws = wb.getWorksheet("Dados_Produção") || wb.worksheets[0];
      if (!ws) { toast.error(t("importadorPPI51.toastTabNotFound")); return; }

      const rows: RowPPI51[] = [];
      ws.eachRow((row, rowNum) => {
        if (rowNum < 6) return; // Pula cabeçalho (linhas 1-5)
        const vals = row.values as (string|number|Date|null|undefined)[];
        const parsed = parseRow(vals.slice(1)); // ExcelJS começa em índice 1
        if (parsed) rows.push(parsed);
      });

      setPreview(rows);
      if (rows.length === 0) toast.error(t("importadorPPI51.toastNoValidRecords"));
      else toast.success(t("importadorPPI51.toastRecordsFound", { count: rows.length }));
    } catch (e) {
      toast.error(t("importadorPPI51.toastReadError") + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleImport() {
    if (preview.length === 0) return;
    setLoading(true);
    const result: ImportResult = { total: preview.length, importados: 0, erros: 0, detalhes: [] };

    for (const row of preview) {
      try {
        // Monta paradas
        const paradas = row.hr_parada
          .map((h, i) => ({ tipo_id: i + 1, tipo_nome: TIPOS_PARADA[i], duracao_horas: h }))
          .filter(p => p.duracao_horas > 0);

        // Monta refugos
        const refugos = row.refugo
          .map((q, i) => ({ tipo_id: i + 1, tipo_nome: TIPOS_REFUGO[i], quantidade: q }))
          .filter(r => r.quantidade > 0);

        const { error } = await supabase.rpc("criar_apontamento_ppi51", {
          p_data:               row.data,
          p_turno:              row.turno,
          p_maquina:            row.maquina,
          p_equipamento:        row.equipamento,
          p_produto:            row.produto,
          p_descricao_produto:  row.descricao,
          p_qtde_por_hora:      row.qtde_hora,
          p_horas_planejadas:   row.hr_planejadas,
          p_qtde_plan_disp:     row.qtde_plan_disp,
          p_qtde_produzida:     row.qtde_produzida,
          p_horario_inicio:     row.horario_inicio,
          p_horario_fim:        row.horario_fim,
          p_cycle_time_min:     row.cycle_time_min,
          p_lead_time_horas:    row.lead_time_horas,
          p_lote:               row.lote,
          p_lote_mp:            row.lote_mp,
          p_descricao_mp:       row.descricao_mp,
          p_comprimento_mm:     row.comprimento_mm || null,
          p_consumo_mp_metros:  row.consumo_mp_metros || null,
          p_operador:           "Importado PPI-51",
          p_paradas:            JSON.stringify(paradas),
          p_refugos:            JSON.stringify(refugos),
        });

        if (error) {
          result.erros++;
          result.detalhes.push(`Seq ${row.seq}: ${error.message}`);
        } else {
          result.importados++;
        }
      } catch (e) {
        result.erros++;
        result.detalhes.push(`Seq ${row.seq}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    setResult(result);
    setLoading(false);
    if (result.importados > 0) {
      toast.success(t("importadorPPI51.toastImportSuccess", { count: result.importados }));
    }
    if (result.erros > 0) {
      toast.warning(t("importadorPPI51.toastImportErrors", { count: result.erros }));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full max-w-xl bg-card rounded-t-2xl sm:rounded-2xl border border-border/40 shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30 shrink-0">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-green-600" />
            <h3 className="font-semibold text-sm">{t("importadorPPI51.title")}</h3>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Drop zone */}
          {!file && (
            <label className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border/40 p-8 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors">
              <Upload className="h-8 w-8 text-muted-foreground/50" />
              <div className="text-center">
                <p className="text-sm font-medium">{t("importadorPPI51.dragOrClick")}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{t("importadorPPI51.format")}</p>
              </div>
              <input
                type="file"
                accept=".xlsm,.xlsx,.xls"
                className="hidden"
                onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
              />
            </label>
          )}

          {/* Preview */}
          {file && preview.length > 0 && !result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium">{file.name}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">{preview.length} {t("importadorPPI51.records")}</span>
              </div>
              <div className="rounded-xl border border-border/40 overflow-hidden">
                <div className="grid grid-cols-4 gap-2 px-3 py-2 bg-muted/30 text-[10px] font-semibold uppercase text-muted-foreground">
                  <span>{t("importadorPPI51.colSeq")}</span><span>{t("importadorPPI51.colDate")}</span><span>{t("importadorPPI51.colMachineProduct")}</span><span>{t("importadorPPI51.colProduced")}</span>
                </div>
                <div className="max-h-52 overflow-y-auto divide-y divide-border/20">
                  {preview.slice(0, 50).map(r => (
                    <div key={r.seq} className="grid grid-cols-4 gap-2 px-3 py-1.5 text-[11px]">
                      <span className="font-mono text-muted-foreground">#{r.seq}</span>
                      <span>{r.data}</span>
                      <span className="truncate">{r.maquina} · {r.produto}</span>
                      <span className="font-medium">{r.qtde_produzida.toLocaleString(t("importadorPPI51.localeCode"))} {t("importadorPPI51.pieceAbbrev")}</span>
                    </div>
                  ))}
                  {preview.length > 50 && (
                    <div className="px-3 py-2 text-[11px] text-muted-foreground text-center">
                      + {preview.length - 50} {t("importadorPPI51.additionalRecords")}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Resultado */}
          {result && (
            <div className="space-y-3">
              <div className={cn(
                "rounded-xl border p-4 space-y-2",
                result.erros === 0 ? "bg-green-500/5 border-green-500/20" : "bg-amber-500/5 border-amber-500/20"
              )}>
                <div className="flex items-center gap-2">
                  {result.erros === 0
                    ? <CheckCircle2 className="h-5 w-5 text-green-600" />
                    : <AlertTriangle className="h-5 w-5 text-amber-600" />}
                  <p className="font-semibold text-sm">{t("importadorPPI51.importComplete")}</p>
                </div>
                <div className="grid grid-cols-3 gap-3 text-[11px]">
                  <div><p className="text-muted-foreground">{t("importadorPPI51.total")}</p><p className="font-bold text-lg">{result.total}</p></div>
                  <div><p className="text-muted-foreground">{t("importadorPPI51.imported")}</p><p className="font-bold text-lg text-green-600">{result.importados}</p></div>
                  <div><p className="text-muted-foreground">{t("importadorPPI51.errors")}</p><p className="font-bold text-lg text-red-600">{result.erros}</p></div>
                </div>
              </div>
              {result.detalhes.length > 0 && (
                <div className="rounded-lg bg-muted/20 p-3 max-h-40 overflow-y-auto">
                  {result.detalhes.map((d, i) => (
                    <p key={i} className="text-[10px] text-muted-foreground font-mono">{d}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-border/30 shrink-0">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            {result ? t("importadorPPI51.close") : t("importadorPPI51.cancel")}
          </Button>
          {preview.length > 0 && !result && (
            <Button
              className="flex-1 gap-2 bg-green-600 hover:bg-green-500"
              onClick={handleImport}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {loading ? t("importadorPPI51.importing") : t("importadorPPI51.importAction", { count: preview.length })}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
