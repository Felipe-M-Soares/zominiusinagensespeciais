import { useEffect, useMemo, useRef, useState } from "react";
import ExcelJS from "exceljs";
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
  MessageCircle,
  PackageMinus,
  Plus,
  Save,
  Search,
  ShoppingCart,
  Trash2,
  Truck,
  Upload,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

type Tab = "ferramentas" | "compras" | "fornecedores" | "faltas" | "codigos";
type Linguagem = "G-Code" | "Fanuc" | "Siemens" | "Mazak" | "Haas" | "Heidenhain" | "Okuma" | "Mitsubishi" | "Fagor" | "ISO CNC" | "Macro B" | "Outro";

type Ferramenta = { id: string; nome: string; codigo: string; categoria: string; total: number; usadas: number; danificadas: number; minimo: number; local: string; fornecedorId?: string };
type Fornecedor = { id: string; nome: string; contato: string; telefone: string; email: string; observacoes: string };
type Pedido = { id: string; ferramenta: string; fornecedorId: string; quantidade: number; status: "Solicitado" | "Aprovado" | "Comprado" | "Recebido"; data: string; observacoes: string };
type Programa = { id: string; nome: string; maquina: string; linguagem: Linguagem; conteudo: string; atualizadoEm: string };

const STORAGE_KEYS = { ferramentas: "processos:ferramentas", fornecedores: "processos:fornecedores", pedidos: "processos:pedidos", programas: "processos:programas" };
const linguagens: Linguagem[] = ["G-Code", "Fanuc", "Siemens", "Mazak", "Haas", "Heidenhain", "Okuma", "Mitsubishi", "Fagor", "ISO CNC", "Macro B", "Outro"];
const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const today = () => new Date().toISOString().slice(0, 10);

function readStorage<T>(key: string, fallback: T): T { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } }
function useStoredState<T>(key: string, fallback: T) { const [value, setValue] = useState<T>(() => readStorage(key, fallback)); useEffect(() => localStorage.setItem(key, JSON.stringify(value)), [key, value]); return [value, setValue] as const; }
function NumberInput(props: React.InputHTMLAttributes<HTMLInputElement>) { return <Input type="number" min={0} step={1} {...props} />; }
const disponivel = (f: Ferramenta) => Math.max(Number(f.total || 0) - Number(f.usadas || 0) - Number(f.danificadas || 0), 0);

const tabItems: PageNavTab<Tab>[] = [
  { id: "ferramentas", label: "Ferramentas", Icon: Wrench, activeColor: "text-primary", activeBg: "bg-primary/10", activeBorder: "border-primary/40", badgeBg: "bg-primary/15", badgeText: "text-primary" },
  { id: "compras", label: "Compras", Icon: ShoppingCart, activeColor: "text-success", activeBg: "bg-success/10", activeBorder: "border-success/40", badgeBg: "bg-success/15", badgeText: "text-success" },
  { id: "fornecedores", label: "Fornecedores", Icon: Truck, activeColor: "text-primary", activeBg: "bg-primary/10", activeBorder: "border-primary/40", badgeBg: "bg-primary/15", badgeText: "text-primary" },
  { id: "faltas", label: "Faltas", Icon: AlertTriangle, activeColor: "text-warning", activeBg: "bg-warning/10", activeBorder: "border-warning/40", badgeBg: "bg-warning/15", badgeText: "text-warning" },
  { id: "codigos", label: "Códigos CNC", Icon: Code2, activeColor: "text-primary", activeBg: "bg-primary/10", activeBorder: "border-primary/40", badgeBg: "bg-primary/15", badgeText: "text-primary" },
];

