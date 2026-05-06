import { useEffect, useRef, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScanBarcode, X, AlertCircle } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onDetected: (value: string) => void;
}

// Formatos aceitos pelo BarcodeDetector — inclui os mais comuns em UDI médico
const BARCODE_FORMATS = [
  "code_128",
  "data_matrix",
  "ean_13",
  "ean_8",
  "qr_code",
  "upc_a",
  "upc_e",
  "code_39",
  "codabar",
  "pdf417",
  "aztec",
  "itf",
];

declare global {
  interface Window {
    BarcodeDetector: {
      new (opts?: { formats?: string[] }): {
        detect(source: HTMLVideoElement | ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
      };
      getSupportedFormats?(): Promise<string[]>;
    };
  }
}

export function BarcodeScanner({ open, onClose, onDetected }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<InstanceType<typeof window.BarcodeDetector> | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detectedRef = useRef(false);

  const [status, setStatus] = useState<"loading" | "scanning" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    detectedRef.current = false;
    setStatus("loading");
  }, []);

  const startDetection = useCallback(() => {
    if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
    scanIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || !detectorRef.current || detectedRef.current) return;
      // Only scan when video has valid dimensions
      if (videoRef.current.videoWidth === 0) return;
      try {
        const barcodes = await detectorRef.current.detect(videoRef.current);
        if (barcodes.length > 0) {
          const value = barcodes[0].rawValue?.trim();
          if (value) {
            detectedRef.current = true;
            stopCamera();
            onDetected(value);
            onClose();
          }
        }
      } catch {
        // ignore individual frame errors
      }
    }, 250);
  }, [onDetected, onClose, stopCamera]);

  const startCamera = useCallback(async () => {
    setStatus("loading");
    setErrorMsg(null);
    detectedRef.current = false;

    if (!("BarcodeDetector" in window)) {
      setStatus("error");
      setErrorMsg(
        "Leitor de código de barras não suportado neste navegador. Use Chrome ou Edge (Android/Desktop)."
      );
      return;
    }

    try {
      // Build detector with available formats
      let formats = BARCODE_FORMATS;
      if (window.BarcodeDetector.getSupportedFormats) {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        formats = BARCODE_FORMATS.filter((f) => supported.includes(f));
        if (formats.length === 0) formats = supported;
      }
      detectorRef.current = new window.BarcodeDetector({ formats });

      // UX-03: getUserMedia requires HTTPS — detect and show a clear error
      if (!navigator.mediaDevices?.getUserMedia) {
        setErrorMsg(
          window.location.protocol === "http:"
            ? "A câmera requer conexão segura (HTTPS)."
            : "Câmera não disponível neste dispositivo ou navegador."
        );
        setStatus("error");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStatus("scanning");
        startDetection();
      }
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.name === "NotAllowedError"
            ? "Permissão de câmera negada. Libere o acesso nas configurações do navegador."
            : e.message
          : "Erro ao acessar câmera.";
      setStatus("error");
      setErrorMsg(msg);
    }
  }, [startDetection]);

  useEffect(() => {
    if (open) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          stopCamera();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-[360px] p-4 gap-3">
        <DialogHeader className="pb-0">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <ScanBarcode className="h-4 w-4 text-primary" />
            Escanear código de barras — UDI
          </DialogTitle>
        </DialogHeader>

        {/* Camera viewport */}
        <div className="relative rounded-xl overflow-hidden bg-black aspect-video w-full shadow-inner">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            muted
            playsInline
            aria-label="Câmera para leitura de código de barras"
          />

          {/* Scanning overlay — crosshair */}
          {status === "scanning" && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              {/* Dimmed corners */}
              <div className="absolute inset-0 bg-black/30" />
              {/* Target rect */}
              <div className="relative z-10 w-4/5 h-1/2 rounded-lg border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]">
                {/* Corner decorators */}
                <span className="absolute -top-[2px] -left-[2px] w-5 h-5 border-t-4 border-l-4 border-primary rounded-tl-lg" />
                <span className="absolute -top-[2px] -right-[2px] w-5 h-5 border-t-4 border-r-4 border-primary rounded-tr-lg" />
                <span className="absolute -bottom-[2px] -left-[2px] w-5 h-5 border-b-4 border-l-4 border-primary rounded-bl-lg" />
                <span className="absolute -bottom-[2px] -right-[2px] w-5 h-5 border-b-4 border-r-4 border-primary rounded-br-lg" />
                {/* Scanning line animation */}
                <span className="absolute left-1 right-1 top-1/2 -translate-y-1/2 h-[2px] bg-primary/80 rounded animate-[scan-line_1.5s_ease-in-out_infinite]" />
              </div>
            </div>
          )}

          {/* Loading spinner */}
          {status === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <div className="animate-spin h-7 w-7 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          )}
        </div>

        {/* Status messages */}
        {status === "scanning" && (
          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            Aponte a câmera para o código de barras do <strong>UDI</strong>.
            <br />A leitura é automática.
          </p>
        )}

        {status === "error" && errorMsg && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <p className="text-xs text-destructive leading-relaxed">{errorMsg}</p>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5 h-9"
          onClick={() => {
            stopCamera();
            onClose();
          }}
        >
          <X className="h-3.5 w-3.5" />
          Cancelar
        </Button>
      </DialogContent>
    </Dialog>
  );
}
