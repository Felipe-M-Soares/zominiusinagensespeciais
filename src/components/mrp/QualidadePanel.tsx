/**
 * QualidadePanel — Não Conformidades / RNC (Módulo MRP)
 * Registro, análise e fechamento de não conformidades.
 */

import { useState, useEffect, useCallback } from "react";
import {
  ShieldCheck, Plus, Search, AlertTriangle, CheckCircle2,
  X, ChevronDown, Clock, XCircle, RefreshCw, User2, Calendar,
  Microscope, Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

// ── Tipos ─────────────────────────────────────────────────────────────────────

type NCStatus   = "aberta" | "em_analise" | "concluida" | "cancelada";
type NCGravidade = "baixa" | "media" | "alta" | "critica";
type NCTipo      = "produto" | "processo" | "fornecedor" | "cliente";
type NCOrigem    = "interna" | "cliente" | "auditoria" | "recebimento";

interface NaoConformidade {
  id: string;
  numero: string;
  tipo: NCTipo;
  origem: NCOrigem;
  descricao: string;
  gravidade: NCGravidade;
  status: NCStatus;
  acao_imediata: string | null;
  causa_raiz: string | null;
  acao_corretiva: string | null;
  responsavel_nome: string | null;
  prazo: string | null;
  concluida_em: string | null;
  created_at: string;
}

// ── Configs visuais ───────────────────────────────────────────────────────────

const STATUS_CFG: Record<NCStatus, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  aberta:     { label: "Aberta",      color: "text-destructive", bg: "bg-destructive/10", Icon: AlertTriangle },
  em_analise: { label: "Em Análise",  color: "text-amber-500",   bg: "bg-amber-500/10",   Icon: Microscope   },
  concluida:  { label: "Concluída",   color: "text-success",     bg: "bg-success/10",     Icon: CheckCircle2 },
  cancelada:  { label: "Cancelada",   color: "text-muted-foreground", bg: "bg-muted/10",  Icon: XCircle      },
};

const GRAV_CFG: Record<NCGravidade, { label: string; color: string; dot: string }> = {
  baixa:   { label: "Baixa",    color: "text-muted-foreground", dot: "bg-muted-foreground/40" },
  media:   { label: "Média",    color: "text-amber-500",        dot: "bg-amber-400"           },
  alta:    { label: "Alta",     color: "text-orange-500",       dot: "bg-orange-400"          },
  critica: { label: "Crítica",  color: "text-destructive",      dot: "bg-destructive"         },
};

// ── KPI Strip ─────────────────────────────────────────────────────────────────
function NCKPIs({ ncs }: { ncs: NaoConformidade[] }) {
  const abertas    = ncs.filter(n => n.status === "aberta").length;
  const analise    = ncs.filter(n => n.status === "em_analise").length;
  const criticas   = ncs.filter(n => n.gravidade === "critica" && n.status !== "concluida" && n.status !== "cancelada").length;
  const concluidas = ncs.filter(n => n.status === "concluida").length;

  const stats = [
    { label: "Abertas",    value: abertas,    color: "text-destructive" },
    { label: "Em análise", value: analise,    color: "text-amber-500"   },
    { label: "Críticas",   value: criticas,   color: "text-orange-500"  },
    { label: "Concluídas", value: concluidas, color: "text-success"     },
  ];

  return (
    <div className="grid grid-cols-4 gap-2">
      {stats.map(s => (
        <div key={s.label} className="rounded-2xl border bg-card/60 p-3 text-center">
          <p className={cn("text-2xl font-bold tabular-nums", s.color)}>{s.value}</p>
          <p className="text-[10px] text-muted-foreground/70 mt-0.5">{s.label}</p>
        </div>
      ))}
    </div>
  );
}