export default function Processos() {
  const [tab, setTab] = useState<Tab>("ferramentas");
  const isMobile = useIsMobile();
  const [ferramentas, setFerramentas] = useStoredState<Ferramenta[]>(STORAGE_KEYS.ferramentas, []);
  const [fornecedores, setFornecedores] = useStoredState<Fornecedor[]>(STORAGE_KEYS.fornecedores, []);
  const [pedidos, setPedidos] = useStoredState<Pedido[]>(STORAGE_KEYS.pedidos, []);
  const [programas, setProgramas] = useStoredState<Programa[]>(STORAGE_KEYS.programas, []);

  const emFalta = useMemo(() => ferramentas.filter((f) => disponivel(f) <= Number(f.minimo || 0)), [ferramentas]);
  const totalDisponivel = ferramentas.reduce((acc, f) => acc + disponivel(f), 0);
  const totalDanificadas = ferramentas.reduce((acc, f) => acc + Number(f.danificadas || 0), 0);
  const pedidosAbertos = pedidos.filter((p) => p.status !== "Recebido").length;

  return <div className="flex flex-col h-full bg-transparent">
    <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/40">
      <div className="px-3 sm:px-4 h-12 sm:h-14 flex items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-2">
          <Factory className="h-4 w-4 text-primary shrink-0" />
          <h1 className="text-sm font-semibold">Processos</h1>
        </div>
        <Badge variant={emFalta.length ? "destructive" : "secondary"} className="gap-1 text-[10px] sm:text-xs">
          <Bell className="h-3 w-3" />{emFalta.length ? `${emFalta.length} falta(s)` : "Estoque OK"}
        </Badge>
      </div>
    </header>
    <main className="flex-1 overflow-y-auto"><div className="px-2.5 sm:px-4 py-3 sm:py-4 space-y-3 sm:space-y-4">
      <PageNav tabs={tabItems} activeTab={tab} onTabChange={setTab} cols={isMobile ? 2 : undefined} />
      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4"><Metric title="Ferramentas cadastradas" value={ferramentas.length} icon={Wrench} tone="primary" /><Metric title="Disponíveis" value={totalDisponivel} icon={Boxes} tone="success" /><Metric title="Danificadas" value={totalDanificadas} icon={PackageMinus} tone="destructive" /><Metric title="Compras em aberto" value={pedidosAbertos} icon={ClipboardList} tone="warning" /></div>
      {tab === "ferramentas" && <FerramentasPanel ferramentas={ferramentas} setFerramentas={setFerramentas} fornecedores={fornecedores} />}
      {tab === "fornecedores" && <FornecedoresPanel fornecedores={fornecedores} setFornecedores={setFornecedores} />}
      {tab === "compras" && <ComprasPanel pedidos={pedidos} setPedidos={setPedidos} fornecedores={fornecedores} ferramentas={ferramentas} />}
      {tab === "faltas" && <FaltasPanel ferramentas={emFalta} fornecedores={fornecedores} pedidos={pedidos} setPedidos={setPedidos} />}
      {tab === "codigos" && <CodigosPanel programas={programas} setProgramas={setProgramas} />}
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

function FerramentasPanel({ ferramentas, setFerramentas, fornecedores }: { ferramentas: Ferramenta[]; setFerramentas: React.Dispatch<React.SetStateAction<Ferramenta[]>>; fornecedores: Fornecedor[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busca, setBusca] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Omit<Ferramenta, "id">>({ nome: "", codigo: "", categoria: "", total: 0, usadas: 0, danificadas: 0, minimo: 0, local: "", fornecedorId: undefined });
  const filtradas = ferramentas.filter((f) => `${f.nome} ${f.codigo} ${f.categoria} ${f.local}`.toLowerCase().includes(busca.toLowerCase()));

  const resetForm = () => setForm({ nome: "", codigo: "", categoria: "", total: 0, usadas: 0, danificadas: 0, minimo: 0, local: "", fornecedorId: undefined });
  const salvar = () => {
    if (!form.nome.trim()) return toast.error("Informe o nome da ferramenta.");
    setFerramentas((old) => [{ ...form, id: uid(), total: Number(form.total), usadas: Number(form.usadas), danificadas: Number(form.danificadas), minimo: Number(form.minimo) }, ...old]);
    resetForm();
    setOpen(false);
    toast.success("Ferramenta cadastrada com sucesso.");
  };
  const movimentar = (id: string, field: "usadas" | "danificadas", delta: number) => setFerramentas((old) => old.map((f) => f.id === id ? { ...f, [field]: Math.max(0, Number(f[field] || 0) + delta) } : f));
  const importar = async (file?: File) => {
    if (!file) return;
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      const rows: Ferramenta[] = [];
      ws.eachRow((row, index) => {
        if (index === 1) return;
        const vals = row.values as ExcelJS.CellValue[];
        const nome = String(vals[1] ?? "").trim();
        if (!nome) return;
        rows.push({ id: uid(), nome, codigo: String(vals[2] ?? "").trim(), categoria: String(vals[3] ?? "").trim(), total: Number(vals[4] ?? 0), usadas: Number(vals[5] ?? 0), danificadas: Number(vals[6] ?? 0), minimo: Number(vals[7] ?? 0), local: String(vals[8] ?? "").trim(), fornecedorId: undefined });
      });
      setFerramentas((old) => [...rows, ...old]);
      toast.success(`${rows.length} ferramenta(s) importada(s).`);
    } catch {
      toast.error("Não foi possível importar a planilha.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const baixarModelo = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Ferramentas");
    ws.addRow(["Nome", "Código", "Categoria", "Total", "Usadas", "Danificadas", "Mínimo", "Local"]);
    ws.addRow(["Pastilha CNMG", "CNMG120408", "Pastilha", 50, 8, 2, 10, "Armário A1"]);
    const buffer = await wb.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "modelo_ferramentas_processos.xlsx");
    toast.success("Modelo de planilha baixado.");
  };

  return <Card className="shadow-sm">
    <CardHeader>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-sm flex items-center gap-2"><Wrench className="h-4 w-4 text-primary" />Estoque de ferramentas</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Cadastre, importe e controle o uso das ferramentas do processo.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-2" />Importar</Button>
          <Button variant="outline" className="w-full sm:w-auto" onClick={baixarModelo}><FileSpreadsheet className="h-4 w-4 mr-2" />Modelo</Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button className="w-full sm:w-auto"><Plus className="h-4 w-4 mr-2" />Cadastrar</Button></DialogTrigger>
            <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
              <DialogHeader><DialogTitle className="flex items-center gap-2"><Wrench className="h-4 w-4 text-primary" />Cadastrar ferramenta</DialogTitle></DialogHeader>
              <div className="space-y-3 pt-2">
                <Field label="Nome"><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Pastilha, broca, macho..." /></Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><Field label="Código"><Input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} /></Field><Field label="Categoria"><Input value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} /></Field></div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2"><Field label="Total"><NumberInput value={form.total} onChange={(e) => setForm({ ...form, total: Number(e.target.value) })} /></Field><Field label="Usadas"><NumberInput value={form.usadas} onChange={(e) => setForm({ ...form, usadas: Number(e.target.value) })} /></Field><Field label="Danific."><NumberInput value={form.danificadas} onChange={(e) => setForm({ ...form, danificadas: Number(e.target.value) })} /></Field><Field label="Mín."><NumberInput value={form.minimo} onChange={(e) => setForm({ ...form, minimo: Number(e.target.value) })} /></Field></div>
                <Field label="Local"><Input value={form.local} onChange={(e) => setForm({ ...form, local: e.target.value })} placeholder="Armário / gaveta" /></Field>
                <Field label="Fornecedor padrão"><Select value={form.fornecedorId ?? "nenhum"} onValueChange={(v) => setForm({ ...form, fornecedorId: v === "nenhum" ? undefined : v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="nenhum">Nenhum</SelectItem>{fornecedores.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}</SelectContent></Select></Field>
                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={salvar}><Plus className="h-4 w-4 mr-2" />Adicionar</Button></div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        <input ref={fileRef} type="file" className="hidden" accept=".xlsx" onChange={(e) => importar(e.target.files?.[0])} />
      </div>
    </CardHeader>
    <CardContent className="space-y-3">
      <div className="relative w-full sm:max-w-xs sm:ml-auto"><Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9 h-9" placeholder="Buscar ferramenta..." value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
      <div className="space-y-2">{filtradas.map((f) => { const disp = disponivel(f); const critical = disp <= f.minimo; return <div key={f.id} className={cn("rounded-2xl border p-3 bg-card shadow-sm", critical ? "border-warning/40 bg-warning/8" : "border-border") }><div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3"><div><div className="font-semibold text-sm flex items-center gap-2">{f.nome}{critical && <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">falta</Badge>}</div><div className="text-xs text-muted-foreground">{f.codigo || "Sem código"} • {f.categoria || "Sem categoria"} • {f.local || "Sem local"}</div></div><div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 text-xs"><Pill label="Disponível" value={disp} tone="success" /><Pill label="Usadas" value={f.usadas} tone="primary" /><Pill label="Danificadas" value={f.danificadas} tone="destructive" /><Pill label="Mínimo" value={f.minimo} tone="warning" /></div></div><div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 mt-3"><Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => movimentar(f.id, "usadas", 1)}>+ usada</Button><Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => movimentar(f.id, "usadas", -1)}>- usada</Button><Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => movimentar(f.id, "danificadas", 1)}>+ danificada</Button><Button size="sm" variant="ghost" className="w-full sm:w-auto" onClick={() => setFerramentas((old) => old.filter((x) => x.id !== f.id))}><Trash2 className="h-4 w-4" /></Button></div></div>; })}{!filtradas.length && <Empty text="Nenhuma ferramenta encontrada." />}</div>
    </CardContent>
  </Card>;
}

