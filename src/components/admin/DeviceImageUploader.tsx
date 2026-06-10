/**
 * DeviceImageUploader — Upload em massa de imagens de componentes
 *
 * Regra de matching (EXATA):
 *   nome do arquivo (sem extensão) === device.reference
 *   Normalização: trim + colapso de espaços múltiplos + case-insensitive
 *   ⚠️  Letras a mais NÃO fazem match. Ex: "CCAHC 09X" ≠ "CCAHC 09"
 *
 * Modos de entrada:
 *   1. Selecionar Pasta  → varre pasta e subpastas via webkitdirectory
 *   2. Selecionar Arquivos → seleção manual múltipla
 *   3. Drag & Drop        → soltar arquivos ou pasta
 *
 * Fluxo:
 *  1. Carrega arquivos → match com references do banco
 *  2. Mostra preview (✅ com match | ⚠️ sem match)
 *  3. Upload para Supabase Storage (bucket devices-images)
 *  4. Atualiza icon_url no banco em batch
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  Upload, X, CheckCircle2, AlertTriangle, XCircle,
  FileImage, ArrowUpCircle, Loader2, FolderOpen, Files,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// ── Thumbnail seguro com revoke ──────────────────────────────────────────────
function BlobThumb({ file, uploadedUrl }: { file: File; uploadedUrl?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (uploadedUrl) { setSrc(uploadedUrl); return; }
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file, uploadedUrl]);
  return (
    <div className="h-10 w-10 rounded-lg overflow-hidden bg-white border border-border/30 shrink-0 flex items-center justify-center">
      {src && <img src={src} alt="" className="h-full w-full object-contain p-0.5" />}
    </div>
  );
}

interface FileResult {
  file:      File;
  refName:   string;
  deviceId:  string | null;
  reference: string | null;
  model:     string | null;
  status:    "pending" | "uploading" | "done" | "error" | "no_match";
  url?:      string;
  error?:    string;
}

// Normaliza para comparação:
// 1. Remove acentos (CABEÇA → CABECA, para tolerar variação de encoding)
// 2. Lowercase + trim
// 3. Remove TODOS os espaços (ADE 3318NC = ADE3318NC = ade3318nc)
// Isso resolve a principal causa de falha: espaços inconsistentes
// antes de sufixos como NC, ST, B, N, R entre arquivos e banco.
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // remove diacríticos (acentos)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "");              // remove todos os espaços
}

// Remove extensão
function stemName(filename: string) {
  return filename.replace(/\.[^.]+$/, "");
}

// Sanitiza path para storage
function sanitizePath(name: string): string {
  return name
    .replace(/\.\.+/g, ".")
    .replace(/[\/\\<>:"|?*\x00]/g, "_")
    .trim();
}

interface Props {
  onClose: () => void;
  onDone:  () => void;
}

export function DeviceImageUploader({ onClose, onDone }: Props) {
  const [results,   setResults]   = useState<FileResult[]>([]);
  const [uploading, setUploading] = useState(false);
  const [done,      setDone]      = useState(false);

  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef  = useRef<HTMLInputElement>(null);

  // ── Processa lista de arquivos ───────────────────────────────────────────
  const processFiles = useCallback(async (files: FileList | File[]) => {
    // Filtra apenas imagens; ignora arquivos ocultos (._xxx) gerados pelo macOS
    const arr = Array.from(files).filter(f =>
      /\.(webp|jpg|jpeg|png|gif)$/i.test(f.name) &&
      !f.name.startsWith("._") &&
      !f.name.startsWith(".")
    );

    if (arr.length === 0) {
      toast.error("Nenhuma imagem encontrada (.webp, .jpg, .png, .gif)");
      return;
    }

    // Busca todas as references do banco de uma vez
    const { data: devices, error } = await supabase
      .from("devices")
      .select("id, reference, model");

    if (error || !devices) {
      toast.error("Erro ao buscar componentes do banco");
      return;
    }

    // Mapa: reference normalizada → device (matching EXATO após norm)
    const devMap = new Map(
      devices.map(d => [norm(d.reference || ""), d])
    );

    const fileResults: FileResult[] = arr.map(file => {
      const refName   = stemName(file.name);          // nome sem extensão
      const normRef   = norm(refName);                // normalizado
      const dev       = devMap.get(normRef) ?? null;  // match exato

      return {
        file,
        refName,
        deviceId:  dev?.id        ?? null,
        reference: dev?.reference ?? null,
        model:     dev?.model     ?? null,
        status:    dev ? "pending" : "no_match",
      };
    });

    // Ordena: com match primeiro, sem match depois
    fileResults.sort((a, b) => {
      if (a.status === b.status) return a.refName.localeCompare(b.refName);
      return a.status === "pending" ? -1 : 1;
    });

    setResults(fileResults);
    setDone(false);
  }, []);

  // ── Drag & Drop (aceita pasta ou arquivos soltos) ────────────────────────
  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();

    // Tenta ler como FileSystemEntries para suportar pastas via DnD
    const items = Array.from(e.dataTransfer.items ?? []);
    const allFiles: File[] = [];

    async function readEntry(entry: FileSystemEntry): Promise<void> {
      if (entry.isFile) {
        await new Promise<void>(res => {
          (entry as FileSystemFileEntry).file(f => { allFiles.push(f); res(); });
        });
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        await new Promise<void>(res => {
          function readBatch() {
            reader.readEntries(async entries => {
              if (entries.length === 0) { res(); return; }
              await Promise.all(entries.map(readEntry));
              readBatch();
            });
          }
          readBatch();
        });
      }
    }

    if (items.length > 0 && items[0].webkitGetAsEntry) {
      const entries = items
        .map(i => i.webkitGetAsEntry())
        .filter((e): e is FileSystemEntry => !!e);
      await Promise.all(entries.map(readEntry));
      if (allFiles.length > 0) { processFiles(allFiles); return; }
    }

    // Fallback: DataTransfer.files normais
    processFiles(e.dataTransfer.files);
  }, [processFiles]);

  // ── Contagens ────────────────────────────────────────────────────────────
  const counts = useMemo(() => ({
    matched:  results.filter(r => r.status === "pending").length,
    noMatch:  results.filter(r => r.status === "no_match").length,
    total:    results.length,
    done:     results.filter(r => r.status === "done").length,
    errors:   results.filter(r => r.status === "error").length,
  }), [results]);

  // ── Upload ────────────────────────────────────────────────────────────────
  async function handleUpload() {
    const toUpload = results.filter(r => r.status === "pending");
    if (toUpload.length === 0) return;

    setUploading(true);
    setResults(prev => prev.map(r =>
      r.status === "pending" ? { ...r, status: "uploading" } : r
    ));

    const PARALLEL = 20;
    const urlMap = new Map<string, string>();

    async function uploadOne(item: FileResult): Promise<void> {
      const ext  = item.file.name.split(".").pop()!.toLowerCase();
      const path = `${sanitizePath(item.refName)}.${ext}`;

      const { error } = await supabase.storage
        .from("devices-images")
        .upload(path, item.file, {
          upsert:       true,
          contentType:  item.file.type,
          cacheControl: "31536000",
        });

      if (error) throw error;

      const { data } = supabase.storage.from("devices-images").getPublicUrl(path);
      urlMap.set(item.refName, data.publicUrl);
    }

    const uploadErrors = new Map<string, string>();

    for (let i = 0; i < toUpload.length; i += PARALLEL) {
      const batch   = toUpload.slice(i, i + PARALLEL);
      const settled = await Promise.allSettled(batch.map(uploadOne));
      settled.forEach((res, idx) => {
        if (res.status === "rejected") {
          const msg = res.reason instanceof Error ? res.reason.message : String(res.reason);
          uploadErrors.set(batch[idx].refName, msg);
        }
      });
    }

    // Atualiza icon_url em batch de 500
    const toUpdate = toUpload
      .filter(item => urlMap.has(item.refName))
      .map(item    => ({ id: item.deviceId!, icon_url: urlMap.get(item.refName)! }));

    const DB_BATCH = 500;
    for (let i = 0; i < toUpdate.length; i += DB_BATCH) {
      await supabase.from("devices").upsert(
        toUpdate.slice(i, i + DB_BATCH),
        { onConflict: "id" }
      );
    }

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

  function resetar() {
    setResults([]);
    setDone(false);
    // Limpa os inputs para permitir re-selecionar a mesma pasta
    if (folderInputRef.current) folderInputRef.current.value = "";
    if (filesInputRef.current)  filesInputRef.current.value  = "";
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full max-w-2xl bg-card rounded-t-2xl sm:rounded-2xl border border-border/40 shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30 shrink-0">
          <div className="flex items-center gap-2">
            <FileImage className="h-4 w-4 text-primary" />
            <div>
              <h3 className="font-semibold text-sm">Upload de Imagens em Massa</h3>
              <p className="text-[11px] text-muted-foreground">
                Nome do arquivo (sem extensão) = Referência exata do componente
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Zona de entrada — só aparece se ainda não carregou arquivos */}
          {results.length === 0 && (
            <div className="space-y-3">

              {/* Drag & Drop area */}
              <div
                className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border/50 p-8 hover:border-primary/50 hover:bg-primary/5 transition-colors"
                onDrop={onDrop}
                onDragOver={e => e.preventDefault()}
              >
                <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Upload className="h-6 w-6 text-primary" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold">Arraste uma pasta ou arquivos aqui</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Ou use os botões abaixo para selecionar
                  </p>
                </div>
              </div>

              {/* Botões de seleção */}
              <div className="grid grid-cols-2 gap-3">
                {/* Selecionar Pasta (varre subpastas automaticamente) */}
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="flex flex-col items-center gap-2 rounded-xl border border-border/50 bg-muted/30 p-4 hover:bg-primary/5 hover:border-primary/40 transition-colors"
                >
                  <FolderOpen className="h-7 w-7 text-primary/70" />
                  <div className="text-center">
                    <p className="text-[13px] font-semibold">Selecionar Pasta</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Varre pasta e subpastas
                    </p>
                  </div>
                </button>

                {/* Selecionar arquivos individuais */}
                <button
                  type="button"
                  onClick={() => filesInputRef.current?.click()}
                  className="flex flex-col items-center gap-2 rounded-xl border border-border/50 bg-muted/30 p-4 hover:bg-primary/5 hover:border-primary/40 transition-colors"
                >
                  <Files className="h-7 w-7 text-primary/70" />
                  <div className="text-center">
                    <p className="text-[13px] font-semibold">Selecionar Arquivos</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Escolha múltiplos arquivos
                    </p>
                  </div>
                </button>
              </div>

              {/* Nota de matching */}
              <p className="text-[11px] text-muted-foreground text-center bg-muted/30 rounded-lg px-3 py-2">
                O nome de cada arquivo deve ser <strong>idêntico</strong> à referência do componente.
                Espaços e capitalização são ignorados, mas letras a mais <strong>não fazem match</strong>.
                <br />
                <span className="font-mono text-primary">CCAHC 09.webp</span> → referência <span className="font-mono text-primary">CCAHC 09</span>
              </p>

              {/* Inputs ocultos */}
              {/* Pasta: webkitdirectory varre tudo recursivamente */}
              <input
                ref={folderInputRef}
                type="file"
                // @ts-ignore — atributo não-padrão suportado por todos os browsers modernos
                webkitdirectory=""
                multiple
                accept="image/*"
                className="hidden"
                onChange={e => { if (e.target.files) processFiles(e.target.files); }}
              />
              {/* Arquivos individuais */}
              <input
                ref={filesInputRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={e => { if (e.target.files) processFiles(e.target.files); }}
              />
            </div>
          )}

          {/* Preview e resultados */}
          {results.length > 0 && (
            <>
              {/* Cards de resumo */}
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

              {/* Lista de arquivos */}
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
                    <BlobThumb file={r.file} uploadedUrl={r.status === "done" ? r.url : undefined} />

                    <div className="flex-1 min-w-0">
                      <p className="font-mono font-medium truncate">{r.refName}</p>
                      {r.status === "no_match" ? (
                        <p className="text-amber-600 text-[10px]">
                          Nenhum componente com esta referência exata
                        </p>
                      ) : r.status === "error" ? (
                        <p className="text-red-500 text-[10px] truncate">{r.error}</p>
                      ) : r.model ? (
                        <p className="text-muted-foreground text-[10px] truncate">{r.model}</p>
                      ) : null}
                    </div>

                    <div className="shrink-0">{statusIcon(r.status)}</div>
                  </div>
                ))}
              </div>

              {!uploading && (
                <button
                  onClick={resetar}
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
                ? "Enviando..."
                : `Enviar ${counts.matched} imagem${counts.matched !== 1 ? "ns" : ""}`}
            </Button>
          )}

          {done && (
            <div className="flex-1 flex items-center justify-center gap-2 text-green-600 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4" />
              {counts.done} imagem{counts.done !== 1 ? "ns" : ""} atualizada{counts.done !== 1 ? "s" : ""}
              {counts.errors > 0 && (
                <span className="text-red-500 ml-2">({counts.errors} erro{counts.errors !== 1 ? "s" : ""})</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
