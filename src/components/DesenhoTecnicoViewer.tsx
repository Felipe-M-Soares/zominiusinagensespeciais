import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { X, Printer, Loader2, AlertTriangle } from "lucide-react";

// Worker do pdfjs — mesmo setup usado em ExcelStockImport.tsx
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// Escala usada na pré-visualização em tela (rápida, resolução de tela é suficiente).
const PREVIEW_SCALE = 2;
// Escala usada só na hora de imprimir — equivale a ~300dpi (padrão gráfico),
// bem mais nítido que a prévia em tela. Renderizado sob demanda, só quando
// o usuário clica em Imprimir, pra não deixar a abertura do desenho lenta.
const PRINT_SCALE = 4;

interface Props {
  path: string | null;
  title: string;
  onClose: () => void;
}

/**
 * Renderiza o PDF como imagens (uma por página) em vez de exibir num
 * <iframe>. Isso evita dois problemas reais de navegador:
 *  - iOS Safari (e vários webviews embutidos) não renderiza PDF dentro de
 *    iframe de forma confiável — mostra em branco e às vezes dispara download.
 *  - CSP restritiva (frame-src) bloqueia iframes de qualquer origem, inclusive
 *    blob:, dependendo da configuração do site.
 * Como imagem <img> renderiza em qualquer navegador sem exceção, e a
 * impressão abre uma janela nova só com essas imagens — mesmo padrão já
 * usado em outras telas do app (PedidosEstoquePanel, Financeiro, etc.).
 */
export function DesenhoTecnicoViewer({ path, title, onClose }: Props) {
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);

  async function renderPages(pdf: PDFDocumentProxy, scale: number): Promise<string[]> {
    const images: string[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      if (cancelledRef.current) break;
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      images.push(canvas.toDataURL("image/png"));
    }
    return images;
  }

  useEffect(() => {
    if (!path) return;
    cancelledRef.current = false;

    (async () => {
      setLoading(true);
      setError(null);
      setPages([]);
      pdfRef.current = null;
      try {
        const { data: signed, error: signErr } = await supabase.storage
          .from("desenhos-tecnicos")
          .createSignedUrl(path, 300);
        if (signErr || !signed?.signedUrl) throw new Error(signErr?.message ?? "Erro ao gerar link do desenho.");

        const resp = await fetch(signed.signedUrl);
        if (!resp.ok) throw new Error("Erro ao carregar o arquivo do desenho.");
        const buf = await resp.arrayBuffer();
        if (cancelledRef.current) return;

        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        if (cancelledRef.current) return;
        pdfRef.current = pdf;

        const images = await renderPages(pdf, PREVIEW_SCALE);
        if (cancelledRef.current) return;
        setPages(images);
      } catch (e) {
        if (cancelledRef.current) return;
        logger.error("DesenhoTecnicoViewer load error:", e);
        setError(e instanceof Error ? e.message : "Erro ao carregar o desenho técnico.");
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    })();

    return () => { cancelledRef.current = true; };
  }, [path]);

  async function handlePrint() {
    if (!pdfRef.current || printing) return;
    setPrinting(true);
    try {
      const printImages = await renderPages(pdfRef.current, PRINT_SCALE);
      if (cancelledRef.current || printImages.length === 0) return;

      const win = window.open("", "_blank");
      if (!win) return;
      const imgsHtml = printImages
        .map(src => `<div class="page"><img src="${src}" /></div>`)
        .join("");
      win.document.write(`
        <html>
          <head>
            <title>Desenho técnico — ${title}</title>
            <style>
              @page { size: A4 landscape; margin: 0; }
              html, body { margin: 0; padding: 0; background: #525659; }
              .page {
                width: 297mm;
                height: 210mm;
                display: flex;
                align-items: center;
                justify-content: center;
                page-break-after: always;
                background: white;
              }
              .page img {
                max-width: 100%;
                max-height: 100%;
                width: auto;
                height: auto;
                object-fit: contain;
              }
              @media print {
                html, body { background: white; }
                .page { page-break-after: always; }
                .page:last-child { page-break-after: auto; }
              }
            </style>
          </head>
          <body>
            ${imgsHtml}
            <script>window.onload = function() { window.print(); }</script>
          </body>
        </html>
      `);
      win.document.close();
    } catch (e) {
      logger.error("handlePrint render error:", e);
    } finally {
      if (!cancelledRef.current) setPrinting(false);
    }
  }

  if (!path) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4">
      <div className="w-full max-w-4xl h-[92vh] bg-card rounded-2xl border border-border/40 shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-border/30 shrink-0">
          <h3 className="font-semibold text-sm truncate pr-2">Desenho técnico — {title}</h3>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" className="gap-1.5 h-8" onClick={handlePrint} disabled={pages.length === 0 || printing}>
              {printing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
              {printing ? "Preparando..." : "Imprimir"}
            </Button>
            <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/40">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 bg-muted/30 relative overflow-y-auto">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando desenho...
            </div>
          )}
          {!loading && error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground px-6 text-center">
              <AlertTriangle className="h-6 w-6 text-warning" />
              {error}
            </div>
          )}
          {!loading && !error && pages.length > 0 && (
            <div className="flex flex-col items-center gap-3 p-3 sm:p-4">
              {pages.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={`Página ${i + 1} do desenho técnico — ${title}`}
                  className="max-w-full rounded-lg shadow-md border border-border/30 bg-white"
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
