/**
 * DesenhoTecnicoUploader — Upload em massa de desenhos técnicos (PDF) a partir
 * de um único arquivo .zip com pastas e subpastas.
 *
 * Para cada PDF dentro do zip, tenta casar com uma peça do banco em duas
 * etapas:
 *   1. Correspondência EXATA — nome do próprio arquivo (sem extensão) ou de
 *      alguma pasta ancestral bate exatamente com a referência (ou modelo)
 *      cadastrado, ignorando acentos, maiúsculas/minúsculas, espaços, traços,
 *      underscores e pontuação (ex: "UCEAR-4814", "ucear_4814" e "UCEAR 4814"
 *      são todos tratados como o mesmo texto).
 *   2. Correspondência APROXIMADA (fallback) — se nada bateu exato, verifica
 *      se o nome do arquivo/pasta CONTÉM a referência cadastrada (ou é contido
 *      por ela) — cobre casos como "UCEAR 4814 Rev02.pdf" ou "Desenho_UCEAR4814".
 *      Só aceita esse tipo de match quando ele aponta pra EXATAMENTE UMA peça
 *      (se mais de uma referência poderia bater, fica marcado como sem match
 *      pra não arriscar vincular o desenho errado). Esses casos aparecem
 *      marcados como "aproximado" na prévia, pra conferência antes de enviar.
 */

