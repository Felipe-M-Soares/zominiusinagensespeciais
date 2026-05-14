/**
 * OrdensProducaoPanel — Ordens de Produção (Módulo MRP)
 * Criação, acompanhamento e mudança de status de OPs.
 */

import { useState, useEffect, useCallback } from "react";
import {
  ClipboardList, Plus, Search, ChevronRight, Clock, CheckCircle2,
  PlayCircle, PauseCircle, XCircle, AlertTriangle, X, ChevronDown, RefreshCw,
  Factory, Calendar, User2, Package,
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

type OPStatus = "planejada" | "em_producao" | "pausada" | "concluida" | "cancelada";
type Prioridade = "baixa" | "normal" | "alta" | "urgente";

interface OrdemProducao {
  id: string;
  numero: string;
  device_id: string;
  device_model?: string;
  quantidade: number;
  status: OPStatus;
  prioridade: Prioridade;
  data_inicio_prev: string | null;
  data_fim_prev: string | null;
  data_inicio_real: string | null;
  data_fim_real: string | null;
  responsavel_nome: string | null;
  lote_producao: string | null;
  observacoes: string | null;
  created_at: string;
}

interface Device { id: string; model: string; }

// ── Config visual de status ───────────────────────────────────────────────────
const STATUS_CFG: Record<OPStatus, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  planejada:    { label: "Planejada",    color: "text-blue-500",   bg: "bg-blue-500/10",   Icon: Clock        },
  em_producao:  { label: "Em Produção",  color: "text-green-500",  bg: "bg-green-500/10",  Icon: PlayCircle   },
  pausada:      { label: "Pausada",      color: "text-amber-500",  bg: "bg-amber-500/10",  Icon: PauseCircle  },
  concluida:    { label: "Concluída",    color: "text-primary",    bg: "bg-primary/10",    Icon: CheckCircle2 },
  cancelada:    { label: "Cancelada",    color: "text-destructive",bg: "bg-destructive/10",Icon: XCircle      },
};

const PRIO_CFG: Record<Prioridade, { label: string; color: string }> = {
  baixa:   { label: "Baixa",   color: "text-muted-foreground" },
  normal:  { label: "Normal",  color: "text-blue-500"         },
  alta:    { label: "Alta",    color: "text-amber-500"        },
  urgente: { label: "Urgente", color: "text-destructive"      },
};