function whatsappUrl(telefone: string): string | null {
  const digits = telefone.replace(/\D/g, "");
  if (!digits) return null;
  const normalized = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${normalized}`;
}

function FornecedoresPanel({ fornecedores, setFornecedores }: { fornecedores: Fornecedor[]; setFornecedores: React.Dispatch<React.SetStateAction<Fornecedor[]>> }) {
  const [form, setForm] = useState<Omit<Fornecedor, "id">>({ nome: "", contato: "", telefone: "", email: "", observacoes: "" });
  const salvar = () => {
    if (!form.nome.trim()) return toast.error("Informe o nome do fornecedor.");
    setFornecedores((old) => [{ ...form, id: uid() }, ...old]);
    setForm({ nome: "", contato: "", telefone: "", email: "", observacoes: "" });
    toast.success("Fornecedor cadastrado.");
  };

  return <div className="grid gap-3 sm:gap-4 lg:grid-cols-[380px_1fr]">
    <Card className="shadow-sm bg-card">
      <CardHeader className="bg-primary/5 rounded-t-lg border-b border-border/40">
        <CardTitle className="text-sm flex items-center gap-2"><Truck className="h-4 w-4 text-primary" />Cadastrar fornecedor</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <Field label="Empresa"><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></Field>
        <Field label="Contato"><Input value={form.contato} onChange={(e) => setForm({ ...form, contato: e.target.value })} /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Field label="Telefone / WhatsApp"><Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} placeholder="(11) 99999-9999" /></Field>
          <Field label="E-mail"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        </div>
        <Field label="Observações"><Textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></Field>
        <Button className="w-full" onClick={salvar}><Plus className="h-4 w-4 mr-2" />Adicionar</Button>
      </CardContent>
    </Card>

    <Card className="shadow-sm bg-card">
      <CardHeader><CardTitle className="text-sm">Lista de fornecedores</CardTitle></CardHeader>
      <CardContent className="grid gap-2">
        {fornecedores.map((f) => {
          const whats = whatsappUrl(f.telefone);
          return <div key={f.id} className="rounded-2xl border border-border/70 p-3 flex flex-col sm:flex-row sm:items-start justify-between gap-3 bg-card">
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">{f.nome}</div>
              <div className="text-xs text-muted-foreground">{f.contato || "Sem contato"} • {f.email || "Sem e-mail"}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {whats ? (
                  <a href={whats} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-success/30 bg-success/8 px-2.5 py-1 text-xs font-medium text-success hover:bg-success/12 transition-colors">
                    <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                  </a>
                ) : (
                  <span className="inline-flex items-center rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1 text-xs text-muted-foreground">Sem WhatsApp</span>
                )}
                {f.telefone && <span className="inline-flex items-center rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1 text-xs text-muted-foreground">{f.telefone}</span>}
              </div>
              {f.observacoes && <p className="text-xs mt-2 text-muted-foreground">{f.observacoes}</p>}
            </div>
            <Button size="icon" variant="ghost" className="self-end sm:self-start" onClick={() => { setFornecedores((old) => old.filter((x) => x.id !== f.id)); toast.success("Fornecedor removido."); }}><Trash2 className="h-4 w-4" /></Button>
          </div>;
        })}
        {!fornecedores.length && <Empty text="Nenhum fornecedor cadastrado." />}
      </CardContent>
    </Card>
  </div>;
}

function ComprasPanel({ pedidos, setPedidos, fornecedores, ferramentas }: { pedidos: Pedido[]; setPedidos: React.Dispatch<React.SetStateAction<Pedido[]>>; fornecedores: Fornecedor[]; ferramentas: Ferramenta[] }) { const [form, setForm] = useState<Omit<Pedido, "id">>({ ferramenta: "", fornecedorId: "", quantidade: 1, status: "Solicitado", data: today(), observacoes: "" }); const salvar = () => { if (!form.ferramenta.trim()) return toast.error("Informe a ferramenta para compra."); setPedidos((old) => [{ ...form, id: uid(), quantidade: Number(form.quantidade) }, ...old]); setForm({ ferramenta: "", fornecedorId: "", quantidade: 1, status: "Solicitado", data: today(), observacoes: "" }); toast.success("Pedido de compra criado."); }; const fornecedorNome = (id: string) => fornecedores.find((f) => f.id === id)?.nome ?? "Sem fornecedor"; return <div className="grid gap-3 sm:gap-4 lg:grid-cols-[380px_1fr]"><Card className="shadow-sm"><CardHeader className="bg-success/5 rounded-t-lg border-b border-border/40"><CardTitle className="text-sm flex items-center gap-2"><ShoppingCart className="h-4 w-4 text-success" />Novo pedido de compra</CardTitle></CardHeader><CardContent className="space-y-3 pt-4"><Field label="Ferramenta"><Input list="ferramentas" value={form.ferramenta} onChange={(e) => setForm({ ...form, ferramenta: e.target.value })} /><datalist id="ferramentas">{ferramentas.map((f) => <option key={f.id} value={f.nome} />)}</datalist></Field><div className="grid grid-cols-2 gap-2"><Field label="Quantidade"><NumberInput value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: Number(e.target.value) })} /></Field><Field label="Data"><Input type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></Field></div><Field label="Fornecedor"><Select value={form.fornecedorId || "nenhum"} onValueChange={(v) => setForm({ ...form, fornecedorId: v === "nenhum" ? "" : v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="nenhum">Sem fornecedor</SelectItem>{fornecedores.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}</SelectContent></Select></Field><Field label="Observações"><Textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></Field><Button className="w-full" onClick={salvar}><ShoppingCart className="h-4 w-4 mr-2" />Criar pedido</Button></CardContent></Card><Card className="shadow-sm"><CardHeader><CardTitle className="text-sm">Pedidos de compra</CardTitle></CardHeader><CardContent className="space-y-2">{pedidos.map((p) => <div key={p.id} className="rounded-2xl border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-card"><div><div className="font-semibold text-sm">{p.quantidade}x {p.ferramenta}</div><div className="text-xs text-muted-foreground">{fornecedorNome(p.fornecedorId)} • {p.data}</div><p className="text-xs mt-1">{p.observacoes}</p></div><div className="flex gap-2"><Select value={p.status} onValueChange={(v: Pedido["status"]) => { setPedidos((old) => old.map((x) => x.id === p.id ? { ...x, status: v } : x)); toast.info(`Status alterado para ${v}.`); }}><SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger><SelectContent>{["Solicitado", "Aprovado", "Comprado", "Recebido"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select><Button size="icon" variant="ghost" onClick={() => setPedidos((old) => old.filter((x) => x.id !== p.id))}><Trash2 className="h-4 w-4" /></Button></div></div>)}{!pedidos.length && <Empty text="Nenhum pedido de compra." />}</CardContent></Card></div>; }

function FaltasPanel({ ferramentas, fornecedores, pedidos, setPedidos }: { ferramentas: Ferramenta[]; fornecedores: Fornecedor[]; pedidos: Pedido[]; setPedidos: React.Dispatch<React.SetStateAction<Pedido[]>> }) { const fornecedorNome = (id?: string) => fornecedores.find((f) => f.id === id)?.nome ?? "Sem fornecedor padrão"; const gerarPedido = (f: Ferramenta) => { const qtd = Math.max(f.minimo * 2 - disponivel(f), 1); setPedidos([{ id: uid(), ferramenta: f.nome, fornecedorId: f.fornecedorId ?? "", quantidade: qtd, status: "Solicitado", data: today(), observacoes: "Gerado automaticamente pelo controle de faltas." }, ...pedidos]); toast.success("Pedido gerado pela falta de ferramenta."); }; return <Card className="shadow-sm"><CardHeader className="bg-warning/5 rounded-t-lg border-b border-border/40"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warning" />Ferramentas abaixo do estoque mínimo</CardTitle></CardHeader><CardContent className="space-y-2 pt-4">{ferramentas.map((f) => { const disp = disponivel(f); return <div key={f.id} className="rounded-2xl border border-warning/35 bg-warning/8 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div><div className="font-semibold text-sm">{f.nome}</div><div className="text-xs text-muted-foreground">Disponível: {disp} • Mínimo: {f.minimo} • {fornecedorNome(f.fornecedorId)}</div></div><Button size="sm" className="w-full sm:w-auto" onClick={() => gerarPedido(f)}><ShoppingCart className="h-4 w-4 mr-2" />Gerar compra</Button></div>; })}{!ferramentas.length && <Empty text="Nenhuma ferramenta em falta." />}</CardContent></Card>; }

function CodigosPanel({ programas, setProgramas }: { programas: Programa[]; setProgramas: React.Dispatch<React.SetStateAction<Programa[]>> }) { const [selectedId, setSelectedId] = useState<string>(programas[0]?.id ?? "novo"); const selected = programas.find((p) => p.id === selectedId); const novo = (): Programa => ({ id: "novo", nome: "Novo programa", maquina: "", linguagem: "G-Code", conteudo: "(INICIO)\nG21 G90\nM30\n(FIM)", atualizadoEm: new Date().toISOString() }); const [draft, setDraft] = useState<Programa>(selected ?? novo()); useEffect(() => { const next = programas.find((p) => p.id === selectedId); if (next) setDraft(next); }, [selectedId, programas]); const linhas = draft.conteudo.split("\n").map((_, i) => i + 1).join("\n"); const salvar = () => { if (!draft.nome.trim()) return toast.error("Informe o nome do programa."); const item = { ...draft, id: draft.id === "novo" ? uid() : draft.id, atualizadoEm: new Date().toISOString() }; setProgramas((old) => draft.id === "novo" ? [item, ...old] : old.map((p) => p.id === item.id ? item : p)); setSelectedId(item.id); toast.success("Código salvo."); }; const excluir = () => { if (draft.id === "novo") return toast.error("Esse programa ainda não foi salvo."); setProgramas((old) => old.filter((p) => p.id !== draft.id)); setSelectedId("novo"); setDraft(novo()); toast.success("Programa apagado."); }; const baixar = () => { const ext = draft.linguagem === "Siemens" ? "mpf" : draft.linguagem === "Heidenhain" ? "h" : "nc"; downloadBlob(new Blob([draft.conteudo], { type: "text/plain;charset=utf-8" }), `${draft.nome.replace(/[^a-z0-9_-]+/gi, "_")}.${ext}`); toast.success("Programa baixado."); }; const copiar = async () => { await navigator.clipboard?.writeText(draft.conteudo); toast.success("Código copiado."); }; return <div className="grid gap-3 sm:gap-4 lg:grid-cols-[300px_1fr]"><Card className="shadow-sm"><CardHeader className="bg-primary/5 rounded-t-lg border-b border-border/40"><CardTitle className="text-sm flex items-center gap-2"><FileCode2 className="h-4 w-4" />Programas</CardTitle></CardHeader><CardContent className="space-y-2 pt-4"><Button className="w-full" variant="outline" onClick={() => { setSelectedId("novo"); setDraft(novo()); }}><Plus className="h-4 w-4 mr-2" />Novo código</Button>{programas.map((p) => <button key={p.id} onClick={() => setSelectedId(p.id)} className={cn("w-full text-left rounded-xl border p-3 text-sm transition-all", selectedId === p.id ? "border-primary bg-primary/10 shadow-sm" : "hover:bg-muted/60 bg-card")}><div className="font-semibold truncate">{p.nome}</div><div className="text-xs text-muted-foreground truncate">{p.maquina || "Sem máquina"} • {p.linguagem}</div></button>)}{!programas.length && <Empty text="Nenhum programa salvo." />}</CardContent></Card><Card className="shadow-sm"><CardHeader><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2"><CardTitle className="text-sm flex items-center gap-2"><Database className="h-4 w-4" />Editor estilo Notepad++</CardTitle><div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 w-full sm:w-auto"><Button variant="outline" className="w-full sm:w-auto" onClick={copiar}><Copy className="h-4 w-4 mr-2" />Copiar</Button><Button variant="outline" className="w-full sm:w-auto" onClick={baixar}><Download className="h-4 w-4 mr-2" />Baixar</Button><Button variant="destructive" className="w-full sm:w-auto" onClick={excluir}><Trash2 className="h-4 w-4 mr-2" />Apagar</Button><Button className="w-full sm:w-auto" onClick={salvar}><Save className="h-4 w-4 mr-2" />Salvar</Button></div></div></CardHeader><CardContent className="space-y-3"><div className="grid sm:grid-cols-3 gap-2"><Field label="Nome"><Input value={draft.nome} onChange={(e) => setDraft({ ...draft, nome: e.target.value })} /></Field><Field label="Máquina"><Input value={draft.maquina} onChange={(e) => setDraft({ ...draft, maquina: e.target.value })} /></Field><Field label="Linguagem"><Select value={draft.linguagem} onValueChange={(v: Linguagem) => setDraft({ ...draft, linguagem: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{linguagens.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent></Select></Field></div><div className="rounded-xl border overflow-hidden bg-slate-950 text-slate-100"><div className="h-9 px-3 flex items-center gap-2 border-b border-slate-800 bg-slate-900 text-xs text-slate-400"><CheckCircle2 className="h-3.5 w-3.5 text-success" />{draft.linguagem} • linhas: {draft.conteudo.split("\n").length}</div><div className="flex min-h-[340px] sm:min-h-[500px]"><pre className="select-none px-2 sm:px-3 py-3 text-right text-[10px] sm:text-xs leading-5 bg-slate-900 text-slate-500 font-mono">{linhas}</pre><Textarea value={draft.conteudo} onChange={(e) => setDraft({ ...draft, conteudo: e.target.value })} spellCheck={false} className="min-h-[340px] sm:min-h-[500px] resize-none border-0 rounded-none bg-slate-950 text-slate-100 font-mono text-xs leading-5 focus-visible:ring-0" /></div></div></CardContent></Card></div>; }

function downloadBlob(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
function Pill({ label, value, tone }: { label: string; value: number; tone: "success" | "primary" | "destructive" | "warning" }) { const cls = { success: "bg-success/8 text-success border-success/25", primary: "bg-primary/8 text-primary border-primary/25", destructive: "bg-destructive/8 text-destructive border-destructive/25", warning: "bg-warning/8 text-warning border-warning/25" }; return <span className={cn("rounded-full border px-2.5 py-1 font-medium text-center sm:text-left", cls[tone])}>{label}: {value}</span>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground bg-muted/20">{text}</div>; }
