import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Boxes,
  ClipboardList,
  Code2,
  Factory,
  PackageMinus,
  Plus,
  Save,
  ShoppingCart,
  Trash2,
  Truck,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

type Tab = "ferramentas" | "compras" | "fornecedores" | "faltas" | "codigos";

type Ferramenta = {
  id: string;
  nome: string;
  codigo: string;
  categoria: string;
  total: number;
  usadas: number;
  danificadas: number;
  minimo: number;
  local: string;
  fornecedorId?: string;
};

type Fornecedor = {
  id: string;
  nome: string;
  contato: string;
  telefone: string;
  email: string;
  observacoes: string;
};

type Pedido = {
  id: string;
  ferramenta: string;
  fornecedorId: string;
  quantidade: number;
  status: "Solicitado" | "Aprovado" | "Comprado" | "Recebido";
  data: string;
  observacoes: string;
};

type Programa = {
  id: string;
  nome: string;
  maquina: string;
  linguagem: "G-Code" | "Fanuc" | "Siemens" | "Mazak" | "Outro";
  conteudo: string;
  atualizadoEm: string;
};

const STORAGE_KEYS = {
  ferramentas: "processos:ferramentas",
  fornecedores: "processos:fornecedores",
  pedidos: "processos:pedidos",
  programas: "processos:programas",
};

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const today = () => new Date().toISOString().slice(0, 10);

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function useStoredState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readStorage(key, fallback));
  useEffect(() => localStorage.setItem(key, JSON.stringify(value)), [key, value]);
  return [value, setValue] as const;
}

function NumberInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <Input type="number" min={0} step={1} {...props} />;
}

const tabItems: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "ferramentas", label: "Controle de ferramentas", icon: Wrench },
  { id: "compras", label: "Compras", icon: ShoppingCart },
  { id: "fornecedores", label: "Fornecedores", icon: Truck },
  { id: "faltas", label: "Faltas", icon: AlertTriangle },
  { id: "codigos", label: "Códigos CNC", icon: Code2 },
];

export default function Processos() {
  const [tab, setTab] = useState<Tab>("ferramentas");
  const [ferramentas, setFerramentas] = useStoredState<Ferramenta[]>(STORAGE_KEYS.ferramentas, []);
  const [fornecedores, setFornecedores] = useStoredState<Fornecedor[]>(STORAGE_KEYS.fornecedores, []);
  const [pedidos, setPedidos] = useStoredState<Pedido[]>(STORAGE_KEYS.pedidos, []);
  const [programas, setProgramas] = useStoredState<Programa[]>(STORAGE_KEYS.programas, []);

  const emFalta = useMemo(
    () => ferramentas.filter((f) => Math.max(f.total - f.usadas - f.danificadas, 0) <= f.minimo),
    [ferramentas]
  );
  const totalDisponivel = ferramentas.reduce((acc, f) => acc + Math.max(f.total - f.usadas - f.danificadas, 0), 0);
  const totalDanificadas = ferramentas.reduce((acc, f) => acc + f.danificadas, 0);
  const pedidosAbertos = pedidos.filter((p) => p.status !== "Recebido").length;

  return (
    <div className="flex flex-col h-full bg-transparent">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="px-3 sm:px-4 h-12 sm:h-14 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2">
            <Factory className="h-4 w-4 text-primary shrink-0" />
            <h1 className="text-sm font-semibold">Processos</h1>
          </div>
          <Badge variant={emFalta.length ? "destructive" : "secondary"}>
            {emFalta.length ? `${emFalta.length} falta(s)` : "Estoque OK"}
          </Badge>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="px-3 sm:px-4 py-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Metric title="Ferramentas cadastradas" value={ferramentas.length} icon={Wrench} />
            <Metric title="Disponíveis" value={totalDisponivel} icon={Boxes} />
            <Metric title="Danificadas" value={totalDanificadas} icon={PackageMinus} />
            <Metric title="Compras em aberto" value={pedidosAbertos} icon={ClipboardList} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {tabItems.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-all",
                    active ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-muted/60 text-muted-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>

          {tab === "ferramentas" && <FerramentasPanel ferramentas={ferramentas} setFerramentas={setFerramentas} fornecedores={fornecedores} />}
          {tab === "fornecedores" && <FornecedoresPanel fornecedores={fornecedores} setFornecedores={setFornecedores} />}
          {tab === "compras" && <ComprasPanel pedidos={pedidos} setPedidos={setPedidos} fornecedores={fornecedores} ferramentas={ferramentas} />}
          {tab === "faltas" && <FaltasPanel ferramentas={emFalta} fornecedores={fornecedores} pedidos={pedidos} setPedidos={setPedidos} />}
          {tab === "codigos" && <CodigosPanel programas={programas} setProgramas={setProgramas} />}
        </div>
      </main>
    </div>
  );
}

function Metric({ title, value, icon: Icon }: { title: string; value: number; icon: React.ElementType }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="text-2xl font-semibold">{value}</p>
        </div>
        <Icon className="h-5 w-5 text-primary" />
      </CardContent>
    </Card>
  );
}

