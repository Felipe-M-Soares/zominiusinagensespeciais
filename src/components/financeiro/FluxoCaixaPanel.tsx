/**
 * FluxoCaixaPanel — Dashboard financeiro avançado
 * Fluxo de caixa mensal + Aging report de inadimplência
 * Usa tabela contas_financeiras (já existente em _empresarial.sql)
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, AlertTriangle, RefreshCw, BarChart3, Clock, DollarSign, Download } from "lucide-react";

interface Conta {
  id: string;
  tipo: "pagar" | "receber";
  valor: number;
  data_vencimento: string;
  data_pagamento: string | null;
  status: string;
  categoria: string;
}

const BRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const MESES_LABEL = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

function getMes(iso: string) {
  const d = new Date(iso + "T12:00:00");
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── Fluxo de caixa mensal ────────────────────────────────────────────────────
function FluxoCaixa({ contas }: { contas: Conta[] }) {
  const meses = useMemo(() => {
    const now = new Date();
    const result: { key: string; label: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      result.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: `${MESES_LABEL[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`,
      });
    }
    return result;
  }, []);

  const data = useMemo(() =>
    meses.map(({ key, label }) => {
      const ref = (c: Conta) => getMes(c.data_pagamento || c.data_vencimento) === key;
      const entradas = contas.filter(c => c.tipo === "receber" && c.status === "pago" && ref(c)).reduce((s, c) => s + c.valor, 0);
      const saidas   = contas.filter(c => c.tipo === "pagar"   && c.status === "pago" && ref(c)).reduce((s, c) => s + c.valor, 0);
      return { key, label, entradas, saidas, saldo: entradas - saidas };
    }), [contas, meses]);

  const maxVal = Math.max(...data.flatMap(d => [d.entradas, d.saidas]), 1);

  return (
    <div className="rounded-2xl border border-border/40 bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-primary" />
        <p className="text-sm font-bold">Fluxo de Caixa — últimos 6 meses</p>
      </div>
      <div className="flex items-end gap-2 h-32">
        {data.map((d) => (
          <div key={d.key} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex gap-0.5 items-end h-24">
              {/* Entradas */}
              <div className="flex-1 flex flex-col justify-end" title={`Entradas: ${BRL(d.entradas)}`}>
                <div
                  className="rounded-t-sm bg-emerald-500/80 transition-all duration-500"
                  style={{ height: `${Math.max(2, (d.entradas / maxVal) * 100)}%` }}
                />
              </div>
              {/* Saídas */}
              <div className="flex-1 flex flex-col justify-end" title={`Saídas: ${BRL(d.saidas)}`}>
                <div
                  className="rounded-t-sm bg-red-400/80 transition-all duration-500"
                  style={{ height: `${Math.max(2, (d.saidas / maxVal) * 100)}%` }}
                />
              </div>
            </div>
            <p className="text-[9px] text-muted-foreground">{d.label}</p>
            <p className={cn("text-[9px] font-bold", d.saldo >= 0 ? "text-emerald-600" : "text-red-500")}>
              {d.saldo >= 0 ? "+" : ""}{BRL(d.saldo)}
            </p>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500/80 inline-block"/>Entradas (pago)</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red-400/80 inline-block"/>Saídas (pago)</span>
      </div>
    </div>
  );
}

