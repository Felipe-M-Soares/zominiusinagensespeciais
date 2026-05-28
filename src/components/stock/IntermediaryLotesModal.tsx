import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tag, Printer, RefreshCw, Package, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { escHtml } from "@/lib/escHtml";

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

// ─── Impressão de etiqueta 50×45 mm ──────────────────────────────────────────

// ─── Geração ZPL para Zebra ZD220 ─────────────────────────────────────────────
// Etiqueta 50mm × 45mm @ 203 dpi
// 203 dpi → 1mm = 8 dots
// 50mm = 400 dots largura | 45mm = 360 dots altura

function mmToDots(mm: number) { return Math.round(mm * 8); }

// Trunca string para caber em N dots usando fonte A (largura ~12 dots/char @ h=30)
function truncateZpl(text: string, maxDots: number, charWidthDots: number) {
  const maxChars = Math.floor(maxDots / charWidthDots);
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function buildZpl(model: string, reference: string, lote: string): string {
  // Layout (dots):
  //   Linha modelo:     Y=10,  fonte A 20×12,  wrapping manual
  //   Linha referência: Y=80,  fonte 0 (scalable) 120×60 bold
  //   Linha lote:       Y=250, fonte 0 (scalable) 80×45
  //
  // ^FO x,y  = Field Origin
  // ^A0N,h,w = Fonte scalable, normal, altura, largura
  // ^AN,h,w  = Fonte A built-in
  // ^FD      = Field Data
  // ^FS      = Field Separator

  const labelW = 400; // dots
  const labelH = 360; // dots

  // Calcula largura de fonte para referência — preenche ~90% da largura
  const refText = reference;
  const refMaxW = Math.round(labelW * 0.90);
  // Zebra ^A0: largura de cada char ≈ altura * 0.6 para fonte proporcional
  const refH = 110;
  const refCharW = Math.round(refH * 0.6);
  const refFitsChars = Math.floor(refMaxW / refCharW);
  const refW = refText.length <= refFitsChars
    ? refCharW
    : Math.floor(refMaxW / refText.length);
  const refFontH = Math.round(refW / 0.6);
  const refX = Math.round((labelW - refText.length * refW) / 2);

  // Lote — menor
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
    `^PW${labelW}`,          // largura da etiqueta
    `^LL${labelH}`,          // comprimento da etiqueta
    "^CI28",                 // UTF-8
    "^LH0,0",                // Label Home

    // ── Modelo (fonte A pequena, centralizado) ──
    `^FO10,8^A0N,22,13^FB${labelW - 20},2,,C^FD${model}^FS`,

    // ── Separador horizontal superior ──
    `^FO0,38^GB${labelW},2,2^FS`,

    // ── Referência (grande, centralizada) ──
    `^FO${refX},55^A0N,${refFontH},${refW}^FD${refText}^FS`,

    // ── Separador horizontal inferior ──
    `^FO0,${labelH - 88},${labelW},2,2^GB${labelW},2,2^FS`,

    // ── Lote ──
    `^FO${loteX},${labelH - 80}^A0N,${loteFontH},${loteW}^FD${loteText}^FS`,

    // Imprimir 2 cópias
    "^PQ2",
    "^XZ",
  ].join("\n");
}

function printLabel(model: string, reference: string, lote: string) {
  const zpl = buildZpl(model, reference, lote);

  // Tenta enviar direto via TCP para impressora local (porta padrão Zebra: 9100)
  // Como browser não tem acesso TCP direto, oferece duas opções:
  // 1. Download do .zpl para enviar manualmente
  // 2. Envio via Zebra Browser Print (se instalado)

  // Opção primária: Zebra Browser Print (app local que expõe API HTTP)
  fetch("http://127.0.0.1:9100", {
    method: "POST",
    body: zpl,
  }).catch(() => {
    // Browser Print não disponível — faz download do arquivo ZPL
    downloadZpl(zpl, lote);
  });

  // Também oferece download como fallback sempre visível
  downloadZpl(zpl, lote);
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


// ─── Modal ────────────────────────────────────────────────────────────────────

export function IntermediaryLotesModal({ open, onClose }: Props) {
  const [rows, setRows]       = useState<LoteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro]       = useState<string | null>(null);
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
      // Usa RPC para evitar qualquer problema de sintaxe de filtro no cliente.
      // A função SQL faz tudo: join, filtro de fase, cálculo de saldo, agrupamento.
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
    }
  }, [open, load]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden rounded-xl">

        {/* Cabeçalho */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border shrink-0">
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
              className="flex items-center justify-between gap-3 rounded-xl border border-border
                         bg-card px-4 py-2.5 hover:bg-accent/30 transition-colors"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-[12px] font-semibold text-foreground truncate">{row.model}</p>
                <p className="text-[11px] text-muted-foreground font-mono">{row.reference}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Tag className="h-3 w-3 text-primary/60" />
                  <span className="text-[12px] font-bold text-primary font-mono">{row.lote}</span>

                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs rounded-lg shrink-0"
                onClick={() => printLabel(row.model, row.reference, row.lote)}
              >
                <Printer className="h-3.5 w-3.5" />
                Imprimir ZPL
              </Button>
            </div>
          ))}
        </div>

        {/* Rodapé */}
        <div className="px-5 py-3 border-t border-border shrink-0">
          <p className="text-[11px] text-muted-foreground">
            {rows.length} lote{rows.length !== 1 ? "s" : ""} com saldo positivo · Etiqueta 50×45 mm · Zebra ZD220 · 2 cópias por impressão
          </p>
        </div>

      </DialogContent>
    </Dialog>
  );
}