function FerramentasPanel({ ferramentas, setFerramentas, fornecedores }: {
  ferramentas: Ferramenta[];
  setFerramentas: React.Dispatch<React.SetStateAction<Ferramenta[]>>;
  fornecedores: Fornecedor[];
}) {
  const [form, setForm] = useState<Omit<Ferramenta, "id">>({ nome: "", codigo: "", categoria: "", total: 0, usadas: 0, danificadas: 0, minimo: 0, local: "", fornecedorId: undefined });
  const salvar = () => {
    if (!form.nome.trim()) return toast.error("Informe o nome da ferramenta.");
    setFerramentas((old) => [{ ...form, id: uid(), total: Number(form.total), usadas: Number(form.usadas), danificadas: Number(form.danificadas), minimo: Number(form.minimo) }, ...old]);
    setForm({ nome: "", codigo: "", categoria: "", total: 0, usadas: 0, danificadas: 0, minimo: 0, local: "", fornecedorId: undefined });
    toast.success("Ferramenta cadastrada.");
  };
  const movimentar = (id: string, field: "usadas" | "danificadas", delta: number) => setFerramentas((old) => old.map((f) => f.id === id ? { ...f, [field]: Math.max(0, f[field] + delta) } : f));
  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Card><CardHeader><CardTitle className="text-sm">Cadastrar ferramenta</CardTitle></CardHeader><CardContent className="space-y-3">
        <Field label="Nome"><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Pastilha, broca, macho..." /></Field>
        <div className="grid grid-cols-2 gap-2"><Field label="Código"><Input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} /></Field><Field label="Categoria"><Input value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} /></Field></div>
        <div className="grid grid-cols-4 gap-2"><Field label="Total"><NumberInput value={form.total} onChange={(e) => setForm({ ...form, total: Number(e.target.value) })} /></Field><Field label="Usadas"><NumberInput value={form.usadas} onChange={(e) => setForm({ ...form, usadas: Number(e.target.value) })} /></Field><Field label="Danific."><NumberInput value={form.danificadas} onChange={(e) => setForm({ ...form, danificadas: Number(e.target.value) })} /></Field><Field label="Mín."><NumberInput value={form.minimo} onChange={(e) => setForm({ ...form, minimo: Number(e.target.value) })} /></Field></div>
        <Field label="Local"><Input value={form.local} onChange={(e) => setForm({ ...form, local: e.target.value })} placeholder="Armário / gaveta" /></Field>
        <Field label="Fornecedor padrão"><Select value={form.fornecedorId ?? "nenhum"} onValueChange={(v) => setForm({ ...form, fornecedorId: v === "nenhum" ? undefined : v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="nenhum">Nenhum</SelectItem>{fornecedores.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}</SelectContent></Select></Field>
        <Button className="w-full" onClick={salvar}><Plus className="h-4 w-4 mr-2" />Adicionar</Button>
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-sm">Estoque de ferramentas</CardTitle></CardHeader><CardContent className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="text-left py-2">Ferramenta</th><th>Disponível</th><th>Usadas</th><th>Danificadas</th><th>Ações</th></tr></thead><tbody>{ferramentas.map((f) => { const disp = Math.max(f.total - f.usadas - f.danificadas, 0); return <tr key={f.id} className="border-t"><td className="py-3"><div className="font-medium">{f.nome}</div><div className="text-xs text-muted-foreground">{f.codigo || "Sem código"} • {f.local || "Sem local"}</div></td><td className="text-center"><Badge variant={disp <= f.minimo ? "destructive" : "secondary"}>{disp}</Badge></td><td className="text-center">{f.usadas}</td><td className="text-center">{f.danificadas}</td><td><div className="flex justify-center gap-1"><Button size="sm" variant="outline" onClick={() => movimentar(f.id, "usadas", 1)}>Usar</Button><Button size="sm" variant="outline" onClick={() => movimentar(f.id, "danificadas", 1)}>Danificar</Button><Button size="icon" variant="ghost" onClick={() => setFerramentas((old) => old.filter((x) => x.id !== f.id))}><Trash2 className="h-4 w-4" /></Button></div></td></tr>; })}</tbody></table>{!ferramentas.length && <Empty text="Nenhuma ferramenta cadastrada." />}</CardContent></Card>
    </div>
  );
}

function FornecedoresPanel({ fornecedores, setFornecedores }: { fornecedores: Fornecedor[]; setFornecedores: React.Dispatch<React.SetStateAction<Fornecedor[]>> }) {
  const [form, setForm] = useState<Omit<Fornecedor, "id">>({ nome: "", contato: "", telefone: "", email: "", observacoes: "" });
  const salvar = () => { if (!form.nome.trim()) return toast.error("Informe o fornecedor."); setFornecedores((old) => [{ ...form, id: uid() }, ...old]); setForm({ nome: "", contato: "", telefone: "", email: "", observacoes: "" }); toast.success("Fornecedor cadastrado."); };
  return <div className="grid gap-4 lg:grid-cols-[360px_1fr]"><Card><CardHeader><CardTitle className="text-sm">Cadastrar fornecedor</CardTitle></CardHeader><CardContent className="space-y-3"><Field label="Empresa"><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></Field><Field label="Contato"><Input value={form.contato} onChange={(e) => setForm({ ...form, contato: e.target.value })} /></Field><div className="grid grid-cols-2 gap-2"><Field label="Telefone"><Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} /></Field><Field label="E-mail"><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field></div><Field label="Observações"><Textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></Field><Button className="w-full" onClick={salvar}><Plus className="h-4 w-4 mr-2" />Adicionar</Button></CardContent></Card><Card><CardHeader><CardTitle className="text-sm">Lista de fornecedores</CardTitle></CardHeader><CardContent className="grid gap-2">{fornecedores.map((f) => <div key={f.id} className="rounded-xl border p-3 flex justify-between gap-3"><div><div className="font-medium text-sm">{f.nome}</div><div className="text-xs text-muted-foreground">{f.contato} • {f.telefone} • {f.email}</div><p className="text-xs mt-1">{f.observacoes}</p></div><Button size="icon" variant="ghost" onClick={() => setFornecedores((old) => old.filter((x) => x.id !== f.id))}><Trash2 className="h-4 w-4" /></Button></div>)}{!fornecedores.length && <Empty text="Nenhum fornecedor cadastrado." />}</CardContent></Card></div>;
}

