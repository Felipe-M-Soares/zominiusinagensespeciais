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
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { Edit3, Tag, TrendingDown, Percent, AlertTriangle, X, RefreshCw, FileSpreadsheet, Printer, ChevronDown, ChevronUp, Package } from "lucide-react";

// ─── PainelTabelaPrecos ───────────────────────────────────────────────────────

interface DevicePreco {
  id: string;
  model: string;
  reference: string;
  internal_code: string;
  ncm: string;
  cfop_padrao: string;
  unidade: string;
  preco_custo: number;
  preco_venda: number;
  desconto_max_pct: number;
  margem_minima_pct: number;
  ativo: boolean;
  observacoes_preco: string | null;
}

export function TabelaPrecos({ modoTeste, canEdit = true }: { modoTeste: boolean; canEdit?: boolean }) {
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
        .select("id, model, reference, internal_code, ncm, cfop_padrao, unidade, preco_custo, preco_venda, desconto_max_pct, margem_minima_pct, ativo, observacoes_preco")
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

  function exportExcel() {
    // Gera CSV detalhado e dispara download (funciona sem lib externa)
    const headers = [
      "Modelo", "Referência", "Cód. Interno", "NCM", "CFOP",
      "Unidade", "Preço Custo (R$)", "Preço Venda (R$)",
      "Margem Real (%)", "Desconto Máx (%)", "Margem Mín (%)",
      "Ativo", "Observações"
    ];
    const BOM = "\uFEFF"; // UTF-8 BOM para Excel reconhecer acentos
    const rows = filtered.map(d => {
      const margem = d.preco_venda > 0
        ? ((d.preco_venda - d.preco_custo) / d.preco_venda * 100).toFixed(2)
        : "0.00";
      return [
        d.model, d.reference, d.internal_code, d.ncm, d.cfop_padrao,
        d.unidade,
        d.preco_custo.toFixed(2).replace(".", ","),
        d.preco_venda.toFixed(2).replace(".", ","),
        margem.replace(".", ","),
        String(d.desconto_max_pct),
        String(d.margem_minima_pct),
        d.ativo ? "Sim" : "Não",
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
    toast.success(`Planilha exportada! ${filtered.length} peças.`);
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
        <td style="text-align:center">${d.ativo ? "Ativo" : "Inativo"}</td>
      </tr>`;
    }).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Tabela de Preços — Zomini</title>
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
    <h1>Tabela de Preços — Zomini Usinagens Especiais</h1>
    <p class="sub">Gerado em ${new Date().toLocaleString("pt-BR")} · ${filtered.length} peças</p>
    <table><thead><tr>
      <th>Modelo</th><th>Referência</th><th>NCM</th>
      <th style="text-align:right">Custo</th><th style="text-align:right">Venda</th>
      <th style="text-align:center">Margem</th><th style="text-align:center">Desc. Máx</th><th style="text-align:center">Status</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <script>window.print();</script>
    </body></html>`;
    const w = window.open("", "_blank");
    if (!w) { toast.error("Popup bloqueado. Permita popups para imprimir."); return; }
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
    toast.success("Preço atualizado!");
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
          { label: "Preço Médio Venda", value: filtered.length > 0 ? fmtCurrency(totalVenda / filtered.length) : "—", icon: Tag,          color: "#7c3aed" },
          { label: "Custo Médio",       value: filtered.length > 0 ? fmtCurrency(totalCusto / filtered.length) : "—", icon: TrendingDown,  color: "#ef4444" },
          { label: "Margem Média",      value: `${margemMedia.toFixed(1)}%`,                                             icon: Percent,       color: margemMedia >= 20 ? "#10b981" : "#f97316" },
          { label: "Sem Preço",         value: String(semPreco),                                                          icon: AlertTriangle, color: semPreco > 0 ? "#d97706" : "#10b981" },
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
          placeholder="Buscar por modelo, referência, NCM ou bipe o código..."
          height="h-9"
          showSearchIcon
        />
        <button type="button" onClick={() => setShowInativ(v => !v)}
          className={cn("h-9 px-3 flex items-center gap-1.5 rounded-xl text-[11px] font-semibold border transition-all",
            showInativ ? "bg-violet-500/15 border-violet-500/40 text-violet-600" : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50")}>
          <Package size={13} />Inativos
        </button>
        <button type="button" onClick={load} disabled={loading}
          className="h-9 w-9 flex items-center justify-center rounded-xl bg-muted/30 border border-border hover:bg-muted/50 transition-colors">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
        <span className="text-[11px] text-muted-foreground/70">{filtered.length} peças</span>
        <button type="button" onClick={exportExcel} disabled={filtered.length === 0}
          className="h-9 px-3 flex items-center gap-1.5 rounded-xl text-[11px] font-bold border border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/8 hover:bg-emerald-500/15 transition-colors disabled:opacity-40">
          <FileSpreadsheet size={14} />Exportar Excel
        </button>
        <button type="button" onClick={printTabelaPrecos} disabled={filtered.length === 0}
          className="h-9 px-3 flex items-center gap-1.5 rounded-xl text-[11px] font-bold border border-violet-500/40 text-violet-700 dark:text-violet-400 bg-violet-500/8 hover:bg-violet-500/15 transition-colors disabled:opacity-40">
          <Printer size={14} />Imprimir PDF
        </button>
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-6 w-6 border-2 border-violet-500 border-t-transparent rounded-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-14 space-y-2">
          <Tag size={32} className="text-muted-foreground/20 mx-auto" />
          <p className="text-sm text-muted-foreground">Nenhuma peça encontrada</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
          {/* Cabeçalho */}
          <div className="grid gap-2 px-4 py-2.5 bg-muted/30 border-b border-border/40"
            style={{ gridTemplateColumns: "1fr 100px 100px 80px 70px 70px 90px 50px 100px" }}>
            <SortBtn col="model"           label="Modelo / Referência" />
            <SortBtn col="preco_custo"     label="Custo (R$)" />
            <SortBtn col="preco_venda"     label="Venda (R$)" />
            <SortBtn col="desconto_max_pct" label="Desc. Máx" />
            <SortBtn col="ncm"             label="NCM" />
            <SortBtn col="cfop_padrao"     label="CFOP" />
            <SortBtn col="margem_minima_pct" label="Margem Mín" />
            <SortBtn col="ativo"           label="Ativo" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Ações</span>
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
                  style={{ gridTemplateColumns: "1fr 100px 100px 80px 70px 70px 90px 50px 100px" }}>

                  {/* Modelo */}
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold truncate">{d.model}</p>
                    <p className="text-[10px] text-muted-foreground/70 truncate">{d.reference} · {d.internal_code}</p>
                    {isEdit && editData.observacoes_preco !== undefined && (
                      <input type="text"
                        value={editData.observacoes_preco ?? ""}
                        onChange={e => setEditData(prev => ({ ...prev, observacoes_preco: e.target.value.slice(0,120) }))}
                        placeholder="Observação (opcional)"
                        className="mt-1 w-full h-6 rounded-lg border border-border/50 bg-background text-foreground px-2 text-[10px] focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                      />
                    )}
                  </div>

                  {/* Preço Custo */}
                  {isEdit ? (
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground">R$</span>
                      <input type="number" min="0" step="0.01"
                        value={editData.preco_custo ?? ""}
                        onChange={e => setEditData(prev => ({ ...prev, preco_custo: parseFloat(e.target.value) || 0 }))}
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
                      <input type="number" min="0" step="0.01"
                        value={editData.preco_venda ?? ""}
                        onChange={e => setEditData(prev => ({ ...prev, preco_venda: parseFloat(e.target.value) || 0 }))}
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

                  {/* Desconto Máx */}
                  {isEdit ? (
                    <div className="flex items-center gap-1">
                      <input type="number" min="0" max="100" step="1"
                        value={editData.desconto_max_pct ?? 0}
                        onChange={e => setEditData(prev => ({ ...prev, desconto_max_pct: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)) }))}
                        className="w-full h-8 rounded-lg border border-border/50 bg-background text-foreground px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                      />
                      <span className="text-[10px] text-muted-foreground shrink-0">%</span>
                    </div>
                  ) : (
                    <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-lg border",
                      d.desconto_max_pct > 0
                        ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                        : "bg-muted/30 text-muted-foreground border-border/30")}>
                      {d.desconto_max_pct}%
                    </span>
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

                  {/* Margem mínima */}
                  {isEdit ? (
                    <div className="flex items-center gap-1">
                      <input type="number" min="0" max="100" step="1"
                        value={editData.margem_minima_pct ?? 0}
                        onChange={e => setEditData(prev => ({ ...prev, margem_minima_pct: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)) }))}
                        className="w-full h-8 rounded-lg border border-border/50 bg-background text-foreground px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                      />
                      <span className="text-[10px] text-muted-foreground shrink-0">%</span>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      <span className={cn("text-[10px] font-bold",
                        d.preco_venda > 0 && (margemOk ? "text-emerald-600" : "text-red-500"))}>
                        {d.preco_venda > 0 ? `${margem.toFixed(1)}%` : "—"}
                      </span>
                      <span className="text-[9px] text-muted-foreground/60">mín {d.margem_minima_pct}%</span>
                    </div>
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
                      {d.ativo ? "Sim" : "Não"}
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
                      <Edit3 size={11} />Editar
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* Rodapé totais */}
          <div className="grid gap-2 px-4 py-2.5 bg-muted/20 border-t border-border/40 font-bold"
            style={{ gridTemplateColumns: "1fr 100px 100px 80px 70px 70px 90px 50px 100px" }}>
            <p className="text-[11px] text-muted-foreground">{filtered.length} peças</p>
            <p className="text-[11px] font-mono text-muted-foreground">{fmtCurrency(totalCusto / (filtered.length || 1))}</p>
            <p className="text-[11px] font-mono text-violet-600">{fmtCurrency(totalVenda / (filtered.length || 1))}</p>
            <p className="text-[11px] text-muted-foreground col-span-6">← médias por peça</p>
          </div>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground">
            Os preços e descontos definidos aqui são usados como referência na emissão de notas fiscais.
            O desconto máx. por peça é aplicado <strong className="text-foreground">individualmente em cada item</strong>, não no total do pedido.
            {modoTeste && <span className="text-orange-500 font-semibold"> · Modo Homologação ativo.</span>}
          </p>
        </div>
      )}
    </div>
  );
}
