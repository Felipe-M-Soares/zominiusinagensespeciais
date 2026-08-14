/**
 * DeviceImageUploader — Upload em massa de imagens de componentes
 *
 * Regras de matching (em ordem de prioridade):
 *   1. Exato:   nome do arquivo === reference (após normalização)
 *   2. Família: arquivo cobre múltiplas peças que diferem apenas no dígito
 *               de altura/variante no meio do código numérico.
 *               Ex: "PIM 4818N" → PIM 48181N, PIM 48182N ... PIM 48186N
 *               Ex: "EAE 3318NC" → EAE 3318172NC, EAE 3318173NC, EAE 3318174NC ...
 *               Regra: mesmas letras prefixo + dígitos do arquivo são prefixo
 *               dos dígitos do banco + mesmo sufixo de letras.
 *
 * Uma imagem de família é enviada UMA VEZ ao Storage e seu URL é linkado
 * a TODAS as peças da família no banco (icon_url em batch).
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

// ── Thumbnail ────────────────────────────────────────────────────────────────
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

interface Device {
  id: string;
  reference: string;
  model: string;
}

interface FileResult {
  file:       File;
  refName:    string;
  // uma imagem pode cobrir várias peças (família)
  deviceIds:  string[];
  references: string[];
  model:      string | null;
  status:     "pending" | "uploading" | "done" | "error" | "no_match";
  url?:       string;
  error?:     string;
}

// Normaliza: remove acentos, lowercase, remove espaços
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "");
}

// Remove extensão do arquivo
function stemName(filename: string) {
  return filename.replace(/\.[^.]+$/, "");
}

// Sanitiza path para storage
function sanitizePath(name: string): string {
  return name
    .replace(/\.\.+/g, ".")
    // eslint-disable-next-line no-control-regex -- \x00 é intencional: remove byte nulo de nomes de arquivo antes de usar como path de storage.
    .replace(/[/\\<>:"|?*\x00]/g, "_")
    .trim();
}

/**
 * Encontra todas as peças do banco que correspondem ao arquivo.
 *
 * Match exato:    norm(file) === norm(ref)
 * Match família:  mesmas letras-prefixo + dígitos do arquivo são prefixo
 *                 dos dígitos do banco + mesmo sufixo de letras.
 *
 * Exemplo família:
 *   arquivo  "PIM 4818N"  → norm "pim4818n"
 *   banco    "PIM 48181N" → norm "pim48181n"  ← pim + 48181 + n
 *   regra: prefixLetters="pim", fileDigits="4818", suffix="n"
 *          bank digits "48181" starts with "4818" ✓
 */
