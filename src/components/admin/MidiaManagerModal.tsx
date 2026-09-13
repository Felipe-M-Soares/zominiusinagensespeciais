/**
 * MidiaManagerModal — Gerenciar (e excluir) imagens ou desenhos técnicos já
 * enviados para as peças do catálogo.
 *
 * Abre a partir do "X" ao lado dos botões "Imagens" / "Desenhos" em
 * AdminDevices.tsx (página só acessível por admin). Permite:
 *  - Excluir individualmente a mídia de uma peça específica
 *  - Excluir todas as mídias do tipo de uma vez (com confirmação por texto)
 *
 * Remove tanto o arquivo do Storage quanto a referência na tabela `devices`
 * (icon_url para imagens, desenho_tecnico_path para desenhos).
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileImage, FileText, Trash2, X, ShieldAlert, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import type { TablesUpdate } from "@/integrations/supabase/types";

type Tipo = "imagem" | "desenho";

interface DeviceMidia {
  id: string;
  reference: string;
  model: string;
  path: string; // path relativo no bucket (extraído da URL, no caso de imagem)
  url: string;  // valor bruto do campo no banco (URL pública ou path)
}

const CONFIG: Record<Tipo, {
  bucket: string;
  column: "icon_url" | "desenho_tecnico_path";
  label: string;
  labelPlural: string;
  icon: React.ElementType;
  accent: string;
}> = {
  imagem: {
    bucket: "devices-images",
    column: "icon_url",
    label: "imagem",
    labelPlural: "Imagens",
    icon: FileImage,
    accent: "violet",
  },
  desenho: {
    bucket: "desenhos-tecnicos",
    column: "desenho_tecnico_path",
    label: "desenho técnico",
    labelPlural: "Desenhos Técnicos",
    icon: FileText,
    accent: "primary",
  },
};

/** Extrai o path relativo dentro do bucket a partir de uma public URL do Storage. */
function extractStoragePath(bucket: string, value: string): string {
  const marker = `/object/public/${bucket}/`;
  const idx = value.indexOf(marker);
  if (idx === -1) return value; // já é um path puro (caso dos desenhos)
  return decodeURIComponent(value.slice(idx + marker.length));
}

interface MidiaManagerModalProps {
  tipo: Tipo;
  onClose: () => void;
  onChanged?: () => void;
}

