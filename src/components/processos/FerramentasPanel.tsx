/**
 * Processos › Ferramentas — cadastro, importação por planilha e controle de
 * vida útil das ferramentas de corte / CNC.
 */
import { useMemo, useRef, useState } from "react";
import ExcelJS from "exceljs";
import { toast } from "sonner";
import {
  CheckCircle2, FileSpreadsheet, Loader2, MoreVertical, Pencil, Plus, RefreshCw, Search, Trash2, Upload, Wrench, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { friendlyError } from "@/lib/errorMessages";
import {
  Chip, EmptyState, Field, STATUS_LABEL, STATUS_TONE, TIPOS, TIPO_LABEL, downloadBlob, emFaltaStatus, pctVida,
  useDropdownOptions, type Ferramenta, type StatusFerramenta, type TipoFerramenta,
} from "./shared";

type Filtro = "todas" | "ativo" | "falta" | "inativo";

const FILTROS: { id: Filtro; label: string }[] = [
  { id: "todas", label: "Todas" },
  { id: "ativo", label: "Em uso" },
  { id: "falta", label: "Perto do limite / trocar" },
  { id: "inativo", label: "Inativas" },
];

interface FormState {
  codigo: string; descricao: string; tipo: TipoFerramenta; maquina_codigo: string;
  vida_util_pecas: string; custo_unitario: string; fornecedor_id: string; observacoes: string;
  status: StatusFerramenta;
}
const EMPTY_FORM: FormState = {
  codigo: "", descricao: "", tipo: "broca", maquina_codigo: "", vida_util_pecas: "0",
  custo_unitario: "", fornecedor_id: "", observacoes: "", status: "ativo",
};

function statusCalculado(inativa: boolean, pecas: number, vida: number): StatusFerramenta {
  if (inativa) return "inativo";
  if (vida > 0 && pecas >= vida) return "substituir";
  if (vida > 0 && pecas >= vida * 0.8) return "alerta";
  return "ativo";
}

export function FerramentasPanel({ ferramentas, loading, onChange, filtroInicial = "todas" }: {
  ferramentas: Ferramenta[];
  loading: boolean;
  onChange: () => void;
  filtroInicial?: Filtro;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>(filtroInicial);
  const [editando, setEditando] = useState<Ferramenta | "nova" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [importando, setImportando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmTroca, setConfirmTroca] = useState<Ferramenta | null>(null);
  const [confirmExcluir, setConfirmExcluir] = useState<Ferramenta | null>(null);
  const { fornecedores, maquinas } = useDropdownOptions();

  const contagem = useMemo(() => ({
    todas: ferramentas.length,
    ativo: ferramentas.filter(f => f.status === "ativo").length,
    falta: ferramentas.filter(emFaltaStatus).length,
    inativo: ferramentas.filter(f => f.status === "inativo").length,
  }), [ferramentas]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return ferramentas.filter(f => {
      if (filtro === "ativo" && f.status !== "ativo") return false;
      if (filtro === "falta" && !emFaltaStatus(f)) return false;
      if (filtro === "inativo" && f.status !== "inativo") return false;
      return !q || `${f.descricao} ${f.codigo} ${f.tipo} ${f.maquina_codigo ?? ""}`.toLowerCase().includes(q);
    });
  }, [ferramentas, busca, filtro]);

  const fornecedorNome = (id: string | null) => fornecedores.find(f => f.id === id)?.razao_social;
  const maquinaNome = (codigo: string | null) => maquinas.find(m => m.codigo === codigo)?.nome ?? codigo;

  const abrirNova = () => { setForm(EMPTY_FORM); setEditando("nova"); };
  const abrirEdicao = (f: Ferramenta) => {
    setForm({
      codigo: f.codigo, descricao: f.descricao, tipo: f.tipo, maquina_codigo: f.maquina_codigo ?? "",
      vida_util_pecas: String(f.vida_util_pecas ?? 0), custo_unitario: f.custo_unitario != null ? String(f.custo_unitario) : "",
      fornecedor_id: f.fornecedor_id ?? "", observacoes: f.observacoes ?? "", status: f.status,
    });
    setEditando(f);
  };

  const salvar = async () => {
    if (!form.codigo.trim()) return toast.error("Informe o código da ferramenta.");
    if (!form.descricao.trim()) return toast.error("Informe a descrição da ferramenta.");
    setSaving(true);
    const dados = {
      codigo: form.codigo.trim(),
      descricao: form.descricao.trim(),
      tipo: form.tipo,
      maquina_codigo: form.maquina_codigo || null,
      vida_util_pecas: Math.max(0, Math.round(Number(form.vida_util_pecas) || 0)),
      custo_unitario: form.custo_unitario !== "" ? Number(form.custo_unitario.replace(",", ".")) || 0 : null,
      fornecedor_id: form.fornecedor_id || null,
      observacoes: form.observacoes.trim() || null,
    };
    const { error } = editando === "nova"
      ? await supabase.from("ferramentas_cnc").insert(dados)
      : await supabase.from("ferramentas_cnc").update({
          ...dados,
          // "Inativa" é escolha manual; o resto segue a mesma regra da RPC
          // atualizar_status_ferramentas() (≥ 80% alerta, ≥ 100% substituir).
          status: statusCalculado(form.status === "inativo", (editando as Ferramenta).pecas_produzidas, dados.vida_util_pecas),
        }).eq("id", (editando as Ferramenta).id);
    setSaving(false);
    if (error) {
      toast.error(error.message.includes("duplicate") ? "Já existe uma ferramenta com esse código." : friendlyError(error, "Não foi possível salvar a ferramenta."));
      return;
    }
    toast.success(editando === "nova" ? "Ferramenta cadastrada." : "Ferramenta atualizada.");
    setEditando(null);
    onChange();
  };

  const registrarPeca = async (f: Ferramenta) => {
    setOcupado(f.id);
    const { error } = await supabase.from("ferramentas_cnc").update({ pecas_produzidas: f.pecas_produzidas + 1 }).eq("id", f.id);
    if (error) { setOcupado(null); toast.error(friendlyError(error, "Erro ao registrar peça.")); return; }
    await supabase.rpc("atualizar_status_ferramentas");
    setOcupado(null);
    onChange();
  };

  const registrarTroca = async (f: Ferramenta) => {
    setOcupado(f.id);
    const { error } = await supabase.from("ferramentas_cnc").update({
      pecas_produzidas: 0, horas_uso: 0, status: "ativo", ultima_troca: new Date().toISOString().slice(0, 10),
    }).eq("id", f.id);
    setOcupado(null);
    if (error) { toast.error(friendlyError(error, "Erro ao registrar troca.")); return; }
    toast.success(`Troca registrada — contador de ${f.codigo} zerado.`);
    onChange();
  };

  const excluir = async (f: Ferramenta) => {
    const { error } = await supabase.from("ferramentas_cnc").delete().eq("id", f.id);
    if (error) { toast.error(friendlyError(error, "Erro ao excluir ferramenta (ela pode estar ligada a um pedido de compra).")); return; }
    toast.success("Ferramenta excluída.");
    onChange();
  };

  const importar = async (file?: File) => {
    if (!file) return;
    setImportando(true);
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
      if (rows.length === 0) { toast.error("Nenhuma linha válida encontrada (verifique as colunas Código e Descrição)."); return; }
      const { error } = await supabase.from("ferramentas_cnc").upsert(rows, { onConflict: "codigo" });
      if (error) { toast.error(friendlyError(error, "Erro ao importar a planilha.")); return; }
      toast.success(`${rows.length} ferramenta(s) importada(s).`);
      onChange();
    } catch {
      toast.error("Não foi possível ler a planilha. Use o modelo (.xlsx).");
    } finally {
      setImportando(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const baixarModelo = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Ferramentas");
    ws.addRow(["Código", "Descrição", "Tipo", "Vida útil (peças)", "Custo unitário"]);
    ws.addRow(["CNMG120408", "Pastilha CNMG", "pastilha", 500, 12.5]);
    const buffer = await wb.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "modelo_ferramentas_processos.xlsx");
    toast.success("Modelo de planilha baixado.");
  };

  return (
    <section className="space-y-3">
      <input ref={fileRef} type="file" className="hidden" accept=".xlsx" onChange={e => importar(e.target.files?.[0])} />

      {/* Barra de ações */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9 pr-9 h-11 rounded-xl bg-card"
            placeholder="Buscar ferramenta…"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            aria-label="Buscar ferramenta"
          />
          {busca && (
            <button type="button" onClick={() => setBusca("")} aria-label="Limpar busca"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-11 rounded-xl gap-2 flex-1 sm:flex-none" disabled={importando}>
                {importando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                Planilha
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => fileRef.current?.click()} className="gap-2 py-2.5">
                <Upload className="h-4 w-4" /> Importar planilha (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={baixarModelo} className="gap-2 py-2.5">
                <FileSpreadsheet className="h-4 w-4" /> Baixar modelo
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="icon" className="h-11 w-11 rounded-xl shrink-0" onClick={onChange} aria-label="Atualizar lista" title="Atualizar">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
          <Button className="h-11 rounded-xl gap-2 flex-1 sm:flex-none" onClick={abrirNova}>
            <Plus className="h-4 w-4" /> Cadastrar
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-3 px-3 sm:mx-0 sm:px-0 sm:flex-wrap" role="group" aria-label="Filtrar por situação">
        {FILTROS.map(f => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFiltro(f.id)}
            aria-pressed={filtro === f.id}
            className={cn(
              "h-9 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors inline-flex items-center gap-1.5",
              filtro === f.id ? "border-primary/40 bg-primary/10 text-primary" : "bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60"
            )}
          >
            {f.label}
            <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", filtro === f.id ? "bg-primary/15" : "bg-muted")}>{contagem[f.id]}</span>
          </button>
        ))}
      </div>

      {/* Lista */}
      <div className="rounded-2xl border bg-card overflow-hidden">
        {loading && !ferramentas.length ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando ferramentas…
          </div>
        ) : filtradas.length === 0 ? (
          ferramentas.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title="Nenhuma ferramenta cadastrada"
              text="Cadastre uma a uma ou importe a lista toda de uma planilha (baixe o modelo no botão Planilha)."
              action={<Button onClick={abrirNova} className="gap-2"><Plus className="h-4 w-4" />Cadastrar ferramenta</Button>}
            />
          ) : (
            <EmptyState
              icon={Search}
              title="Nada encontrado"
              text="Nenhuma ferramenta com essa busca ou filtro."
              action={<Button variant="outline" onClick={() => { setBusca(""); setFiltro("todas"); }}>Limpar filtros</Button>}
            />
          )
        ) : (
          <ul className="divide-y">
            {filtradas.map(f => {
              const pct = pctVida(f);
              const barra = pct === null ? null : Math.min(100, pct);
              const tom = pct === null ? "bg-primary" : pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-warning" : "bg-success";
              const detalhes = [TIPO_LABEL[f.tipo] ?? f.tipo, maquinaNome(f.maquina_codigo), fornecedorNome(f.fornecedor_id)].filter(Boolean).join(" · ");
              return (
                <li key={f.id} className={cn("p-3 sm:px-4", emFaltaStatus(f) && "bg-warning/[0.04]")}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm leading-tight">{f.descricao}</p>
                        <Chip className={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</Chip>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        <span className="font-mono">{f.codigo}</span>{detalhes && ` · ${detalhes}`}
                      </p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-9 w-9 -mr-1 shrink-0" aria-label={`Mais ações para ${f.descricao}`}>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={() => abrirEdicao(f)} className="gap-2 py-2.5"><Pencil className="h-4 w-4" />Editar</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setConfirmExcluir(f)} className="gap-2 py-2.5 text-destructive focus:text-destructive"><Trash2 className="h-4 w-4" />Excluir</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="mt-2.5 flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-muted-foreground">
                          <strong className="text-foreground tabular-nums">{f.pecas_produzidas.toLocaleString("pt-BR")}</strong>
                          {f.vida_util_pecas > 0 ? ` de ${f.vida_util_pecas.toLocaleString("pt-BR")} peças` : " peças (sem limite)"}
                        </span>
                        {pct !== null && <span className={cn("font-semibold tabular-nums", pct >= 100 ? "text-destructive" : pct >= 80 ? "text-warning" : "text-muted-foreground")}>{pct}%</span>}
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        {barra !== null && <div className={cn("h-full rounded-full transition-all", tom)} style={{ width: `${barra}%` }} />}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {f.ultima_troca ? `Última troca: ${new Date(f.ultima_troca + "T12:00:00").toLocaleDateString("pt-BR")}` : "Sem troca registrada"}
                        {f.custo_unitario != null && ` · ${formatBRL(f.custo_unitario)} cada`}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                      <Button variant="outline" className="h-10 rounded-xl gap-1.5" disabled={ocupado === f.id} onClick={() => registrarPeca(f)}>
                        {ocupado === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} 1 peça
                      </Button>
                      <Button variant={f.status === "substituir" ? "default" : "outline"} className="h-10 rounded-xl gap-1.5" disabled={ocupado === f.id} onClick={() => setConfirmTroca(f)}>
                        <CheckCircle2 className="h-4 w-4" /> Registrar troca
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Cadastrar / editar */}
      <Dialog open={editando !== null} onOpenChange={v => { if (!v && !saving) setEditando(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-primary" />{editando === "nova" ? "Cadastrar ferramenta" : "Editar ferramenta"}
            </DialogTitle>
            <DialogDescription>
              {editando === "nova" ? "Preencha o código e a descrição; o resto é opcional." : "O contador de peças não muda aqui — use “Registrar troca” para zerar."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Código *" htmlFor="f-codigo"><Input id="f-codigo" className="h-11" value={form.codigo} onChange={e => setForm({ ...form, codigo: e.target.value })} placeholder="CNMG120408" /></Field>
              <Field label="Tipo">
                <Select value={form.tipo} onValueChange={(v: TipoFerramenta) => setForm({ ...form, tipo: v })}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>{TIPOS.map(t => <SelectItem key={t} value={t}>{TIPO_LABEL[t]}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Descrição *" htmlFor="f-desc"><Input id="f-desc" className="h-11" value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })} placeholder="Pastilha, broca, macho…" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Vida útil (peças, 0 = sem limite)" htmlFor="f-vida"><Input id="f-vida" className="h-11" type="number" inputMode="numeric" min={0} step={1} value={form.vida_util_pecas} onChange={e => setForm({ ...form, vida_util_pecas: e.target.value })} /></Field>
              <Field label="Custo unitário (R$)" htmlFor="f-custo"><Input id="f-custo" className="h-11" type="number" inputMode="decimal" min={0} step="0.01" value={form.custo_unitario} onChange={e => setForm({ ...form, custo_unitario: e.target.value })} placeholder="0,00" /></Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Máquina">
                <Select value={form.maquina_codigo || "nenhuma"} onValueChange={v => setForm({ ...form, maquina_codigo: v === "nenhuma" ? "" : v })}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="nenhuma">Nenhuma</SelectItem>{maquinas.map(m => <SelectItem key={m.codigo} value={m.codigo}>{m.codigo} · {m.nome}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Fornecedor">
                <Select value={form.fornecedor_id || "nenhum"} onValueChange={v => setForm({ ...form, fornecedor_id: v === "nenhum" ? "" : v })}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="nenhum">Nenhum</SelectItem>{fornecedores.map(f => <SelectItem key={f.id} value={f.id}>{f.razao_social}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </div>
            {editando !== "nova" && (
              <label className="flex items-center gap-3 rounded-xl border p-3 cursor-pointer">
                <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={form.status === "inativo"}
                  onChange={e => setForm({ ...form, status: e.target.checked ? "inativo" : "ativo" })} />
                <span className="text-sm">
                  <span className="font-medium">Ferramenta inativa</span>
                  <span className="block text-xs text-muted-foreground">Não entra no controle de faltas.</span>
                </span>
              </label>
            )}
            <Field label="Observações" htmlFor="f-obs"><Textarea id="f-obs" rows={2} value={form.observacoes} onChange={e => setForm({ ...form, observacoes: e.target.value })} /></Field>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" className="h-11" onClick={() => setEditando(null)} disabled={saving}>Cancelar</Button>
            <Button className="h-11 gap-2" onClick={salvar} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editando === "nova" ? <Plus className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {saving ? "Salvando…" : editando === "nova" ? "Cadastrar" : "Salvar alterações"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar troca */}
      <AlertDialog open={!!confirmTroca} onOpenChange={v => { if (!v) setConfirmTroca(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Registrar troca de {confirmTroca?.descricao}?</AlertDialogTitle>
            <AlertDialogDescription>
              O contador de peças ({confirmTroca?.pecas_produzidas.toLocaleString("pt-BR")}) volta para zero e a data de hoje fica como última troca.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirmTroca) registrarTroca(confirmTroca); setConfirmTroca(null); }}>
              Sim, registrar troca
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmar exclusão */}
      <AlertDialog open={!!confirmExcluir} onOpenChange={v => { if (!v) setConfirmExcluir(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {confirmExcluir?.descricao}?</AlertDialogTitle>
            <AlertDialogDescription>
              A ferramenta <strong className="font-mono">{confirmExcluir?.codigo}</strong> e o histórico de uso dela saem do cadastro. Isso não pode ser desfeito.
              Se ela só não é mais usada, prefira marcar como inativa em “Editar”.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (confirmExcluir) excluir(confirmExcluir); setConfirmExcluir(null); }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
