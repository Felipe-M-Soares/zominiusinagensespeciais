/**
 * ControlePanel — Controle de Produção
 * ✓ Dados reais via Supabase (tabela apontamentos_producao)
 * ✓ Fallback offline com IndexedDB
 * ✓ Sem histórico/dados mock
 */

import { useState, useEffect, useCallback } from "react";
import { Plus, X, Search, Clock, User2, Package, Hash, CheckCircle2, PlayCircle, ClipboardList, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { useAuth } from "@/hooks/useAuth";

type Turno = "1º Turno" | "2º Turno" | "3º Turno";

interface Apontamento {
  id: string;
  produto: string;
  lote: string;
  maquina: string;
  operador: string;
  turno: Turno;
  quantidade: number;
  inicio: string;
  fim?: string;
  status: "em_andamento" | "concluido";
  user_id?: string;
  created_at?: string;
}

const TURNOS: Turno[] = ["1º Turno", "2º Turno", "3º Turno"];

function NovoApontamentoModal({ open, onClose, onSaved, maquinas, produtos }: {
  open: boolean; onClose: () => void; onSaved: (a: Apontamento) => void;
  maquinas: string[]; produtos: string[];
}) {
  const [form, setForm] = useState({ produto:"", lote:"", maquina:"", operador:"", turno:"1º Turno" as Turno, quantidade:"" });
  const [saving, setSaving] = useState(false);
  const { saveWithFallback } = useOfflineSync();
  const { user } = useAuth();

  useEffect(() => {
    if (open) setForm({ produto:"", lote:"", maquina:"", operador:"", turno:"1º Turno", quantidade:"" });
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    if (!form.produto || !form.maquina || !form.operador || !form.quantidade) {
      toast.error("Preencha todos os campos obrigatórios"); return;
    }
    setSaving(true);
    const now = new Date();
    const inicio = `${now.getHours().toString().padStart(2,"0")}:${now.getMinutes().toString().padStart(2,"0")}`;
    const id = crypto.randomUUID();
    const data = {
      id, produto: form.produto, lote: form.lote || `LOT-${Date.now()}`,
      maquina: form.maquina, operador: form.operador, turno: form.turno,
      quantidade: Number(form.quantidade), inicio, status: "em_andamento" as const,
      user_id: user?.id,
    };
    const { data: saved, error, savedOffline } = await saveWithFallback(
      "apontamentos_producao", "apontamentos", "INSERT", data
    );
    setSaving(false);
    if (error) { toast.error("Erro ao salvar apontamento"); return; }
    toast.success(savedOffline ? "Apontamento salvo offline" : "Apontamento registrado!");
    onSaved(saved || data);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-card rounded-xl border shadow-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Novo Apontamento</h3>
          <button onClick={onClose} aria-label="Fechar"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Produto *</label>
            {produtos.length > 0 ? (
              <select value={form.produto} onChange={e => setForm(p=>({...p, produto:e.target.value}))}
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                <option value="">Selecione...</option>
                {produtos.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            ) : (
              <Input value={form.produto} onChange={e=>setForm(p=>({...p,produto:e.target.value}))} placeholder="Ex: PÇ-001 Eixo" />
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Lote (opcional)</label>
            <Input value={form.lote} onChange={e=>setForm(p=>({...p,lote:e.target.value}))} placeholder="Ex: LOT-2026-001" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Máquina *</label>
            {maquinas.length > 0 ? (
              <select value={form.maquina} onChange={e=>setForm(p=>({...p,maquina:e.target.value}))}
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                <option value="">Selecione...</option>
                {maquinas.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <Input value={form.maquina} onChange={e=>setForm(p=>({...p,maquina:e.target.value}))} placeholder="Ex: CNC-01" />
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Operador *</label>
            <Input value={form.operador} onChange={e=>setForm(p=>({...p,operador:e.target.value}))} placeholder="Nome do operador" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Turno</label>
              <select value={form.turno} onChange={e=>setForm(p=>({...p,turno:e.target.value as Turno}))}
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                {TURNOS.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Quantidade *</label>
              <Input type="number" min="1" value={form.quantidade} onChange={e=>setForm(p=>({...p,quantidade:e.target.value}))} placeholder="0" />
            </div>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="flex-1" onClick={handleSave} disabled={saving}>
            {saving ? "Salvando..." : "Registrar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ApontamentoCard({ ap, onConcluir }: { ap: Apontamento; onConcluir: (id:string)=>void }) {
  const isAtivo = ap.status === "em_andamento";
  return (
    <div className={cn("rounded-xl border p-4 space-y-3 transition-all",
      isAtivo ? "bg-green-500/5 border-green-500/20" : "bg-card/60 border-border opacity-75")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{ap.produto}</p>
          <p className="text-[11px] text-muted-foreground">{ap.maquina} · {ap.turno}</p>
        </div>
        <Badge variant={isAtivo ? "default" : "secondary"} className="text-[10px] shrink-0">
          {isAtivo ? "Em andamento" : "Concluído"}
        </Badge>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div className="flex items-center gap-1 text-muted-foreground"><Hash className="h-3 w-3"/><span>{ap.lote}</span></div>
        <div className="flex items-center gap-1 text-muted-foreground"><User2 className="h-3 w-3"/><span className="truncate">{ap.operador}</span></div>
        <div className="flex items-center gap-1 text-muted-foreground"><Clock className="h-3 w-3"/><span>{ap.inicio}{ap.fim ? `–${ap.fim}`:""}</span></div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5 text-green-500"/>
          <span className="font-semibold text-sm">{ap.quantidade.toLocaleString("pt-BR")} pç</span>
        </div>
        {isAtivo && (
          <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={()=>onConcluir(ap.id)}>
            <CheckCircle2 className="h-3 w-3"/>Concluir
          </Button>
        )}
      </div>
    </div>
  );
}

export function ControlePanel({ isAdmin: _isAdmin }: { isAdmin: boolean }) {
  const [apontamentos, setApontamentos] = useState<Apontamento[]>([]);
  const [maquinas, setMaquinas] = useState<string[]>([]);
  const [produtos, setProdutos] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"todos"|"em_andamento"|"concluido">("todos");
  const { isOnline, saveWithFallback, loadWithFallback } = useOfflineSync();

  const load = useCallback(async () => {
    setLoading(true);
    const data = await loadWithFallback<Apontamento>("apontamentos_producao", "apontamentos");
    setApontamentos(data.sort((a,b) => (b.created_at||"").localeCompare(a.created_at||"")));

    // Carrega listas de máquinas e produtos do Supabase se online
    if (navigator.onLine) {
      const [{ data: maq }, { data: prod }] = await Promise.all([
        supabase.from("maquinas_producao").select("codigo").order("codigo"),
        supabase.from("produtos_producao").select("codigo,descricao").eq("ativo",true).order("codigo"),
      ]);
      if (maq) setMaquinas(maq.map((m:{ codigo:string }) => m.codigo));
      if (prod) setProdutos(prod.map((p:{ codigo:string; descricao:string }) => `${p.codigo} ${p.descricao}`));
    }
    setLoading(false);
  }, [loadWithFallback]);

  useEffect(() => { load(); }, [load]);

  async function handleConcluir(id: string) {
    const ap = apontamentos.find(a => a.id === id);
    if (!ap) return;
    const now = new Date();
    const fim = `${now.getHours().toString().padStart(2,"0")}:${now.getMinutes().toString().padStart(2,"0")}`;
    const updated = { ...ap, fim, status: "concluido" as const };
    const { error, savedOffline } = await saveWithFallback("apontamentos_producao", "apontamentos", "UPDATE", updated);
    if (error) { toast.error("Erro ao concluir"); return; }
    toast.success(savedOffline ? "Concluído offline" : "Apontamento concluído!");
    setApontamentos(prev => prev.map(a => a.id === id ? updated : a));
  }

  const filtered = apontamentos.filter(a => {
    const matchSearch = !search || [a.produto, a.lote, a.maquina, a.operador].some(v => v.toLowerCase().includes(search.toLowerCase()));
    const matchStatus = filtroStatus === "todos" || a.status === filtroStatus;
    return matchSearch && matchStatus;
  });

  const emAndamento = apontamentos.filter(a => a.status === "em_andamento").length;
  const totalPecas = apontamentos.filter(a => a.status === "em_andamento").reduce((s,a) => s + a.quantidade, 0);

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border bg-green-500/5 border-green-500/20 p-4">
          <div className="flex items-center gap-2 mb-1"><PlayCircle className="h-4 w-4 text-green-500"/><span className="text-xs text-muted-foreground">Em andamento</span></div>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">{emAndamento}</p>
        </div>
        <div className="rounded-xl border bg-blue-500/5 border-blue-500/20 p-4">
          <div className="flex items-center gap-2 mb-1"><Package className="h-4 w-4 text-blue-500"/><span className="text-xs text-muted-foreground">Peças em produção</span></div>
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{totalPecas.toLocaleString("pt-BR")}</p>
        </div>
      </div>

      {/* Barra de ações */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"/>
          <Input className="pl-8 h-9 text-sm" placeholder="Buscar..." value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <select value={filtroStatus} onChange={e=>setFiltroStatus(e.target.value as typeof filtroStatus)}
          className="h-9 rounded-lg border border-input bg-background px-3 text-sm">
          <option value="todos">Todos</option>
          <option value="em_andamento">Em andamento</option>
          <option value="concluido">Concluídos</option>
        </select>
        <Button size="sm" className="gap-1 h-9" onClick={()=>setModalOpen(true)}>
          <Plus className="h-4 w-4"/>Novo
        </Button>
        <Button size="sm" variant="outline" className="h-9 px-2" onClick={load} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")}/>
        </Button>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
          <RefreshCw className="h-4 w-4 animate-spin"/> Carregando...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-2">
          <ClipboardList className="h-8 w-8 opacity-30"/>
          <p>{apontamentos.length === 0 ? "Nenhum apontamento registrado" : "Nenhum resultado encontrado"}</p>
          {!isOnline && <div className="flex items-center gap-1 text-xs text-amber-600"><WifiOff className="h-3 w-3"/>Modo offline</div>}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(ap => <ApontamentoCard key={ap.id} ap={ap} onConcluir={handleConcluir}/>)}
        </div>
      )}

      <NovoApontamentoModal open={modalOpen} onClose={()=>setModalOpen(false)} onSaved={ap=>{setApontamentos(p=>[ap,...p]);}} maquinas={maquinas} produtos={produtos}/>
    </div>
  );
}