// ── Aging report ─────────────────────────────────────────────────────────────
function AgingReport({ contas }: { contas: Conta[] }) {
  const today = new Date();

  const brackets = useMemo(() => {
    const vencidas = contas.filter(c => c.status === "vencido" && c.tipo === "receber");
    function dias(c: Conta) {
      return Math.floor((today.getTime() - new Date(c.data_vencimento + "T12:00:00").getTime()) / 86400000);
    }
    return [
      { label: "1–30 dias",  filter: (c: Conta) => { const d = dias(c); return d >= 1  && d <= 30;  } },
      { label: "31–60 dias", filter: (c: Conta) => { const d = dias(c); return d >= 31 && d <= 60;  } },
      { label: "61–90 dias", filter: (c: Conta) => { const d = dias(c); return d >= 61 && d <= 90;  } },
      { label: "91+ dias",   filter: (c: Conta) => dias(c) > 90 },
    ].map(b => ({
      label: b.label,
      contas: vencidas.filter(b.filter),
      total: vencidas.filter(b.filter).reduce((s, c) => s + c.valor, 0),
    }));
  }, [contas, today]);

  const totalVencido = brackets.reduce((s, b) => s + b.total, 0);

  if (totalVencido === 0) {
    return (
      <div className="rounded-2xl border border-border/40 bg-card p-4 flex flex-col items-center justify-center gap-2 py-8">
        <TrendingUp className="h-8 w-8 text-emerald-500 opacity-50" />
        <p className="text-sm font-medium text-emerald-600">Nenhuma inadimplência</p>
        <p className="text-[11px] text-muted-foreground">Todas as contas a receber estão em dia</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/40 bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-destructive" />
          <p className="text-sm font-bold">Aging — Inadimplência a Receber</p>
        </div>
        <p className="text-sm font-bold text-destructive">{BRL(totalVencido)}</p>
      </div>
      <div className="space-y-2">
        {brackets.map((b) => {
          const pct = totalVencido > 0 ? (b.total / totalVencido) * 100 : 0;
          const color = b.label.startsWith("91") ? "bg-red-600" : b.label.startsWith("61") ? "bg-red-500" : b.label.startsWith("31") ? "bg-orange-500" : "bg-amber-500";
          return (
            <div key={b.label} className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">{b.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{b.contas.length} conta{b.contas.length !== 1 ? "s" : ""}</span>
                  <span className="font-bold font-mono">{BRL(b.total)}</span>
                  <span className="text-muted-foreground/60">{pct.toFixed(0)}%</span>
                </div>
              </div>
              <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
                <div className={cn("h-full rounded-full transition-all duration-700", color)} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Projeção de saldo ─────────────────────────────────────────────────────────
function ProjecaoSaldo({ contas }: { contas: Conta[] }) {
  const today = new Date();
  const em30 = new Date(today.getTime() + 30 * 86400000);

  const abertas = contas.filter(c => c.status === "aberto" && new Date(c.data_vencimento + "T12:00:00") <= em30);
  const receber30 = abertas.filter(c => c.tipo === "receber").reduce((s, c) => s + c.valor, 0);
  const pagar30   = abertas.filter(c => c.tipo === "pagar").reduce((s, c) => s + c.valor, 0);
  const saldo30   = receber30 - pagar30;

  return (
    <div className="rounded-2xl border border-border/40 bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <DollarSign className="h-4 w-4 text-primary" />
        <p className="text-sm font-bold">Projeção — próximos 30 dias</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-2.5 text-center">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">A Receber</p>
          <p className="text-sm font-bold text-emerald-600">{BRL(receber30)}</p>
          <p className="text-[9px] text-muted-foreground">{abertas.filter(c => c.tipo === "receber").length} contas</p>
        </div>
        <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-2.5 text-center">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">A Pagar</p>
          <p className="text-sm font-bold text-red-600">{BRL(pagar30)}</p>
          <p className="text-[9px] text-muted-foreground">{abertas.filter(c => c.tipo === "pagar").length} contas</p>
        </div>
        <div className={cn("rounded-xl border p-2.5 text-center", saldo30 >= 0 ? "bg-primary/5 border-primary/20" : "bg-orange-500/5 border-orange-500/20")}>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Saldo</p>
          <p className={cn("text-sm font-bold", saldo30 >= 0 ? "text-primary" : "text-orange-600")}>{BRL(saldo30)}</p>
          <p className="text-[9px] text-muted-foreground">{saldo30 >= 0 ? "positivo" : "negativo"}</p>
        </div>
      </div>
    </div>
  );
}

// ── Painel principal ──────────────────────────────────────────────────────────
export function FluxoCaixaPanel() {
  const [contas, setContas] = useState<Conta[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("contas_financeiras")
        .select("id,tipo,valor,data_vencimento,data_pagamento,status,categoria")
        .order("data_vencimento");
      if (error) throw error;
      setContas((data as Conta[]) ?? []);
    } catch (err) {
      logger.error("FluxoCaixaPanel: erro ao carregar contas", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Exporta CSV do fluxo
  function exportCSV() {
    const rows = contas.map(c =>
      [c.tipo, c.status, c.categoria, c.valor, c.data_vencimento, c.data_pagamento ?? ""].join(",")
    );
    const blob = new Blob([["tipo,status,categoria,valor,vencimento,pagamento\n", ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "fluxo-caixa.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">{contas.length} contas carregadas</p>
        <div className="flex gap-2">
          <button onClick={load} className="h-8 w-8 flex items-center justify-center rounded-lg border border-input hover:bg-muted/40">
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button onClick={exportCSV} className="h-8 px-3 rounded-lg border border-input text-[12px] flex items-center gap-1.5 hover:bg-muted/40">
            <Download className="h-3.5 w-3.5" /> Exportar CSV
          </button>
        </div>
      </div>
      <ProjecaoSaldo contas={contas} />
      <FluxoCaixa contas={contas} />
      <AgingReport contas={contas} />
    </div>
  );
}