import { useState, useCallback, useMemo, useRef } from "react";
import JSZip from "jszip";
import {
  X, CheckCircle2, AlertTriangle, XCircle,
  FileText, ArrowUpCircle, Loader2, FileArchive, Copy, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
import { useTranslation } from "react-i18next";

const MAX_ZIP_SIZE_MB = 1024;
// Candidatos de nome com menos que isso (já normalizado) não entram na
// correspondência aproximada — evita casar "01" com qualquer peça que tenha
// "01" em algum canto da referência.
const MIN_FUZZY_LEN = 4;

interface Device {
  id: string;
  reference: string;
  model: string;
}

interface FileResult {
  zipPath:    string;   // caminho completo dentro do zip, só pra exibição
  refName:    string;   // nome usado para o match (arquivo ou pasta)
  entry:      JSZip.JSZipObject;
  deviceId?:  string;
  reference?: string;
  model?:     string;
  fuzzy?:     boolean;  // true = correspondência aproximada (conferir antes de enviar)
  status:     "pending" | "uploading" | "done" | "error" | "no_match" | "duplicate";
  error?:     string;
}

/** Remove acentos, caixa e QUALQUER separador (espaço, traço, underscore, ponto...) */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function stemName(filename: string) {
  return filename.replace(/\.[^.]+$/, "");
}

function sanitizePath(name: string): string {
  return name
    .replace(/\.\.+/g, ".")
    // eslint-disable-next-line no-control-regex -- \x00 é intencional: remove byte nulo de nomes de arquivo antes de usar como path de storage.
    .replace(/[/\\<>:"|?*\x00]/g, "_")
    .trim();
}

/** Tenta casar por nome do arquivo, depois por cada pasta ancestral — exato primeiro, aproximado como fallback. */
function findMatch(zipPath: string, devices: Device[]): { device: Device; refName: string; fuzzy: boolean } | null {
  const parts = zipPath.split("/").filter(Boolean);
  const fileName = parts[parts.length - 1];
  const candidates = [stemName(fileName), ...parts.slice(0, -1).reverse()];

  // Etapa 1: correspondência exata (referência ou modelo, normalizados)
  for (const candidate of candidates) {
    const candNorm = norm(candidate);
    if (!candNorm) continue;
    const match = devices.find(d => norm(d.reference) === candNorm || norm(d.model) === candNorm);
    if (match) return { device: match, refName: candidate, fuzzy: false };
  }

  // Etapa 2: correspondência aproximada — só aceita se apontar pra uma única peça
  for (const candidate of candidates) {
    const candNorm = norm(candidate);
    if (!candNorm || candNorm.length < MIN_FUZZY_LEN) continue;
    const matches = devices.filter(d => {
      const refNorm = norm(d.reference);
      const modelNorm = norm(d.model);
      const refHit = refNorm.length >= MIN_FUZZY_LEN && (candNorm.includes(refNorm) || refNorm.includes(candNorm));
      const modelHit = modelNorm.length >= MIN_FUZZY_LEN && (candNorm.includes(modelNorm) || modelNorm.includes(candNorm));
      return refHit || modelHit;
    });
    if (matches.length === 1) return { device: matches[0], refName: candidate, fuzzy: true };
  }

  return null;
}

interface Props {
  onClose: () => void;
  onDone:  () => void;
}

export function DesenhoTecnicoUploader({ onClose, onDone }: Props) {
  const { t } = useTranslation();
  const [results,   setResults]   = useState<FileResult[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [done,      setDone]      = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processZip = useCallback(async (zipFile: File) => {
    if (!zipFile.name.toLowerCase().endsWith(".zip")) {
      toast.error(t("desenhoTecnicoUploader.toastSelectZip"));
      return;
    }
    if (zipFile.size > MAX_ZIP_SIZE_MB * 1024 * 1024) {
      toast.error(t("desenhoTecnicoUploader.toastFileTooLarge", { gb: (MAX_ZIP_SIZE_MB / 1024).toFixed(0) }));
      return;
    }

    setExtracting(true);
    try {
      const zip = await JSZip.loadAsync(zipFile);
      const entries = Object.values(zip.files).filter(e =>
        !e.dir &&
        /\.pdf$/i.test(e.name) &&
        !e.name.split("/").some(seg => seg.startsWith("__MACOSX") || seg.startsWith("."))
      );

      if (entries.length === 0) {
        toast.error(t("desenhoTecnicoUploader.toastNoPdfFound"));
        setExtracting(false);
        return;
      }

      const { data: devices, error } = await supabase
        .from("devices")
        .select("id, reference, model");

      if (error || !devices) {
        toast.error(t("desenhoTecnicoUploader.toastLoadDevicesError"));
        setExtracting(false);
        return;
      }

      const usedDeviceIds = new Set<string>();
      const fileResults: FileResult[] = entries.map(entry => {
        const found = findMatch(entry.name, devices as Device[]);
        if (!found) {
          return { zipPath: entry.name, refName: stemName(entry.name.split("/").pop()!), entry, status: "no_match" as const };
        }
        if (usedDeviceIds.has(found.device.id)) {
          return {
            zipPath: entry.name, refName: found.refName, entry,
            deviceId: found.device.id, reference: found.device.reference, model: found.device.model,
            fuzzy: found.fuzzy,
            status: "duplicate" as const,
          };
        }
        usedDeviceIds.add(found.device.id);
        return {
          zipPath: entry.name, refName: found.refName, entry,
          deviceId: found.device.id, reference: found.device.reference, model: found.device.model,
          fuzzy: found.fuzzy,
          status: "pending" as const,
        };
      });

      fileResults.sort((a, b) => {
        if (a.status === b.status) return a.zipPath.localeCompare(b.zipPath);
        const order = { pending: 0, duplicate: 1, no_match: 2, uploading: 3, done: 4, error: 5 };
        return order[a.status] - order[b.status];
      });

      setResults(fileResults);
      setDone(false);
    } catch (e) {
      logger.error("processZip error:", e);
      toast.error(t("desenhoTecnicoUploader.toastZipReadError"));
    } finally {
      setExtracting(false);
    }
  }, []);

  const counts = useMemo(() => {
    const matched = results.filter(r => r.status === "pending");
    return {
      matched: matched.length,
      fuzzy: matched.filter(r => r.fuzzy).length,
      noMatch: results.filter(r => r.status === "no_match").length,
      duplicate: results.filter(r => r.status === "duplicate").length,
      total: results.length,
      done: results.filter(r => r.status === "done").length,
      errors: results.filter(r => r.status === "error").length,
    };
  }, [results]);

  async function handleUpload() {
    const toUpload = results.filter(r => r.status === "pending");
    if (toUpload.length === 0) return;

    setUploading(true);
    setResults(prev => prev.map(r => r.status === "pending" ? { ...r, status: "uploading" } : r));

    const PARALLEL = 6;
    const errors = new Map<string, string>();

    async function uploadOne(item: FileResult): Promise<void> {
      const blob = await item.entry.async("blob");
      const path = `${sanitizePath(item.reference!)}.pdf`;

      const { error: upErr } = await supabase.storage
        .from("desenhos-tecnicos")
        .upload(path, blob, { upsert: true, contentType: "application/pdf", cacheControl: "31536000" });
      if (upErr) throw upErr;

      const { error: dbErr } = await supabase
        .from("devices")
        .update({ desenho_tecnico_path: path })
        .eq("id", item.deviceId!);
      if (dbErr) throw dbErr;
    }

    for (let i = 0; i < toUpload.length; i += PARALLEL) {
      const batch = toUpload.slice(i, i + PARALLEL);
      const settled = await Promise.allSettled(batch.map(uploadOne));
      settled.forEach((res, idx) => {
        if (res.status === "rejected") {
          const msg = res.reason instanceof Error ? res.reason.message : String(res.reason);
          errors.set(batch[idx].zipPath, msg);
        }
      });
      setResults(prev => prev.map(r => {
        if (r.status !== "uploading") return r;
        if (errors.has(r.zipPath)) return { ...r, status: "error", error: errors.get(r.zipPath) };
        if (batch.some(b => b.zipPath === r.zipPath)) return { ...r, status: "done" };
        return r;
      }));
    }

    setUploading(false);
    setDone(true);
    onDone();
  }

  const statusIcon = (s: FileResult["status"]) => {
    if (s === "pending")    return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/40" />;
    if (s === "uploading")  return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    if (s === "done")       return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (s === "error")      return <XCircle className="h-4 w-4 text-red-500" />;
    if (s === "no_match")   return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    if (s === "duplicate")  return <Copy className="h-4 w-4 text-muted-foreground" />;
  };

  function resetar() {
    setResults([]);
    setDone(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full max-w-2xl bg-card rounded-t-2xl sm:rounded-2xl border border-border/40 shadow-2xl flex flex-col max-h-[90vh]">

        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30 shrink-0">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <div>
              <h3 className="font-semibold text-sm">{t("desenhoTecnicoUploader.title")}</h3>
              <p className="text-[11px] text-muted-foreground">
                {t("desenhoTecnicoUploader.subtitle")}
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
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={extracting}
                className="w-full flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border/50 p-8 hover:border-primary/50 hover:bg-primary/5 transition-colors disabled:opacity-60"
              >
                <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                  {extracting
                    ? <Loader2 className="h-6 w-6 text-primary animate-spin" />
                    : <FileArchive className="h-6 w-6 text-primary" />}
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold">{extracting ? t("desenhoTecnicoUploader.readingZip") : t("desenhoTecnicoUploader.selectZipFile")}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">{t("desenhoTecnicoUploader.foldersScanned")}</p>
                  <p className="text-[10px] text-muted-foreground/70">{t("desenhoTecnicoUploader.largeFilesHint")}</p>
                </div>
              </button>
              <input ref={fileInputRef} type="file" accept=".zip,application/zip" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) processZip(f); }} />
            </div>
          )}

          {results.length > 0 && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-3 text-center">
                  <p className="text-xl font-bold text-green-600">{counts.matched}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("desenhoTecnicoUploader.matched")}</p>
                </div>
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-center">
                  <p className="text-xl font-bold text-amber-600">{counts.noMatch}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("desenhoTecnicoUploader.noMatch")}</p>
                </div>
                <div className="rounded-xl border border-border/40 p-3 text-center">
                  <p className="text-xl font-bold">{counts.total}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("desenhoTecnicoUploader.pdfsInZip")}</p>
                </div>
              </div>
              {counts.fuzzy > 0 && (
                <p className="text-[11px] text-amber-600 flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3" /> {t("desenhoTecnicoUploader.fuzzyMatchWarning", { count: counts.fuzzy })}
                </p>
              )}
              {counts.duplicate > 0 && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <Copy className="h-3 w-3" /> {t("desenhoTecnicoUploader.duplicateWarning", { count: counts.duplicate })}
                </p>
              )}

              <div className="rounded-xl border border-border/40 overflow-hidden divide-y divide-border/20 max-h-72 overflow-y-auto">
                {results.map((r, i) => (
                  <div key={i} className={cn(
                    "flex items-center gap-3 px-3 py-2 text-[12px]",
                    r.status === "no_match"  && "bg-amber-500/5",
                    r.status === "duplicate" && "bg-muted/20",
                    r.status === "done"      && "bg-green-500/5",
                    r.status === "error"     && "bg-red-500/5",
                    r.fuzzy && r.status === "pending" && "bg-amber-500/5",
                  )}>
                    <FileText className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-mono font-medium truncate" title={r.zipPath}>{r.zipPath}</p>
                      {r.status === "no_match" ? (
                        <p className="text-amber-600 text-[10px]">{t("desenhoTecnicoUploader.noMatchDetail")}</p>
                      ) : r.status === "duplicate" ? (
                        <p className="text-muted-foreground text-[10px] truncate">{t("desenhoTecnicoUploader.alreadyMatchedBy", { ref: r.reference })}</p>
                      ) : r.status === "error" ? (
                        <p className="text-red-500 text-[10px] truncate">{r.error}</p>
                      ) : r.reference ? (
                        <p className={cn("text-[10px] truncate", r.fuzzy ? "text-amber-600" : "text-muted-foreground")}>
                          {r.fuzzy && "≈ "}{r.reference} · {r.model}{r.fuzzy && t("desenhoTecnicoUploader.approximate")}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0">{statusIcon(r.status)}</div>
                  </div>
                ))}
              </div>

              {!uploading && (
                <button onClick={resetar} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                  {t("desenhoTecnicoUploader.selectAnotherFile")}
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-border/30 shrink-0">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={uploading}>
            {done ? t("desenhoTecnicoUploader.close") : t("desenhoTecnicoUploader.cancel")}
          </Button>

          {counts.matched > 0 && !done && (
            <Button className="flex-1 gap-2" onClick={handleUpload} disabled={uploading}>
              {uploading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <ArrowUpCircle className="h-4 w-4" />}
              {uploading
                ? t("desenhoTecnicoUploader.sending")
                : t("desenhoTecnicoUploader.sendDrawings", { count: counts.matched, plural: counts.matched !== 1 ? "s" : "" })}
            </Button>
          )}

          {done && (
            <div className="flex-1 flex items-center justify-center gap-2 text-green-600 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4" />
              {t("desenhoTecnicoUploader.sentCount", { count: counts.done })}
              {counts.errors > 0 && (
                <span className="text-red-500 ml-2">{t("desenhoTecnicoUploader.errorsCount", { count: counts.errors, plural: counts.errors !== 1 ? "s" : "" })}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
