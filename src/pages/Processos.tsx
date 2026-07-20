import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ExcelJS from "exceljs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logger } from "@/lib/logger";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PageNav, type PageNavTab } from "@/components/PageNav";
import { useIsMobile } from "@/hooks/use-mobile";
import { FornecedoresPanel } from "@/components/compras/FornecedoresPanel";
import { PedidosCompraPanel } from "@/components/compras/PedidosCompraPanel";
import {
  AlertTriangle,
  Bell,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Code2,
  Copy,
  Database,
  Download,
  Factory,
  FileCode2,
  FileSpreadsheet,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShoppingCart,
  Trash2,
  Truck,
  Upload,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

type Tab = "ferramentas" | "compras" | "fornecedores" | "faltas" | "codigos";
type Linguagem = "G-Code" | "Fanuc" | "Siemens" | "Mazak" | "Haas" | "Heidenhain" | "Okuma" | "Mitsubishi" | "Fagor" | "ISO CNC" | "Macro B" | "Outro";
type TipoFerramenta = "broca" | "inserto" | "pastilha" | "fresa" | "alargador" | "outros";
type StatusFerramenta = "ativo" | "alerta" | "substituir" | "inativo";

// Estas 3 interfaces espelham exatamente as colunas das tabelas do Supabase
// (ferramentas_cnc, programas_cnc, fornecedores/maquinas_producao para os
// dropdowns) — ver migration 20260045000000_processos.sql.
interface Ferramenta {
  id: string;
  codigo: string;
  descricao: string;
  tipo: TipoFerramenta;
  maquina_codigo: string | null;
  vida_util_pecas: number;
  vida_util_horas: number | null;
  pecas_produzidas: number;
  horas_uso: number;
  status: StatusFerramenta;
  ultima_troca: string | null;
  fornecedor_id: string | null;
  custo_unitario: number | null;
  observacoes: string | null;
}

interface Programa {
  id: string;
  nome: string;
  maquina_codigo: string | null;
  linguagem: Linguagem;
  conteudo: string;
  updated_at: string;
}

interface FornecedorOption { id: string; razao_social: string }
interface MaquinaOption { codigo: string; nome: string }

const TIPOS: TipoFerramenta[] = ["broca", "inserto", "pastilha", "fresa", "alargador", "outros"];
const linguagens: Linguagem[] = ["G-Code", "Fanuc", "Siemens", "Mazak", "Haas", "Heidenhain", "Okuma", "Mitsubishi", "Fagor", "ISO CNC", "Macro B", "Outro"];

function NumberInput(props: React.InputHTMLAttributes<HTMLInputElement>) { return <Input type="number" min={0} step={1} {...props} />; }

// "Falta" para uma ferramenta de vida útil (ao contrário de peça de estoque com
// quantidade) é ela estar perto ou além do limite de peças que pode produzir
// antes de precisar ser trocada — status já calculado no banco pela RPC
// atualizar_status_ferramentas() (chamada após cada "+1 peça produzida").
const emFaltaStatus = (f: Ferramenta) => f.status === "alerta" || f.status === "substituir";

function buildTabItems(t: (k: string) => string): PageNavTab<Tab>[] {
  return [
  { id: "ferramentas", label: t("processos.tabs.ferramentas"), Icon: Wrench, activeColor: "text-primary", activeBg: "bg-primary/10", activeBorder: "border-primary/40", badgeBg: "bg-primary/15", badgeText: "text-primary" },
  { id: "compras", label: t("processos.tabs.compras"), Icon: ShoppingCart, activeColor: "text-success", activeBg: "bg-success/10", activeBorder: "border-success/40", badgeBg: "bg-success/15", badgeText: "text-success" },
  { id: "fornecedores", label: t("processos.tabs.fornecedores"), Icon: Truck, activeColor: "text-primary", activeBg: "bg-primary/10", activeBorder: "border-primary/40", badgeBg: "bg-primary/15", badgeText: "text-primary" },
  { id: "faltas", label: t("processos.tabs.faltas"), Icon: AlertTriangle, activeColor: "text-warning", activeBg: "bg-warning/10", activeBorder: "border-warning/40", badgeBg: "bg-warning/15", badgeText: "text-warning" },
  { id: "codigos", label: t("processos.tabs.codigos"), Icon: Code2, activeColor: "text-primary", activeBg: "bg-primary/10", activeBorder: "border-primary/40", badgeBg: "bg-primary/15", badgeText: "text-primary" },
  ];
}

export default function Processos() {
  const { t } = useTranslation();
  const tabItems = buildTabItems(t);
  const [tab, setTab] = useState<Tab>("ferramentas");
  const isMobile = useIsMobile();

  const [ferramentas, setFerramentas] = useState<Ferramenta[]>([]);
  const [loadingFerramentas, setLoadingFerramentas] = useState(true);
  const [pedidosAbertos, setPedidosAbertos] = useState(0);

  const fetchFerramentas = useCallback(async () => {
    setLoadingFerramentas(true);
    const { data, error } = await supabase.from("ferramentas_cnc").select("*").order("codigo");
    if (error) { logger.error("fetchFerramentas error:", error.message); toast.error(t("processos.toastLoadToolsError")); }
    else setFerramentas((data ?? []) as Ferramenta[]);
    setLoadingFerramentas(false);
  }, []);

  const fetchPedidosAbertos = useCallback(async () => {
    const { count } = await supabase
      .from("pedidos_compra")
      .select("id", { count: "exact", head: true })
      .not("status", "in", "(recebido,cancelado)");
    setPedidosAbertos(count ?? 0);
  }, []);

  useEffect(() => { fetchFerramentas(); fetchPedidosAbertos(); }, [fetchFerramentas, fetchPedidosAbertos]);

  const emFalta = useMemo(() => ferramentas.filter(emFaltaStatus), [ferramentas]);
  const totalAtivas = ferramentas.filter((f) => f.status === "ativo").length;
  const totalAlerta = ferramentas.filter(emFaltaStatus).length;

  return <div className="flex flex-col h-full bg-transparent">
    <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/40">
      <div className="px-3 sm:px-4 h-12 sm:h-14 flex items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-2">
          <Factory className="h-4 w-4 text-primary shrink-0" />
          <h1 className="text-sm font-semibold">{t("processos.title")}</h1>
        </div>
        <Badge variant={emFalta.length ? "destructive" : "secondary"} className="gap-1 text-[10px] sm:text-xs">
          <Bell className="h-3 w-3" />{emFalta.length ? `${emFalta.length} ${t("processos.shortagesSuffix")}` : t("processos.stockOk")}
        </Badge>
      </div>
    </header>
    <main className="flex-1 overflow-y-auto"><div className="px-2.5 sm:px-4 py-3 sm:py-4 space-y-3 sm:space-y-4">
      <PageNav tabs={tabItems} activeTab={tab} onTabChange={setTab} cols={isMobile ? 2 : undefined} />
      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <Metric title={t("processos.metricToolsRegistered")} value={ferramentas.length} icon={Wrench} tone="primary" />
        <Metric title={t("processos.metricActive")} value={totalAtivas} icon={Boxes} tone="success" />
        <Metric title={t("processos.metricAlertReplace")} value={totalAlerta} icon={AlertTriangle} tone="destructive" />
        <Metric title={t("processos.metricOpenPurchases")} value={pedidosAbertos} icon={ClipboardList} tone="warning" />
      </div>
      {tab === "ferramentas" && <FerramentasPanel ferramentas={ferramentas} loading={loadingFerramentas} onChange={fetchFerramentas} />}
      {tab === "fornecedores" && <FornecedoresPanel />}
      {tab === "compras" && <PedidosCompraPanel />}
      {tab === "faltas" && <FaltasPanel ferramentas={emFalta} onChange={() => { fetchFerramentas(); fetchPedidosAbertos(); }} />}
      {tab === "codigos" && <CodigosPanel />}
    </div></main>
  </div>;
}

function Metric({ title, value, icon: Icon, tone }: { title: string; value: number; icon: React.ElementType; tone: "primary" | "success" | "destructive" | "warning" }) {
  const tones = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    destructive: "bg-destructive/10 text-destructive",
    warning: "bg-warning/10 text-warning",
  };
  return <Card className="overflow-hidden border-border/70 shadow-sm bg-card"><CardContent className="p-3 sm:p-4 flex items-center justify-between gap-2 sm:gap-3"><div className="min-w-0"><p className="text-[10px] sm:text-xs text-muted-foreground truncate">{title}</p><p className="text-xl sm:text-2xl font-semibold">{value}</p></div><div className={cn("h-9 w-9 sm:h-11 sm:w-11 rounded-2xl flex items-center justify-center shrink-0", tones[tone])}><Icon className="h-4 w-4 sm:h-5 sm:w-5" /></div></CardContent></Card>;
}

