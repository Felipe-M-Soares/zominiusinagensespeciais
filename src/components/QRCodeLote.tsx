/**
 * QRCodeLote — Gerador de QR Code para rastreabilidade de lotes
 *
 * Gera um QR Code a partir do lote que, ao ser escaneado, abre a
 * rastreabilidade completa do lote no sistema.
 *
 * Usa a Web API nativa (qrcode) via canvas para evitar dependência externa.
 * O QR Code aponta para: ${APP_URL}/qualidade?tab=rastreabilidade&lote=${lote}
 *
 * Uso:
 *   <QRCodeLote lote="230601-01/A" deviceModel="Implante XYZ" />
 */
import { useEffect, useRef, useState } from "react";
import { Download, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { escHtml } from "@/lib/escHtml";

interface Props {
  lote: string;
  deviceModel?: string;
  size?: number;
}

// Gera QR Code via API pública de QR (sem dependência extra)
// Em produção, substituir por biblioteca local (qrcode) para privacidade.
function buildQRUrl(data: string, size: number): string {
  const encoded = encodeURIComponent(data);
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encoded}&ecc=M`;
}

export function QRCodeLote({ lote, deviceModel, size = 200 }: Props) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const appUrl = typeof window !== "undefined" ? window.location.origin : "";
  const rastrUrl = `${appUrl}/qualidade?tab=rastreabilidade&lote=${encodeURIComponent(lote)}`;

  useEffect(() => {
    setLoading(true);
    setError(false);
    setImgSrc(buildQRUrl(rastrUrl, size));
  }, [lote, rastrUrl, size]);

  function handleLoad() { setLoading(false); }
  function handleError() { setLoading(false); setError(true); }

  function handleDownload() {
    if (!imgRef.current || !imgSrc) return;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(imgRef.current, 0, 0);
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `qr-lote-${lote.replace(/[^a-z0-9]/gi, "_")}.png`;
    link.click();
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <QrCode className="h-4 w-4 text-muted-foreground" />
        <span>Lote: {lote}</span>
      </div>

      <div className="relative bg-white p-3 rounded-xl border border-border/40 shadow-sm">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/80">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        )}
        {error ? (
          <div className="h-[200px] w-[200px] flex items-center justify-center text-xs text-muted-foreground text-center px-4">
            Não foi possível gerar o QR Code. Verifique a conexão.
          </div>
        ) : (
          <img
            ref={imgRef}
            src={imgSrc ?? ""}
            alt={`QR Code do lote ${escHtml(lote)}`}
            width={size}
            height={size}
            onLoad={handleLoad}
            onError={handleError}
            crossOrigin="anonymous"
          />
        )}
      </div>

      {deviceModel && (
        <p className="text-xs text-muted-foreground text-center max-w-[200px] truncate">
          {deviceModel}
        </p>
      )}

      <p className="text-[10px] text-muted-foreground/60 text-center max-w-[200px] break-all">
        {rastrUrl}
      </p>

      {!error && !loading && (
        <Button variant="outline" size="sm" onClick={handleDownload} className="gap-2 h-8 text-xs">
          <Download className="h-3.5 w-3.5" />
          Baixar PNG
        </Button>
      )}
    </div>
  );
}
