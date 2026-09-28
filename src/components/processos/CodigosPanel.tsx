/**
 * Processos › Códigos CNC — biblioteca de programas compartilhada com a equipe
 * (salva no banco). No celular: lista → editor (com botão voltar); no
 * computador: lista e editor lado a lado. Avisa antes de descartar alterações
 * não salvas e pede confirmação para apagar.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft, ChevronRight, Copy, Download, FileCode2, Loader2, Plus, Save, Search, Trash2, Upload, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { friendlyError } from "@/lib/errorMessages";
import { LINGUAGENS_CNC, type LinguagemCnc } from "@/lib/programasCnc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ImportarProgramasDialog } from "./ImportarProgramasDialog";
import { EmptyState, Field, downloadBlob, useDropdownOptions, type Programa } from "./shared";

const NOVO_CONTEUDO = "(INICIO)\nG21 G90\nM30\n(FIM)";
const novoPrograma = (): Programa => ({
  id: "novo", nome: "Novo programa", maquina_codigo: null, linguagem: "G-Code",
  conteudo: NOVO_CONTEUDO, updated_at: new Date().toISOString(),
});

function mesmoConteudo(a: Programa, b: Programa) {
  return a.nome === b.nome && a.maquina_codigo === b.maquina_codigo && a.linguagem === b.linguagem && a.conteudo === b.conteudo;
}

export function CodigosPanel() {
  const { user } = useAuth();
  const { maquinas } = useDropdownOptions();
  const [programas, setProgramas] = useState<Programa[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [selectedId, setSelectedId] = useState<string>("novo");
  const [draft, setDraft] = useState<Programa>(novoPrograma);
  const [original, setOriginal] = useState<Programa>(draft);
  const [saving, setSaving] = useState(false);
  const [importarAberto, setImportarAberto] = useState(false);
  // Celular: "lista" ou "editor". No computador os dois aparecem juntos.
  const [vistaMobile, setVistaMobile] = useState<"lista" | "editor">("lista");
  const [pendente, setPendente] = useState<(() => void) | null>(null);
  const [confirmApagar, setConfirmApagar] = useState(false);

  const alterado = !mesmoConteudo(draft, original);

  const fetchProgramas = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("programas_cnc").select("*").order("nome");
    setLoading(false);
    if (error) {
      logger.error("fetchProgramas error:", error.message);
      toast.error("Erro ao carregar programas.");
      return null;
    }
    const list = (data ?? []) as Programa[];
    setProgramas(list);
    return list;
  }, []);

  useEffect(() => { fetchProgramas(); }, [fetchProgramas]);

  // Troca de programa com proteção para alterações não salvas.
  const protegido = (acao: () => void) => {
    if (alterado) setPendente(() => acao);
    else acao();
  };

  const abrir = (p: Programa) => {
    setSelectedId(p.id); setDraft(p); setOriginal(p); setVistaMobile("editor");
  };
  const criarNovo = () => {
    const n = novoPrograma();
    setSelectedId("novo"); setDraft(n); setOriginal(n); setVistaMobile("editor");
  };

  const salvar = async () => {
    if (!draft.nome.trim()) return toast.error("Informe o nome do programa.");
    setSaving(true);
    if (draft.id === "novo") {
      const { data, error } = await supabase.from("programas_cnc").insert({
        nome: draft.nome.trim(), maquina_codigo: draft.maquina_codigo, linguagem: draft.linguagem,
        conteudo: draft.conteudo, created_by: user?.id ?? null,
      }).select("id").single();
      setSaving(false);
      if (error || !data) { toast.error(friendlyError(error, "Erro ao salvar o programa.")); return; }
      const salvo = { ...draft, id: data.id, nome: draft.nome.trim() };
      setSelectedId(data.id); setDraft(salvo); setOriginal(salvo);
    } else {
      const { error } = await supabase.from("programas_cnc").update({
        nome: draft.nome.trim(), maquina_codigo: draft.maquina_codigo, linguagem: draft.linguagem, conteudo: draft.conteudo,
      }).eq("id", draft.id);
      setSaving(false);
      if (error) { toast.error(friendlyError(error, "Erro ao salvar o programa.")); return; }
      const salvo = { ...draft, nome: draft.nome.trim() };
      setDraft(salvo); setOriginal(salvo);
    }
    toast.success("Programa salvo.");
    fetchProgramas();
  };

  // Ctrl+S / Cmd+S salva o programa aberto.
  const salvarRef = useRef(salvar);
  salvarRef.current = salvar;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); salvarRef.current(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const apagar = async () => {
    if (draft.id === "novo") return;
    const { error } = await supabase.from("programas_cnc").delete().eq("id", draft.id);
    if (error) { toast.error(friendlyError(error, "Erro ao apagar o programa.")); return; }
    toast.success("Programa apagado.");
    const n = novoPrograma();
    setSelectedId("novo"); setDraft(n); setOriginal(n); setVistaMobile("lista");
    fetchProgramas();
  };

  const baixar = () => {
    const ext = draft.linguagem === "Siemens" ? "mpf" : draft.linguagem === "Heidenhain" ? "h" : "nc";
    downloadBlob(new Blob([draft.conteudo], { type: "text/plain;charset=utf-8" }), `${draft.nome.replace(/[^a-z0-9_-]+/gi, "_")}.${ext}`);
    toast.success("Programa baixado.");
  };
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(draft.conteudo);
      toast.success("Código copiado.");
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
    }
  };

  const aposImportar = async (ultimoId: string | null) => {
    const list = await fetchProgramas();
    const alvo = ultimoId && list?.find(p => p.id === ultimoId);
    if (alvo) abrir(alvo);
  };

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return programas;
    return programas.filter(p => `${p.nome} ${p.maquina_codigo ?? ""} ${p.linguagem}`.toLowerCase().includes(q));
  }, [programas, busca]);

  const maquinaNome = (codigo: string | null) => {
    if (!codigo) return "Sem máquina";
    const m = maquinas.find(x => x.codigo === codigo);
    return m ? `${m.codigo} · ${m.nome}` : codigo;
  };

  const totalLinhas = draft.conteudo.split("\n").length;
  const numeros = useMemo(() => Array.from({ length: totalLinhas }, (_, i) => i + 1).join("\n"), [totalLinhas]);

  return (
    <div className="grid gap-3 lg:gap-4 lg:grid-cols-[320px_minmax(0,1fr)] items-start">
      <ImportarProgramasDialog open={importarAberto} onOpenChange={setImportarAberto} maquinas={maquinas}
        existentes={programas} userId={user?.id ?? null} onImportado={aposImportar} />

      {/* ── Lista ─────────────────────────────────────────── */}
      <section className={cn("rounded-2xl border bg-card overflow-hidden lg:sticky lg:top-4", vistaMobile === "editor" && "hidden lg:block")}>
        <div className="p-3 space-y-2 border-b">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold flex items-center gap-2"><FileCode2 className="h-4 w-4 text-primary" />Programas CNC</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">{programas.length}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button className="h-11 rounded-xl gap-2" onClick={() => protegido(criarNovo)}><Plus className="h-4 w-4" />Novo</Button>
            <Button variant="outline" className="h-11 rounded-xl gap-2" onClick={() => setImportarAberto(true)}><Upload className="h-4 w-4" />Importar</Button>
          </div>
          {programas.length > 5 && (
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input className="pl-9 pr-9 h-11 rounded-xl" placeholder="Buscar programa…" value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar programa" />
              {busca && (
                <button type="button" onClick={() => setBusca("")} aria-label="Limpar busca"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>
        {loading && !programas.length ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground text-sm gap-2"><Loader2 className="h-4 w-4 animate-spin" />Carregando…</div>
        ) : programas.length === 0 ? (
          <EmptyState icon={FileCode2} title="Nenhum programa salvo" text="Use “Importar” para trazer os arquivos do SolidCAM ou “Novo” para escrever um." />
        ) : filtrados.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum programa com “{busca}”.</p>
        ) : (
          <ul className="divide-y max-h-none lg:max-h-[calc(100vh-18rem)] overflow-y-auto">
            {filtrados.map(p => {
              const ativo = selectedId === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => { if (!ativo) protegido(() => abrir(p)); else setVistaMobile("editor"); }}
                    aria-current={ativo ? "true" : undefined}
                    className={cn(
                      "w-full text-left px-3 py-3 flex items-center gap-3 transition-colors",
                      ativo ? "bg-primary/10" : "hover:bg-muted/50"
                    )}
                  >
                    <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0", ativo ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                      <FileCode2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm font-semibold truncate", ativo && "text-primary")}>{p.nome}</p>
                      <p className="text-xs text-muted-foreground truncate">{maquinaNome(p.maquina_codigo)} · {p.linguagem}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 lg:hidden" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Editor ────────────────────────────────────────── */}
      <section className={cn("rounded-2xl border bg-card overflow-hidden min-w-0", vistaMobile === "lista" && "hidden lg:block")}>
        <div className="p-3 sm:p-4 space-y-3 border-b">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-10 w-10 -ml-1 lg:hidden shrink-0" aria-label="Voltar para a lista"
              onClick={() => protegido(() => { setDraft(original); setVistaMobile("lista"); })}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold truncate">{draft.id === "novo" ? "Novo programa" : draft.nome || "Sem nome"}</h2>
              <p className="text-[11px] text-muted-foreground">
                {alterado ? <span className="text-warning font-medium">Alterações não salvas</span> : draft.id === "novo" ? "Ainda não salvo" : "Salvo · compartilhado com a equipe"}
              </p>
            </div>
            <Button className="h-10 rounded-xl gap-2 shrink-0" onClick={salvar} disabled={saving || (!alterado && draft.id !== "novo")}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)] gap-2">
            <Field label="Nome" className="col-span-2 sm:col-span-1" htmlFor="prog-nome">
              <Input id="prog-nome" className="h-11" value={draft.nome} onChange={e => setDraft({ ...draft, nome: e.target.value })} />
            </Field>
            <Field label="Máquina">
              <Select value={draft.maquina_codigo ?? "nenhuma"} onValueChange={v => setDraft({ ...draft, maquina_codigo: v === "nenhuma" ? null : v })}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="nenhuma">Nenhuma</SelectItem>{maquinas.map(m => <SelectItem key={m.codigo} value={m.codigo}>{m.codigo} · {m.nome}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Linguagem">
              <Select value={draft.linguagem} onValueChange={(v: LinguagemCnc) => setDraft({ ...draft, linguagem: v })}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>{LINGUAGENS_CNC.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
        </div>

        <div className="px-3 sm:px-4 py-2 flex items-center gap-1 border-b bg-muted/30">
          <Button variant="ghost" size="sm" className="h-9 gap-1.5" onClick={copiar}><Copy className="h-4 w-4" />Copiar</Button>
          <Button variant="ghost" size="sm" className="h-9 gap-1.5" onClick={baixar}><Download className="h-4 w-4" />Baixar</Button>
          <Button variant="ghost" size="sm" className="h-9 gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => setConfirmApagar(true)} disabled={draft.id === "novo"}>
            <Trash2 className="h-4 w-4" />Apagar
          </Button>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums whitespace-nowrap">{totalLinhas.toLocaleString("pt-BR")} linhas</span>
        </div>

        <div className="flex max-h-[65vh] lg:max-h-[calc(100vh-20rem)] min-h-[50vh] overflow-auto bg-slate-950 text-slate-100">
          <pre aria-hidden className="select-none sticky left-0 z-[1] px-2 sm:px-3 py-3 text-right text-[11px] sm:text-xs leading-6 bg-slate-900 text-slate-500 font-mono border-r border-slate-800 min-h-full">{numeros}</pre>
          <textarea
            value={draft.conteudo}
            onChange={e => setDraft({ ...draft, conteudo: e.target.value })}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap="off"
            rows={totalLinhas + 1}
            aria-label="Código do programa"
            className="flex-1 min-w-[560px] resize-none overflow-hidden border-0 bg-transparent text-slate-100 font-mono text-[13px] sm:text-sm leading-6 p-3 outline-none focus-visible:outline-none"
          />
        </div>
      </section>

      {/* Alterações não salvas */}
      <AlertDialog open={!!pendente} onOpenChange={v => { if (!v) setPendente(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar alterações?</AlertDialogTitle>
            <AlertDialogDescription>
              O programa “{draft.nome}” tem alterações que ainda não foram salvas. Se continuar, elas serão perdidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar e salvar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { const acao = pendente; setPendente(null); acao?.(); }}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Apagar */}
      <AlertDialog open={confirmApagar} onOpenChange={setConfirmApagar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar o programa “{draft.nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Ele sai da biblioteca para toda a equipe. Se quiser guardar uma cópia, use “Baixar” antes. Isso não pode ser desfeito.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={apagar}>
              Apagar programa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
