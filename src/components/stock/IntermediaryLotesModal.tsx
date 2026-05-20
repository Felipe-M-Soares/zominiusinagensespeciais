import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tag, Printer, RefreshCw, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { StockItem } from "@/hooks/useStock";

interface IntermediaryLoteRow {
  lote: string;
  saldo: number;
  item: StockItem;
}

interface Props {
  open: boolean;
  onClose: () => void;
  intermediariaItems: StockItem[];
}

// ─── Etiqueta 50×45mm ─────────────────────────────────────────────────────────
function printLabel(item: StockItem, lote: string) {
  const nome = item.device.model;
  const ref = item.device.reference;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Etiqueta</title>
  <style>
    @page {
      size: 50mm 45mm;
      margin: 0;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 50mm;
      height: 45mm;
      font-family: Arial, Helvetica, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .label {
      width: 48mm;
      height: 43mm;
      border: 1px solid #000;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 2mm;
      padding: 2mm;
      text-align: center;
    }
    .desc {
      font-size: 7pt;
      color: #333;
      letter-spacing: 0.02em;
    }
    .ref {
      font-size: 13pt;
      font-weight: bold;
      letter-spacing: 0.03em;
    }
    .lote {
      font-size: 12pt;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div class="label">
    <div class="desc">${nome}</div>
    <div class="ref">${ref}</div>
    <div class="lote">${lote}</div>
  </div>
</body>
</html>`;

  const win = window.open("", "_blank", "width=300,height=300");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 400);
}

// ─── Componente principal ─────────────────────────────────────────────────────
export function IntermediaryLotesModal({ open, onClose, intermediariaItems }: Props) {
  const [rows, setRows] = useState<IntermediaryLoteRow[]>([]);
  const [loading, setLoading] = useState(false);

  const IGNORE_REASONS = new Set([
    "Recebido de Intermediário",
    "Retrabalho concluído — recebido do Retrabalho",
    "Rollback — falha ao criar item de retrabalho",
    "Rollback — falha ao criar item de expedição",
    "Rollback — falha ao registrar entrada na expedição",
  ]);

  const load = useCallback(async () => {
    if (intermediariaItems.length === 0) { setRows([]); return; }
    setLoading(true);

    const ids = intermediariaItems.map((i) => i.id);

    const { data } = await supabase
      .from("stock_movements")
      .select("stock_item_id, lote, type, quantity, reason")
      .in("stock_item_id", ids)
      .not("lote", "is", null);

    if (!data) { setLoading(false); return; }

    type Row = { stock_item_id: string; lote: string; type: string; quantity: number; reason: string | null };

    // Calcula saldo por (item_id, lote)
    const saldos = new Map<string, number>();
    for (const row of data as Row[]) {
      if (row.reason && IGNORE_REASONS.has(row.reason)) continue;
      const key = `${row.stock_item_id}|${row.lote.toUpperCase()}`;
      const cur = saldos.get(key) ?? 0;
      saldos.set(key, row.type === "entrada" ? cur + row.quantity : cur - row.quantity);
    }

    // Monta lista de lotes com saldo > 0
    const itemMap = new Map(intermediariaItems.map((i) => [i.id, i]));
    const result: IntermediaryLoteRow[] = [];
    for (const [key, saldo] of saldos) {
      if (saldo <= 0) continue;
      const [itemId, lote] = key.split("|");
      const item = itemMap.get(itemId);
      if (!item) continue;
      result.push({ lote, saldo, item });
    }

    // Ordena: nome do modelo, depois lote
    result.sort((a, b) => {
      const nm = a.item.device.model.localeCompare(b.item.device.model);
      return nm !== 0 ? nm : a.lote.localeCompare(b.lote);
    });

    setRows(result);
    setLoading(false);
  }, [intermediariaItems]);

  useEffect(() => {
    if (open) load();
    else setRows([]);
  }, [open, load]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden rounded-2xl">
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
              className="h-7 w-7 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              title="Atualizar"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {loading && (
            <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
              <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Carregando lotes…
            </div>
          )}

          {!loading && rows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
              <Package className="h-8 w-8 opacity-30" />
              <p className="text-sm">Nenhum lote com saldo no intermediário.</p>
            </div>
          )}

          {!loading && rows.map(({ lote, saldo, item }) => (
            <div
              key={`${item.id}|${lote}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-border/40 bg-card px-4 py-2.5 hover:bg-accent/30 transition-colors"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-[12px] font-semibold text-foreground truncate">{item.device.model}</p>
                <p className="text-[11px] text-muted-foreground font-mono">{item.device.reference}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Tag className="h-3 w-3 text-primary/60" />
                  <span className="text-[12px] font-bold text-primary font-mono">{lote}</span>
                  <span className="text-[10px] text-muted-foreground ml-1">· {saldo} un.</span>
                </div>
              </div>

              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs rounded-lg shrink-0"
                onClick={() => printLabel(item, lote)}
              >
                <Printer className="h-3.5 w-3.5" />
                Imprimir
              </Button>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-border/40 shrink-0">
          <p className="text-[11px] text-muted-foreground">
            {rows.length} lote{rows.length !== 1 ? "s" : ""} com saldo positivo · Etiqueta 50×45 mm
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