// ── NovaOPModal ───────────────────────────────────────────────────────────────
function NovaOPModal({ open, onClose, onSaved, devices }: {
  open: boolean; onClose: () => void; onSaved: () => void; devices: Device[];
}) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    device_id: "", quantidade: 1, prioridade: "normal" as Prioridade,
    data_inicio_prev: "", data_fim_prev: "", observacoes: "",
    lote_producao: "", responsavel_nome: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm({ device_id: "", quantidade: 1, prioridade: "normal",
      data_inicio_prev: "", data_fim_prev: "", observacoes: "", lote_producao: "", responsavel_nome: "" });
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    if (!form.device_id) { toast.error("Selecione o produto"); return; }
    if (form.quantidade < 1) { toast.error("Quantidade inválida"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("ordens_producao").insert({
        device_id: form.device_id,
        quantidade: form.quantidade,
        prioridade: form.prioridade,
        data_inicio_prev: form.data_inicio_prev || null,
        data_fim_prev: form.data_fim_prev || null,
        observacoes: form.observacoes || null,
        lote_producao: form.lote_producao || null,
        responsavel_nome: form.responsavel_nome || null,
        numero: "",  // trigger gera automaticamente
        created_by: user?.id,
      });
      if (error) throw error;
      toast.success("Ordem de Produção criada!");
      onSaved();
      onClose();
    } catch { toast.error("Erro ao criar OP."); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40 sticky top-0 bg-background z-10">
          <div className="flex items-center gap-2">
            <Factory className="h-4 w-4 text-primary" />
            <p className="font-semibold text-sm">Nova Ordem de Produção</p>
          </div>
          <button onClick={onClose} className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-muted/40 transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Produto *</label>
            <select value={form.device_id} onChange={e => setForm(f => ({ ...f, device_id: e.target.value }))}
              className="w-full h-9 rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">Selecione o produto...</option>
              {devices.map(d => <option key={d.id} value={d.id}>{d.model}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Quantidade *</label>
              <Input type="number" min={1} value={form.quantidade}
                onChange={e => setForm(f => ({ ...f, quantidade: parseInt(e.target.value) || 1 }))}
                className="h-9" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Prioridade</label>
              <select value={form.prioridade} onChange={e => setForm(f => ({ ...f, prioridade: e.target.value as Prioridade }))}
                className="w-full h-9 rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="baixa">Baixa</option>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Início Previsto</label>
              <Input type="date" value={form.data_inicio_prev}
                onChange={e => setForm(f => ({ ...f, data_inicio_prev: e.target.value }))}
                className="h-9" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fim Previsto</label>
              <Input type="date" value={form.data_fim_prev}
                onChange={e => setForm(f => ({ ...f, data_fim_prev: e.target.value }))}
                className="h-9" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Lote de Produção</label>
              <Input value={form.lote_producao} onChange={e => setForm(f => ({ ...f, lote_producao: e.target.value }))}
                placeholder="ex: LOTE-2026-05" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Responsável</label>
              <Input value={form.responsavel_nome} onChange={e => setForm(f => ({ ...f, responsavel_nome: e.target.value }))}
                placeholder="Nome do responsável" className="h-9" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Observações</label>
            <textarea value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))}
              className="w-full h-20 rounded-xl border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Instruções, restrições, referências..." />
          </div>
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-border/40">
          <Button variant="outline" onClick={onClose} className="flex-1 h-9">Cancelar</Button>
          <Button onClick={handleSave} disabled={saving} className="flex-1 h-9">
            {saving ? "Criando..." : "Criar OP"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── OPCard ────────────────────────────────────────────────────────────────────
const NEXT_STATUS: Partial<Record<OPStatus, OPStatus>> = {
  planejada: "em_producao", em_producao: "concluida", pausada: "em_producao",
};
const PAUSE_FROM: OPStatus[] = ["em_producao"];

function OPCard({ op, isAdmin, onRefresh }: {
  op: OrdemProducao; isAdmin: boolean; onRefresh: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const cfg = STATUS_CFG[op.status];
  const prio = PRIO_CFG[op.prioridade];
  const isAtrasada = op.data_fim_prev && !op.data_fim_real && new Date(op.data_fim_prev) < new Date();

  async function changeStatus(newStatus: OPStatus) {
    setLoading(true);
    const patch: Record<string, unknown> = { status: newStatus };
    if (newStatus === "em_producao" && !op.data_inicio_real) patch.data_inicio_real = new Date().toISOString();
    if (newStatus === "concluida") patch.data_fim_real = new Date().toISOString();
    const { error } = await supabase.from("ordens_producao").update(patch).eq("id", op.id);
    if (error) { toast.error("Erro ao atualizar status."); }
    else { toast.success(`OP ${newStatus === "concluida" ? "concluída" : "atualizada"}!`); onRefresh(); }
    setLoading(false);
  }

  return (
    <div className={cn("rounded-2xl border bg-card/80 overflow-hidden",
      isAtrasada && "border-destructive/40")}>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Status icon */}
        <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0", cfg.bg)}>
          <cfg.Icon className={cn("h-5 w-5", cfg.color)} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] font-bold text-muted-foreground">{op.numero}</span>
            <Badge className={cn("text-[10px] h-4 px-1.5", cfg.bg, cfg.color, "border-0")}>
              {cfg.label}
            </Badge>
            {op.prioridade !== "normal" && (
              <span className={cn("text-[10px] font-semibold", prio.color)}>{prio.label}</span>
            )}
            {isAtrasada && (
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" title="Atrasada" />
            )}
          </div>
          <p className="text-sm font-medium truncate mt-0.5">{op.device_model ?? op.device_id}</p>
          <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Package className="h-3 w-3" />{op.quantidade} un.
            </span>
            {op.responsavel_nome && (
              <span className="flex items-center gap-1">
                <User2 className="h-3 w-3" />{op.responsavel_nome}
              </span>
            )}
            {op.data_fim_prev && (
              <span className={cn("flex items-center gap-1", isAtrasada && "text-destructive font-medium")}>
                <Calendar className="h-3 w-3" />
                {new Date(op.data_fim_prev).toLocaleDateString("pt-BR")}
              </span>
            )}
          </div>
        </div>

        {/* Ações de status */}
        {isAdmin && op.status !== "concluida" && op.status !== "cancelada" && (
          <div className="flex flex-col gap-1 shrink-0">
            {NEXT_STATUS[op.status] && (
              <button onClick={() => changeStatus(NEXT_STATUS[op.status]!)} disabled={loading}
                className={cn("px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors",
                  op.status === "planejada" ? "bg-green-500/10 text-green-600 hover:bg-green-500/20"
                    : op.status === "pausada" ? "bg-blue-500/10 text-blue-600 hover:bg-blue-500/20"
                    : "bg-primary/10 text-primary hover:bg-primary/20")}>
                {op.status === "planejada" ? "Iniciar" : op.status === "pausada" ? "Retomar" : "Concluir"}
              </button>
            )}
            {PAUSE_FROM.includes(op.status) && (
              <button onClick={() => changeStatus("pausada")} disabled={loading}
                className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 transition-colors">
                Pausar
              </button>
            )}
            {op.status === "planejada" && (
              <button onClick={() => changeStatus("cancelada")} disabled={loading}
                className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors">
                Cancelar
              </button>
            )}
          </div>
        )}
      </div>

      {op.observacoes && (
        <div className="px-4 pb-3 pt-0">
          <p className="text-[11px] text-muted-foreground/70 italic border-t border-border/20 pt-2">
            {op.observacoes}
          </p>
        </div>
      )}
    </div>
  );
}

// ── KPI Bar ───────────────────────────────────────────────────────────────────
function KpiBar({ ops }: { ops: OrdemProducao[] }) {
  const ativas = ops.filter(o => o.status === "em_producao").length;
  const planejadas = ops.filter(o => o.status === "planejada").length;
  const atrasadas = ops.filter(o =>
    o.data_fim_prev && !o.data_fim_real && new Date(o.data_fim_prev) < new Date()
    && !["concluida","cancelada"].includes(o.status)).length;
  const concluidas = ops.filter(o => o.status === "concluida").length;

  const stats = [
    { label: "Em produção", value: ativas,    color: "text-green-500"  },
    { label: "Planejadas",  value: planejadas, color: "text-blue-500"   },
    { label: "Concluídas",  value: concluidas, color: "text-primary"    },
    { label: "Atrasadas",   value: atrasadas,  color: "text-destructive"},
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

// ── Main Panel ────────────────────────────────────────────────────────────────
export function OrdensProducaoPanel({ isAdmin }: { isAdmin: boolean }) {
  const [ops, setOps] = useState<OrdemProducao[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<OPStatus | "todas">("todas");
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: opsData }, { data: devData }] = await Promise.all([
      supabase.from("ordens_producao").select("*").order("created_at", { ascending: false }),
      supabase.from("devices").select("id, model").order("model"),
    ]);
    const devMap = new Map((devData ?? []).map((d: Device) => [d.id, d.model]));
    const enriched = (opsData ?? []).map((o: OrdemProducao) => ({
      ...o, device_model: devMap.get(o.device_id) ?? o.device_id,
    }));
    setOps(enriched as OrdemProducao[]);
    setDevices((devData ?? []) as Device[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = ops.filter(o => {
    if (statusFilter !== "todas" && o.status !== statusFilter) return false;
    const q = search.toLowerCase();
    return !q || o.numero.toLowerCase().includes(q)
      || (o.device_model ?? "").toLowerCase().includes(q)
      || (o.lote_producao ?? "").toLowerCase().includes(q);
  });

  const STATUS_OPTS: Array<{ value: OPStatus | "todas"; label: string }> = [
    { value: "todas", label: "Todas" },
    { value: "planejada", label: "Planejada" },
    { value: "em_producao", label: "Em Produção" },
    { value: "pausada", label: "Pausada" },
    { value: "concluida", label: "Concluída" },
    { value: "cancelada", label: "Cancelada" },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-sm">Ordens de Produção</h2>
          <Badge variant="outline" className="text-[10px]">{filtered.length}</Badge>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="h-8 w-8 rounded-xl border flex items-center justify-center hover:bg-muted/40 transition-colors">
            <RefreshCw className={cn("h-3.5 w-3.5 text-muted-foreground", loading && "animate-spin")} />
          </button>
          {isAdmin && (
            <Button size="sm" className="h-8 gap-1.5" onClick={() => setModalOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Nova OP
            </Button>
          )}
        </div>
      </div>

      {/* KPIs */}
      {!loading && <KpiBar ops={ops} />}

      {/* Busca + Filtro de status */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar OP, produto ou lote..."
            className="pl-9 h-9 text-sm" />
        </div>
        <div className="relative">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as OPStatus | "todas")}
            className="h-9 pr-8 pl-3 rounded-xl border border-input bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer">
            {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="rounded-2xl border p-4 flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed py-16 text-center space-y-2">
          <ClipboardList className="h-8 w-8 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground/60">
            {search || statusFilter !== "todas" ? "Nenhuma OP encontrada" : "Nenhuma ordem de produção criada"}
          </p>
          {isAdmin && !search && statusFilter === "todas" && (
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setModalOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Criar primeira OP
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(op => (
            <OPCard key={op.id} op={op} isAdmin={isAdmin} onRefresh={load} />
          ))}
        </div>
      )}

      <NovaOPModal open={modalOpen} onClose={() => setModalOpen(false)}
        onSaved={load} devices={devices} />
    </div>
  );
}
