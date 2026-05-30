import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tag, Printer, RefreshCw, Package, AlertCircle, X, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface LoteRow {
  stock_item_id: string;
  lote: string;
  saldo: number;
  model: string;
  reference: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

// ─── Geração ZPL para Zebra ZD220 ─────────────────────────────────────────────
// Etiqueta 50mm × 45mm @ 203 dpi
// 203 dpi → 1mm = 8 dots
// 50mm = 400 dots largura | 45mm = 360 dots altura

function buildZpl(model: string, reference: string, lote: string): string {
  const labelW = 400;
  const labelH = 360;

  const refText = reference;
  const refMaxW = Math.round(labelW * 0.90);
  const refH = 110;
  const refCharW = Math.round(refH * 0.6);
  const refFitsChars = Math.floor(refMaxW / refCharW);
  const refW = refText.length <= refFitsChars
    ? refCharW
    : Math.floor(refMaxW / refText.length);
  const refFontH = Math.round(refW / 0.6);
  const refX = Math.round((labelW - refText.length * refW) / 2);

  const loteText = lote;
  const loteH = 70;
  const loteCharW = Math.round(loteH * 0.6);
  const loteFitsChars = Math.floor(refMaxW / loteCharW);
  const loteW = loteText.length <= loteFitsChars
    ? loteCharW
    : Math.floor(refMaxW / loteText.length);
  const loteFontH = Math.round(loteW / 0.6);
  const loteX = Math.round((labelW - loteText.length * loteW) / 2);

  return [
    "^XA",
    `^PW${labelW}`,
    `^LL${labelH}`,
    "^CI28",
    "^LH0,0",
    `^FO10,8^A0N,22,13^FB${labelW - 20},2,,C^FD${model}^FS`,
    `^FO0,38^GB${labelW},2,2^FS`,
    `^FO${refX},55^A0N,${refFontH},${refW}^FD${refText}^FS`,
    `^FO0,${labelH - 88},${labelW},2,2^GB${labelW},2,2^FS`,
    `^FO${loteX},${labelH - 80}^A0N,${loteFontH},${loteW}^FD${loteText}^FS`,
    "^PQ2",
    "^XZ",
  ].join("\n");
}

function sendToPrinter(zpl: string) {
  // Tenta Zebra Browser Print (porta padrão 9100)
  fetch("http://127.0.0.1:9100", {
    method: "POST",
    body: zpl,
  }).catch(() => {
    // Browser Print não disponível — faz download do arquivo ZPL
  });
}

function downloadZpl(zpl: string, lote: string) {
  const blob = new Blob([zpl], { type: "text/plain" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `etiqueta-${lote.replace(/\//g, "-")}.zpl`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Preview da Etiqueta (canvas SVG) ─────────────────────────────────────────

function LabelPreview({ model, reference, lote }: { model: string; reference: string; lote: string }) {
  // Proporção 50x45 mm → renderiza como 250x225px
  const W = 250;
  const H = 225;

  // Calcula tamanho de fonte para referência (preenche ~80% da largura)
  const refMaxPx = W * 0.82;
  const refBaseFontSize = 44;
  const refFontSize = reference.length > 8
    ? Math.max(14, Math.floor(refMaxPx / reference.length * 1.55))
    : refBaseFontSize;

  const loteFontSize = Math.max(12, Math.min(28, Math.floor(refMaxPx / lote.length * 1.55)));

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-[11px] text-muted-foreground font-medium">Prévia — Etiqueta 50×45 mm · 2 cópias</p>
      <div
        style={{ width: W, height: H }}
        className="relative rounded-lg border-2 border-border bg-white text-black overflow-hidden shadow-md font-mono"
      >
        {/* Modelo (topo, pequeno) */}
        <div
          style={{ fontSize: 11, lineHeight: 1.2 }}
          className="text-center px-2 pt-1.5 pb-1 font-bold truncate text-gray-800"
        >
          {model}
        </div>

        {/* Separador superior */}
        <div className="h-px bg-gray-400 mx-0" />

        {/* Referência (grande, centralizada) */}
        <div
          className="flex items-center justify-center px-2"
          style={{ height: H * 0.42 }}
        >
          <span
            style={{ fontSize: refFontSize, lineHeight: 1, fontWeight: 800, letterSpacing: -0.5 }}
            className="text-center text-black leading-none tracking-tight"
          >
            {reference}
          </span>
        </div>

        {/* Separador inferior */}
        <div className="h-px bg-gray-400 mx-0" />

        {/* Lote (inferior) */}
        <div
          className="flex items-center justify-center px-2"
          style={{ height: H * 0.28 }}
        >
          <span style={{ fontSize: loteFontSize, fontWeight: 700 }} className="text-center text-black">
            {lote}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de Preview + Impressão ─────────────────────────────────────────────

interface PrintPreviewModalProps {
  row: LoteRow | null;
  onClose: () => void;
}

function PrintPreviewModal({ row, onClose }: PrintPreviewModalProps) {
  const [printing, setPrinting] = useState(false);
  if (!row) return null;
  async function handlePrint() {
    if (printing) return;
    setPrinting(true);
    const ok = await sendToPrinter(buildZpl(row!.model, row!.reference, row!.lote));
    setPrinting(false);
    if (ok) { toast.success("Etiqueta enviada para a ZD220 — 2 cópias"); onClose(); }
    else toast.error("Impressora não encontrada. Verifique o Zebra Browser Print.", { duration: 6000 });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-card border border-border/30 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold">Prévia da Etiqueta</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Preview */}
        <div className="p-5 flex flex-col items-center gap-4">
          <LabelPreview model={row.model} reference={row.reference} lote={row.lote} />

          {/* Info */}
          <div className="w-full rounded-xl bg-muted/20 border border-border/20 px-4 py-3 space-y-1.5 text-[12px]">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Package className="h-3.5 w-3.5 shrink-0 text-primary/60" />
              <span className="font-medium text-foreground truncate">{row.model}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="text-[11px] font-mono text-foreground/70">{row.reference}</span>
            </div>
            <div className="flex items-center gap-2">
              <Tag className="h-3.5 w-3.5 shrink-0 text-primary/60" />
              <span className="font-bold font-mono text-primary">{row.lote}</span>
              <span className="ml-auto text-muted-foreground/60">{row.saldo} un.</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted/30 transition-colors"
          >
            Cancelar
          </button>
          <button type="button" onClick={handlePrint} disabled={printing} className="flex-1 h-9 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60">
            {printing ? <div className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
            {printing ? "Enviando..." : "Imprimir (2 cópias)"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal Principal ──────────────────────────────────────────────────────────

export function IntermediaryLotesModal({ open, onClose }: Props) {
  const [rows, setRows]       = useState<LoteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro]       = useState<string | null>(null);
  const [previewRow, setPreviewRow] = useState<LoteRow | null>(null);
  const mountedRef             = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErro(null);
    setRows([]);

    try {
      const { data, error } = await supabase.rpc("get_lotes_intermediario");

      if (!mountedRef.current) return;

      if (error) {
        setErro(`Erro: ${error.message}`);
        return;
      }

      setRows((data as LoteRow[]) ?? []);
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      setErro(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      load();
    } else {
      setRows([]);
      setErro(null);
      setLoading(false);
      setPreviewRow(null);
    }
  }, [open, load]);

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden rounded-2xl">

          {/* Cabeçalho */}
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/40 shrink-0">
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
                <Tag className="h-4 w-4 text-primary" />
                Lotes — Intermediário
              </DialogTitle>
              <button
                type="button"
                onClick={load}
                disabled={loading}
                title="Atualizar"
                className="h-7 w-7 flex items-center justify-center rounded-lg border border-border
                           text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </button>
            </div>
          </DialogHeader>

          {/* Corpo */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">

            {loading && (
              <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Carregando lotes…
              </div>
            )}

            {!loading && erro && (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <AlertCircle className="h-6 w-6 text-destructive" />
                <p className="text-destructive text-center text-xs px-4">{erro}</p>
                <Button size="sm" variant="outline" onClick={load}>
                  Tentar novamente
                </Button>
              </div>
            )}

            {!loading && !erro && rows.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
                <Package className="h-8 w-8 opacity-30" />
                <p className="text-sm">Nenhum lote com saldo no intermediário.</p>
              </div>
            )}

            {!loading && !erro && rows.map((row) => (
              <div
                key={`${row.stock_item_id}|${row.lote}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/40
                           bg-card px-4 py-2.5 hover:bg-accent/30 transition-colors"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-[12px] font-semibold text-foreground truncate">{row.model}</p>
                  <p className="text-[11px] text-muted-foreground font-mono">{row.reference}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Tag className="h-3 w-3 text-primary/60" />
                    <span className="text-[12px] font-bold text-primary font-mono">{row.lote}</span>
                    <span className="text-[10px] text-muted-foreground/50 ml-1">{row.saldo} un.</span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs rounded-lg shrink-0 border-violet-500/30 text-violet-600 hover:bg-violet-500/10"
                  onClick={() => setPreviewRow(row)}
                >
                  <Eye className="h-3.5 w-3.5" />
                  Ver e imprimir
                </Button>
              </div>
            ))}
          </div>

          {/* Rodapé */}
          <div className="px-5 py-3 border-t border-border/40 shrink-0">
            <p className="text-[11px] text-muted-foreground">
              {rows.length} lote{rows.length !== 1 ? "s" : ""} com saldo positivo · Etiqueta 50×45 mm · Zebra ZD220 · 2 cópias por impressão
            </p>
          </div>

        </DialogContent>
      </Dialog>

      {/* Modal de preview */}
      <PrintPreviewModal row={previewRow} onClose={() => setPreviewRow(null)} />
    </>
  );
}
