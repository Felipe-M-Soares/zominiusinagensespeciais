/**
 * Escapa caracteres HTML especiais para prevenir XSS ao interpolar
 * dados do banco em templates HTML (ex: janelas de impressão via document.write).
 *
 * Cobre os 5 caracteres críticos:
 *   & → &amp;   (deve ser o primeiro para não double-escapar)
 *   < → &lt;
 *   > → &gt;
 *   " → &quot;
 *   ' → &#39;
 */
export function escHtml(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
