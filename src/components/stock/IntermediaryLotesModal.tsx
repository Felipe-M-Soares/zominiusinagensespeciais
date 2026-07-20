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
import { useTranslation } from "react-i18next";

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

function buildZpl(model: string, reference: string): string {
  const labelW = 400;
  const labelH = 360;

  // Referência centralizada, ocupa ~70% da altura
  const refText = reference;
  const refMaxW = Math.round(labelW * 0.90);
  const refH = 140;
  const refCharW = Math.round(refH * 0.6);
  const refFitsChars = Math.floor(refMaxW / refCharW);
  const refW = refText.length <= refFitsChars
    ? refCharW
    : Math.floor(refMaxW / refText.length);
  const refFontH = Math.round(refW / 0.6);
  const refX = Math.round((labelW - refText.length * refW) / 2);
  const refY = Math.round((labelH - refFontH) / 2);

  return [
    "^XA",
    `^PW${labelW}`,
    `^LL${labelH}`,
    "^CI28",
    "^LH0,0",
    // Modelo no topo
    `^FO10,8^A0N,22,13^FB${labelW - 20},2,,C^FD${model}^FS`,
    `^FO0,38^GB${labelW},2,2^FS`,
    // Referência centralizada
    `^FO${refX},${refY}^A0N,${refFontH},${refW}^FD${refText}^FS`,
    "^PQ2",
    "^XZ",
  ].join("\n");
}

/**
 * sendZplDirect — envia ZPL direto à ZD220 via Zebra Browser Print (localhost:9100).
 * Retorna true se conseguiu enviar, false se o serviço não estiver rodando.
 */
async function sendZplDirect(zpl: string): Promise<boolean> {
  try {
    // Zebra Browser Print escuta em 9100 por padrão
    const res = await fetch("http://localhost:9100", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: zpl,
      signal: AbortSignal.timeout(2500), // 2.5s timeout
    });
    return res.ok || res.status === 0; // status 0 = CORS blocked = enviou
  } catch {
    return false;
  }
}

/**
 * printLabelFallback — fallback via window.print() com @page 50×45mm.
 * Usado quando o Zebra Browser Print não está disponível.
 */
