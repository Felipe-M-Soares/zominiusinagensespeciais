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

function printLabel(model: string, reference: string, lote: string) {
  const win = window.open("", "_blank", "width=320,height=320");
  if (!win) {
    alert("Popup bloqueado. Permita popups para este site e tente novamente.");
    return;
  }
  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Etiqueta</title>
  <style>
    @page { size: 50mm 45mm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 50mm; height: 45mm;
      font-family: Arial, Helvetica, sans-serif;
      display: flex; align-items: center; justify-content: center;
    }
    .label {
      width: 48mm; height: 43mm;
      border: 1px solid #000;
      display: flex; flex-direction: column;
      justify-content: center; align-items: center;
      gap: 2mm; padding: 2mm; text-align: center;
    }
    .desc { font-size: 7pt; color: #333; }
    .ref  { font-size: 13pt; font-weight: bold; }
    .lote { font-size: 12pt; font-weight: bold; }
  </style>
</head>
<body>
  <div class="label">
    <div class="desc">${escHtml(model)}</div>
    <div class="ref">${escHtml(reference)}</div>
    <div class="lote">${escHtml(lote)}</div>
  </div>
</body>
</html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 400);
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

                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs rounded-lg shrink-0"
                onClick={() => printLabel(row.model, row.reference, row.lote)}
              >
                <Printer className="h-3.5 w-3.5" />
                Imprimir
              </Button>
            </div>
          ))}
        </div>

        {/* Rodapé */}
        <div className="px-5 py-3 border-t border-border/40 shrink-0">
          <p className="text-[11px] text-muted-foreground">
            {rows.length} lote{rows.length !== 1 ? "s" : ""} com saldo positivo · Etiqueta 50×45 mm
          </p>
        </div>

      </DialogContent>
    </Dialog>
  );
}
