import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { StockItem } from "@/hooks/useStock";
import { Package, AlertTriangle, TrendingDown, CheckCircle2, List, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { escHtml } from "@/lib/escHtml";

interface Props {
  open: boolean;
  onClose: () => void;
  items: StockItem[];
}

export function StockListModal({ open, onClose, items }: Props) {
  // Apenas itens com pelo menos 1 unidade, ordenados por nome
  const available = [...items]
    .filter((i) => i.quantity > 0)
    .sort((a, b) => a.device.model.localeCompare(b.device.model, "pt-BR"));

  function handlePrint() {
    const now = new Date().toLocaleDateString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });

    const rows = available.map((item) => {
      const isLow = item.quantity <= item.min_quantity;
      const status = isLow ? "⚠ Baixo" : "✓ OK";
      // SECURITY: todos os campos de texto do banco passam por escHtml() antes
      // de serem interpolados no HTML — evita XSS se algum campo contiver tags.
      return `
        <tr>
          <td>${escHtml(item.device.model)}</td>
          <td>${escHtml(item.device.reference)}</td>
          <td>${escHtml(item.device.udi_di)}</td>
          <td style="text-align:center; font-weight:bold; color:${isLow ? "#d97706" : "#16a34a"}">${item.quantity}</td>
          <td style="text-align:center">${item.min_quantity}</td>
          <td style="text-align:center; color:${isLow ? "#d97706" : "#16a34a"}">${escHtml(status)}</td>
          <td>${escHtml(item.location)}</td>
        </tr>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Estoque — ${now}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 20px; }
    h2 { font-size: 14px; margin-bottom: 4px; }
    p.sub { color: #555; font-size: 10px; margin: 0 0 14px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 5px 8px; text-align: left; font-size: 10px; }
    td { border: 1px solid #e2e8f0; padding: 4px 8px; vertical-align: middle; }
    tr:nth-child(even) td { background: #f8fafc; }
    @media print { body { margin: 10px; } button { display: none; } }
  </style>
</head>
<body>
  <h2>Relatório de Estoque</h2>
  <p class="sub">Gerado em: ${now} &nbsp;|&nbsp; Total: ${available.length} peça${available.length !== 1 ? "s" : ""}</p>
  <button onclick="window.print()" style="margin-bottom:14px;padding:6px 14px;cursor:pointer;font-size:11px;">🖨 Imprimir</button>
  <table>
    <thead>
      <tr>
        <th>Modelo</th>
        <th>Referência</th>
        <th>UDI-DI</th>
        <th style="text-align:center">Qtd.</th>
        <th style="text-align:center">Mín.</th>
        <th style="text-align:center">Status</th>
        <th>Localização</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (!win) {
      // Popup blocker ativo — orientar o usuário
      alert("Popup bloqueado pelo navegador. Permita popups para este site e tente novamente.");
      return;
    }
    win.document.write(html);
    win.document.close();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md p-0 rounded-xl overflow-hidden border-border">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-3">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
          <div className="relative">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
                <List className="h-4 w-4 text-primary" />
                Peças em Estoque
              </DialogTitle>
            </DialogHeader>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {available.length} peça{available.length !== 1 ? "s" : ""} com unidades disponíveis
            </p>
          </div>
        </div>

        <div className="px-3 pb-4 max-h-[480px] overflow-y-auto space-y-1">
          {available.length === 0 && (
            <div className="text-center py-12 text-sm text-muted-foreground">
              Nenhuma peça com estoque disponível
            </div>
          )}

          {available.map((item) => {
            const isLow          = item.quantity <= item.min_quantity;
            const isRetrabalho   = item.fase === "retrabalho";
            const isIntermediaria = item.fase === "intermediaria";
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/20 transition-colors"
              >
                {/* Indicador de status */}
                {isLow
                  ? <TrendingDown className="h-3.5 w-3.5 text-warning shrink-0" />
                  : <CheckCircle2 className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      isRetrabalho    ? "text-orange-400"
                      : isIntermediaria ? "text-blue-500"
                      : "text-success"
                    )} />}

                {/* Info da peça */}
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-foreground leading-snug line-clamp-1">
                    {item.device.model}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <p className="text-[10px] text-muted-foreground font-mono">{item.device.reference}</p>
                    {isRetrabalho && (
                      <span className="text-[9px] font-semibold uppercase tracking-wide text-orange-500 bg-orange-500/10 px-1 py-0.5 rounded">
                        retrabalho
                      </span>
                    )}
                    {isIntermediaria && (
                      <span className="text-[9px] font-semibold uppercase tracking-wide text-blue-500 bg-blue-500/10 px-1 py-0.5 rounded">
                        intermediário
                      </span>
                    )}
                  </div>
                </div>

                {/* Quantidade */}
                <div className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-bold tabular-nums shrink-0",
                  isLow
                    ? "bg-warning/10 text-warning"
                    : isRetrabalho
                      ? "bg-orange-500/10 text-orange-500"
                      : isIntermediaria
                        ? "bg-blue-500/10 text-blue-500"
                        : "bg-success/10 text-success"
                )}>
                  <Package className="h-3 w-3" />
                  {item.quantity}
                  <span className="text-[10px] font-normal opacity-70">un.</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Botão exportar tabela */}
        {available.length > 0 && (
          <div className="px-5 pb-5">
            <Button
              variant="outline"
              size="sm"
              className="w-full h-9 gap-2 rounded-xl text-xs"
              onClick={handlePrint}
            >
              <Printer className="h-3.5 w-3.5" />
              Exportar Tabela para Impressão
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
