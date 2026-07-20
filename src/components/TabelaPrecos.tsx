/**
 * TabelaPrecos — Componente compartilhado entre Financeiro e Comercial
 * 
 * Props:
 *   canEdit: boolean — true para financeiro, false para comercial (somente leitura)
 *   modoTeste: boolean — passa false normalmente
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { friendlyError } from "@/lib/errorMessages";
import { escHtml } from "@/lib/escHtml";
import { formatBRL } from "@/lib/format";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { Edit3, Tag, TrendingDown, Percent, AlertTriangle, X, RefreshCw, FileSpreadsheet, Printer, ChevronDown, ChevronUp, Package, Trash2, Loader2, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";

// ─── PainelTabelaPrecos ───────────────────────────────────────────────────────

interface DevicePreco {
  id: string;
  model: string;
  reference: string;
  internal_code: string;
  ncm: string;
  cfop_padrao: string;
  ipi_pct: number;
  unidade: string;
  preco_custo: number;
  preco_venda: number;
  desconto_max_pct: number;
  margem_minima_pct: number;
  ativo: boolean;
  observacoes_preco: string | null;
}

function fmtCurrency(v: number) {
  return formatBRL(v);
}

export function TabelaPrecos({ modoTeste, canEdit = true }: { modoTeste: boolean; canEdit?: boolean }) {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const [devices,    setDevices]    = useState<DevicePreco[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState<string | null>(null);
  const [search,     setSearch]     = useState("");
  const [editRow,    setEditRow]    = useState<string | null>(null);
  const [editData,   setEditData]   = useState<Partial<DevicePreco>>({});
  const [showInativ, setShowInativ] = useState(false);
  const [sortKey,    setSortKey]    = useState<keyof DevicePreco>("model");
  const [sortAsc,    setSortAsc]    = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // Busca todas as peças com paginação (sem limite padrão do Supabase de 1000)
    const PAGE = 1000;
    let all: DevicePreco[] = [];
    let from = 0;
    let keepGoing = true;
    while (keepGoing) {
      const { data, error } = await supabase
        .from("devices")
        .select("id, model, reference, internal_code, ncm, cfop_padrao, ipi_pct, unidade, preco_custo, preco_venda, desconto_max_pct, margem_minima_pct, ativo, observacoes_preco")
        .order("model")
        .range(from, from + PAGE - 1);
      if (error) { toast.error(friendlyError(error)); break; }
      all = all.concat((data ?? []) as DevicePreco[]);
      keepGoing = (data?.length ?? 0) === PAGE;
      from += PAGE;
    }
    setDevices(all);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function limparPrecos() {
    if (!window.confirm(t("tabelaPrecosStandalone.confirmClearPrices"))) return;
    const { error } = await supabase.from("devices").update({ preco_custo: 0, preco_venda: 0 }).neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) { toast.error(t("tabelaPrecosStandalone.toastClearPricesError")); return; }
    toast.success(t("tabelaPrecosStandalone.toastPricesCleared"));
    load();
  }

  async function preencherPrecosTeste() {
    if (!window.confirm(t("tabelaPrecosStandalone.confirmTestPrices"))) return;
    // Um único UPDATE com valor fixo para todas as peças — sem loop, sem timeout
    const custo = 45.00;
    const venda = 120.00;
    const { error } = await supabase
      .from("devices")
      .update({ preco_custo: custo, preco_venda: venda })
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) { toast.error(t("tabelaPrecosStandalone.toastFillPricesError") + error.message); return; }
    toast.success(t("tabelaPrecosStandalone.toastTestPricesFilled"));
    load();
  }

  function exportExcel() {
    // Gera CSV detalhado e dispara download (funciona sem lib externa)
    const headers = t("tabelaPrecosStandalone.xlsxHeaders", { returnObjects: true }) as string[];
    const BOM = "\uFEFF"; // UTF-8 BOM para Excel reconhecer acentos
    const rows = filtered.map(d => {
      const margem = d.preco_venda > 0
        ? ((d.preco_venda - d.preco_custo) / d.preco_venda * 100).toFixed(2)
        : "0.00";
      return [
        d.model, d.reference, d.internal_code, d.ncm, d.cfop_padrao, String(d.ipi_pct ?? 0),
        d.unidade,
        d.preco_custo.toFixed(2).replace(".", ","),
        d.preco_venda.toFixed(2).replace(".", ","),
        margem.replace(".", ","),
        String(d.desconto_max_pct),
        String(d.margem_minima_pct),
        d.ativo ? t("tabelaPrecosStandalone.yes") : t("tabelaPrecosStandalone.no"),
        d.observacoes_preco ?? "",
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(";");
    });
    const csv = BOM + [headers.map(h => `"${h}"`).join(";"), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `tabela-precos-zomini-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("tabelaPrecosStandalone.toastExported", { count: filtered.length }));
  }

  function printTabelaPrecos() {
    const esc = escHtml;
    const rows = filtered.map(d => {
      const margem = d.preco_venda > 0
        ? ((d.preco_venda - d.preco_custo) / d.preco_venda * 100).toFixed(1) + "%"
        : "—";
      return `<tr>
        <td>${esc(d.model)}</td>
        <td>${esc(d.reference)}</td>
        <td>${esc(d.ncm)}</td>
        <td style="text-align:right">R$ ${d.preco_custo.toFixed(2).replace(".",",")}</td>
        <td style="text-align:right">R$ ${d.preco_venda.toFixed(2).replace(".",",")}</td>
        <td style="text-align:center">${margem}</td>
        <td style="text-align:center">${d.desconto_max_pct}%</td>
        <td style="text-align:center">${d.ativo ? t("tabelaPrecosStandalone.active") : t("tabelaPrecosStandalone.inactive")}</td>
      </tr>`;
    }).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>${t("tabelaPrecosStandalone.printTitle")}</title>
    <style>
      body{font-family:Arial,sans-serif;font-size:11px;padding:16px;color:#111}
      h1{font-size:16px;font-weight:700;margin-bottom:4px}
      p.sub{font-size:10px;color:#666;margin-bottom:12px}
      table{width:100%;border-collapse:collapse}
      th{background:#f3f0ff;color:#5b21b6;font-size:9px;text-transform:uppercase;padding:6px 8px;border-bottom:2px solid #ddd6fe;text-align:left}
      td{padding:5px 8px;border-bottom:1px solid #f0eeff;font-size:10px;vertical-align:top}
      tr:nth-child(even) td{background:#faf9ff}
      @media print{body{padding:8px}button{display:none}}
    </style></head>
    <body>
    <h1>${t("tabelaPrecosStandalone.printTitle")}</h1>
    <p class="sub">${t("tabelaPrecosStandalone.printGeneratedOn", { date: new Date().toLocaleString(t("tabelaPrecosStandalone.localeCode")), count: filtered.length })}</p>
    <table><thead><tr>
      <th>${t("tabelaPrecosStandalone.colModel")}</th><th>${t("tabelaPrecosStandalone.colReference")}</th><th>NCM</th>
      <th style="text-align:right">${t("tabelaPrecosStandalone.colCost")}</th><th style="text-align:right">${t("tabelaPrecosStandalone.colSale")}</th>
      <th style="text-align:center">${t("tabelaPrecosStandalone.colMargin")}</th><th style="text-align:center">${t("tabelaPrecosStandalone.colMaxDiscount")}</th><th style="text-align:center">${t("tabelaPrecosStandalone.colStatus")}</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <script>window.print();</script>
    </body></html>`;
    const w = window.open("", "_blank");
    if (!w) { toast.error(t("tabelaPrecosStandalone.toastPopupBlocked")); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  function startEdit(d: DevicePreco) {
    setEditRow(d.id);
    setEditData({
      preco_custo: d.preco_custo, preco_venda: d.preco_venda,
      desconto_max_pct: d.desconto_max_pct, margem_minima_pct: d.margem_minima_pct,
      ncm: d.ncm, cfop_padrao: d.cfop_padrao, unidade: d.unidade,
      ativo: d.ativo, observacoes_preco: d.observacoes_preco ?? "",
    });
  }

  async function saveEdit(id: string) {
    if (!editData) return;
    setSaving(id);
    const payload = {
      preco_custo:       editData.preco_custo       ?? 0,
      preco_venda:       editData.preco_venda        ?? 0,
      desconto_max_pct:  editData.desconto_max_pct   ?? 0,
      margem_minima_pct: editData.margem_minima_pct  ?? 0,
      ncm:               editData.ncm               ?? "90213990",
      cfop_padrao:       editData.cfop_padrao        ?? "5102",
      unidade:           editData.unidade            ?? "UN",
      ativo:             editData.ativo              ?? true,
      observacoes_preco: editData.observacoes_preco  || null,
    };
    const { error } = await supabase.from("devices").update(payload).eq("id", id);
    setSaving(null);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(t("tabelaPrecosStandalone.toastPriceUpdated"));
    setEditRow(null);
    setDevices(prev => prev.map(d => d.id === id ? { ...d, ...payload } : d));
  }

  function cancelEdit() { setEditRow(null); setEditData({}); }

  function toggleSort(k: keyof DevicePreco) {
    if (sortKey === k) setSortAsc(v => !v);
    else { setSortKey(k); setSortAsc(true); }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return devices
      .filter(d => (showInativ || d.ativo) && (
        !q ||
        d.model.toLowerCase().includes(q) ||
        d.reference.toLowerCase().includes(q) ||
        d.internal_code.toLowerCase().includes(q) ||
        d.ncm.includes(q)
      ))
      .sort((a, b) => {
        const va = a[sortKey]; const vb = b[sortKey];
        const cmp = typeof va === "string"
          ? (va as string).localeCompare(vb as string)
          : (va as number) - (vb as number);
        return sortAsc ? cmp : -cmp;
      });
  }, [devices, search, showInativ, sortKey, sortAsc]);

  const totalCusto  = filtered.reduce((s, d) => s + d.preco_custo, 0);
  const totalVenda  = filtered.reduce((s, d) => s + d.preco_venda, 0);
  const semPreco    = filtered.filter(d => d.preco_venda <= 0).length;
  const margemMedia = filtered.length > 0
    ? filtered.reduce((s, d) => {
        if (d.preco_venda <= 0) return s;
        return s + ((d.preco_venda - d.preco_custo) / d.preco_venda) * 100;
      }, 0) / filtered.filter(d => d.preco_venda > 0).length
    : 0;

  function SortBtn({ col, label }: { col: keyof DevicePreco; label: string }) {
    const active = sortKey === col;
    return (
      <button type="button" onClick={() => toggleSort(col)}
        className={cn("flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide transition-colors whitespace-nowrap",
          active ? "text-violet-600" : "text-muted-foreground hover:text-foreground")}>
        {label}
        {active ? (sortAsc ? <ChevronUp size={10} /> : <ChevronDown size={10} />) : null}
      </button>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: t("tabelaPrecosStandalone.kpiAvgSalePrice"), value: filtered.length > 0 ? fmtCurrency(totalVenda / filtered.length) : "—", icon: Tag,          color: "#7c3aed" },
          { label: t("tabelaPrecosStandalone.kpiAvgCost"),       value: filtered.length > 0 ? fmtCurrency(totalCusto / filtered.length) : "—", icon: TrendingDown,  color: "#ef4444" },
          { label: t("tabelaPrecosStandalone.kpiAvgMargin"),      value: `${margemMedia.toFixed(1)}%`,                                             icon: Percent,       color: margemMedia >= 20 ? "#10b981" : "#f97316" },
          { label: t("tabelaPrecosStandalone.kpiNoPrice"),         value: String(semPreco),                                                          icon: AlertTriangle, color: semPreco > 0 ? "#d97706" : "#10b981" },
        ].map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-2xl p-4 flex items-center gap-3 bg-card border border-border/50">
              <div className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `${k.color}15`, color: k.color }}>
                <Icon size={18} />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{k.label}</p>
                <p className="text-[17px] font-black tabular-nums" style={{ color: k.color }}>{k.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <SearchInputWithBarcode
          className="flex-1 min-w-[180px]"
          value={search}
          onChange={v => setSearch(v)}
          onSearch={v => setSearch(v)}
          placeholder={t("tabelaPrecosStandalone.searchPlaceholder")}
          height="h-9"
          showSearchIcon
        />
        <button type="button" onClick={() => setShowInativ(v => !v)}
          className={cn("h-9 px-3 flex items-center gap-1.5 rounded-xl text-[11px] font-semibold border transition-all",
            showInativ ? "bg-violet-500/15 border-violet-500/40 text-violet-600" : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50")}>
          <Package size={13} />{t("tabelaPrecosStandalone.inactiveBtn")}
        </button>
        <button type="button" onClick={load} disabled={loading}
          className="h-9 w-9 flex items-center justify-center rounded-xl bg-muted/30 border border-border hover:bg-muted/50 transition-colors">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
        <span className="text-[11px] text-muted-foreground/70">{t("tabelaPrecosStandalone.piecesCount", { count: filtered.length })}</span>
        <button type="button" onClick={exportExcel} disabled={filtered.length === 0}
          className="h-9 px-3 flex items-center gap-1.5 rounded-xl text-[11px] font-bold border border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/8 hover:bg-emerald-500/15 transition-colors disabled:opacity-40">
          <FileSpreadsheet size={14} />{t("tabelaPrecosStandalone.exportExcel")}
        </button>
        <button type="button" onClick={printTabelaPrecos} disabled={filtered.length === 0}
          className="h-9 px-3 flex items-center gap-1.5 rounded-xl text-[11px] font-bold border border-violet-500/40 text-violet-700 dark:text-violet-400 bg-violet-500/8 hover:bg-violet-500/15 transition-colors disabled:opacity-40">
          <Printer size={14} />{t("tabelaPrecosStandalone.printPdf")}
        </button>
        {isAdmin && canEdit && (
          <>
            <button type="button" onClick={preencherPrecosTeste}
              className="h-9 px-3 flex items-center gap-1.5 rounded-xl text-[11px] font-bold border border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/8 hover:bg-amber-500/15 transition-colors">
              <Tag size={14} />{t("tabelaPrecosStandalone.testPrices")}
            </button>
            <button type="button" onClick={limparPrecos}
              className="h-9 px-3 flex items-center gap-1.5 rounded-xl text-[11px] font-bold border border-destructive/40 text-destructive bg-destructive/5 hover:bg-destructive/10 transition-colors">
              <Trash2 size={14} />{t("tabelaPrecosStandalone.clearAll")}
            </button>
          </>
        )}
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-6 w-6 border-2 border-violet-500 border-t-transparent rounded-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-14 space-y-2">
          <Tag size={32} className="text-muted-foreground/20 mx-auto" />
          <p className="text-sm text-muted-foreground">{t("tabelaPrecosStandalone.noPieceFound")}</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
          {/* Cabeçalho */}
          <div className="grid gap-2 px-4 py-2.5 bg-muted/30 border-b border-border/40"
            style={{ gridTemplateColumns: "1fr 100px 100px 70px 70px 50px 100px" }}>
            <SortBtn col="model"       label={t("tabelaPrecosStandalone.colModelReference")} />
            <SortBtn col="preco_custo" label={t("tabelaPrecosStandalone.colCostBrl")} />
            <SortBtn col="preco_venda" label={t("tabelaPrecosStandalone.colSaleBrl")} />
            <SortBtn col="ncm"         label={t("tabelaPrecosStandalone.colNcm")} />
            <SortBtn col="cfop_padrao" label={t("tabelaPrecosStandalone.colCfop")} />
            <SortBtn col="ativo"       label={t("tabelaPrecosStandalone.colActive")} />
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{t("tabelaPrecosStandalone.actions")}</span>
          </div>

          {/* Linhas */}
          <div className="divide-y divide-border/30">
            {filtered.map(d => {
              const isEdit = editRow === d.id;
              const isSav  = saving  === d.id;
              const margem = d.preco_venda > 0
                ? ((d.preco_venda - d.preco_custo) / d.preco_venda * 100)
                : 0;
              const margemOk = d.preco_venda > 0 && margem >= d.margem_minima_pct;

              return (
                <div key={d.id}
                  className={cn("grid gap-2 px-4 py-2 items-center transition-colors",
                    isEdit ? "bg-violet-500/5 border-l-2 border-violet-500" : "hover:bg-muted/20",
                    !d.ativo && "opacity-50")}
                  style={{ gridTemplateColumns: "1fr 100px 100px 70px 70px 50px 100px" }}>

                  {/* Modelo */}
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold truncate">{d.model}</p>
                    <p className="text-[10px] text-muted-foreground/70 truncate">{d.reference} · {d.internal_code}</p>
                    {isEdit && editData.observacoes_preco !== undefined && (
                      <input type="text"
                        value={editData.observacoes_preco ?? ""}
                        onChange={e => setEditData(prev => ({ ...prev, observacoes_preco: e.target.value.slice(0,120) }))}
                        placeholder={t("tabelaPrecosStandalone.observationPlaceholder")}
                        className="mt-1 w-full h-6 rounded-lg border border-border/50 bg-background text-foreground px-2 text-[10px] focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                      />
                    )}
                  </div>

                  {/* Preço Custo */}
                  {isEdit ? (
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground">R$</span>
                      <input type="number" inputMode="decimal" min="0" step="0.01"
                        value={editData.preco_custo === 0 || editData.preco_custo == null ? "" : editData.preco_custo}
                        onChange={e => {
                          const raw = e.target.value;
                          if (raw === "") { setEditData(prev => ({ ...prev, preco_custo: undefined })); return; }
                          const v = parseFloat(raw);
                          if (!isNaN(v)) setEditData(prev => ({ ...prev, preco_custo: v }));
                        }}
                        onBlur={() => setEditData(prev => ({ ...prev, preco_custo: prev.preco_custo ?? 0 }))}
                        className="w-full h-8 rounded-lg border border-border/50 bg-background text-foreground pl-5 pr-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                      />
                    </div>
                  ) : (
                    <p className="text-[12px] font-mono tabular-nums text-muted-foreground">{fmtCurrency(d.preco_custo)}</p>
                  )}

                  {/* Preço Venda */}
                  {isEdit ? (
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground">R$</span>
                      <input type="number" inputMode="decimal" min="0" step="0.01"
                        value={editData.preco_venda === 0 || editData.preco_venda == null ? "" : editData.preco_venda}
                        onChange={e => {
                          const raw = e.target.value;
                          if (raw === "") { setEditData(prev => ({ ...prev, preco_venda: undefined })); return; }
                          const v = parseFloat(raw);
                          if (!isNaN(v)) setEditData(prev => ({ ...prev, preco_venda: v }));
                        }}
                        onBlur={() => setEditData(prev => ({ ...prev, preco_venda: prev.preco_venda ?? 0 }))}
                        className={cn("w-full h-8 rounded-lg border bg-background text-foreground pl-5 pr-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40",
                          (editData.preco_venda ?? 0) > 0 ? "border-border/50" : "border-amber-500/60")}
                      />
                    </div>
                  ) : (
                    <p className={cn("text-[12px] font-bold font-mono tabular-nums",
                      d.preco_venda > 0 ? "text-violet-600" : "text-amber-500")}>
                      {d.preco_venda > 0 ? fmtCurrency(d.preco_venda) : "—"}
                    </p>
                  )}


                  {/* NCM */}
                  {isEdit ? (
                    <input type="text" inputMode="numeric"
                      value={editData.ncm ?? ""}
                      onChange={e => setEditData(prev => ({ ...prev, ncm: e.target.value.replace(/\D/g,"").slice(0,8) }))}
                      className="w-full h-8 rounded-lg border border-border/50 bg-background text-foreground px-2 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                    />
                  ) : (
                    <p className="text-[10px] font-mono text-muted-foreground">{d.ncm || "—"}</p>
                  )}

                  {/* CFOP */}
                  {isEdit ? (
                    <input type="text" inputMode="numeric"
                      value={editData.cfop_padrao ?? ""}
                      onChange={e => setEditData(prev => ({ ...prev, cfop_padrao: e.target.value.replace(/\D/g,"").slice(0,4) }))}
                      className="w-full h-8 rounded-lg border border-border/50 bg-background text-foreground px-2 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                    />
                  ) : (
                    <p className="text-[10px] font-mono text-muted-foreground">{d.cfop_padrao || "—"}</p>
                  )}


                  {/* Ativo */}
                  {isEdit ? (
                    <button type="button" onClick={() => setEditData(prev => ({ ...prev, ativo: !prev.ativo }))}
                      className={cn("h-5 w-9 rounded-full transition-colors relative shrink-0",
                        editData.ativo ? "bg-violet-500" : "bg-muted/50")}>
                      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-background text-foreground shadow transition-all",
                        editData.ativo ? "left-[calc(100%-18px)]" : "left-0.5")} />
                    </button>
                  ) : (
                    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full border",
                      d.ativo
                        ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                        : "bg-muted/30 text-muted-foreground border-border/30")}>
                      {d.ativo ? t("tabelaPrecosStandalone.yes") : t("tabelaPrecosStandalone.no")}
                    </span>
                  )}

                  {/* Ações */}
                  {isEdit ? (
                    <div className="flex gap-1">
                      <button type="button" onClick={() => saveEdit(d.id)} disabled={isSav}
                        className="flex-1 h-7 flex items-center justify-center rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50">
                        {isSav ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                      </button>
                      <button type="button" onClick={cancelEdit}
                        className="h-7 w-7 flex items-center justify-center rounded-lg bg-muted/40 hover:bg-muted/70 text-muted-foreground transition-colors">
                        <X size={11} />
                      </button>
                    </div>
                  ) : canEdit ? (
                    <button type="button" onClick={() => startEdit(d)}
                      className="h-7 px-2.5 flex items-center gap-1 rounded-lg bg-muted/30 hover:bg-violet-500/10 hover:text-violet-600 text-muted-foreground text-[10px] font-semibold transition-colors">
                      <Edit3 size={11} />{t("tabelaPrecosStandalone.edit")}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* Rodapé totais */}
          <div className="grid gap-2 px-4 py-2.5 bg-muted/20 border-t border-border/40 font-bold"
            style={{ gridTemplateColumns: "1fr 100px 100px 70px 70px 50px 100px" }}>
            <p className="text-[11px] text-muted-foreground">{t("tabelaPrecosStandalone.piecesCount", { count: filtered.length })}</p>
            <p className="text-[11px] font-mono text-muted-foreground">{fmtCurrency(totalCusto / (filtered.length || 1))}</p>
            <p className="text-[11px] font-mono text-violet-600">{fmtCurrency(totalVenda / (filtered.length || 1))}</p>
            <p className="text-[11px] text-muted-foreground col-span-4">{t("tabelaPrecosStandalone.avgPerPiece")}</p>
          </div>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground">
            {t("tabelaPrecosStandalone.priceReferenceNote")}
            {t("tabelaPrecosStandalone.maxDiscountNote")} <strong className="text-foreground">{t("tabelaPrecosStandalone.individuallyPerItem")}</strong>{t("tabelaPrecosStandalone.notOnOrderTotal")}
            {modoTeste && <span className="text-orange-500 font-semibold">{t("tabelaPrecosStandalone.homologationActive")}</span>}
          </p>
        </div>
      )}
    </div>
  );
}