function printLabelFallback(model: string, reference: string, copies = 2) {
  const id = "__label_print_frame__";
  document.getElementById(id)?.remove();

  const refMaxPx = 205 * 0.82;
  const refFontSize = reference.length > 8
    ? Math.max(14, Math.floor(refMaxPx / reference.length * 1.55))
    : 44;

  const labelHTML = Array.from({ length: copies }).map(() => `
    <div class="label">
      <div class="model">${model}</div>
      <div class="sep"></div>
      <div class="ref" style="font-size:${refFontSize}px">${reference}</div>
    </div>
  `).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    @page { size: 50mm 45mm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { width: 50mm; font-family: monospace; }
    .label { width: 50mm; height: 45mm; display: flex; flex-direction: column; page-break-after: always; overflow: hidden; }
    .model { font-size: 7.5pt; font-weight: bold; text-align: center; padding: 1.5mm 1mm 1mm; line-height: 1.2; white-space: nowrap; overflow: hidden; color: #222; }
    .sep { height: 0.3mm; background: #555; width: 100%; }
    .ref { flex: 1; display: flex; align-items: center; justify-content: center; font-weight: 800; text-align: center; letter-spacing: -0.3px; padding: 0 1mm; color: #000; }
  </style></head><body>${labelHTML}</body></html>`;

  const iframe = document.createElement("iframe");
  iframe.id = id;
  iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:50mm;height:45mm;border:none;";
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow!.document;
  doc.open(); doc.write(html); doc.close();
  iframe.onload = () => {
    try { iframe.contentWindow!.focus(); iframe.contentWindow!.print(); }
    finally { setTimeout(() => iframe.remove(), 3000); }
  };
}


function LabelPreview({ model, reference }: { model: string; reference: string }) {
  const { t } = useTranslation();
  // Proporção 50x45 mm → renderiza como 250x225px
  const W = 250;
  const H = 225;

  const refMaxPx = W * 0.82;
  const refBaseFontSize = 44;
  const refFontSize = reference.length > 8
    ? Math.max(14, Math.floor(refMaxPx / reference.length * 1.55))
    : refBaseFontSize;

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-[11px] text-muted-foreground font-medium">{t("intermediaryLotesModal.previewCaption")}</p>
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

        {/* Separador */}
        <div className="h-px bg-gray-400 mx-0" />

        {/* Referência (grande, centralizada, ocupa resto da etiqueta) */}
        <div
          className="flex items-center justify-center px-2"
          style={{ height: H - 32 }}
        >
          <span
            style={{ fontSize: refFontSize, lineHeight: 1, fontWeight: 800, letterSpacing: -0.5 }}
            className="text-center text-black leading-none tracking-tight"
          >
            {reference}
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
  const { t } = useTranslation();
  const [printing, setPrinting] = useState(false);

  async function handlePrint() {
    if (!row || printing) return;
    setPrinting(true);
    try {
      const zpl = buildZpl(row.model, row.reference);
      const sent = await sendZplDirect(zpl);
      if (sent) {
        toast.success(t("intermediaryLotesModal.printedToPrinter"));
        onClose();
      } else {
        printLabelFallback(row.model, row.reference, 2);
        toast.info(t("intermediaryLotesModal.printerNotFound"), { duration: 5000 });
        onClose();
      }
    } finally {
      setPrinting(false);
    }
  }

  // Usa Dialog do Radix separado para evitar conflito com o Dialog pai
  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden gap-0">
        {/* Header */}
        <DialogHeader className="px-5 py-4 border-b border-border/30">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <Eye className="h-4 w-4 text-primary" />
            {t("intermediaryLotesModal.labelPreviewTitle")}
          </DialogTitle>
        </DialogHeader>

        {row && (
          <>
            {/* Preview */}
            <div className="p-5 flex flex-col items-center gap-4">
              <LabelPreview model={row.model} reference={row.reference} />

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
                  <span className="ml-auto text-muted-foreground/60">{row.saldo} {t("intermediaryLotesModal.units")}</span>
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
                {t("intermediaryLotesModal.cancel")}
              </button>
              <button
                type="button"
                onClick={handlePrint}
                disabled={printing}
                className="flex-1 h-9 rounded-xl bg-violet-600 hover:bg-violet-500 active:scale-95 text-white text-sm font-semibold transition-all flex items-center justify-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {printing
                  ? <div className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Printer className="h-3.5 w-3.5" />}
                {printing ? t("intermediaryLotesModal.sending") : t("intermediaryLotesModal.printCopies")}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Modal Principal ──────────────────────────────────────────────────────────

export function IntermediaryLotesModal({ open, onClose }: Props) {
  const { t } = useTranslation();
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
        setErro(`${t("intermediaryLotesModal.errorPrefix")} ${error.message}`);
        return;
      }

      setRows((data as LoteRow[]) ?? []);
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      setErro(e instanceof Error ? e.message : t("intermediaryLotesModal.unknownError"));
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
                {t("intermediaryLotesModal.title")}
              </DialogTitle>
              <button
                type="button"
                onClick={load}
                disabled={loading}
                title={t("intermediaryLotesModal.refresh")}
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
                {t("intermediaryLotesModal.loading")}
              </div>
            )}

            {!loading && erro && (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <AlertCircle className="h-6 w-6 text-destructive" />
                <p className="text-destructive text-center text-xs px-4">{erro}</p>
                <Button size="sm" variant="outline" onClick={load}>
                  {t("intermediaryLotesModal.tryAgain")}
                </Button>
              </div>
            )}

            {!loading && !erro && rows.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
                <Package className="h-8 w-8 opacity-30" />
                <p className="text-sm">{t("intermediaryLotesModal.noLotes")}</p>
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
                    <span className="text-[10px] text-muted-foreground/50 ml-1">{row.saldo} {t("intermediaryLotesModal.units")}</span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs rounded-lg shrink-0 border-violet-500/30 text-violet-600 hover:bg-violet-500/10"
                  onClick={(e) => { e.stopPropagation(); setPreviewRow(row); }}
                >
                  <Eye className="h-3.5 w-3.5" />
                  {t("intermediaryLotesModal.viewAndPrint")}
                </Button>
              </div>
            ))}
          </div>

          {/* Rodapé */}
          <div className="px-5 py-3 border-t border-border/40 shrink-0">
            <p className="text-[11px] text-muted-foreground">
              {t("intermediaryLotesModal.footer", { count: rows.length, plural: rows.length !== 1 ? "s" : "" })}
            </p>
          </div>

        </DialogContent>
      </Dialog>

      {/* Modal de preview */}
      <PrintPreviewModal row={previewRow} onClose={() => setPreviewRow(null)} />
    </>
  );
}