// ── Ferramentas ────────────────────────────────────────────────────────────────

function useDropdownOptions() {
  const [fornecedores, setFornecedores] = useState<FornecedorOption[]>([]);
  const [maquinas, setMaquinas] = useState<MaquinaOption[]>([]);
  useEffect(() => {
    supabase.from("fornecedores").select("id, razao_social").eq("ativo", true).order("razao_social")
      .then(({ data }) => setFornecedores((data ?? []) as FornecedorOption[]));
    supabase.from("maquinas_producao").select("codigo, nome").order("codigo")
      .then(({ data }) => setMaquinas((data ?? []) as MaquinaOption[]));
  }, []);
  return { fornecedores, maquinas };
}

function buildStatusLabel(t: (k: string) => string): Record<StatusFerramenta, string> {
  return { ativo: t("processos.toolStatus.ativo"), alerta: t("processos.toolStatus.alerta"), substituir: t("processos.toolStatus.substituir"), inativo: t("processos.toolStatus.inativo") };
}
const STATUS_TONE: Record<StatusFerramenta, string> = {
  ativo: "text-success bg-success/10 border-success/25",
  alerta: "text-warning bg-warning/10 border-warning/25",
  substituir: "text-destructive bg-destructive/10 border-destructive/25",
  inativo: "text-muted-foreground bg-muted/30 border-border/50",
};