// ── NC Card ───────────────────────────────────────────────────────────────────
function NCCard({ nc, onUpdate }: { nc: NaoConformidade; onUpdate: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [updating, setUpdating] = useState(false);
  const cfg  = STATUS_CFG[nc.status];
  const grav = GRAV_CFG[nc.gravidade];

  async function changeStatus(newStatus: NCStatus) {
    setUpdating(true);
    const patch: Record<string, unknown> = { status: newStatus };
    if (newStatus === "concluida") patch.concluida_em = new Date().toISOString();
    const { error } = await supabase.from("nao_conformidades").update(patch).eq("id", nc.id);
    if (error) toast.error("Erro ao atualizar RNC.");
    else { toast.success(`RNC ${newStatus === "concluida" ? "concluída" : "atualizada"}!`); onUpdate(); }
    setUpdating(false);
  }

  const atrasada = nc.prazo && nc.status !== "concluida" && nc.status !== "cancelada"
    && new Date(nc.prazo) < new Date();

  return (
    <div className={cn("rounded-2xl border bg-card/80 overflow-hidden transition-all",
      atrasada && "border-destructive/40")}>
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        {/* Status icon */}
        <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0", cfg.bg)}>
          <cfg.Icon className={cn("h-5 w-5", cfg.color)} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] font-bold text-muted-foreground">{nc.numero}</span>
            <Badge className={cn("text-[10px] h-4 px-1.5 border-0", cfg.bg, cfg.color)}>
              {cfg.label}
            </Badge>
            <span className="flex items-center gap-1 text-[10px] font-semibold">
              <span className={cn("h-2 w-2 rounded-full shrink-0", grav.dot)} />
              <span className={grav.color}>{grav.label}</span>
            </span>
            {atrasada && <AlertTriangle className="h-3.5 w-3.5 text-destructive" title="Prazo vencido" />}
          </div>
          <p className="text-[13px] font-medium truncate mt-0.5">{nc.descricao}</p>
          <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
            <span>{nc.tipo} · {nc.origem}</span>
            {nc.responsavel_nome && (
              <span className="flex items-center gap-1">
                <User2 className="h-3 w-3" />{nc.responsavel_nome}
              </span>
            )}
            {nc.prazo && (
              <span className={cn("flex items-center gap-1", atrasada && "text-destructive font-medium")}>
                <Calendar className="h-3 w-3" />
                {new Date(nc.prazo).toLocaleDateString("pt-BR")}
              </span>
            )}
          </div>
        </div>

        <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform",
          expanded && "rotate-180")} />
      </div>

      {expanded && (
        <div className="border-t border-border/20 px-4 pb-4 pt-3 space-y-3 animate-in slide-in-from-top-1 duration-150">
          {nc.acao_imediata && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Ação Imediata</p>
              <p className="text-[12px]">{nc.acao_imediata}</p>
            </div>
          )}
          {nc.causa_raiz && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Causa Raiz</p>
              <p className="text-[12px]">{nc.causa_raiz}</p>
            </div>
          )}
          {nc.acao_corretiva && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Ação Corretiva</p>
              <p className="text-[12px]">{nc.acao_corretiva}</p>
            </div>
          )}

          {/* Ações de status */}
          {nc.status !== "concluida" && nc.status !== "cancelada" && (
            <div className="flex gap-2 pt-1 border-t border-border/20">
              {nc.status === "aberta" && (
                <button onClick={() => changeStatus("em_analise")} disabled={updating}
                  className="flex-1 py-1.5 rounded-xl text-[12px] font-medium bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 transition-colors">
                  <Microscope className="h-3.5 w-3.5 inline mr-1" />Iniciar Análise
                </button>
              )}
              {nc.status === "em_analise" && (
                <button onClick={() => changeStatus("concluida")} disabled={updating}
                  className="flex-1 py-1.5 rounded-xl text-[12px] font-medium bg-success/10 text-success hover:bg-success/20 transition-colors">
                  <CheckCircle2 className="h-3.5 w-3.5 inline mr-1" />Concluir RNC
                </button>
              )}
              <button onClick={() => changeStatus("cancelada")} disabled={updating}
                className="px-3 py-1.5 rounded-xl text-[12px] font-medium bg-muted/30 text-muted-foreground hover:bg-muted/50 transition-colors">
                Cancelar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── NovaNCModal ───────────────────────────────────────────────────────────────
function NovaNCModal({ open, onClose, onSaved }: {
  open: boolean; onClose: () => void; onSaved: () => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    tipo: "produto" as NCTipo,
    origem: "interna" as NCOrigem,
    descricao: "",
    gravidade: "media" as NCGravidade,
    acao_imediata: "",
    responsavel_nome: "",
    prazo: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm({
      tipo: "produto", origem: "interna", descricao: "", gravidade: "media",
      acao_imediata: "", responsavel_nome: "", prazo: "",
    });
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    if (!form.descricao.trim()) { toast.error("Descrição obrigatória"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("nao_conformidades").insert({
        tipo: form.tipo,
        origem: form.origem,
        descricao: form.descricao.trim(),
        gravidade: form.gravidade,
        acao_imediata: form.acao_imediata || null,
        responsavel_nome: form.responsavel_nome || null,
        prazo: form.prazo || null,
        numero: "",  // trigger gera automaticamente
        created_by: user?.id,
        responsavel_id: user?.id,
      });
      if (error) throw error;
      toast.success("RNC registrada!");
      onSaved(); onClose();
    } catch { toast.error("Erro ao registrar RNC."); }
    finally { setSaving(false); }
  }

  const selectClass = "w-full h-9 pr-8 pl-3 rounded-xl border border-input bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40 sticky top-0 bg-background z-10">
          <p className="font-semibold text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-destructive" /> Nova Não Conformidade (RNC)
          </p>
          <button onClick={onClose} className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-muted/40 transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tipo</label>
              <div className="relative">
                <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as NCTipo }))}
                  className={selectClass}>
                  <option value="produto">Produto</option>
                  <option value="processo">Processo</option>
                  <option value="fornecedor">Fornecedor</option>
                  <option value="cliente">Cliente</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Origem</label>
              <div className="relative">
                <select value={form.origem} onChange={e => setForm(f => ({ ...f, origem: e.target.value as NCOrigem }))}
                  className={selectClass}>
                  <option value="interna">Interna</option>
                  <option value="cliente">Cliente</option>
                  <option value="auditoria">Auditoria</option>
                  <option value="recebimento">Recebimento</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Gravidade</label>
            <div className="flex gap-2">
              {(["baixa","media","alta","critica"] as NCGravidade[]).map(g => (
                <button key={g} type="button" onClick={() => setForm(f => ({ ...f, gravidade: g }))}
                  className={cn("flex-1 py-1.5 rounded-xl border text-[11px] font-semibold capitalize transition-colors",
                    form.gravidade === g
                      ? cn(GRAV_CFG[g].color, "border-current bg-current/10")
                      : "text-muted-foreground border-border hover:bg-muted/30")}>
                  <span className={cn("inline-block h-1.5 w-1.5 rounded-full mr-1", GRAV_CFG[g].dot)} />
                  {GRAV_CFG[g].label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Descrição da Não Conformidade *</label>
            <textarea value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
              className="w-full h-24 rounded-xl border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Descreva o problema identificado, onde ocorreu, quando foi detectado..." />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ação Imediata / Contenção</label>
            <textarea value={form.acao_imediata} onChange={e => setForm(f => ({ ...f, acao_imediata: e.target.value }))}
              className="w-full h-16 rounded-xl border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="O que foi feito imediatamente para conter o problema..." />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Responsável</label>
              <Input value={form.responsavel_nome} onChange={e => setForm(f => ({ ...f, responsavel_nome: e.target.value }))}
                placeholder="Nome do responsável" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Prazo</label>
              <Input type="date" value={form.prazo} onChange={e => setForm(f => ({ ...f, prazo: e.target.value }))}
                className="h-9" />
            </div>
          </div>
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-border/40">
          <Button variant="outline" onClick={onClose} className="flex-1 h-9">Cancelar</Button>
          <Button onClick={handleSave} disabled={saving} className="flex-1 h-9 bg-destructive hover:bg-destructive/90">
            {saving ? "Registrando..." : "Registrar RNC"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────
export function QualidadePanel() {
  const [ncs, setNcs] = useState<NaoConformidade[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<NCStatus | "todas">("todas");
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("nao_conformidades")
      .select("*").order("created_at", { ascending: false });
    setNcs((data ?? []) as NaoConformidade[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = ncs.filter(n => {
    if (statusFilter !== "todas" && n.status !== statusFilter) return false;
    const q = search.toLowerCase();
    return !q || n.numero.toLowerCase().includes(q)
      || n.descricao.toLowerCase().includes(q)
      || (n.responsavel_nome ?? "").toLowerCase().includes(q);
  });

  const STATUS_OPTS: Array<{ value: NCStatus | "todas"; label: string }> = [
    { value: "todas",      label: "Todas"       },
    { value: "aberta",     label: "Abertas"     },
    { value: "em_analise", label: "Em Análise"  },
    { value: "concluida",  label: "Concluídas"  },
    { value: "cancelada",  label: "Canceladas"  },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-destructive" />
          <h2 className="font-semibold text-sm">Não Conformidades (RNC)</h2>
          <Badge variant="outline" className="text-[10px]">{filtered.length}</Badge>
        </div>
        <div className="flex gap-2">
          <button onClick={load}
            className="h-8 w-8 rounded-xl border flex items-center justify-center hover:bg-muted/40 transition-colors">
            <RefreshCw className={cn("h-3.5 w-3.5 text-muted-foreground", loading && "animate-spin")} />
          </button>
          <Button size="sm" className="h-8 gap-1.5 bg-destructive hover:bg-destructive/90"
            onClick={() => setModalOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Nova RNC
          </Button>
        </div>
      </div>

      {!loading && <NCKPIs ncs={ncs} />}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por número, descrição ou responsável..."
            className="pl-9 h-9 text-sm" />
        </div>
        <div className="relative">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as NCStatus | "todas")}
            className="h-9 pr-8 pl-3 rounded-xl border border-input bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer">
            {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="rounded-2xl border p-4 flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-64" />
                <Skeleton className="h-3 w-36" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed py-16 text-center space-y-2">
          <ShieldCheck className="h-8 w-8 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground/60">
            {search || statusFilter !== "todas" ? "Nenhuma RNC encontrada" : "Nenhuma não conformidade registrada"}
          </p>
          {!search && statusFilter === "todas" && (
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setModalOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Registrar primeira RNC
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(nc => (
            <NCCard key={nc.id} nc={nc} onUpdate={load} />
          ))}
        </div>
      )}

      <NovaNCModal open={modalOpen} onClose={() => setModalOpen(false)} onSaved={load} />
    </div>
  );
}
