/**
 * Importar programas CNC (Processos → Códigos CNC).
 *
 * O usuário escolhe (ou arrasta) um ou vários arquivos gerados pelo
 * pós-processador (SolidCAM etc.). Cada arquivo vira um programa na
 * biblioteca. Se já existir um programa com o mesmo nome e máquina, o
 * usuário decide se substitui o conteúdo ou salva como cópia.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileCode2, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  EXTENSOES_CNC, LINGUAGENS_CNC, type LinguagemCnc,
  decodificarPrograma, detectarLinguagem, detectarMaquina, nomeSemExtensao,
} from "@/lib/programasCnc";

interface ProgramaExistente { id: string; nome: string; maquina_codigo: string | null }
interface Item {
  chave: string; arquivo: string; nome: string; maquina: string | null; linguagem: LinguagemCnc;
  conteudo: string; linhas: number; erro?: string; acao: "substituir" | "copia";
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export function ImportarProgramasDialog({ open, onOpenChange, maquinas, existentes, userId, onImportado }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  maquinas: { codigo: string; nome: string }[];
  existentes: ProgramaExistente[];
  userId: string | null;
  onImportado: (ultimoId: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { if (!open) { setItens([]); setSalvando(false); } }, [open]);

  const duplicado = (it: Item) => existentes.find(p => semAcento(p.nome) === semAcento(it.nome) && (p.maquina_codigo ?? null) === (it.maquina ?? null));

  async function adicionar(files: FileList | File[]) {
    const codigos = maquinas.map(m => m.codigo);
    const novos: Item[] = [];
    for (const f of Array.from(files)) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const r = decodificarPrograma(bytes);
      const base = { chave: `${f.name}-${f.size}-${f.lastModified}`, arquivo: f.name, nome: nomeSemExtensao(f.name), maquina: detectarMaquina(f.name, codigos), acao: "substituir" as const };
      novos.push(r.ok
        ? { ...base, linguagem: detectarLinguagem(f.name, r.conteudo), conteudo: r.conteudo, linhas: r.linhas }
        : { ...base, linguagem: "G-Code", conteudo: "", linhas: 0, erro: r.erro });
    }
    setItens(prev => [...prev.filter(p => !novos.some(n => n.chave === p.chave)), ...novos]);
  }

  const atualizar = (chave: string, patch: Partial<Item>) => setItens(prev => prev.map(i => i.chave === chave ? { ...i, ...patch } : i));
  const remover = (chave: string) => setItens(prev => prev.filter(i => i.chave !== chave));
  const validos = itens.filter(i => !i.erro && i.nome.trim());

  async function importar() {
    if (!validos.length) return;
    setSalvando(true);
    let ok = 0, falhas = 0, ultimoId: string | null = null;
    for (const it of validos) {
      const dup = duplicado(it);
      if (dup && it.acao === "substituir") {
        const { error } = await supabase.from("programas_cnc")
          .update({ conteudo: it.conteudo, linguagem: it.linguagem }).eq("id", dup.id);
        if (error) falhas++; else { ok++; ultimoId = dup.id; }
      } else {
        let nome = it.nome.trim();
        if (dup) {
          const usados = new Set(existentes.map(p => semAcento(p.nome)));
          let n = 2; while (usados.has(semAcento(`${nome} (${n})`))) n++;
          nome = `${nome} (${n})`;
        }
        const { data, error } = await supabase.from("programas_cnc")
          .insert({ nome, maquina_codigo: it.maquina, linguagem: it.linguagem, conteudo: it.conteudo, created_by: userId })
          .select("id").single();
        if (error || !data) falhas++; else { ok++; ultimoId = data.id; }
      }
    }
    setSalvando(false);
    if (ok) toast.success(ok === 1 ? "1 programa importado." : `${ok} programas importados.`);
    if (falhas) toast.error(`${falhas} não ${falhas === 1 ? "pôde" : "puderam"} ser salvo${falhas === 1 ? "" : "s"}. Verifique a conexão e tente de novo.`);
    if (ok) { onImportado(ultimoId); if (!falhas) onOpenChange(false); }
  }

  return (
    <Dialog open={open} onOpenChange={v => !salvando && onOpenChange(v)}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="h-5 w-5 text-primary" />Importar programas</DialogTitle>
          <DialogDescription>Escolha os arquivos gerados pelo SolidCAM (ou outro CAM). Cada arquivo vira um programa salvo no sistema.</DialogDescription>
        </DialogHeader>

        <input ref={inputRef} type="file" multiple className="hidden"
          accept={EXTENSOES_CNC.join(",")}
          onChange={e => { if (e.target.files?.length) adicionar(e.target.files); e.target.value = ""; }} />

        <button type="button" onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={e => { e.preventDefault(); setArrastando(false); if (e.dataTransfer.files?.length) adicionar(e.dataTransfer.files); }}
          className={cn("w-full rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors",
            arrastando ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/40")}>
          <FileCode2 className="mx-auto h-8 w-8 text-primary/70" />
          <p className="mt-2 text-sm font-semibold">Clique para escolher ou arraste os arquivos aqui</p>
          <p className="mt-0.5 text-xs text-muted-foreground">.nc, .tap, .txt, .mpf, .h, .eia … — pode escolher vários de uma vez (até 5 MB cada)</p>
        </button>

        {itens.length > 0 && (
          <ul className="space-y-2">
            {itens.map(it => {
              const dup = !it.erro && duplicado(it);
              return (
                <li key={it.chave} className={cn("rounded-xl border p-3", it.erro && "border-destructive/40 bg-destructive/5")}>
                  <div className="flex items-start gap-2">
                    {it.erro ? <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive shrink-0" /> : <CheckCircle2 className="h-4 w-4 mt-0.5 text-success shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground truncate">{it.arquivo}{!it.erro && ` · ${it.linhas.toLocaleString("pt-BR")} linhas`}</p>
                      {it.erro ? <p className="text-sm font-medium text-destructive">{it.erro}</p> : (
                        <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-[1fr_11rem_8rem] gap-2">
                          <Input value={it.nome} onChange={e => atualizar(it.chave, { nome: e.target.value })} aria-label="Nome do programa" className="h-10" />
                          <select value={it.maquina ?? ""} onChange={e => atualizar(it.chave, { maquina: e.target.value || null })} aria-label="Máquina"
                            className="h-10 rounded-md border border-input bg-background px-2 text-sm">
                            <option value="">Sem máquina</option>
                            {maquinas.map(m => <option key={m.codigo} value={m.codigo}>{m.codigo} · {m.nome}</option>)}
                          </select>
                          <select value={it.linguagem} onChange={e => atualizar(it.chave, { linguagem: e.target.value as LinguagemCnc })} aria-label="Linguagem"
                            className="h-10 rounded-md border border-input bg-background px-2 text-sm">
                            {LINGUAGENS_CNC.map(l => <option key={l} value={l}>{l}</option>)}
                          </select>
                        </div>
                      )}
                      {dup && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="text-amber-600 font-medium">Já existe um programa com esse nome{it.maquina ? " nessa máquina" : ""}:</span>
                          {(["substituir", "copia"] as const).map(a => (
                            <button key={a} type="button" onClick={() => atualizar(it.chave, { acao: a })}
                              className={cn("rounded-full border px-2.5 py-0.5 font-medium",
                                it.acao === a ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}>
                              {a === "substituir" ? "Substituir pelo novo" : "Salvar como cópia"}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => remover(it.chave)} aria-label={`Tirar ${it.arquivo}`}><X className="h-4 w-4" /></Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>Cancelar</Button>
          <Button onClick={importar} disabled={salvando || validos.length === 0} className="gap-1.5">
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {validos.length > 1 ? `Importar ${validos.length} programas` : "Importar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