function findMatches(fileNorm: string, devices: Device[]): Device[] {
  // Pass 1: exact
  const exact = devices.filter(d => norm(d.reference) === fileNorm);
  if (exact.length > 0) return exact;

  // Pass 2: family — split norm into (letters)(digits)(letters)
  const m = fileNorm.match(/^([a-z]*)(\d+)([a-z]*)$/);
  if (!m) return [];

  const [, prefixLetters, fileDigits, suffixLetters] = m;

  return devices.filter(d => {
    const dn = norm(d.reference);
    const dm = dn.match(/^([a-z]*)(\d+)([a-z]*)$/);
    if (!dm) return false;
    return (
      dm[1] === prefixLetters &&          // mesmas letras iniciais
      dm[2].startsWith(fileDigits) &&     // dígitos do banco começam com os do arquivo
      dm[3] === suffixLetters             // mesmo sufixo de letras
    );
  });
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

  // ── Processa arquivos ────────────────────────────────────────────────────
  const processFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f =>
      /\.(webp|jpg|jpeg|png|gif)$/i.test(f.name) &&
      !f.name.startsWith("._") &&
      !f.name.startsWith(".")
    );

    if (arr.length === 0) {
      toast.error("Nenhuma imagem encontrada (.webp, .jpg, .png, .gif)");
      return;
    }

    // Busca o catálogo INTEIRO paginando — um select() sem range() é limitado
    // pelo Supabase/PostgREST (1000 linhas por padrão). Mesmo bug que existia
    // no upload de desenhos técnicos: catálogo maior que isso perdia peças
    // silenciosamente da comparação. order("id") garante ordem estável entre
    // páginas (sem isso o Postgres não garante não pular/repetir linhas).
    const devices: Device[] = [];
    {
      const DEVICES_PAGE = 1000;
      for (let from = 0; ; from += DEVICES_PAGE) {
        const { data: page, error } = await supabase
          .from("devices")
          .select("id, reference, model")
          .order("id")
          .range(from, from + DEVICES_PAGE - 1);
        if (error) {
          toast.error("Erro ao buscar componentes do banco");
          return;
        }
        if (!page || page.length === 0) break;
        devices.push(...(page as Device[]));
        if (page.length < DEVICES_PAGE) break;
      }
    }

    // Deduplica por nome de arquivo — mesmo arquivo em múltiplas subpastas
    // usa apenas a primeira ocorrência
    const seen = new Map<string, FileResult>();

    for (const file of arr) {
      const refName  = stemName(file.name);
      const fileNorm = norm(refName);

      if (seen.has(fileNorm)) continue; // já processado

      const matched = findMatches(fileNorm, devices);

      seen.set(fileNorm, {
        file,
        refName,
        deviceIds:  matched.map(d => d.id),
        references: matched.map(d => d.reference),
        model:      matched.length === 1
                      ? matched[0].model
                      : matched.length > 1
                        ? `${matched.length} peças (família)`
                        : null,
        status: matched.length > 0 ? "pending" : "no_match",
      });
    }

    const fileResults = Array.from(seen.values());

    // Ordena: com match primeiro
    fileResults.sort((a, b) => {
      if (a.status === b.status) return a.refName.localeCompare(b.refName);
      return a.status === "pending" ? -1 : 1;
    });

    setResults(fileResults);
    setDone(false);
  }, []);

  // ── Drag & Drop ──────────────────────────────────────────────────────────
  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
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

    if (items.length > 0 && typeof items[0].webkitGetAsEntry === "function") {
      const entries = items
        .map(i => i.webkitGetAsEntry())
        .filter((e): e is FileSystemEntry => !!e);
      await Promise.all(entries.map(readEntry));
      if (allFiles.length > 0) { processFiles(allFiles); return; }
    }
    processFiles(e.dataTransfer.files);
  }, [processFiles]);

  // ── Contagens ────────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const matched  = results.filter(r => r.status === "pending");
    const totalDev = matched.reduce((s, r) => s + r.deviceIds.length, 0);
    return {
      matchedFiles: matched.length,
      matchedDevs:  totalDev,
      noMatch:      results.filter(r => r.status === "no_match").length,
      total:        results.length,
      done:         results.filter(r => r.status === "done").length,
      errors:       results.filter(r => r.status === "error").length,
    };
  }, [results]);

  // ── Upload ───────────────────────────────────────────────────────────────
  async function handleUpload() {
    const toUpload = results.filter(r => r.status === "pending");
    if (toUpload.length === 0) return;

    setUploading(true);
    setResults(prev => prev.map(r =>
      r.status === "pending" ? { ...r, status: "uploading" } : r
    ));

    const PARALLEL = 20;
    const urlMap   = new Map<string, string>(); // refName → publicUrl
    const uploadErrors = new Map<string, string>();

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

    // Monta lista de updates: cada device recebe a URL da sua imagem de família
    const idsByUrl = new Map<string, string[]>();
    for (const item of toUpload) {
      const url = urlMap.get(item.refName);
      if (!url) continue;
      const ids = idsByUrl.get(url) ?? [];
      ids.push(...item.deviceIds);
      idsByUrl.set(url, ids);
    }

    const DB_BATCH = 500;
    for (const [url, ids] of idsByUrl) {
      for (let i = 0; i < ids.length; i += DB_BATCH) {
        await supabase
          .from("devices")
          .update({ icon_url: url })
          .in("id", ids.slice(i, i + DB_BATCH));
      }
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
                Arquivo cobre a família inteira — ex: PIM 4818N → todas as alturas
              </p>
            </div>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {results.length === 0 && (
            <div className="space-y-3">
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
                  <p className="text-[11px] text-muted-foreground mt-1">Ou use os botões abaixo</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => folderInputRef.current?.click()}
                  className="flex flex-col items-center gap-2 rounded-xl border border-border/50 bg-muted/30 p-4 hover:bg-primary/5 hover:border-primary/40 transition-colors">
                  <FolderOpen className="h-7 w-7 text-primary/70" />
                  <div className="text-center">
                    <p className="text-[13px] font-semibold">Selecionar Pasta</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Varre pasta e subpastas</p>
                  </div>
                </button>
                <button type="button" onClick={() => filesInputRef.current?.click()}
                  className="flex flex-col items-center gap-2 rounded-xl border border-border/50 bg-muted/30 p-4 hover:bg-primary/5 hover:border-primary/40 transition-colors">
                  <Files className="h-7 w-7 text-primary/70" />
                  <div className="text-center">
                    <p className="text-[13px] font-semibold">Selecionar Arquivos</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Escolha múltiplos arquivos</p>
                  </div>
                </button>
              </div>

              <input ref={folderInputRef} type="file"
                // @ts-expect-error -- webkitdirectory não está nos tipos padrão de HTMLInputElement
                webkitdirectory="" multiple accept="image/*" className="hidden"
                onChange={e => { if (e.target.files) processFiles(e.target.files); }} />
              <input ref={filesInputRef} type="file"
                multiple accept="image/*" className="hidden"
                onChange={e => { if (e.target.files) processFiles(e.target.files); }} />
            </div>
          )}

          {results.length > 0 && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-3 text-center">
                  <p className="text-xl font-bold text-green-600">{counts.matchedDevs}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Peças cobertas</p>
                </div>
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-center">
                  <p className="text-xl font-bold text-amber-600">{counts.noMatch}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Sem match</p>
                </div>
                <div className="rounded-xl border border-border/40 p-3 text-center">
                  <p className="text-xl font-bold">{counts.total}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Arquivos únicos</p>
                </div>
              </div>

              <div className="rounded-xl border border-border/40 overflow-hidden divide-y divide-border/20 max-h-72 overflow-y-auto">
                {results.map((r, i) => (
                  <div key={i} className={cn(
                    "flex items-center gap-3 px-3 py-2 text-[12px]",
                    r.status === "no_match" && "bg-amber-500/5",
                    r.status === "done"     && "bg-green-500/5",
                    r.status === "error"    && "bg-red-500/5",
                  )}>
                    <BlobThumb file={r.file} uploadedUrl={r.status === "done" ? r.url : undefined} />
                    <div className="flex-1 min-w-0">
                      <p className="font-mono font-medium truncate">{r.refName}</p>
                      {r.status === "no_match" ? (
                        <p className="text-amber-600 text-[10px]">Nenhuma peça com esta referência</p>
                      ) : r.status === "error" ? (
                        <p className="text-red-500 text-[10px] truncate">{r.error}</p>
                      ) : r.model ? (
                        <p className="text-muted-foreground text-[10px] truncate">{r.model}</p>
                      ) : null}
                    </div>
                    {r.deviceIds.length > 1 && r.status !== "no_match" && (
                      <span className="text-[9px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full shrink-0">
                        ×{r.deviceIds.length}
                      </span>
                    )}
                    <div className="shrink-0">{statusIcon(r.status)}</div>
                  </div>
                ))}
              </div>

              {!uploading && (
                <button onClick={resetar} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                  ← Selecionar outros arquivos
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-border/30 shrink-0">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={uploading}>
            {done ? "Fechar" : "Cancelar"}
          </Button>

          {counts.matchedFiles > 0 && !done && (
            <Button className="flex-1 gap-2" onClick={handleUpload} disabled={uploading}>
              {uploading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <ArrowUpCircle className="h-4 w-4" />}
              {uploading
                ? "Enviando..."
                : `Enviar ${counts.matchedFiles} arquivo${counts.matchedFiles !== 1 ? "s" : ""} → ${counts.matchedDevs} peça${counts.matchedDevs !== 1 ? "s" : ""}`}
            </Button>
          )}

          {done && (
            <div className="flex-1 flex items-center justify-center gap-2 text-green-600 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4" />
              {counts.done} arquivo{counts.done !== 1 ? "s" : ""} enviado{counts.done !== 1 ? "s" : ""}
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