export function MidiaManagerModal({ tipo, onClose, onChanged }: MidiaManagerModalProps) {
  const cfg = CONFIG[tipo];
  const Icon = cfg.icon;

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<DeviceMidia[]>([]);
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllTyped, setDeleteAllTyped] = useState("");
  const [deletingAll, setDeletingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("devices")
        .select(`id, reference, model, ${cfg.column}`)
        .not(cfg.column, "is", null)
        .order("reference", { ascending: true })
        .limit(5000);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Record<string, string>[];
      setItems(
        rows.map((r) => {
          const raw = r[cfg.column] as string;
          return {
            id: r.id,
            reference: r.reference,
            model: r.model,
            url: raw,
            path: extractStoragePath(cfg.bucket, raw),
          };
        })
      );
    } catch (err) {
      logger.error("MidiaManagerModal load error:", err);
      toast.error("Erro ao carregar lista de mídias.");
    } finally {
      setLoading(false);
    }
  }, [cfg.column, cfg.bucket]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => i.reference.toLowerCase().includes(q) || i.model.toLowerCase().includes(q)
    );
  }, [items, search]);

  async function handleDeleteOne(item: DeviceMidia) {
    setDeletingId(item.id);
    try {
      const { error: storageErr } = await supabase.storage.from(cfg.bucket).remove([item.path]);
      // Não bloqueia por erro de storage isolado (arquivo pode já não existir) —
      // o que importa é garantir que a referência no banco seja limpa.
      if (storageErr) logger.error("MidiaManagerModal storage.remove error:", storageErr.message);

      const patch = { [cfg.column]: null } as unknown as TablesUpdate<"devices">;
      const { error: dbErr } = await supabase
        .from("devices")
        .update(patch)
        .eq("id", item.id);
      if (dbErr) throw dbErr;

      setItems((prev) => prev.filter((i) => i.id !== item.id));
      toast.success(`${cfg.label === "imagem" ? "Imagem" : "Desenho"} removido de ${item.reference}.`);
      onChanged?.();
    } catch (err) {
      logger.error("MidiaManagerModal delete one error:", err);
      toast.error("Erro ao excluir.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDeleteAll() {
    if (deleteAllTyped.trim().toUpperCase() !== "EXCLUIR") return;
    setDeletingAll(true);
    try {
      const allPaths = items.map((i) => i.path).filter(Boolean);

      // Remove do Storage em lotes (limite prático por chamada)
      const CHUNK = 100;
      for (let i = 0; i < allPaths.length; i += CHUNK) {
        const chunk = allPaths.slice(i, i + CHUNK);
        const { error } = await supabase.storage.from(cfg.bucket).remove(chunk);
        if (error) logger.error("MidiaManagerModal bulk storage.remove error:", error.message);
      }

      // Limpa a referência no banco para todas as peças afetadas
      const ids = items.map((i) => i.id);
      const bulkPatch = { [cfg.column]: null } as unknown as TablesUpdate<"devices">;
      const DB_BATCH = 500;
      for (let i = 0; i < ids.length; i += DB_BATCH) {
        const { error } = await supabase
          .from("devices")
          .update(bulkPatch)
          .in("id", ids.slice(i, i + DB_BATCH));
        if (error) throw error;
      }

      toast.success(`Todas as ${cfg.labelPlural.toLowerCase()} foram excluídas (${ids.length}).`);
      setItems([]);
      onChanged?.();
      setDeleteAllOpen(false);
      setDeleteAllTyped("");
    } catch (err) {
      logger.error("MidiaManagerModal delete all error:", err);
      toast.error("Erro ao excluir todas as mídias.");
    } finally {
      setDeletingAll(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-4.5 w-4.5" />
            Gerenciar {cfg.labelPlural}
          </DialogTitle>
        </DialogHeader>

        {!deleteAllOpen ? (
          <>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Buscar por referência ou modelo..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-9 text-sm"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive border-destructive/40 hover:bg-destructive/10 shrink-0"
                onClick={() => setDeleteAllOpen(true)}
                disabled={items.length === 0 || loading}
              >
                <ShieldAlert className="h-3.5 w-3.5 mr-1" />
                Excluir todas
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              {loading ? "Carregando..." : `${items.length} peça(s) com ${cfg.label} cadastrado.`}
            </p>

            <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-1">
              {loading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-10">
                  Nenhuma peça encontrada.
                </p>
              ) : (
                filtered.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2 hover:bg-muted/40 transition-colors"
                  >
                    {tipo === "imagem" ? (
                      <img
                        src={item.url}
                        alt=""
                        className="h-8 w-8 rounded object-contain bg-white border border-border/30 shrink-0"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center shrink-0">
                        <FileText className="h-4 w-4 text-primary" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.reference}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{item.model}</p>
                    </div>
                    <button
                      type="button"
                      title={`Excluir ${cfg.label} desta peça`}
                      onClick={() => handleDeleteOne(item)}
                      disabled={deletingId === item.id}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0 disabled:opacity-50"
                    >
                      {deletingId === item.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-2">
              <p className="text-sm font-semibold text-destructive flex items-center gap-1.5">
                <ShieldAlert className="h-4 w-4" /> Excluir TODAS as {cfg.labelPlural.toLowerCase()}?
              </p>
              <p className="text-[12.5px] text-muted-foreground">
                Isso vai remover permanentemente {items.length} arquivo(s) do Storage e limpar a
                referência de {cfg.label} de todas as peças afetadas. Essa ação não pode ser desfeita.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                Digite EXCLUIR para confirmar
              </label>
              <Input
                value={deleteAllTyped}
                onChange={(e) => setDeleteAllTyped(e.target.value)}
                placeholder="EXCLUIR"
                className="h-9"
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => { setDeleteAllOpen(false); setDeleteAllTyped(""); }}
                disabled={deletingAll}
              >
                Voltar
              </Button>
              <Button
                type="button"
                variant="destructive"
                className={cn("flex-1")}
                onClick={handleDeleteAll}
                disabled={deletingAll || deleteAllTyped.trim().toUpperCase() !== "EXCLUIR"}
              >
                {deletingAll ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
                Excluir tudo
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
