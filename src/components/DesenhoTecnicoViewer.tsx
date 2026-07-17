import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { X, Printer, Loader2, AlertTriangle } from "lucide-react";

interface Props {
  path: string | null;
  title: string;
  onClose: () => void;
}

/**
 * Abre o PDF como blob local (não a URL assinada do Supabase diretamente) —
 * assim o iframe fica "same-origin" (blob:) e conseguimos chamar
 * iframe.contentWindow.print() sem bloqueio de cross-origin do navegador.
 * O parâmetro #toolbar=0 esconde a barra nativa do visualizador de PDF do
 * navegador (que traz seus próprios ícones de baixar/imprimir).
 */
export function DesenhoTecnicoViewer({ path, title, onClose }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!path) return;
    let revoke: string | null = null;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: signed, error: signErr } = await supabase.storage
          .from("desenhos-tecnicos")
          .createSignedUrl(path, 300);
        if (signErr || !signed?.signedUrl) throw new Error(signErr?.message ?? "Erro ao gerar link do desenho.");

        const resp = await fetch(signed.signedUrl);
        if (!resp.ok) throw new Error("Erro ao carregar o arquivo do desenho.");
        const blob = await resp.blob();
        if (cancelled) return;

        const url = URL.createObjectURL(blob);
        revoke = url;
        setBlobUrl(url);
      } catch (e) {
        if (cancelled) return;
        logger.error("DesenhoTecnicoViewer load error:", e);
        setError(e instanceof Error ? e.message : "Erro ao carregar o desenho técnico.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [path]);

  function handlePrint() {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      win.focus();
      win.print();
    } catch (e) {
      logger.error("print() error:", e);
    }
  }

  if (!path) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4">
      <div className="w-full max-w-4xl h-[92vh] bg-card rounded-2xl border border-border/40 shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-border/30 shrink-0">
          <h3 className="font-semibold text-sm truncate pr-2">Desenho técnico — {title}</h3>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" className="gap-1.5 h-8" onClick={handlePrint} disabled={!blobUrl}>
              <Printer className="h-3.5 w-3.5" /> Imprimir
            </Button>
            <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/40">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 bg-muted/20 relative">
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
          {!loading && !error && blobUrl && (
            <iframe
              ref={iframeRef}
              src={`${blobUrl}#toolbar=0&navpanes=0`}
              title={`Desenho técnico — ${title}`}
              className="w-full h-full border-0"
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
