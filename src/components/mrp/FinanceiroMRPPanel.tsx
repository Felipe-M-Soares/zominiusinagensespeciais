/**
 * FinanceiroMRPPanel — Contas a Receber + Fluxo de Caixa (Módulo MRP)
 */

import { useState, useEffect, useCallback } from "react";
import {
  DollarSign, Plus, Search, CheckCircle2, Clock, AlertTriangle,
  X, ChevronDown, TrendingUp, TrendingDown, Wallet, RefreshCw,
  Calendar, User2, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";

// ── Tipos ─────────────────────────────────────────────────────────────────────

type CRStatus = "aberta" | "recebida" | "vencida" | "cancelada";

interface ContaReceber {
  id: string;
  pedido_id: string | null;
  cliente_id: string;
  cliente_nome?: string;
  descricao: string;
  valor: number;
  vencimento: string;
  recebido_em: string | null;
  forma_pagamento: string | null;
  status: CRStatus;
  observacoes: string | null;
  created_at: string;
}

interface Cliente { id: string; nome: string; }

// ── Config visual de status ───────────────────────────────────────────────────
const CR_CFG: Record<CRStatus, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  aberta:    { label: "Em aberto",  color: "text-blue-500",   bg: "bg-blue-500/10",   Icon: Clock        },
  recebida:  { label: "Recebida",   color: "text-success",    bg: "bg-success/10",    Icon: CheckCircle2 },
  vencida:   { label: "Vencida",    color: "text-destructive",bg: "bg-destructive/10",Icon: AlertTriangle },
  cancelada: { label: "Cancelada",  color: "text-muted-foreground", bg: "bg-muted/10", Icon: X },
};

const FORMAS_PAG = ["PIX", "Dinheiro", "Boleto", "Cartão Crédito", "Cartão Débito", "Transferência", "Cheque"];

