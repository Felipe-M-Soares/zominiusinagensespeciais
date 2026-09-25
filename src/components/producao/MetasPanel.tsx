import { useState, useEffect, useCallback } from "react";
import { Target, Plus, RefreshCw, X, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Meta { id:string; mes:number; ano:number; maquina_codigo:string|null; meta_pecas:number; meta_oee_pct:number; meta_disponibilidade_pct:number; meta_qualidade_pct:number; }
interface OEEReal { oee:number; disponibilidade:number; performance:number; qualidade:number; qtde_produzida:number; }

const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

/**
 * Meta SEMESTRAL de produtividade das máquinas — armazenada na mesma tabela
 * metas_producao (sem migration nova), usando a convenção:
 *   maquina_codigo = 'SEMESTRE'  e  mes = 1 (1º sem) ou 7 (2º sem).
 * O campo meta_oee_pct guarda a % de produtividade alvo do semestre.
 * A UNIQUE(mes, ano, maquina_codigo) do banco garante 1 meta por semestre/ano.
 */
export const META_SEMESTRE_CODIGO = "SEMESTRE";
export function periodoSemestre(sem:1|2, ano:number){
  return sem===1
    ? { ini:`${ano}-01-01`, fim:`${ano}-06-30` }
    : { ini:`${ano}-07-01`, fim:`${ano}-12-31` };
}

export function MetasPanel() {
  const now = new Date();
  const [mes, setMes] = useState(now.getMonth()+1);
  const [ano, setAno] = useState(now.getFullYear());
  const [metas, setMetas] = useState<Meta[]>([]);
  const [oeeReal, setOeeReal] = useState<OEEReal|null>(null);
  const [maquinas, setMaquinas] = useState<{codigo:string}[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ maquina_codigo:"", meta_pecas:"0", meta_oee_pct:"85", meta_disponibilidade_pct:"90", meta_qualidade_pct:"98" });

  // ── Meta semestral de produtividade ──────────────────────────────────────
  const semAtual:1|2 = now.getMonth()+1<=6?1:2;
  const [semestre, setSemestre] = useState<1|2>(semAtual);
  const [metaSemestre, setMetaSemestre] = useState<Meta|null>(null);
  const [realSemestre, setRealSemestre] = useState<OEEReal|null>(null);
  const [metaSemInput, setMetaSemInput] = useState("85");
  const [salvandoSem, setSalvandoSem] = useState(false);

  const load = useCallback(async()=>{
    setLoading(true);
    const ini = `${ano}-${String(mes).padStart(2,"0")}-01`;
    const fim = new Date(ano,mes,0).toISOString().split("T")[0];
    const per = periodoSemestre(semestre, ano);
    const[{data:m},{data:oee},{data:maq},{data:ms},{data:oeeSem}] = await Promise.all([
      supabase.from("metas_producao").select("*").eq("mes",mes).eq("ano",ano).order("maquina_codigo"),
      (supabase.rpc as any)("calcular_oee",{p_data_ini:ini,p_data_fim:fim,p_maquina:null}),
      supabase.from("maquinas_producao").select("codigo").order("codigo"),
      supabase.from("metas_producao").select("*").eq("ano",ano).eq("mes",semestre===1?1:7).eq("maquina_codigo",META_SEMESTRE_CODIGO).maybeSingle(),
      (supabase.rpc as any)("calcular_oee",{p_data_ini:per.ini,p_data_fim:per.fim,p_maquina:null}),
    ]);
    // A linha 'SEMESTRE' é uma convenção interna — não aparece na lista mensal
    if(m) setMetas((m as Meta[]).filter(x=>x.maquina_codigo!==META_SEMESTRE_CODIGO));
    if(oee) setOeeReal(oee as OEEReal);
    if(maq) setMaquinas(maq);
    setMetaSemestre(ms as Meta|null);
    if(ms) setMetaSemInput(String((ms as Meta).meta_oee_pct));
    if(oeeSem) setRealSemestre(oeeSem as OEEReal);
    setLoading(false);
  },[mes,ano,semestre]);

  async function salvarMetaSemestre() {
    const pct = parseFloat(metaSemInput);
    if(!pct||pct<=0||pct>100){toast.error("Informe uma porcentagem entre 1 e 100");return;}
    setSalvandoSem(true);
    const {error}=await supabase.from("metas_producao").upsert({
      mes: semestre===1?1:7, ano,
      maquina_codigo: META_SEMESTRE_CODIGO,
      meta_pecas: 0, meta_oee_pct: pct,
      meta_disponibilidade_pct: pct, meta_qualidade_pct: pct,
    },{onConflict:"mes,ano,maquina_codigo"});
    setSalvandoSem(false);
    if(error){toast.error(error.message);return;}
    toast.success(`Meta do ${semestre}º semestre/${ano} salva: ${pct}%`);
    load();
  }

  useEffect(()=>{load();},[load]);

  async function save() {
    const{error}=await supabase.from("metas_producao").upsert({
      mes, ano,
      maquina_codigo: form.maquina_codigo||null,
      meta_pecas: parseInt(form.meta_pecas)||0,
      meta_oee_pct: parseFloat(form.meta_oee_pct)||85,
      meta_disponibilidade_pct: parseFloat(form.meta_disponibilidade_pct)||90,
      meta_qualidade_pct: parseFloat(form.meta_qualidade_pct)||98,
    },{onConflict:"mes,ano,maquina_codigo"});
    if(error){toast.error(error.message);return;}
    toast.success("Meta salva!");
    setModal(false); load();
  }

  function gauge(real:number, meta:number) {
    const pct = meta>0 ? Math.min(100,Math.round(real/meta*100)) : 0;
    const ok = real>=meta;
    return { pct, ok, color: ok?"bg-green-500":"bg-red-500" };
  }

  const metaGeral = metas.find(m=>!m.maquina_codigo);
  const lbl="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block";
  const sel="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={mes} onChange={e=>setMes(Number(e.target.value))} className="h-9 rounded-lg border border-input bg-background px-3 text-sm">
          {MESES.map((m,i)=><option key={i} value={i+1}>{m}</option>)}
        </select>
        <select value={ano} onChange={e=>setAno(Number(e.target.value))} className="h-9 rounded-lg border border-input bg-background px-3 text-sm">
          {[2024,2025,2026,2027].map(y=><option key={y}>{y}</option>)}
        </select>
        <button onClick={load} className="h-9 w-9 flex items-center justify-center rounded-lg border border-input hover:bg-muted/40"><RefreshCw className={cn("h-4 w-4 text-muted-foreground",loading&&"animate-spin")}/></button>
        <Button size="sm" className="h-9 gap-1 ml-auto" onClick={()=>setModal(true)}><Plus className="h-4 w-4"/>Definir Meta</Button>
      </div>

      {/* Comparativo geral */}
      {oeeReal && metaGeral && (
        <div className="rounded-2xl border border-border/40 bg-card p-4 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Target className="h-4 w-4 text-primary"/>Realizado vs Meta — {MESES[mes-1]}/{ano}</h3>
          {[
            {label:"OEE",real:oeeReal.oee,meta:metaGeral.meta_oee_pct},
            {label:"Disponibilidade",real:oeeReal.disponibilidade,meta:metaGeral.meta_disponibilidade_pct},
            {label:"Qualidade",real:oeeReal.qualidade,meta:metaGeral.meta_qualidade_pct},
          ].map(({label,real,meta})=>{
            const g=gauge(real,meta);
            return (
              <div key={label} className="space-y-1">
                <div className="flex justify-between text-[12px]">
                  <span>{label}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={g.ok?"text-green-600 font-bold":"text-red-600 font-bold"}>{real.toFixed(1)}%</span>
                    <span className="text-muted-foreground text-[10px]">/ meta {meta}%</span>
                    {g.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600"/> : <AlertTriangle className="h-3.5 w-3.5 text-red-500"/>}
                  </div>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all",g.color)} style={{width:`${g.pct}%`}}/>
                </div>
              </div>
            );
          })}
          {metaGeral.meta_pecas>0&&(
            <div className="space-y-1">
              <div className="flex justify-between text-[12px]">
                <span>Peças Produzidas</span>
                <span className={oeeReal.qtde_produzida>=metaGeral.meta_pecas?"text-green-600 font-bold":"text-red-600 font-bold"}>
                  {oeeReal.qtde_produzida.toLocaleString("pt-BR")} / {metaGeral.meta_pecas.toLocaleString("pt-BR")}
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className={cn("h-full rounded-full",oeeReal.qtde_produzida>=metaGeral.meta_pecas?"bg-green-500":"bg-red-500")} style={{width:`${Math.min(100,Math.round(oeeReal.qtde_produzida/metaGeral.meta_pecas*100))}%`}}/>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Meta semestral de produtividade das máquinas */}
      <div className="rounded-2xl border border-border/40 bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Target className="h-4 w-4 text-emerald-600"/>
          <h3 className="text-sm font-semibold">Produtividade das Máquinas — Meta Semestral</h3>
          <select value={semestre} onChange={e=>setSemestre(Number(e.target.value) as 1|2)}
            className="ml-auto h-8 rounded-lg border border-input bg-background px-2 text-xs">
            <option value={1}>1º semestre</option>
            <option value={2}>2º semestre</option>
          </select>
        </div>

        {(()=>{
          // Produtividade = performance real do semestre (produzido ÷ planejado)
          const real = realSemestre?.performance ?? 0;
          const alvo = metaSemestre?.meta_oee_pct ?? 0;
          const g = alvo>0 ? gauge(real, alvo) : null;
          return (
            <>
              {alvo>0 ? (
                <div className="space-y-1">
                  <div className="flex justify-between text-[12px]">
                    <span>Produtividade real ({semestre}º sem/{ano})</span>
                    <div className="flex items-center gap-1.5">
                      <span className={g!.ok?"text-green-600 font-bold":"text-red-600 font-bold"}>{real.toFixed(1)}%</span>
                      <span className="text-muted-foreground text-[10px]">/ meta {alvo}%</span>
                      {g!.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600"/> : <AlertTriangle className="h-3.5 w-3.5 text-red-500"/>}
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all",g!.color)} style={{width:`${g!.pct}%`}}/>
                  </div>
                  {realSemestre && (
                    <p className="text-[10px] text-muted-foreground pt-0.5">
                      {realSemestre.qtde_produzida.toLocaleString("pt-BR")} peças produzidas no período · calculado sobre os apontamentos de todas as máquinas
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-[12px] text-muted-foreground">Nenhuma meta definida para o {semestre}º semestre de {ano} — defina abaixo.</p>
              )}
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className={lbl}>Meta de produtividade (%)</label>
                  <Input type="number" min="1" max="100" step="0.5" value={metaSemInput}
                    onChange={e=>setMetaSemInput(e.target.value)} className="h-9"/>
                </div>
                <Button className="h-9" onClick={salvarMetaSemestre} disabled={salvandoSem}>
                  {salvandoSem?"Salvando...":metaSemestre?"Atualizar":"Definir meta"}
                </Button>
              </div>
            </>
          );
        })()}
      </div>

      {/* Lista de metas */}
      {metas.length===0 && !loading && (
        <div className="text-center py-10 text-muted-foreground text-sm"><Target className="h-8 w-8 mx-auto opacity-20 mb-2"/><p>Nenhuma meta definida para {MESES[mes-1]}/{ano}</p></div>
      )}
      {metas.map(m=>(
        <div key={m.id} className="rounded-2xl border border-border/40 bg-card px-4 py-3">
          <p className="text-sm font-medium">{m.maquina_codigo?`Máquina ${m.maquina_codigo}`:"Geral"}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-[11px]">
            <div><p className="text-muted-foreground">Meta OEE</p><p className="font-bold">{m.meta_oee_pct}%</p></div>
            <div><p className="text-muted-foreground">Disponib.</p><p className="font-bold">{m.meta_disponibilidade_pct}%</p></div>
            <div><p className="text-muted-foreground">Qualidade</p><p className="font-bold">{m.meta_qualidade_pct}%</p></div>
            <div><p className="text-muted-foreground">Peças</p><p className="font-bold">{m.meta_pecas.toLocaleString("pt-BR")}</p></div>
          </div>
        </div>
      ))}

      {modal&&(
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full max-w-sm bg-card rounded-t-2xl sm:rounded-2xl border border-border/40 shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
              <h3 className="font-semibold text-sm">Definir Meta — {MESES[mes-1]}/{ano}</h3>
              <button onClick={()=>setModal(false)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40"><X className="h-4 w-4"/></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div><label className={lbl}>Máquina (vazio = geral)</label>
                <select value={form.maquina_codigo} onChange={e=>setForm(f=>({...f,maquina_codigo:e.target.value}))} className={sel}>
                  <option value="">Geral (todas as máquinas)</option>
                  {maquinas.map(m=><option key={m.codigo} value={m.codigo}>{m.codigo}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Meta OEE %</label><Input type="number" min="0" max="100" step="0.1" value={form.meta_oee_pct} onChange={e=>setForm(f=>({...f,meta_oee_pct:e.target.value}))} className="h-9"/></div>
                <div><label className={lbl}>Disponib. %</label><Input type="number" min="0" max="100" step="0.1" value={form.meta_disponibilidade_pct} onChange={e=>setForm(f=>({...f,meta_disponibilidade_pct:e.target.value}))} className="h-9"/></div>
                <div><label className={lbl}>Qualidade %</label><Input type="number" min="0" max="100" step="0.1" value={form.meta_qualidade_pct} onChange={e=>setForm(f=>({...f,meta_qualidade_pct:e.target.value}))} className="h-9"/></div>
                <div><label className={lbl}>Meta Peças</label><Input type="number" min="0" value={form.meta_pecas} onChange={e=>setForm(f=>({...f,meta_pecas:e.target.value}))} className="h-9"/></div>
              </div>
            </div>
            <div className="flex gap-3 px-5 py-4 border-t border-border/30">
              <Button variant="outline" className="flex-1" onClick={()=>setModal(false)}>Cancelar</Button>
              <Button className="flex-1" onClick={save}>Salvar Meta</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
