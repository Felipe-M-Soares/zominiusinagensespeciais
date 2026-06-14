/**
 * printUtils — Utilitário centralizado para impressão via janela popup
 *
 * Garante que:
 * 1. escHtml() é sempre aplicado no título (prevenção XSS no template base)
 * 2. CSS de impressão base está sempre presente
 * 3. Comportamento consistente entre módulos (pedidos, estoque, financeiro, etc.)
 *
 * USO:
 *   import { printHtml, printStyles } from "@/lib/printUtils";
 *
 *   const html = `<table>...</table>`;
 *   printHtml(html, "Relatório de Estoque");
 *
 * Para usar estilos base nos templates:
 *   const html = `<style>${printStyles}</style><table>...`;
 */

import { escHtml } from "@/lib/escHtml";

/** Estilos CSS base para todas as janelas de impressão */
export const printStyles = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 10pt;
    color: #111;
    background: #fff;
    padding: 8mm;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9pt;
  }
  th {
    background: #eee;
    font-size: 8pt;
    text-transform: uppercase;
    padding: 4px 6px;
    border: 1px solid #ccc;
    font-weight: 700;
    color: #333;
    text-align: left;
  }
  td {
    padding: 3px 6px;
    border: 1px solid #ddd;
    vertical-align: top;
  }
  tr:nth-child(even) td { background: #fafafa; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8mm;
    padding-bottom: 4mm;
    border-bottom: 2px solid #333;
  }
  .header h1 { font-size: 14pt; font-weight: 900; }
  .header .meta { font-size: 8pt; color: #666; text-align: right; }
  .footer {
    margin-top: 8mm;
    padding-top: 3mm;
    border-top: 1px solid #ccc;
    font-size: 8pt;
    color: #666;
    display: flex;
    justify-content: space-between;
  }
  @media print {
    body { padding: 4mm; }
    @page { margin: 6mm; size: A4; }
    button, .no-print { display: none !important; }
  }
`;

/**
 * Abre uma janela popup com o HTML fornecido e dispara a impressão.
 *
 * @param bodyHtml - Conteúdo HTML do corpo (sem <html>/<head>/<body>).
 *                   ATENÇÃO: todos os dados dinâmicos devem passar por escHtml()
 *                   antes de serem interpolados neste HTML.
 * @param title    - Título da janela (será escapado automaticamente).
 * @param extraCss - CSS adicional opcional, inserido após os estilos base.
 * @param autoPrint - Se true (padrão), dispara window.print() após carregar.
 */
export function printHtml(
  bodyHtml: string,
  title = "Impressão",
  extraCss = "",
  autoPrint = true
): void {
  const popup = window.open("", "_blank", "width=900,height=700");
  if (!popup) {
    // Popup bloqueado — informar o usuário via console (toast deve ser tratado no chamador)
    console.warn("[printUtils] Popup bloqueado pelo browser. Permita popups para imprimir.");
    return;
  }

  const now = new Date().toLocaleString("pt-BR");
  const safeTitle = escHtml(title);

  const fullHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>${printStyles}${extraCss}</style>
</head>
<body>
  ${bodyHtml}
  <div class="footer">
    <span>Zomini Usinagens Especiais</span>
    <span>Gerado em ${escHtml(now)}</span>
  </div>
  ${autoPrint ? "<script>window.onload = () => { window.focus(); setTimeout(() => window.print(), 400); };<\\/script>" : ""}
</body>
</html>`;

  popup.document.open();
  popup.document.write(fullHtml);
  popup.document.close();
  popup.focus();
}