function FerramentasPanel({ ferramentas, loading, onChange }: { ferramentas: Ferramenta[]; loading: boolean; onChange: () => void }) {
  const { t } = useTranslation();
  const STATUS_LABEL = buildStatusLabel(t);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busca, setBusca] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { fornecedores, maquinas } = useDropdownOptions();
  const emptyForm = { codigo: "", descricao: "", tipo: "broca" as TipoFerramenta, maquina_codigo: "", vida_util_pecas: 0, custo_unitario: 0, fornecedor_id: "", observacoes: "" };
  const [form, setForm] = useState(emptyForm);

  const filtradas = ferramentas.filter((f) => `${f.descricao} ${f.codigo} ${f.tipo}`.toLowerCase().includes(busca.toLowerCase()));

  const salvar = async () => {
    if (!form.descricao.trim()) return toast.error(t("processos.toastDescRequired"));
    if (!form.codigo.trim()) return toast.error(t("processos.toastCodeRequired"));
    setSaving(true);
    const { error } = await supabase.from("ferramentas_cnc").insert({
      codigo: form.codigo.trim(),
      descricao: form.descricao.trim(),
      tipo: form.tipo,
      maquina_codigo: form.maquina_codigo || null,
      vida_util_pecas: Number(form.vida_util_pecas) || 0,
      custo_unitario: form.custo_unitario ? Number(form.custo_unitario) : null,
      fornecedor_id: form.fornecedor_id || null,
      observacoes: form.observacoes || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message.includes("duplicate") ? t("processos.toastDuplicateCode") : t("processos.toastRegisterError")); return; }
    setForm(emptyForm);
    setOpen(false);
    toast.success(t("processos.toastRegistered"));
    onChange();
  };

  const registrarPeca = async (f: Ferramenta) => {
    const { error } = await supabase.from("ferramentas_cnc").update({ pecas_produzidas: f.pecas_produzidas + 1 }).eq("id", f.id);
    if (error) { toast.error(t("processos.toastPieceError")); return; }
    await supabase.rpc("atualizar_status_ferramentas");
    onChange();
  };

  const registrarTroca = async (f: Ferramenta) => {
    const { error } = await supabase.from("ferramentas_cnc").update({
      pecas_produzidas: 0, horas_uso: 0, status: "ativo", ultima_troca: new Date().toISOString().slice(0, 10),
    }).eq("id", f.id);
    if (error) { toast.error(t("processos.toastExchangeError")); return; }
    toast.success(t("processos.toastExchangeSuccess"));
    onChange();
  };

  const excluir = async (id: string) => {
    const { error } = await supabase.from("ferramentas_cnc").delete().eq("id", id);
    if (error) { toast.error(t("processos.toastDeleteError")); return; }
    toast.success(t("processos.toastDeleted"));
    onChange();
  };

  const importar = async (file?: File) => {
    if (!file) return;
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      const rows: { codigo: string; descricao: string; tipo: string; vida_util_pecas: number; custo_unitario: number | null }[] = [];
      ws.eachRow((row, index) => {
        if (index === 1) return;
        const vals = row.values as ExcelJS.CellValue[];
        const codigo = String(vals[1] ?? "").trim();
        const descricao = String(vals[2] ?? "").trim();
        if (!codigo || !descricao) return;
        const tipoRaw = String(vals[3] ?? "outros").trim().toLowerCase();
        rows.push({
          codigo, descricao,
          tipo: (TIPOS as string[]).includes(tipoRaw) ? tipoRaw : "outros",
          vida_util_pecas: Number(vals[4] ?? 0) || 0,
          custo_unitario: vals[5] ? Number(vals[5]) : null,
        });
      });
      if (rows.length === 0) { toast.error(t("processos.toastNoValidRows")); return; }
      const { error } = await supabase.from("ferramentas_cnc").upsert(rows, { onConflict: "codigo" });
      if (error) { toast.error(t("processos.toastImportError") + error.message); return; }
      toast.success(t("processos.toastImportedCount", { count: rows.length }));
      onChange();
    } catch {
      toast.error(t("processos.toastImportFail"));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const baixarModelo = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Ferramentas");
    ws.addRow(i18n.t("processos.xlsxHeaders", { returnObjects: true }) as string[]);
    ws.addRow(["CNMG120408", "Pastilha CNMG", "pastilha", 500, 12.5]);
    const buffer = await wb.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "modelo_ferramentas_processos.xlsx");
    toast.success(t("processos.toastTemplateDownloaded"));
  };

  const fornecedorNome = (id: string | null) => fornecedores.find((f) => f.id === id)?.razao_social;
  const maquinaNome = (codigo: string | null) => maquinas.find((m) => m.codigo === codigo)?.nome;

  return <Card className="shadow-sm">
    <CardHeader>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-sm flex items-center gap-2"><Wrench className="h-4 w-4 text-primary" />{t("processos.cardTitle")}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{t("processos.cardSubtitle")}</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-2" />{t("processos.import")}</Button>
          <Button variant="outline" className="w-full sm:w-auto" onClick={baixarModelo}><FileSpreadsheet className="h-4 w-4 mr-2" />{t("processos.template")}</Button>
          <button onClick={onChange} className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg border border-input hover:bg-muted/40 sm:h-auto sm:w-auto sm:px-3">
            <RefreshCw className={cn("h-4 w-4 text-muted-foreground", loading && "animate-spin")} />
          </button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button className="w-full sm:w-auto"><Plus className="h-4 w-4 mr-2" />{t("processos.register")}</Button></DialogTrigger>
            <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
              <DialogHeader><DialogTitle className="flex items-center gap-2"><Wrench className="h-4 w-4 text-primary" />{t("processos.registerToolTitle")}</DialogTitle></DialogHeader>
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Field label={t("processos.code")}><Input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} placeholder="CNMG120408" /></Field>
                  <Field label={t("processos.type")}><Select value={form.tipo} onValueChange={(v: TipoFerramenta) => setForm({ ...form, tipo: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TIPOS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></Field>
                </div>
                <Field label={t("processos.description")}><Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder={t("processos.descriptionPlaceholder")} /></Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Field label={t("processos.usefulLifePieces")}><NumberInput value={form.vida_util_pecas} onChange={(e) => setForm({ ...form, vida_util_pecas: Number(e.target.value) })} /></Field>
                  <Field label={t("processos.unitCost")}><Input type="number" min={0} step="0.01" value={form.custo_unitario} onChange={(e) => setForm({ ...form, custo_unitario: Number(e.target.value) })} /></Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Field label={t("processos.machine")}><Select value={form.maquina_codigo || "nenhuma"} onValueChange={(v) => setForm({ ...form, maquina_codigo: v === "nenhuma" ? "" : v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="nenhuma">{t("processos.none")}</SelectItem>{maquinas.map((m) => <SelectItem key={m.codigo} value={m.codigo}>{m.nome}</SelectItem>)}</SelectContent></Select></Field>
                  <Field label={t("processos.supplier")}><Select value={form.fornecedor_id || "nenhum"} onValueChange={(v) => setForm({ ...form, fornecedor_id: v === "nenhum" ? "" : v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="nenhum">{t("processos.noneM")}</SelectItem>{fornecedores.map((f) => <SelectItem key={f.id} value={f.id}>{f.razao_social}</SelectItem>)}</SelectContent></Select></Field>
                </div>
                <Field label={t("processos.notes")}><Textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></Field>
                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2"><Button variant="outline" onClick={() => setOpen(false)}>{t("processos.cancel")}</Button><Button onClick={salvar} disabled={saving}><Plus className="h-4 w-4 mr-2" />{saving ? t("processos.saving") : t("processos.add")}</Button></div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        <input ref={fileRef} type="file" className="hidden" accept=".xlsx" onChange={(e) => importar(e.target.files?.[0])} />
      </div>
    </CardHeader>
    <CardContent className="space-y-3">
      <div className="relative w-full sm:max-w-xs sm:ml-auto"><Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9 h-9" placeholder={t("processos.searchToolPlaceholder")} value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
      {loading && !ferramentas.length ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2"><RefreshCw className="h-4 w-4 animate-spin" />{t("processos.loading")}</div>
      ) : (
        <div className="space-y-2">
          {filtradas.map((f) => {
            const pctVida = f.vida_util_pecas > 0 ? Math.min(100, Math.round((f.pecas_produzidas / f.vida_util_pecas) * 100)) : null;
            return <div key={f.id} className={cn("rounded-2xl border p-3 bg-card shadow-sm", emFaltaStatus(f) ? "border-warning/40 bg-warning/8" : "border-border")}>
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-sm flex items-center gap-2 flex-wrap">
                    {f.descricao}
                    <Badge variant="outline" className={cn("border", STATUS_TONE[f.status])}>{STATUS_LABEL[f.status]}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {f.codigo} • {f.tipo}{maquinaNome(f.maquina_codigo) ? ` • ${maquinaNome(f.maquina_codigo)}` : ""}{fornecedorNome(f.fornecedor_id) ? ` • ${fornecedorNome(f.fornecedor_id)}` : ""}
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 text-xs">
                  <Pill label={t("processos.pieces")} value={f.pecas_produzidas} tone="primary" />
                  {f.vida_util_pecas > 0 && <Pill label={t("processos.usefulLife")} value={f.vida_util_pecas} tone="success" />}
                  {pctVida !== null && <Pill label={t("processos.pctUsed")} value={pctVida} tone={pctVida >= 100 ? "destructive" : pctVida >= 80 ? "warning" : "success"} />}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 mt-3">
                <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => registrarPeca(f)}>{t("processos.plusOnePiece")}</Button>
                <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => registrarTroca(f)}><CheckCircle2 className="h-4 w-4 mr-1.5" />{t("processos.registerExchange")}</Button>
                <Button size="sm" variant="ghost" className="w-full sm:w-auto" onClick={() => excluir(f.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>;
          })}
          {!filtradas.length && <Empty text={t("processos.noToolFound")} />}
        </div>
      )}
    </CardContent>
  </Card>;
}

// ── Faltas (ferramentas em alerta ou além da vida útil) ─────────────────────────

function FaltasPanel({ ferramentas, onChange }: { ferramentas: Ferramenta[]; onChange: () => void }) {
  const { t } = useTranslation();
  const STATUS_LABEL = buildStatusLabel(t);
  const { fornecedores } = useDropdownOptions();
  const [gerando, setGerando] = useState<string | null>(null);
  const fornecedorNome = (id: string | null) => fornecedores.find((f) => f.id === id)?.razao_social ?? t("processos.toBeDefined");

  const gerarPedido = async (f: Ferramenta) => {
    setGerando(f.id);
    try {
      const nomeFornecedor = fornecedorNome(f.fornecedor_id);
      const { data: pedido, error } = await supabase.from("pedidos_compra").insert({
        fornecedor_id: f.fornecedor_id, fornecedor_nome: nomeFornecedor,
        observacoes: t("processos.shortageGeneratedNote", { code: f.codigo, desc: f.descricao }),
        valor_total: f.custo_unitario ?? 0, status: "rascunho",
      }).select("id").single();
      if (error || !pedido) { toast.error(error?.message ?? t("processos.toastGeneratePurchaseError")); return; }
      await supabase.from("pedido_compra_itens").insert({
        pedido_id: pedido.id, descricao: `${f.codigo} — ${f.descricao}`,
        quantidade: 1, unidade: "un", valor_unitario: f.custo_unitario ?? 0,
      });
      toast.success(t("processos.toastPurchaseGenerated"));
      onChange();
    } finally {
      setGerando(null);
    }
  };

  return <Card className="shadow-sm">
    <CardHeader className="bg-warning/5 rounded-t-lg border-b border-border/40">
      <CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warning" />{t("processos.shortageCardTitle")}</CardTitle>
    </CardHeader>
    <CardContent className="space-y-2 pt-4">
      {ferramentas.map((f) => (
        <div key={f.id} className="rounded-2xl border border-warning/35 bg-warning/8 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="font-semibold text-sm">{f.descricao}</div>
            <div className="text-xs text-muted-foreground">{f.pecas_produzidas}/{f.vida_util_pecas || "∞"} peças • {STATUS_LABEL[f.status]} • {fornecedorNome(f.fornecedor_id)}</div>
          </div>
          <Button size="sm" className="w-full sm:w-auto" disabled={gerando === f.id} onClick={() => gerarPedido(f)}>
            <ShoppingCart className="h-4 w-4 mr-2" />{gerando === f.id ? t("processos.generatingPurchase") : t("processos.generatePurchase")}
          </Button>
        </div>
      ))}
      {!ferramentas.length && <Empty text={t("processos.noToolsInShortage")} />}
    </CardContent>
  </Card>;
}

// ── Códigos CNC (biblioteca de programas) ───────────────────────────────────────

function CodigosPanel() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [programas, setProgramas] = useState<Programa[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>("novo");
  const [saving, setSaving] = useState(false);
  const novo = useCallback((): Programa => ({ id: "novo", nome: t("processos.newProgram"), maquina_codigo: null, linguagem: "G-Code", conteudo: "(INICIO)\nG21 G90\nM30\n(FIM)", updated_at: new Date().toISOString() }), []);
  const [draft, setDraft] = useState<Programa>(novo());
  const { maquinas } = useDropdownOptions();

  const fetchProgramas = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("programas_cnc").select("*").order("nome");
    if (error) { logger.error("fetchProgramas error:", error.message); toast.error(t("processos.toastLoadProgramsError")); }
    else {
      const list = (data ?? []) as Programa[];
      setProgramas(list);
      if (selectedId !== "novo") {
        const next = list.find((p) => p.id === selectedId);
        if (next) setDraft(next);
      }
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { fetchProgramas(); }, [fetchProgramas]);

  const linhas = draft.conteudo.split("\n").map((_, i) => i + 1).join("\n");
  const selecionar = (id: string) => {
    setSelectedId(id);
    const next = programas.find((p) => p.id === id);
    if (next) setDraft(next);
  };
  const criarNovo = () => { setSelectedId("novo"); setDraft(novo()); };

  const salvar = async () => {
    if (!draft.nome.trim()) return toast.error(t("processos.toastNameRequired"));
    setSaving(true);
    if (draft.id === "novo") {
      const { data, error } = await supabase.from("programas_cnc").insert({
        nome: draft.nome.trim(), maquina_codigo: draft.maquina_codigo, linguagem: draft.linguagem,
        conteudo: draft.conteudo, created_by: user?.id ?? null,
      }).select("id").single();
      setSaving(false);
      if (error || !data) { toast.error(error?.message ?? t("processos.toastSaveError")); return; }
      setSelectedId(data.id);
      toast.success(t("processos.toastCodeSaved"));
      fetchProgramas();
    } else {
      const { error } = await supabase.from("programas_cnc").update({
        nome: draft.nome.trim(), maquina_codigo: draft.maquina_codigo, linguagem: draft.linguagem, conteudo: draft.conteudo,
      }).eq("id", draft.id);
      setSaving(false);
      if (error) { toast.error(t("processos.toastSaveError")); return; }
      toast.success(t("processos.toastCodeSaved"));
      fetchProgramas();
    }
  };

  const excluir = async () => {
    if (draft.id === "novo") return toast.error(t("processos.toastNotSavedYet"));
    const { error } = await supabase.from("programas_cnc").delete().eq("id", draft.id);
    if (error) { toast.error(t("processos.toastDeleteProgError")); return; }
    criarNovo();
    toast.success(t("processos.toastProgramDeleted"));
    fetchProgramas();
  };

  const baixar = () => {
    const ext = draft.linguagem === "Siemens" ? "mpf" : draft.linguagem === "Heidenhain" ? "h" : "nc";
    downloadBlob(new Blob([draft.conteudo], { type: "text/plain;charset=utf-8" }), `${draft.nome.replace(/[^a-z0-9_-]+/gi, "_")}.${ext}`);
    toast.success(t("processos.toastProgramDownloaded"));
  };
  const copiar = async () => {
    await navigator.clipboard?.writeText(draft.conteudo);
    toast.success(t("processos.toastCodeCopied"));
  };

  return <div className="grid gap-3 sm:gap-4 lg:grid-cols-[320px_1fr]">
    <Card className="shadow-sm border-border/70 bg-card overflow-hidden">
      <CardHeader className="border-b border-border/40 bg-muted/20">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2"><FileCode2 className="h-4 w-4 text-primary" />{t("processos.cncPrograms")}</CardTitle>
          <Badge variant="secondary" className="text-[10px]">{programas.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-4 space-y-3">
        <Button className="w-full h-10" onClick={criarNovo}><Plus className="h-4 w-4 mr-2" />{t("processos.newCode")}</Button>
        {loading && !programas.length ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm gap-2"><RefreshCw className="h-4 w-4 animate-spin" />{t("processos.loading")}</div>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-2 lg:overflow-visible">
            {programas.map((p) => (
              <button
                key={p.id}
                onClick={() => selecionar(p.id)}
                className={cn(
                  "min-w-[210px] lg:min-w-0 lg:w-full text-left rounded-2xl border p-3 text-sm transition-all bg-card",
                  selectedId === p.id ? "border-primary/50 bg-primary/10 shadow-sm" : "border-border/70 hover:bg-muted/40"
                )}
              >
                <div className="font-semibold truncate">{p.nome}</div>
                <div className="text-xs text-muted-foreground truncate">{maquinas.find((m) => m.codigo === p.maquina_codigo)?.nome || t("processos.noMachine")} • {p.linguagem}</div>
              </button>
            ))}
          </div>
        )}
        {!loading && !programas.length && <Empty text={t("processos.noProgramsSaved")} />}
      </CardContent>
    </Card>

    <Card className="shadow-sm border-border/70 bg-card overflow-hidden">
      <CardHeader className="border-b border-border/40 bg-muted/20">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2"><Database className="h-4 w-4 text-primary" />{t("processos.codeEditor")}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{t("processos.editorSubtitle")}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:flex xl:flex-wrap">
            <Button variant="outline" className="h-10" onClick={copiar}><Copy className="h-4 w-4 mr-2" />{t("processos.copy")}</Button>
            <Button variant="outline" className="h-10" onClick={baixar}><Download className="h-4 w-4 mr-2" />{t("processos.download")}</Button>
            <Button variant="outline" className="h-10 text-destructive hover:text-destructive" onClick={excluir}><Trash2 className="h-4 w-4 mr-2" />{t("processos.delete")}</Button>
            <Button className="h-10" onClick={salvar} disabled={saving}><Save className="h-4 w-4 mr-2" />{saving ? t("processos.saving") : t("processos.save")}</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Field label={t("processos.programName")}><Input value={draft.nome} onChange={(e) => setDraft({ ...draft, nome: e.target.value })} /></Field>
          <Field label={t("processos.machine")}><Select value={draft.maquina_codigo ?? "nenhuma"} onValueChange={(v) => setDraft({ ...draft, maquina_codigo: v === "nenhuma" ? null : v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="nenhuma">{t("processos.none")}</SelectItem>{maquinas.map((m) => <SelectItem key={m.codigo} value={m.codigo}>{m.nome}</SelectItem>)}</SelectContent></Select></Field>
          <Field label={t("processos.language")}><Select value={draft.linguagem} onValueChange={(v: Linguagem) => setDraft({ ...draft, linguagem: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{linguagens.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent></Select></Field>
        </div>
        <div className="rounded-2xl border border-border/70 overflow-hidden bg-card">
          <div className="h-10 px-3 flex items-center justify-between gap-2 border-b border-border/50 bg-muted/30 text-xs text-muted-foreground">
            <span className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-success" />{draft.linguagem}</span>
            <span>{draft.conteudo.split("\n").length} {t("processos.lines")}</span>
          </div>
          <div className="flex min-h-[52vh] sm:min-h-[520px] max-h-[70vh] overflow-auto bg-slate-950 text-slate-100">
            <pre className="select-none sticky left-0 px-2 sm:px-3 py-3 text-right text-[11px] sm:text-xs leading-6 bg-slate-900 text-slate-500 font-mono border-r border-slate-800">{linhas}</pre>
            <Textarea
              value={draft.conteudo}
              onChange={(e) => setDraft({ ...draft, conteudo: e.target.value })}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="min-h-[52vh] sm:min-h-[520px] w-full min-w-[680px] resize-none border-0 rounded-none bg-slate-950 text-slate-100 font-mono text-[13px] sm:text-sm leading-6 focus-visible:ring-0 p-3"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  </div>;
}

function downloadBlob(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
function Pill({ label, value, tone }: { label: string; value: number; tone: "success" | "primary" | "destructive" | "warning" }) { const cls = { success: "bg-success/8 text-success border-success/25", primary: "bg-primary/8 text-primary border-primary/25", destructive: "bg-destructive/8 text-destructive border-destructive/25", warning: "bg-warning/8 text-warning border-warning/25" }; return <span className={cn("rounded-full border px-2.5 py-1 font-medium text-center sm:text-left", cls[tone])}>{label}: {value}</span>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground bg-muted/20">{text}</div>; }