function ComprasPanel({ pedidos, setPedidos, fornecedores, ferramentas }: { pedidos: Pedido[]; setPedidos: React.Dispatch<React.SetStateAction<Pedido[]>>; fornecedores: Fornecedor[]; ferramentas: Ferramenta[] }) {
  const [form, setForm] = useState<Omit<Pedido, "id">>({ ferramenta: "", fornecedorId: "", quantidade: 1, status: "Solicitado", data: today(), observacoes: "" });
  const salvar = () => { if (!form.ferramenta.trim()) return toast.error("Informe a ferramenta para compra."); setPedidos((old) => [{ ...form, id: uid(), quantidade: Number(form.quantidade) }, ...old]); setForm({ ferramenta: "", fornecedorId: "", quantidade: 1, status: "Solicitado", data: today(), observacoes: "" }); toast.success("Pedido de compra criado."); };
  const fornecedorNome = (id: string) => fornecedores.find((f) => f.id === id)?.nome ?? "Sem fornecedor";
  return <div className="grid gap-4 lg:grid-cols-[360px_1fr]"><Card><CardHeader><CardTitle className="text-sm">Novo pedido de compra</CardTitle></CardHeader><CardContent className="space-y-3"><Field label="Ferramenta"><Input list="ferramentas" value={form.ferramenta} onChange={(e) => setForm({ ...form, ferramenta: e.target.value })} /><datalist id="ferramentas">{ferramentas.map((f) => <option key={f.id} value={f.nome} />)}</datalist></Field><div className="grid grid-cols-2 gap-2"><Field label="Quantidade"><NumberInput value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: Number(e.target.value) })} /></Field><Field label="Data"><Input type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></Field></div><Field label="Fornecedor"><Select value={form.fornecedorId || "nenhum"} onValueChange={(v) => setForm({ ...form, fornecedorId: v === "nenhum" ? "" : v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="nenhum">Sem fornecedor</SelectItem>{fornecedores.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}</SelectContent></Select></Field><Field label="Observações"><Textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></Field><Button className="w-full" onClick={salvar}><ShoppingCart className="h-4 w-4 mr-2" />Criar pedido</Button></CardContent></Card><Card><CardHeader><CardTitle className="text-sm">Pedidos de compra</CardTitle></CardHeader><CardContent className="space-y-2">{pedidos.map((p) => <div key={p.id} className="rounded-xl border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div><div className="font-medium text-sm">{p.quantidade}x {p.ferramenta}</div><div className="text-xs text-muted-foreground">{fornecedorNome(p.fornecedorId)} • {p.data}</div><p className="text-xs mt-1">{p.observacoes}</p></div><div className="flex gap-2"><Select value={p.status} onValueChange={(v: Pedido["status"]) => setPedidos((old) => old.map((x) => x.id === p.id ? { ...x, status: v } : x))}><SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger><SelectContent>{["Solicitado", "Aprovado", "Comprado", "Recebido"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select><Button size="icon" variant="ghost" onClick={() => setPedidos((old) => old.filter((x) => x.id !== p.id))}><Trash2 className="h-4 w-4" /></Button></div></div>)}{!pedidos.length && <Empty text="Nenhum pedido de compra." />}</CardContent></Card></div>;
}

function FaltasPanel({ ferramentas, fornecedores, pedidos, setPedidos }: { ferramentas: Ferramenta[]; fornecedores: Fornecedor[]; pedidos: Pedido[]; setPedidos: React.Dispatch<React.SetStateAction<Pedido[]>> }) {
  const fornecedorNome = (id?: string) => fornecedores.find((f) => f.id === id)?.nome ?? "Sem fornecedor padrão";
  const gerarPedido = (f: Ferramenta) => { const qtd = Math.max(f.minimo * 2 - Math.max(f.total - f.usadas - f.danificadas, 0), 1); setPedidos([{ id: uid(), ferramenta: f.nome, fornecedorId: f.fornecedorId ?? "", quantidade: qtd, status: "Solicitado", data: today(), observacoes: "Gerado automaticamente pelo controle de faltas." }, ...pedidos]); toast.success("Pedido gerado."); };
  return <Card><CardHeader><CardTitle className="text-sm">Ferramentas abaixo do estoque mínimo</CardTitle></CardHeader><CardContent className="space-y-2">{ferramentas.map((f) => { const disp = Math.max(f.total - f.usadas - f.danificadas, 0); return <div key={f.id} className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div><div className="font-medium text-sm">{f.nome}</div><div className="text-xs text-muted-foreground">Disponível: {disp} • Mínimo: {f.minimo} • {fornecedorNome(f.fornecedorId)}</div></div><Button size="sm" onClick={() => gerarPedido(f)}><ShoppingCart className="h-4 w-4 mr-2" />Gerar compra</Button></div>; })}{!ferramentas.length && <Empty text="Nenhuma ferramenta em falta." />}</CardContent></Card>;
}

function CodigosPanel({ programas, setProgramas }: { programas: Programa[]; setProgramas: React.Dispatch<React.SetStateAction<Programa[]>> }) {
  const [selectedId, setSelectedId] = useState<string>(programas[0]?.id ?? "novo");
  const selected = programas.find((p) => p.id === selectedId);
  const [draft, setDraft] = useState<Programa>(selected ?? { id: "novo", nome: "Novo programa", maquina: "", linguagem: "G-Code", conteudo: "(INICIO)\nG21 G90\nM30\n(FIM)", atualizadoEm: new Date().toISOString() });
  useEffect(() => { const next = programas.find((p) => p.id === selectedId); if (next) setDraft(next); }, [selectedId, programas]);
  const linhas = draft.conteudo.split("\n").map((_, i) => i + 1).join("\n");
  const salvar = () => { const item = { ...draft, id: draft.id === "novo" ? uid() : draft.id, atualizadoEm: new Date().toISOString() }; setProgramas((old) => draft.id === "novo" ? [item, ...old] : old.map((p) => p.id === item.id ? item : p)); setSelectedId(item.id); toast.success("Código salvo."); };
  return <div className="grid gap-4 lg:grid-cols-[280px_1fr]"><Card><CardHeader><CardTitle className="text-sm">Programas</CardTitle></CardHeader><CardContent className="space-y-2"><Button className="w-full" variant="outline" onClick={() => { setSelectedId("novo"); setDraft({ id: "novo", nome: "Novo programa", maquina: "", linguagem: "G-Code", conteudo: "(INICIO)\nG21 G90\nM30\n(FIM)", atualizadoEm: new Date().toISOString() }); }}><Plus className="h-4 w-4 mr-2" />Novo código</Button>{programas.map((p) => <button key={p.id} onClick={() => setSelectedId(p.id)} className={cn("w-full text-left rounded-lg border p-2 text-sm", selectedId === p.id ? "border-primary bg-primary/10" : "hover:bg-muted/60")}><div className="font-medium truncate">{p.nome}</div><div className="text-xs text-muted-foreground truncate">{p.maquina || "Sem máquina"} • {p.linguagem}</div></button>)}</CardContent></Card><Card><CardHeader><div className="flex items-center justify-between gap-2"><CardTitle className="text-sm">Editor estilo Notepad++</CardTitle><Button onClick={salvar}><Save className="h-4 w-4 mr-2" />Salvar</Button></div></CardHeader><CardContent className="space-y-3"><div className="grid sm:grid-cols-3 gap-2"><Field label="Nome"><Input value={draft.nome} onChange={(e) => setDraft({ ...draft, nome: e.target.value })} /></Field><Field label="Máquina"><Input value={draft.maquina} onChange={(e) => setDraft({ ...draft, maquina: e.target.value })} /></Field><Field label="Linguagem"><Select value={draft.linguagem} onValueChange={(v: Programa["linguagem"]) => setDraft({ ...draft, linguagem: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["G-Code", "Fanuc", "Siemens", "Mazak", "Outro"].map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent></Select></Field></div><div className="flex rounded-xl border overflow-hidden bg-slate-950 text-slate-100 min-h-[480px]"><pre className="select-none px-3 py-3 text-right text-xs leading-5 bg-slate-900 text-slate-500 font-mono">{linhas}</pre><Textarea value={draft.conteudo} onChange={(e) => setDraft({ ...draft, conteudo: e.target.value })} spellCheck={false} className="min-h-[480px] resize-none border-0 rounded-none bg-slate-950 text-slate-100 font-mono text-xs leading-5 focus-visible:ring-0" /></div></CardContent></Card></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{text}</div>;
}
