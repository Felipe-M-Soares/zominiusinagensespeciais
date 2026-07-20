/**
 * RecallPanel — Painel de recall ativo e alertas
 * Lista todos os items de rastreabilidade_pos_venda com status_recall
 * = 'alerta' ou 'recall_ativo' sem necessidade de busca.
 * Permite atualização em lote do status de recall.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { AlertTriangle, RefreshCw, CheckCircle2, Search, Download, Bell } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface RecallItem {
  id: string;
  lote: string;
  device_ref: string;
  device_model: string;
  udi_di: string | null;
  quantidade: number;
  cliente_nome: string;
  clinica: string | null;
  cirurgiao: string | null;
  data_envio: string;
  status_recall: string;
  observacoes: string | null;
  pedido_id: string;
}

function buildStatusConfig(t: (k: string) => string) {
  return {
  alerta:      { label: t("recallPanel.alertLabel"),       color: "text-amber-600", bg: "bg-amber-500/10 border-amber-500/20", dot: "bg-amber-500" },
  recall_ativo:{ label: t("recallPanel.recallActiveLabel"), color: "text-red-600",   bg: "bg-red-500/10 border-red-500/20",     dot: "bg-red-500 animate-pulse" },
  };
}

function fmtDate(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString("pt-BR");
}

export function RecallPanel() {
  const { t } = useTranslation();
  const STATUS_CONFIG = buildStatusConfig(t);
  const [items, setItems]       = useState<RecallItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filtro, setFiltro]     = useState<"todos" | "alerta" | "recall_ativo">("todos");
  const [search, setSearch]     = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [updating, setUpdating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("rastreabilidade_pos_venda")
        .select("id,lote,device_ref,device_model,udi_di,quantidade,cliente_nome,clinica,cirurgiao,data_envio,status_recall,observacoes,pedido_id")
        .in("status_recall", ["alerta", "recall_ativo"])
        .order("status_recall")
        .order("data_envio", { ascending: false });
      if (error) throw error;
      setItems((data as RecallItem[]) ?? []);
    } catch (err) {
      logger.error("RecallPanel: erro ao carregar", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    return items.filter(i => {
      if (filtro !== "todos" && i.status_recall !== filtro) return false;
      if (search) {
        const q = search.toLowerCase();
        return i.lote.toLowerCase().includes(q) ||
               i.device_ref.toLowerCase().includes(q) ||
               i.cliente_nome.toLowerCase().includes(q) ||
               (i.clinica ?? "").toLowerCase().includes(q);
      }
      return true;
    });
  }, [items, filtro, search]);

  const countAtivo = items.filter(i => i.status_recall === "recall_ativo").length;
  const countAlerta = items.filter(i => i.status_recall === "alerta").length;

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(i => i.id)));
    }
  }

  async function updateLote(novoStatus: string) {
    if (selected.size === 0) { toast.error(t("recallPanel.toastSelectAtLeastOne")); return; }
    setUpdating(true);
    const ids = [...selected];
    const { error } = await supabase
      .from("rastreabilidade_pos_venda")
      .update({ status_recall: novoStatus })
      .in("id", ids);
    setUpdating(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("recallPanel.toastUpdated", { count: ids.length, status: novoStatus }));
    setSelected(new Set());
    load();
  }

  function exportCSV() {
    const header = "lote,device_ref,cliente,clinica,data_envio,status\n";
    const rows = filtered.map(i =>
      [i.lote, i.device_ref, i.cliente_nome, i.clinica ?? "", i.data_envio, i.status_recall].join(",")
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `recall-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Resumo */}
      <div className="grid grid-cols-2 gap-3">
        <div className={cn("rounded-2xl border p-3", countAtivo > 0 ? "border-red-500/20 bg-red-500/5" : "border-border/40 bg-card")}>
          <div className="flex items-center gap-1.5">
            <AlertTriangle className={cn("h-4 w-4", countAtivo > 0 ? "text-red-600" : "text-muted-foreground")} />
            <p className="text-[10px] text-muted-foreground uppercase">{t("recallPanel.activeRecall")}</p>
          </div>
          <p className={cn("text-2xl font-black", countAtivo > 0 ? "text-red-600" : "text-foreground")}>{countAtivo}</p>
          <p className="text-[10px] text-muted-foreground">{t("recallPanel.unitsActiveRecall")}</p>
        </div>
        <div className={cn("rounded-2xl border p-3", countAlerta > 0 ? "border-amber-500/20 bg-amber-500/5" : "border-border/40 bg-card")}>
          <div className="flex items-center gap-1.5">
            <Bell className={cn("h-4 w-4", countAlerta > 0 ? "text-amber-600" : "text-muted-foreground")} />
            <p className="text-[10px] text-muted-foreground uppercase">{t("recallPanel.inAlert")}</p>
          </div>
          <p className={cn("text-2xl font-black", countAlerta > 0 ? "text-amber-600" : "text-foreground")}>{countAlerta}</p>
          <p className="text-[10px] text-muted-foreground">{t("recallPanel.unitsInAlert")}</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("recallPanel.searchPlaceholder")}
            className="w-full pl-8 pr-3 h-8 text-[12px] rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        {(["todos","recall_ativo","alerta"] as const).map(f => (
          <button key={f} onClick={() => setFiltro(f)}
            className={cn("h-8 px-3 rounded-lg text-[12px] font-medium border transition-colors",
              filtro === f ? "bg-primary text-primary-foreground border-primary" : "border-input hover:bg-muted/40")}>
            {f === "todos" ? t("recallPanel.all") : f === "recall_ativo" ? t("recallPanel.recallActiveLabel") : t("recallPanel.alertLabel")}
          </button>
        ))}
        <button onClick={load} className="h-8 w-8 flex items-center justify-center rounded-lg border border-input hover:bg-muted/40">
          <RefreshCw className={cn("h-3.5 w-3.5 text-muted-foreground", loading && "animate-spin")} />
        </button>
        <button onClick={exportCSV} className="h-8 px-3 rounded-lg border border-input text-[12px] flex items-center gap-1.5 hover:bg-muted/40">
          <Download className="h-3.5 w-3.5" /> {t("recallPanel.csv")}
        </button>
      </div>

      {/* Ações em lote */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/5 border border-primary/20">
          <p className="text-[12px] text-primary font-medium flex-1">{selected.size} {t("recallPanel.selected")}</p>
          {(["normal","alerta","recall_ativo","devolvido"] as const).map(s => (
            <button key={s} onClick={() => updateLote(s)} disabled={updating}
              className="h-7 px-2 rounded-lg text-[10px] font-medium border border-input hover:bg-muted/40 transition-colors disabled:opacity-50">
              → {t(`recallPanel.status.${s}`)}
            </button>
          ))}
        </div>
      )}

      {/* Lista */}
      {loading && items.length === 0 && (
        <div className="flex justify-center py-10">
          <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
          <CheckCircle2 className="h-10 w-10 text-emerald-500 opacity-40" />
          <p className="text-sm font-medium text-emerald-600">{t("recallPanel.noActiveRecall")}</p>
          <p className="text-[11px]">{t("recallPanel.allNormal")}</p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="space-y-1.5">
          {/* Selecionar todos */}
          <div className="flex items-center gap-2 px-1">
            <input type="checkbox"
              checked={selected.size === filtered.length && filtered.length > 0}
              onChange={toggleAll}
              className="h-3.5 w-3.5 rounded"
            />
            <p className="text-[11px] text-muted-foreground">{filtered.length} {t("recallPanel.records")}</p>
          </div>

          {filtered.map(item => {
            const cfg = STATUS_CONFIG[item.status_recall as keyof typeof STATUS_CONFIG];
            return (
              <div key={item.id}
                className={cn("rounded-2xl border overflow-hidden", cfg?.bg ?? "border-border/40 bg-card")}>
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <input type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggleSelect(item.id)}
                    className="h-3.5 w-3.5 rounded shrink-0"
                  />
                  <span className={cn("h-2 w-2 rounded-full shrink-0", cfg?.dot)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[12px] font-mono font-bold">{item.lote}</p>
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium border", cfg?.bg, cfg?.color)}>
                        {cfg?.label}
                      </span>
                      <p className="text-[11px] text-muted-foreground truncate">{item.device_ref} · {item.device_model}</p>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5 flex-wrap">
                      <span>{item.cliente_nome}</span>
                      {item.clinica && <span>· {item.clinica}</span>}
                      {item.cirurgiao && <span>· {t("recallPanel.drAbbrev")} {item.cirurgiao}</span>}
                      <span>· {item.quantidade} {t("recallPanel.shippedOn")} {fmtDate(item.data_envio)}</span>
                    </div>
                    {item.observacoes && <p className="text-[10px] text-muted-foreground/70 italic mt-0.5">{item.observacoes}</p>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
