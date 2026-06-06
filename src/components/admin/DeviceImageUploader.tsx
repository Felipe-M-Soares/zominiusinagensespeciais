/**
 * DeviceImageUploader — Upload em massa de imagens de componentes
 *
 * Regra de matching:
 *   nome do arquivo (sem extensão) === device.reference  (case-insensitive, trim)
 *
 * Ex: arquivo "CCAHC 09.webp" → atualiza o device cuja reference = "CCAHC 09"
 *
 * O componente:
 *  1. Recebe N arquivos de uma vez (drag & drop ou seletor)
 *  2. Para cada arquivo, faz match com a reference dos devices
 *  3. Mostra preview antes de confirmar
 *  4. Faz upload para Supabase Storage (bucket devices-images)
 *  5. Atualiza icon_url no banco para os devices matched
 *  6. Reporta: ✅ matched | ⚠️ sem match | ❌ erro
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  Upload, X, CheckCircle2, AlertTriangle, XCircle,
  FileImage, ArrowUpCircle, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// Componente de thumbnail que usa URL.createObjectURL de forma segura
// com revokeObjectURL no cleanup para evitar memory leak
function BlobThumb({ file, uploadedUrl }: { file: File; uploadedUrl?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (uploadedUrl) { setSrc(uploadedUrl); return; }
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url); // cleanup garante sem memory leak
  }, [file, uploadedUrl]);
  return (
    <div className="h-10 w-10 rounded-lg overflow-hidden bg-muted/40 shrink-0 flex items-center justify-center">
      {src && <img src={src} alt="" className="h-full w-full object-contain" />}
    </div>
  );
}

interface FileResult {
  file:      File;
  refName:   string;     // nome sem extensão
  deviceId:  string | null;
  reference: string | null;
  model:     string | null;
  status:    "pending" | "uploading" | "done" | "error" | "no_match";
  url?:      string;
  error?:    string;
}

// Normaliza string para comparação: lowercase + trim + colapsa espaços
function norm(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

// Remove extensão do nome do arquivo
function stemName(filename: string) {
  return filename.replace(/\.[^.]+$/, "");
}

// Sanitiza o nome para uso como path no storage
// Remove chars perigosos: /, \, .., null bytes, etc.
function sanitizePath(name: string): string {
  return name
    .replace(/\.\.+/g, ".")          // bloqueia path traversal (..)
    .replace(/[\/\\<>:"|?*\x00]/g, "_") // chars inválidos → _
    .trim();
}

interface Props {
  onClose: () => void;
  onDone:  () => void;   // chamado ao finalizar para recarregar os cards
}

export function DeviceImageUploader({ onClose, onDone }: Props) {
  const [results,   setResults]   = useState<FileResult[]>([]);
  const [uploading, setUploading] = useState(false);
  const [done,      setDone]      = useState(false);

  // ── Processa arquivos selecionados ─────────────────────────────────────────
  const processFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f =>
      /\.(webp|jpg|jpeg|png|gif)$/i.test(f.name)
    );
    if (arr.length === 0) {
      toast.error("Selecione imagens (.webp, .jpg, .png)");
      return;
    }

    // Busca todos os devices de uma vez
    const { data: devices, error } = await supabase
      .from("devices")
      .select("id, reference, model");

    if (error || !devices) {
      toast.error("Erro ao buscar componentes");
      return;
    }

    // Mapa: reference normalizada → device
    const devMap = new Map(
      devices.map(d => [norm(d.reference || ""), d])
    );

    const fileResults: FileResult[] = arr.map(file => {
      const refName = stemName(file.name);
      const dev     = devMap.get(norm(refName));
      return {
        file,
        refName,
        deviceId:  dev?.id   || null,
        reference: dev?.reference || null,
        model:     dev?.model || null,
        status:    dev ? "pending" : "no_match",
      };
    });

    setResults(fileResults);
    setDone(false);
  }, []);

  // ── Drag & Drop ────────────────────────────────────────────────────────────
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    processFiles(e.dataTransfer.files);
  }, [processFiles]);

  // ── Contagens para preview ─────────────────────────────────────────────────
  const counts = useMemo(() => ({
    matched:  results.filter(r => r.status === "pending").length,
    noMatch:  results.filter(r => r.status === "no_match").length,
    total:    results.length,
    done:     results.filter(r => r.status === "done").length,
    errors:   results.filter(r => r.status === "error").length,
  }), [results]);

  // ── Upload ─────────────────────────────────────────────────────────────────
  async function handleUpload() {
    const toUpload = results.filter(r => r.status === "pending");
    if (toUpload.length === 0) return;

    setUploading(true);

    // Marca todos como "uploading"
    setResults(prev => prev.map(r =>
      r.status === "pending" ? { ...r, status: "uploading" } : r
    ));

    // ── PASSO 1: Upload de todos os arquivos em paralelo (20 simultâneos) ────
    // Mesmo padrão do import de peças: batches paralelos direto pelo cliente
    const PARALLEL = 20;
    const urlMap = new Map<string, string>(); // file → publicUrl

    async function uploadFile(item: FileResult): Promise<void> {
      const ext  = item.file.name.split(".").pop()!.toLowerCase();
      const path = `${sanitizePath(item.refName)}.${ext}`;

      const { error } = await supabase.storage
        .from("devices-images")
        .upload(path, item.file, {
          upsert:      true,
          contentType: item.file.type,
          cacheControl: "31536000",
        });

      if (error) throw error;

      const { data } = supabase.storage.from("devices-images").getPublicUrl(path);
      urlMap.set(item.refName, data.publicUrl);
    }

    const uploadErrors = new Map<string, string>();

    for (let i = 0; i < toUpload.length; i += PARALLEL) {
      const batch = toUpload.slice(i, i + PARALLEL);
      const settled = await Promise.allSettled(batch.map(uploadFile));
      settled.forEach((res, idx) => {
        if (res.status === "rejected") {
          const msg = res.reason instanceof Error ? res.reason.message : String(res.reason);
          uploadErrors.set(batch[idx].refName, msg);
        }
      });
    }

    // ── PASSO 2: Atualiza icon_url em batch de 500 (igual ao import de peças) ─
    const toUpdate = toUpload
      .filter(item => urlMap.has(item.refName))
      .map(item => ({ id: item.deviceId!, icon_url: urlMap.get(item.refName)! }));

    const DB_BATCH = 500;
    for (let i = 0; i < toUpdate.length; i += DB_BATCH) {
      const batch = toUpdate.slice(i, i + DB_BATCH);
      await supabase.from("devices").upsert(batch, { onConflict: "id" });
    }

    // ── Atualiza status visual ─────────────────────────────────────────────────
    setResults(prev => prev.map(r => {
      if (r.status !== "uploading") return r;
      if (uploadErrors.has(r.refName))
        return { ...r, status: "error", error: uploadErrors.get(r.refName) };
      const url = urlMap.get(r.refName);
      return url ? { ...r, status: "done", url } : r;
    }));

    setUploading(false);
    setDone(true);
    onDone();
  }

  const statusIcon = (s: FileResult["status"]) => {
    if (s === "pending")   return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/40" />;
    if (s === "uploading") return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    if (s === "done")      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (s === "error")     return <XCircle className="h-4 w-4 text-red-500" />;
    if (s === "no_match")  return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full max-w-2xl bg-card rounded-t-2xl sm:rounded-2xl border border-border/40 shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30 shrink-0">
          <div className="flex items-center gap-2">
            <FileImage className="h-4 w-4 text-primary" />
            <div>
              <h3 className="font-semibold text-sm">Upload de Imagens</h3>
              <p className="text-[11px] text-muted-foreground">
                Nome do arquivo = Referência do componente
              </p>
            </div>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Drop zone */}
          {results.length === 0 && (
            <label
              className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border/50 p-10 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
              onDrop={onDrop}
              onDragOver={e => e.preventDefault()}
            >
              <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Upload className="h-7 w-7 text-primary" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold">Arraste as imagens ou clique para selecionar</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  O nome de cada arquivo deve ser idêntico à referência do componente
                </p>
                <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                  Ex: <span className="text-primary">CCAHC 09.webp</span> → reference "CCAHC 09"
                </p>
              </div>
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={e => { if (e.target.files) processFiles(e.target.files); }}
              />
            </label>
          )}

          {/* Resumo */}
          {results.length > 0 && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-3 text-center">
                  <p className="text-xl font-bold text-green-600">{counts.matched}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Com match</p>
                </div>
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-center">
                  <p className="text-xl font-bold text-amber-600">{counts.noMatch}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Sem match</p>
                </div>
                <div className="rounded-xl border border-border/40 p-3 text-center">
                  <p className="text-xl font-bold">{counts.total}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total</p>
                </div>
              </div>

              {/* Lista */}
              <div className="rounded-xl border border-border/40 overflow-hidden divide-y divide-border/20 max-h-72 overflow-y-auto">
                {results.map((r, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 text-[12px]",
                      r.status === "no_match" && "bg-amber-500/5",
                      r.status === "done"     && "bg-green-500/5",
                      r.status === "error"    && "bg-red-500/5",
                    )}
                  >
                    {/* Thumbnail — usa URL do storage se disponível, senão data URL via FileReader */}
                    <BlobThumb file={r.file} uploadedUrl={r.status === "done" ? r.url : undefined} />

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-mono font-medium truncate">{r.refName}</p>
                      {r.status === "no_match" ? (
                        <p className="text-amber-600 text-[10px]">
                          ⚠️ Nenhum componente com esta referência
                        </p>
                      ) : r.status === "error" ? (
                        <p className="text-red-500 text-[10px] truncate">{r.error}</p>
                      ) : r.model ? (
                        <p className="text-muted-foreground text-[10px] truncate">{r.model}</p>
                      ) : null}
                    </div>

                    {/* Status */}
                    <div className="shrink-0">
                      {statusIcon(r.status)}
                    </div>
                  </div>
                ))}
              </div>

              {/* Resetar */}
              {!uploading && (
                <button
                  onClick={() => { setResults([]); setDone(false); }}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  ← Selecionar outros arquivos
                </button>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-border/30 shrink-0">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={uploading}>
            {done ? "Fechar" : "Cancelar"}
          </Button>

          {counts.matched > 0 && !done && (
            <Button
              className="flex-1 gap-2"
              onClick={handleUpload}
              disabled={uploading}
            >
              {uploading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <ArrowUpCircle className="h-4 w-4" />}
              {uploading
                ? `Enviando...`
                : `Enviar ${counts.matched} imagem${counts.matched !== 1 ? "ns" : ""}`}
            </Button>
          )}

          {done && (
            <div className="flex-1 flex items-center justify-center gap-2 text-green-600 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4" />
              {counts.done} imagem{counts.done !== 1 ? "ns" : ""} atualizada{counts.done !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