// ── KPI Cards ────────────────────────────────────────────────────────────────
function FinanceiroKPIs({ contas }: { contas: ContaReceber[] }) {
  const abertas  = contas.filter(c => c.status === "aberta");
  const vencidas = contas.filter(c => c.status === "vencida");
  const recebidas30 = contas.filter(c =>
    c.status === "recebida" && c.recebido_em &&
    new Date(c.recebido_em) >= new Date(Date.now() - 30 * 86400000));

  const totalAberto   = abertas.reduce((s, c) => s + c.valor, 0);
  const totalVencido  = vencidas.reduce((s, c) => s + c.valor, 0);
  const totalRecebido = recebidas30.reduce((s, c) => s + c.valor, 0);

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const cards = [
    { label: "A Receber", value: fmt(totalAberto),   color: "text-blue-500",   bg: "bg-blue-500/5",   border: "border-blue-500/20",   Icon: Wallet        },
    { label: "Vencido",   value: fmt(totalVencido),  color: "text-destructive",bg: "bg-destructive/5",border: "border-destructive/20",Icon: AlertTriangle  },
    { label: "Recebido (30d)", value: fmt(totalRecebido), color: "text-success", bg: "bg-success/5", border: "border-success/20", Icon: TrendingUp },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {cards.map(c => (
        <div key={c.label} className={cn("rounded-2xl border p-4 space-y-1", c.bg, c.border)}>
          <div className="flex items-center gap-1.5">
            <c.Icon className={cn("h-4 w-4", c.color)} />
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{c.label}</span>
          </div>
          <p className={cn("text-lg font-bold tabular-nums", c.color)}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Gráfico de fluxo de caixa (últimos 6 meses) ───────────────────────────────
function FluxoChart({ contas }: { contas: ContaReceber[] }) {
  const months: { name: string; recebido: number; pendente: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
    const y = d.getFullYear(), m = d.getMonth();
    const recebido = contas
      .filter(c => c.status === "recebida" && c.recebido_em &&
        new Date(c.recebido_em).getFullYear() === y &&
        new Date(c.recebido_em).getMonth() === m)
      .reduce((s, c) => s + c.valor, 0);
    const pendente = contas
      .filter(c => c.status !== "cancelada" &&
        new Date(c.vencimento).getFullYear() === y &&
        new Date(c.vencimento).getMonth() === m)
      .reduce((s, c) => s + c.valor, 0);
    months.push({ name: label, recebido, pendente });
  }

  return (
    <div className="rounded-2xl border border-border/40 p-4">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-semibold">Fluxo de Caixa — últimos 6 meses</p>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={months} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorRec" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(152 60% 40%)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(152 60% 40%)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorPend" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(197 100% 47%)" stopOpacity={0.25} />
              <stop offset="95%" stopColor="hsl(197 100% 47%)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))"
            tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
          <Tooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
            formatter={(v: number) => [v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), ""]} />
          <Area type="monotone" dataKey="recebido" stroke="hsl(152 60% 40%)" fill="url(#colorRec)"
            strokeWidth={2} name="Recebido" />
          <Area type="monotone" dataKey="pendente" stroke="hsl(197 100% 47%)" fill="url(#colorPend)"
            strokeWidth={2} name="Pendente" />
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-2 justify-center">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="h-2.5 w-2.5 rounded-full bg-success" />Recebido
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="h-2.5 w-2.5 rounded-full bg-primary" />Pendente
        </div>
      </div>
    </div>
  );
}

// ── Conta Card ────────────────────────────────────────────────────────────────
function ContaCard({ conta, onReceive, onCancel }: {
  conta: ContaReceber;
  onReceive: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const cfg = CR_CFG[conta.status];
  const isVencida = conta.status === "aberta" && new Date(conta.vencimento) < new Date();
  const effectiveCfg = isVencida ? CR_CFG.vencida : cfg;

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/10 transition-colors">
      <div className={cn("h-8 w-8 rounded-xl flex items-center justify-center shrink-0", effectiveCfg.bg)}>
        <effectiveCfg.Icon className={cn("h-4 w-4", effectiveCfg.color)} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium truncate">{conta.descricao}</p>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {conta.cliente_nome && (
            <span className="flex items-center gap-1">
              <User2 className="h-3 w-3" />{conta.cliente_nome}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {new Date(conta.vencimento).toLocaleDateString("pt-BR")}
          </span>
          {conta.forma_pagamento && (
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" />{conta.forma_pagamento}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={cn("text-sm font-bold tabular-nums", effectiveCfg.color)}>
          {conta.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
        </span>
        {(conta.status === "aberta" || isVencida) && (
          <div className="flex gap-1">
            <button onClick={() => onReceive(conta.id)}
              className="h-7 px-2 rounded-lg bg-success/10 text-success text-[11px] font-medium hover:bg-success/20 transition-colors">
              Receber
            </button>
            <button onClick={() => onCancel(conta.id)}
              className="h-7 w-7 rounded-lg hover:bg-muted/40 flex items-center justify-center transition-colors">
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── NovaContaModal ────────────────────────────────────────────────────────────
function NovaContaModal({ open, onClose, onSaved, clientes }: {
  open: boolean; onClose: () => void; onSaved: () => void; clientes: Cliente[];
}) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    cliente_id: "", descricao: "", valor: "", vencimento: "",
    forma_pagamento: "PIX", observacoes: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm({ cliente_id: "", descricao: "", valor: "", vencimento: "", forma_pagamento: "PIX", observacoes: "" });
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    if (!form.cliente_id) { toast.error("Selecione o cliente"); return; }
    if (!form.descricao.trim()) { toast.error("Descrição obrigatória"); return; }
    if (!form.valor || parseFloat(form.valor) <= 0) { toast.error("Valor inválido"); return; }
    if (!form.vencimento) { toast.error("Data de vencimento obrigatória"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("contas_receber").insert({
        cliente_id: form.cliente_id,
        descricao: form.descricao.trim(),
        valor: parseFloat(form.valor),
        vencimento: form.vencimento,
        forma_pagamento: form.forma_pagamento,
        observacoes: form.observacoes || null,
        created_by: user?.id,
      });
      if (error) throw error;
      toast.success("Conta a receber criada!");
      onSaved(); onClose();
    } catch { toast.error("Erro ao criar conta."); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
          <p className="font-semibold text-sm flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-success" /> Nova Conta a Receber
          </p>
          <button onClick={onClose} className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-muted/40">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cliente *</label>
            <div className="relative">
              <select value={form.cliente_id} onChange={e => setForm(f => ({ ...f, cliente_id: e.target.value }))}
                className="w-full h-9 pr-8 pl-3 rounded-xl border border-input bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="">Selecione...</option>
                {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Descrição *</label>
            <Input value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
              placeholder="ex: Pedido #123 — Usinagem peças" className="h-9" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Valor (R$) *</label>
              <Input type="number" min={0} step="0.01" value={form.valor}
                onChange={e => setForm(f => ({ ...f, valor: e.target.value }))}
                placeholder="0,00" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Vencimento *</label>
              <Input type="date" value={form.vencimento}
                onChange={e => setForm(f => ({ ...f, vencimento: e.target.value }))}
                className="h-9" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Forma de Pagamento</label>
            <div className="relative">
              <select value={form.forma_pagamento} onChange={e => setForm(f => ({ ...f, forma_pagamento: e.target.value }))}
                className="w-full h-9 pr-8 pl-3 rounded-xl border border-input bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-ring">
                {FORMAS_PAG.map(fp => <option key={fp} value={fp}>{fp}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Observações</label>
            <Input value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))}
              placeholder="Notas adicionais..." className="h-9" />
          </div>
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-border/40">
          <Button variant="outline" onClick={onClose} className="flex-1 h-9">Cancelar</Button>
          <Button onClick={handleSave} disabled={saving} className="flex-1 h-9">
            {saving ? "Salvando..." : "Criar Conta"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────
export function FinanceiroMRPPanel() {
  const [contas, setContas] = useState<ContaReceber[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CRStatus | "todas">("todas");
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: crData }, { data: cliData }] = await Promise.all([
      supabase.from("contas_receber").select("*").order("vencimento"),
      supabase.from("clientes").select("id, nome").order("nome"),
    ]);
    const cliMap = new Map((cliData ?? []).map((c: Cliente) => [c.id, c.nome]));
    const enriched = (crData ?? []).map((c: ContaReceber) => ({
      ...c, cliente_nome: cliMap.get(c.cliente_id) ?? "—",
    }));
    // Auto-mark vencidas
    const now = new Date().toISOString().slice(0, 10);
    const toVencer = enriched.filter(c => c.status === "aberta" && c.vencimento < now);
    if (toVencer.length > 0) {
      await supabase.from("contas_receber")
        .update({ status: "vencida" })
        .in("id", toVencer.map(c => c.id));
      for (const c of enriched) {
        if (toVencer.find(v => v.id === c.id)) c.status = "vencida";
      }
    }
    setContas(enriched as ContaReceber[]);
    setClientes((cliData ?? []) as Cliente[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleReceive(id: string) {
    const { error } = await supabase.from("contas_receber")
      .update({ status: "recebida", recebido_em: new Date().toISOString() })
      .eq("id", id);
    if (error) { toast.error("Erro ao registrar recebimento."); return; }
    toast.success("Recebimento registrado!");
    load();
  }

  async function handleCancel(id: string) {
    if (!confirm("Cancelar esta conta?")) return;
    await supabase.from("contas_receber").update({ status: "cancelada" }).eq("id", id);
    toast.success("Conta cancelada.");
    load();
  }

  const filtered = contas.filter(c => {
    if (statusFilter !== "todas" && c.status !== statusFilter) return false;
    const q = search.toLowerCase();
    return !q || c.descricao.toLowerCase().includes(q)
      || (c.cliente_nome ?? "").toLowerCase().includes(q);
  });

  const STATUS_OPTS: Array<{ value: CRStatus | "todas"; label: string }> = [
    { value: "todas", label: "Todas" },
    { value: "aberta", label: "Em aberto" },
    { value: "vencida", label: "Vencida" },
    { value: "recebida", label: "Recebida" },
    { value: "cancelada", label: "Cancelada" },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-success" />
          <h2 className="font-semibold text-sm">Contas a Receber</h2>
          <Badge variant="outline" className="text-[10px]">{filtered.length}</Badge>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="h-8 w-8 rounded-xl border flex items-center justify-center hover:bg-muted/40 transition-colors">
            <RefreshCw className={cn("h-3.5 w-3.5 text-muted-foreground", loading && "animate-spin")} />
          </button>
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setModalOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Nova Conta
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <FinanceiroKPIs contas={contas} />
          <FluxoChart contas={contas} />
        </>
      )}

      {/* Filtros */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por descrição ou cliente..." className="pl-9 h-9 text-sm" />
        </div>
        <div className="relative">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as CRStatus | "todas")}
            className="h-9 pr-8 pl-3 rounded-xl border border-input bg-background text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer">
            {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        </div>
      </div>

      {/* Lista */}
      {!loading && (
        filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed py-14 text-center space-y-2">
            <DollarSign className="h-8 w-8 text-muted-foreground/30 mx-auto" />
            <p className="text-sm text-muted-foreground/60">
              {search || statusFilter !== "todas" ? "Nenhuma conta encontrada" : "Nenhuma conta a receber"}
            </p>
            {!search && statusFilter === "todas" && (
              <Button size="sm" variant="outline" className="mt-2" onClick={() => setModalOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Criar conta
              </Button>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-border/40 overflow-hidden divide-y divide-border/20">
            {filtered.map(conta => (
              <ContaCard key={conta.id} conta={conta}
                onReceive={handleReceive} onCancel={handleCancel} />
            ))}
          </div>
        )
      )}

      <NovaContaModal open={modalOpen} onClose={() => setModalOpen(false)}
        onSaved={load} clientes={clientes} />
    </div>
  );
}
