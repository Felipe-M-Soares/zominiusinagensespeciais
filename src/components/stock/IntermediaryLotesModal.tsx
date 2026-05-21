import { useState, useEffect, useRef } from "react";
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

interface IntermediaryLoteRow {
  lote: string;
  saldo: number;
  model: string;
  reference: string;
  stockItemId: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

// Apenas movimentos que são espelhos contábeis da EXPEDIÇÃO são ignorados aqui.
// Os rollbacks são entradas de recuperação reais na intermediária e NÃO devem ser ignorados.
// "Recebido de Intermediário" é uma entrada na expedição — nunca aparece nos movimentos
// da intermediária, mas fica listado aqui por segurança.
const IGNORE_REASONS = new Set([
  "Recebido de Intermediário",
  "Retrabalho concluído — recebido do Retrabalho",
]);

function printLabel(model: string, reference: string, lote: string) {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Etiqueta</title>
  <style>
    @page { size: 50mm 45mm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { width:50mm; height:45mm; font-family:Arial,Helvetica,sans-serif;
           display:flex; align-items:center; justify-content:center; }
    .label { width:48mm; height:43mm; border:1px solid #000;
             display:flex; flex-direction:column; justify-content:center;
             align-items:center; gap:2mm; padding:2mm; text-align:center; }
    .desc { font-size:7pt; color:#333; }
    .ref  { font-size:13pt; font-weight:bold; }
    .lote { font-size:12pt; font-weight:bold; }
  </style>
</head>
<body>
  <div class="label">
    <div class="desc">${model}</div>
    <div class="ref">${reference}</div>
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

// Busca stock_movements em chunks para evitar Bad Request (URL muito longa no .in())
async function fetchMovimentosEmChunks(ids: string[]) {
  const CHUNK = 50;
  type MovRow = { stock_item_id: string; lote: string; type: string; quantity: number; reason: string | null };
  const all: MovRow[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("stock_movements")
      .select("stock_item_id, lote, type, quantity, reason")
      .in("stock_item_id", chunk)
      .not("lote", "is", null);
    if (error) throw new Error(`stock_movements: ${error.message}`);
    all.push(...((data ?? []) as MovRow[]));
  }
  return all;
}

export function IntermediaryLotesModal({ open, onClose }: Props) {
  const [rows, setRows] = useState<IntermediaryLoteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const cancelRef = useRef(false);

  async function load() {
    cancelRef.current = false;
    setLoading(true);
    setErro(null);

    try {
      // 1. Busca todos os stock_items intermediários com join no device
      // IMPORTANTE: usa alias "device:devices(...)" igual ao useStock — o PostgREST
      // expõe o resultado sob a chave "device" (não "devices") por conta da constraint FK.
      const { data: siData, error: siErr } = await supabase
        .from("stock_items")
        .select("id, device_id, device:devices(model, reference)")
        .eq("fase", "intermediaria");

      if (siErr) throw new Error(`stock_items: ${siErr.message}`);
      if (cancelRef.current) return;

      if (!siData || siData.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      type SiRow = {
        id: string;
        device_id: string;
        device: { model: string; reference: string } | { model: string; reference: string }[] | null;
      };

      const deviceMap = new Map<string, { model: string; reference: string }>();
      const allStockItemIds: string[] = [];
      for (const si of siData as SiRow[]) {
        allStockItemIds.push(si.id);
        const dev = Array.isArray(si.device) ? si.device[0] : si.device;
        if (dev) deviceMap.set(si.id, dev);
      }

      // allIds inclui TODOS os stock_item_ids (mesmo os sem device mapeado),
      // mas no resultado final só aparecem os que têm device no deviceMap.
      const allIds = allStockItemIds;

      // Lotes placeholder que não representam estoque real
      const LOTE_INDEFINIDO = new Set(["a-definir", "a definir", "sem lote"]);

      // 2. Busca movimentos em chunks (evita Bad Request por URL longa)
      if (cancelRef.current) return;
      const movimentos = await fetchMovimentosEmChunks(allIds);
      if (cancelRef.current) return;

      // 3. Calcula saldo por (stock_item_id, lote)
      const saldos = new Map<string, number>();
      for (const row of movimentos) {
        if (!row.lote) continue;
        if (LOTE_INDEFINIDO.has(row.lote.trim().toLowerCase())) continue;
        if (row.reason && IGNORE_REASONS.has(row.reason)) continue;
        const key = `${row.stock_item_id}|${row.lote.toUpperCase()}`;
        const cur = saldos.get(key) ?? 0;
        saldos.set(key, row.type === "entrada" ? cur + row.quantity : cur - row.quantity);
      }

      // 4. Monta resultado com saldo > 0
      const result: IntermediaryLoteRow[] = [];
      for (const [key, saldo] of saldos) {
        if (saldo <= 0) continue;
        const pipeIdx = key.indexOf("|");
        const stockItemId = key.slice(0, pipeIdx);
        const lote = key.slice(pipeIdx + 1);
        const dev = deviceMap.get(stockItemId);
        if (!dev) continue;
        result.push({ lote, saldo, model: dev.model, reference: dev.reference, stockItemId });
      }

      result.sort((a, b) => {
        const nm = a.model.localeCompare(b.model);
        return nm !== 0 ? nm : a.lote.localeCompare(b.lote);
      });

      if (!cancelRef.current) {
        setRows(result);
        setLoading(false);
      }
    } catch (e: unknown) {
      console.error("[IntermediaryLotesModal] erro:", e);
      if (!cancelRef.current) {
        const msg = e instanceof Error ? e.message : String(e);
        setErro(`Erro: ${msg}`);
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!open) {
      cancelRef.current = true;
      setRows([]);
      setLoading(false);
      setErro(null);
      return;
    }
    const t = setTimeout(load, 0);
    return () => { clearTimeout(t); cancelRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

          {!loading && erro && (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-sm">
              <AlertCircle className="h-6 w-6 text-destructive" />
              <p className="text-destructive text-center text-xs px-4">{erro}</p>
              <Button size="sm" variant="outline" onClick={load}>
                Tentar novamente
              </Button>
            </div>
          )}

          {!loading && !erro && rows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
              <Package className="h-8 w-8 opacity-30" />
              <p className="text-sm">Nenhum lote com saldo no intermediário.</p>
            </div>
          )}

          {!loading && !erro && rows.map(({ lote, saldo, model, reference, stockItemId }) => (
            <div
              key={`${stockItemId}|${lote}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-border/40 bg-card px-4 py-2.5 hover:bg-accent/30 transition-colors"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-[12px] font-semibold text-foreground truncate">{model}</p>
                <p className="text-[11px] text-muted-foreground font-mono">{reference}</p>
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
                onClick={() => printLabel(model, reference, lote)}
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
