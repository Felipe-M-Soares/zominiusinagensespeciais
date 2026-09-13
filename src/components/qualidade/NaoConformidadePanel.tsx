/**
 * NaoConformidadePanel — aba "Não Conformidade" dentro de Qualidade.
 *
 * Fluxo:
 *  1. Qualquer setor abre uma NC (ver ReportarNaoConformidadeModal, botão
 *     global disponível no menu lateral para todos os usuários).
 *  2. Aparece aqui como "Aberta". A Qualidade analisa e decide entre abrir
 *     uma Ocorrência (registro simples) ou uma RNC (Relatório de Não
 *     Conformidade — tratamento formal), via RPC decidir_nao_conformidade.
 *  3. Depois de tratada, a Qualidade registra a ação corretiva e encerra,
 *     via RPC encerrar_nao_conformidade.
 *
 * Quando a NC envolve peça, mostra a referência/modelo/lote vinculados —
 * a mesma rastreabilidade usada no resto do módulo de Qualidade/Estoque.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle, Loader2, Package, ClipboardList, FileWarning,
  CheckCircle2, Clock, User, RefreshCw, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { ROLE_LABELS, type AppRole } from "@/types/roles";

type NcStatus = "aberta" | "em_analise" | "decidida" | "encerrada";
type NcDecisao = "ocorrencia" | "rnc" | null;

interface NaoConformidade {
  id: string;
  numero: string;
  setor_origem: AppRole;
  aberto_por_nome: string | null;
  titulo: string;
  descricao: string;
  envolve_peca: boolean;
  device_id: string | null;
  lote: string | null;
  quantidade_afetada: number | null;
  status: NcStatus;
  decisao: NcDecisao;
  numero_decisao: string | null;
  analise_qualidade: string | null;
  acao_corretiva: string | null;
  decidido_por_nome: string | null;
  decidido_em: string | null;
  encerrado_em: string | null;
  created_at: string;
  devices?: { reference: string; model: string } | null;
}

const STATUS_CONFIG: Record<NcStatus, { label: string; color: string; bg: string; border: string }> = {
  aberta:      { label: "Aberta",      color: "text-red-500",    bg: "bg-red-500/10",    border: "border-red-500/30" },
  em_analise:  { label: "Em análise",  color: "text-amber-500",  bg: "bg-amber-500/10",  border: "border-amber-500/30" },
  decidida:    { label: "Decidida",    color: "text-blue-500",   bg: "bg-blue-500/10",   border: "border-blue-500/30" },
  encerrada:   { label: "Encerrada",   color: "text-emerald-500",bg: "bg-emerald-500/10",border: "border-emerald-500/30" },
};

const FILTERS: { id: NcStatus | "todas"; label: string }[] = [
  { id: "todas",     label: "Todas" },
  { id: "aberta",    label: "Abertas" },
  { id: "decidida",  label: "Decididas" },
  { id: "encerrada", label: "Encerradas" },
];

export function NaoConformidadePanel() {
  const [items, setItems] = useState<NaoConformidade[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<NcStatus | "todas">("todas");
  const [selected, setSelected] = useState<NaoConformidade | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("nao_conformidades")
        .select("*, devices(reference, model)")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      setItems((data as unknown as NaoConformidade[]) ?? []);
    } catch (err) {
      logger.error("NaoConformidadePanel load error:", err);
      toast.error("Erro ao carregar não conformidades.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel("nao-conformidades-panel")
      .on("postgres_changes", { event: "*", schema: "public", table: "nao_conformidades" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const filtered = useMemo(
    () => (filtro === "todas" ? items : items.filter((i) => i.status === filtro)),
    [items, filtro]
  );

  const counts = useMemo(() => ({
    aberta: items.filter((i) => i.status === "aberta").length,
    decidida: items.filter((i) => i.status === "decidida").length,
  }), [items]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFiltro(f.id)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                filtro === f.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:bg-muted/50"
              )}
            >
              {f.label}
              {f.id === "aberta" && counts.aberta > 0 && (
                <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 text-white text-[10px] px-1">
                  {counts.aberta}
                </span>
              )}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Atualizar
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 space-y-1">
          <ClipboardList className="h-8 w-8 text-muted-foreground/40 mx-auto" />
          <p className="text-muted-foreground text-sm">Nenhuma não conformidade encontrada.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((nc) => {
            const st = STATUS_CONFIG[nc.status];
            return (
              <button
                key={nc.id}
                onClick={() => setSelected(nc)}
                className="w-full text-left rounded-xl border border-border/50 bg-card hover:bg-muted/30 transition-colors p-3.5 flex items-start gap-3"
              >
                <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", st.bg)}>
                  <AlertTriangle className={cn("h-4.5 w-4.5", st.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-semibold text-muted-foreground">{nc.numero}</span>
                    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full border", st.color, st.bg, st.border)}>
                      {st.label}
                    </span>
                    {nc.numero_decisao && (
                      <span className="text-[10px] font-mono font-semibold text-primary">{nc.numero_decisao}</span>
                    )}
                  </div>
                  <p className="text-sm font-medium mt-1 truncate">{nc.titulo}</p>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1"><User className="h-3 w-3" />{nc.aberto_por_nome ?? "—"} · {ROLE_LABELS[nc.setor_origem] ?? nc.setor_origem}</span>
                    {nc.envolve_peca && nc.devices && (
                      <span className="flex items-center gap-1"><Package className="h-3 w-3" />{nc.devices.reference}{nc.lote ? ` · lote ${nc.lote}` : ""}</span>
                    )}
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(nc.created_at).toLocaleDateString("pt-BR")}</span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0 mt-2.5" />
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <NcDetailModal nc={selected} onClose={() => setSelected(null)} onChanged={load} />
      )}
    </div>
  );
}

// ─── Modal de detalhe / decisão / encerramento ───────────────────────────────

function NcDetailModal({ nc, onClose, onChanged }: { nc: NaoConformidade; onClose: () => void; onChanged: () => void }) {
  const [analise, setAnalise] = useState(nc.analise_qualidade ?? "");
  const [acaoCorretiva, setAcaoCorretiva] = useState(nc.acao_corretiva ?? "");
  const [saving, setSaving] = useState(false);
  const st = STATUS_CONFIG[nc.status];

  async function decidir(decisao: "ocorrencia" | "rnc") {
    if (analise.trim().length < 5) {
      toast.error("Descreva a análise da Qualidade antes de decidir.");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("decidir_nao_conformidade", {
        p_id: nc.id, p_decisao: decisao, p_analise: analise.trim(),
      });
      const result = data as { ok?: boolean; error?: string; numero_decisao?: string } | null;
      if (error || result?.ok === false) {
        toast.error(result?.error ?? "Erro ao registrar decisão.");
        return;
      }
      toast.success(`${decisao === "rnc" ? "RNC" : "Ocorrência"} aberta: ${result?.numero_decisao}`);
      onChanged();
      onClose();
    } catch {
      toast.error("Erro ao registrar decisão.");
    } finally {
      setSaving(false);
    }
  }

  async function encerrar() {
    if (acaoCorretiva.trim().length < 5) {
      toast.error("Descreva a ação corretiva antes de encerrar.");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("encerrar_nao_conformidade", {
        p_id: nc.id, p_acao_corretiva: acaoCorretiva.trim(),
      });
      const result = data as { ok?: boolean; error?: string } | null;
      if (error || result?.ok === false) {
        toast.error(result?.error ?? "Erro ao encerrar.");
        return;
      }
      toast.success("Não conformidade encerrada.");
      onChanged();
      onClose();
    } catch {
      toast.error("Erro ao encerrar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileWarning className="h-4.5 w-4.5 text-orange-500" />
            {nc.numero}
            <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full border ml-1", st.color, st.bg, st.border)}>
              {st.label}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold">{nc.titulo}</p>
            <p className="text-[13px] text-muted-foreground mt-1 whitespace-pre-wrap">{nc.descricao}</p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <p className="text-muted-foreground">Aberta por</p>
              <p className="font-medium">{nc.aberto_por_nome ?? "—"}</p>
            </div>
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <p className="text-muted-foreground">Setor de origem</p>
              <p className="font-medium">{ROLE_LABELS[nc.setor_origem] ?? nc.setor_origem}</p>
            </div>
          </div>

          {nc.envolve_peca && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 space-y-0.5">
              <p className="text-[11px] font-medium text-primary flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5" /> Peça envolvida (rastreabilidade)
              </p>
              <p className="text-sm font-medium">{nc.devices?.reference ?? "—"} — {nc.devices?.model ?? ""}</p>
              <div className="flex gap-4 text-[12px] text-muted-foreground pt-0.5">
                {nc.lote && <span>Lote: <span className="font-mono">{nc.lote}</span></span>}
                {nc.quantidade_afetada != null && <span>Qtd. afetada: {nc.quantidade_afetada}</span>}
              </div>
            </div>
          )}

          {nc.status === "aberta" && (
            <div className="space-y-3 pt-1 border-t border-border/40">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  Análise da Qualidade
                </Label>
                <Textarea
                  value={analise}
                  onChange={(e) => setAnalise(e.target.value)}
                  placeholder="O que foi verificado, causa provável..."
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => decidir("ocorrencia")} disabled={saving} className="gap-1.5">
                  <ClipboardList className="h-4 w-4" /> Abrir Ocorrência
                </Button>
                <Button onClick={() => decidir("rnc")} disabled={saving} className="gap-1.5 bg-orange-500 hover:bg-orange-600">
                  <FileWarning className="h-4 w-4" /> Abrir RNC
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Ocorrência: registro simples, sem necessidade de plano formal. RNC: tratamento formal
                (Relatório de Não Conformidade), com ação corretiva obrigatória antes de encerrar.
              </p>
            </div>
          )}

          {(nc.status === "decidida" || nc.status === "encerrada") && (
            <div className="rounded-lg bg-muted/40 px-3 py-2.5 space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                Decisão da Qualidade
              </p>
              <p className="text-sm">
                <span className="font-mono font-semibold">{nc.numero_decisao}</span>
                {" — "}
                {nc.decisao === "rnc" ? "RNC (tratamento formal)" : "Ocorrência (registro simples)"}
              </p>
              {nc.analise_qualidade && <p className="text-[12.5px] text-muted-foreground whitespace-pre-wrap">{nc.analise_qualidade}</p>}
              <p className="text-[11px] text-muted-foreground pt-1">Decidido por {nc.decidido_por_nome} em {nc.decidido_em ? new Date(nc.decidido_em).toLocaleString("pt-BR") : "—"}</p>
            </div>
          )}

          {nc.status === "decidida" && (
            <div className="space-y-2 pt-1 border-t border-border/40">
              <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                Ação corretiva (obrigatória para encerrar)
              </Label>
              <Textarea
                value={acaoCorretiva}
                onChange={(e) => setAcaoCorretiva(e.target.value)}
                placeholder="O que foi feito para corrigir e evitar recorrência..."
                rows={3}
              />
              <Button className="w-full gap-1.5" onClick={encerrar} disabled={saving}>
                <CheckCircle2 className="h-4 w-4" /> Encerrar não conformidade
              </Button>
            </div>
          )}

          {nc.status === "encerrada" && nc.acao_corretiva && (
            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-3 py-2.5 space-y-1">
              <p className="text-[11px] font-medium text-emerald-600 uppercase tracking-wide">Ação corretiva</p>
              <p className="text-[12.5px] whitespace-pre-wrap">{nc.acao_corretiva}</p>
              <p className="text-[11px] text-muted-foreground pt-1">Encerrada em {nc.encerrado_em ? new Date(nc.encerrado_em).toLocaleString("pt-BR") : "—"}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
