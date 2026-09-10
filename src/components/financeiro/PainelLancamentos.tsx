import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { formatBRL as fmtCurrency } from "@/lib/format";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { TestBadge } from "@/components/financeiro/TestBadge";
import {
  LancamentoFinanceiro, CategoriaCompra,
  CATEGORIAS_PRODUCAO, CATEGORIAS_EMPRESA, CATEGORIAS_CUSTO,
} from "@/components/financeiro/financeiroTypes";
import {
  AlertTriangle, BarChart3, CalendarDays, CheckCircle2, Edit3, Loader2,
  Package, PlusCircle, RefreshCw, Repeat2, ShoppingCart, Trash2, X,
} from "lucide-react";

interface LancModalProps {
  open: boolean; tipo: LancamentoFinanceiro["tipo"];
  onClose: () => void; onSuccess: () => void;
  inicial?: LancamentoFinanceiro | null; modoTeste: boolean;
}

function LancamentoModal({ open, tipo, onClose, onSuccess, inicial, modoTeste }: LancModalProps) {
  const { user } = useAuth();
  const categorias = tipo === "compra_producao" ? CATEGORIAS_PRODUCAO
                   : tipo === "compra_empresa"  ? CATEGORIAS_EMPRESA
                   :                              CATEGORIAS_CUSTO;

  const [categoria,     setCategoria]     = useState<CategoriaCompra>(categorias[0].valor);
  const [descricao,     setDescricao]     = useState("");
  const [fornecedor,    setFornecedor]    = useState("");
  const [valor,         setValor]         = useState("");
  const [data,          setData]          = useState(new Date().toISOString().slice(0, 10));
  const [nfManual,      setNfManual]      = useState("");
  const [chaveNfe,      setChaveNfe]      = useState("");
  const [statusNf,      setStatusNf]      = useState<LancamentoFinanceiro["status_nf"]>("sem_nf");
  const [obs,           setObs]           = useState("");
  const [recorrente,    setRecorrente]    = useState(false);
  const [periodicidade, setPeriodicidade] = useState<NonNullable<LancamentoFinanceiro["periodicidade"]>>("mensal");
  const [saving,        setSaving]        = useState(false);

  useEffect(() => {
    if (!open) return;
    if (inicial) {
      setCategoria(inicial.categoria); setDescricao(inicial.descricao);
      setFornecedor(inicial.fornecedor ?? ""); setValor(inicial.valor.toFixed(2));
      setData(inicial.data_lancamento.slice(0,10)); setNfManual(inicial.nota_fiscal_manual ?? "");
      setChaveNfe(inicial.chave_nfe ?? ""); setStatusNf(inicial.status_nf);
      setObs(inicial.observacoes ?? ""); setRecorrente(inicial.recorrente);
      setPeriodicidade(inicial.periodicidade ?? "mensal");
    } else {
      setCategoria(categorias[0].valor); setDescricao(""); setFornecedor(""); setValor("");
      setData(new Date().toISOString().slice(0,10)); setNfManual(""); setChaveNfe("");
      setStatusNf("sem_nf"); setObs(""); setRecorrente(false); setPeriodicidade("mensal");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inicial]);

  if (!open) return null;

  async function handleSave() {
    if (!descricao.trim()) { toast.error("Descrição obrigatória"); return; }
    if (!valor || parseFloat(valor) <= 0) { toast.error("Informe o valor"); return; }
    setSaving(true);
    const payload = {
      tipo, categoria, descricao: descricao.trim(),
      fornecedor: fornecedor.trim() || null,
      valor: parseFloat(valor), data_lancamento: data,
      nota_fiscal_manual: nfManual.trim() || null,
      chave_nfe: chaveNfe.trim() || null,
      status_nf: statusNf, observacoes: obs.trim() || null,
      recorrente, periodicidade: recorrente ? periodicidade : null,
      created_by: user?.id ?? null, modo_teste: modoTeste,
    };
    try {
      let err;
      if (inicial) {
        ({ error: err } = await supabase.from("financeiro_lancamentos").update(payload).eq("id", inicial.id));
      } else {
        ({ error: err } = await supabase.from("financeiro_lancamentos").insert(payload));
      }
      if (err) throw err;
      toast.success(inicial ? "Lançamento atualizado!" : "Lançamento registrado!");
      onSuccess();
    } catch (e) {
      toast.error("Erro ao salvar lançamento.");
      logger.error("LancamentoModal:", e);
    } finally { setSaving(false); }
  }

  const tipoLabel = tipo === "compra_producao" ? "Compra — Produção"
                  : tipo === "compra_empresa"  ? "Compra — Empresa"
                  :                              "Custo Operacional";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-card border border-border/40 shadow-2xl overflow-hidden flex flex-col max-h-[94vh] sm:max-h-[92vh] animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="px-5 pt-5 pb-3 border-b border-border/20 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-violet-500/15 flex items-center justify-center">
              <ShoppingCart className="h-4 w-4 text-violet-500" />
            </div>
            <span className="text-sm font-semibold">{inicial ? "Editar" : "Novo"} {tipoLabel}</span>
            <TestBadge modoTeste={modoTeste} />
          </div>
          <button type="button" onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Categoria *</label>
            <div className="grid grid-cols-2 gap-1.5">
              {categorias.map(cat => {
                const Icon = cat.icon;
                return (
                  <button key={cat.valor} type="button" onClick={() => setCategoria(cat.valor)}
                    className={cn("flex items-center gap-2 px-2.5 py-2 rounded-xl border text-left transition-all",
                      categoria === cat.valor
                        ? "border-violet-500/50 bg-violet-500/10"
                        : "border-border/30 bg-muted/10 hover:bg-muted/30")}>
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", categoria === cat.valor ? "text-violet-500" : "text-muted-foreground")} />
                    <span className="text-[10px] font-medium leading-tight">{cat.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {[
            { label: "Descrição *", val: descricao, set: setDescricao, placeholder: "Ex: Compressor industrial, conta de luz..." },
            { label: "Fornecedor / Empresa", val: fornecedor, set: setFornecedor, placeholder: "Nome do fornecedor" },
          ].map(f => (
            <div key={f.label} className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{f.label}</label>
              <input type="text" value={f.val} onChange={e => f.set(e.target.value.slice(0,120))}
                placeholder={f.placeholder}
                className="w-full h-9 rounded-xl border border-border/50 bg-background text-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Valor (R$) *</label>
              <input type="number" min="0" step="0.01" value={valor} onChange={e => setValor(e.target.value)}
                placeholder="0,00"
                className="w-full h-9 rounded-xl border border-border/50 bg-background text-foreground px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <CalendarDays className="h-2.5 w-2.5" />Data
              </label>
              <input type="date" value={data} onChange={e => setData(e.target.value)}
                className="w-full h-9 rounded-xl border border-border/50 bg-background text-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Status da Nota Fiscal</label>
            <div className="flex gap-1.5">
              {(["sem_nf", "manual", "pendente"] as const).map(s => (
                <button key={s} type="button" onClick={() => setStatusNf(s)}
                  className={cn("flex-1 h-8 rounded-lg border text-[10px] font-medium transition-all",
                    statusNf === s
                      ? "border-violet-500/50 bg-violet-500/10 text-violet-600"
                      : "border-border/30 bg-muted/10 text-muted-foreground")}>
                  {s === "sem_nf" ? "Sem NF" : s === "manual" ? "Manual" : "Pendente"}
                </button>
              ))}
            </div>
            {statusNf === "manual" && (
              <div className="space-y-2">
                <input type="text" value={nfManual} onChange={e => setNfManual(e.target.value.slice(0,60))}
                  placeholder="Número da NF (ex: NF-0001)"
                  className="w-full h-8 rounded-xl border border-border/50 bg-background text-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                />
                <input type="text" value={chaveNfe} onChange={e => setChaveNfe(e.target.value.replace(/\D/g,"").slice(0,44))}
                  placeholder="Chave de acesso NF-e 44 dígitos (opcional)"
                  className="w-full h-8 rounded-xl border border-border/50 bg-background text-foreground px-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                />
              </div>
            )}
          </div>
          {tipo === "custo_operacional" && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setRecorrente(v => !v)}
                  className={cn("h-5 w-9 rounded-full transition-colors relative shrink-0",
                    recorrente ? "bg-violet-500" : "bg-muted/50")}>
                  <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-background text-foreground shadow transition-all",
                    recorrente ? "left-[calc(100%-18px)]" : "left-0.5")} />
                </button>
                <span className="text-[11px] font-medium">Custo recorrente</span>
              </div>
              {recorrente && (
                <div className="grid grid-cols-4 gap-1.5">
                  {(["mensal", "bimestral", "trimestral", "anual"] as const).map(p => (
                    <button key={p} type="button" onClick={() => setPeriodicidade(p)}
                      className={cn("h-7 rounded-lg border text-[9px] font-medium transition-all",
                        periodicidade === p
                          ? "border-violet-500/50 bg-violet-500/10 text-violet-600"
                          : "border-border/30 bg-muted/10 text-muted-foreground")}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Observações</label>
            <textarea value={obs} onChange={e => setObs(e.target.value.slice(0,300))}
              placeholder="Informações adicionais..." rows={2}
              className="w-full rounded-xl border border-border/50 bg-background text-foreground px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            />
          </div>
        </div>
        <div className="px-5 pb-5 pt-3 border-t border-border/20 shrink-0 flex gap-2">
          <button type="button" onClick={onClose}
            className="h-10 px-4 rounded-xl border border-border/50 text-sm font-medium text-muted-foreground hover:bg-muted/40">
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={saving}
            className="flex-1 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {inicial ? "Salvar alterações" : "Registrar lançamento"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PainelLancamentos ───────────────────────────────────────────────────────

export function PainelLancamentos({ tipo, modoTeste }: { tipo: LancamentoFinanceiro["tipo"]; modoTeste: boolean }) {
  const [itens,      setItens]      = useState<LancamentoFinanceiro[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [modalOpen,  setModalOpen]  = useState(false);
  const [editItem,   setEditItem]   = useState<LancamentoFinanceiro | null>(null);
  const [delItem,    setDelItem]    = useState<LancamentoFinanceiro | null>(null);
  const [deleting,   setDeleting]   = useState(false);
  const [search,     setSearch]     = useState("");
  const [filtroNF,   setFiltroNF]   = useState<"todos" | LancamentoFinanceiro["status_nf"]>("todos");
  const [showRecorr, setShowRecorr] = useState(false);
  const [filtroDataInicio, setFiltroDataInicio] = useState("");
  const [filtroDataFim, setFiltroDataFim] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("financeiro_lancamentos")
      .select("id, tipo, categoria, descricao, fornecedor, valor, data_lancamento, nota_fiscal_manual, chave_nfe, status_nf, observacoes, recorrente, periodicidade, created_at, created_by")
      .eq("tipo", tipo).order("data_lancamento", { ascending: false });
    if (!error) setItens((data ?? []) as LancamentoFinanceiro[]);
    setLoading(false);
  }, [tipo]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete() {
    if (!delItem) return;
    setDeleting(true);
    const { error } = await supabase.from("financeiro_lancamentos").delete().eq("id", delItem.id);
    setDeleting(false);
    if (error) { toast.error("Erro ao excluir."); return; }
    toast.success("Lançamento excluído."); setDelItem(null); load();
  }

  const now = new Date();
  const mesAtualStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const totalMes    = useMemo(() => itens.filter(i => i.data_lancamento.startsWith(mesAtualStr)).reduce((s, i) => s + i.valor, 0), [itens, mesAtualStr]);
  const total       = itens.reduce((s, i) => s + i.valor, 0);
  const totalRecorr = itens.filter(i => i.recorrente).reduce((s, i) => s + i.valor, 0);
  const semNF       = itens.filter(i => i.status_nf === "sem_nf" || i.status_nf === "pendente").length;
  const allCats     = [...CATEGORIAS_PRODUCAO, ...CATEGORIAS_EMPRESA, ...CATEGORIAS_CUSTO];

  const itensFiltrados = useMemo(() => itens.filter(i => {
    const matchSearch = !search.trim() ||
      i.descricao.toLowerCase().includes(search.toLowerCase()) ||
      (i.fornecedor ?? "").toLowerCase().includes(search.toLowerCase());
    const matchNF     = filtroNF === "todos" || i.status_nf === filtroNF;
    const matchRecorr = !showRecorr || i.recorrente;
    const matchInicio = !filtroDataInicio || i.data_lancamento >= filtroDataInicio;
    const matchFim    = !filtroDataFim    || i.data_lancamento <= filtroDataFim;
    return matchSearch && matchNF && matchRecorr && matchInicio && matchFim;
  }), [itens, search, filtroNF, showRecorr, filtroDataInicio, filtroDataFim]);

  const nfColors: Record<LancamentoFinanceiro["status_nf"], { label: string; cls: string }> = {
    sem_nf:     { label: "Sem NF",        cls: "bg-muted/50 text-muted-foreground border-border/40" },
    manual:     { label: "NF Manual",     cls: "bg-violet-500/10 text-violet-600 border-violet-500/20" },
    pendente:   { label: "NF Pendente",   cls: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
    autorizada: { label: "NF Autorizada", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  };

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Este Mês",    value: fmtCurrency(totalMes),   icon: CalendarDays,   color: "#f97316" },
          { label: "Total Geral", value: fmtCurrency(total),       icon: BarChart3,      color: "#7c3aed" },
          { label: "Recorrentes", value: fmtCurrency(totalRecorr), icon: Repeat2,        color: "#0ea5e9" },
          { label: "Sem NF",      value: String(semNF),            icon: AlertTriangle,  color: semNF > 0 ? "#d97706" : "#10b981" },
        ].map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-xl p-3 flex items-center gap-3 bg-card border border-border/50 hover:border-border transition-colors">
              <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${k.color}15`, color: k.color }}>
                <Icon size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{k.label}</p>
                <p className="text-[14px] font-black truncate tabular-nums" style={{ color: k.color }}>{k.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => { setEditItem(null); setModalOpen(true); }}
          className="h-9 px-4 flex items-center gap-1.5 rounded-xl text-[12px] font-bold text-white transition-all hover:opacity-90 active:scale-95"
          style={{ background: "linear-gradient(135deg,#7c3aed,#6d28d9)", boxShadow: "0 2px 8px rgba(124,58,237,0.3)" }}>
          <PlusCircle size={14} />Novo lançamento
        </button>
        <SearchInputWithBarcode
          className="flex-1 min-w-[160px]"
          value={search}
          onChange={v => setSearch(v)}
          onSearch={v => setSearch(v)}
          placeholder="Buscar descrição, fornecedor ou bipe o código..."
          height="h-9"
          showSearchIcon
        />
        <select value={filtroNF} onChange={e => setFiltroNF(e.target.value as typeof filtroNF)}
          className="h-9 rounded-xl px-3 text-[12px] font-medium bg-muted/30 border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/30">
          <option value="todos">Todas NFs</option>
          <option value="sem_nf">Sem NF</option>
          <option value="manual">NF Manual</option>
          <option value="pendente">NF Pendente</option>
          <option value="autorizada">NF Autorizada</option>
        </select>
        <button type="button" onClick={() => setShowRecorr(v => !v)}
          className={cn("h-9 px-3 flex items-center gap-1.5 rounded-xl text-[11px] font-semibold border transition-all",
            showRecorr
              ? "bg-violet-500/15 border-violet-500/40 text-violet-600"
              : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50")}>
          <Repeat2 size={13} />Recorrentes
        </button>
        <input type="date" value={filtroDataInicio} onChange={e => setFiltroDataInicio(e.target.value)}
          title="Data início"
          className="h-9 rounded-xl border border-border/50 bg-background text-foreground text-[11px] px-2 focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
        <span className="text-[10px] text-muted-foreground">–</span>
        <input type="date" value={filtroDataFim} onChange={e => setFiltroDataFim(e.target.value)}
          title="Data fim"
          className="h-9 rounded-xl border border-border/50 bg-background text-foreground text-[11px] px-2 focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
        {(filtroDataInicio || filtroDataFim) && (
          <button type="button" onClick={() => { setFiltroDataInicio(""); setFiltroDataFim(""); }}
            className="h-9 w-9 flex items-center justify-center rounded-xl hover:bg-muted/50 text-muted-foreground transition-colors" title="Limpar período">
            <X size={13} />
          </button>
        )}
        <button type="button" onClick={load} disabled={loading}
          className="h-9 w-9 flex items-center justify-center rounded-xl bg-muted/30 border border-border hover:bg-muted/50 transition-colors">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {!loading && itens.length > 0 && (
        <p className="text-[11px] text-muted-foreground/70">
          {itensFiltrados.length} de {itens.length} lançamentos{search && ` · "${search}"`}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-6 w-6 border-2 border-violet-500 border-t-transparent rounded-full" />
        </div>
      ) : itensFiltrados.length === 0 ? (
        <div className="text-center py-14 space-y-3">
          <div className="h-16 w-16 rounded-2xl mx-auto flex items-center justify-center bg-muted/30">
            <ShoppingCart size={28} className="text-muted-foreground/40" />
          </div>
          <div>
            <p className="text-sm font-semibold">
              {itens.length === 0 ? "Nenhum lançamento registrado" : "Nenhum resultado para o filtro"}
            </p>
            <p className="text-[12px] text-muted-foreground/70 mt-0.5">
              {itens.length === 0 ? "Clique em 'Novo lançamento' para começar" : "Limpe os filtros para ver todos"}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {itensFiltrados.map(item => {
            const CatIcon  = allCats.find(c => c.valor === item.categoria)?.icon ?? Package;
            const catLabel = allCats.find(c => c.valor === item.categoria)?.label ?? item.categoria;
            const nf       = nfColors[item.status_nf];
            const isMes    = item.data_lancamento.startsWith(mesAtualStr);
            return (
              <div key={item.id} className="rounded-xl overflow-hidden flex flex-col bg-card border border-border/50 hover:border-border hover:shadow-md transition-all">
                <div style={{ height: 3, background: isMes ? "#f97316" : "hsl(var(--border))" }} />
                <div className="p-3 flex-1 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                        <CatIcon size={15} className="text-violet-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[12px] font-bold text-foreground truncate">{item.descricao}</p>
                        <p className="text-[10px] text-muted-foreground/70">{catLabel}</p>
                      </div>
                    </div>
                    <p className="text-[14px] font-black shrink-0 text-red-600 dark:text-red-400 font-mono tabular-nums">
                      {fmtCurrency(item.valor)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-lg border", nf.cls)}>{nf.label}</span>
                    {item.recorrente && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg flex items-center gap-1 bg-sky-500/10 text-sky-600 border border-sky-500/20">
                        <Repeat2 size={9} />{item.periodicidade}
                      </span>
                    )}
                    {isMes && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-orange-500/10 text-orange-600 border border-orange-500/20">mês atual</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground/70">
                    <span className="truncate">{item.fornecedor ?? "—"}</span>
                    <span className="font-mono shrink-0 ml-2">{new Date(item.data_lancamento + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                  </div>
                  {(item.nota_fiscal_manual || item.chave_nfe) && (
                    <div className="rounded-lg px-2 py-1.5 bg-muted/30 border border-border/40">
                      {item.nota_fiscal_manual && <p className="text-[10px] font-mono text-muted-foreground">NF: {item.nota_fiscal_manual}</p>}
                      {item.chave_nfe && <p className="text-[9px] font-mono text-muted-foreground/70 truncate">Chave: {item.chave_nfe.slice(0, 20)}…</p>}
                    </div>
                  )}
                  {item.observacoes && <p className="text-[10px] text-muted-foreground italic line-clamp-2">{item.observacoes}</p>}
                </div>
                <div className="flex" style={{ borderTop: "1px solid hsl(var(--border))" }}>
                  <button type="button" onClick={() => { setEditItem(item); setModalOpen(true); }}
                    className="flex-1 h-8 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-violet-500/8 hover:text-violet-700 transition-colors">
                    <Edit3 size={11} />Editar
                  </button>
                  <div style={{ width: 1, background: "hsl(var(--border))" }} />
                  <button type="button" onClick={() => setDelItem(item)}
                    className="flex-1 h-8 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-muted-foreground/70 hover:bg-red-500/8 hover:text-red-600 transition-colors">
                    <Trash2 size={11} />Excluir
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <LancamentoModal
        open={modalOpen} tipo={tipo} inicial={editItem} modoTeste={modoTeste}
        onClose={() => { setModalOpen(false); setEditItem(null); }}
        onSuccess={() => { setModalOpen(false); setEditItem(null); load(); }}
      />

      {delItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-card border border-border/40 p-5 space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-red-100 dark:bg-red-950/40 flex items-center justify-center shrink-0">
                <Trash2 size={18} className="text-red-600" />
              </div>
              <div>
                <p className="text-[14px] font-bold">Excluir lançamento?</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">{delItem.descricao}</p>
                <p className="text-[13px] font-bold mt-1 text-red-500">{fmtCurrency(delItem.valor)}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDelItem(null)} disabled={deleting}
                className="flex-1 h-9 rounded-xl border border-border/50 text-sm font-semibold text-muted-foreground hover:bg-muted/40 transition-colors">
                Cancelar
              </button>
              <button type="button" onClick={handleDelete} disabled={deleting}
                className="flex-1 h-9 rounded-xl text-white text-sm font-bold transition-colors flex items-center justify-center gap-1.5"
                style={{ background: "#dc2626" }}>
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
