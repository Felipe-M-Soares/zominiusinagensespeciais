/**
 * UsuariosProducaoPanel — Controle de Usuários do Sistema de Produção
 * ✓ Dados reais via Supabase (tabelas profiles + user_roles)
 * ✓ Exibe usuários reais do sistema com seus papéis
 */

import { useState, useEffect, useCallback } from "react";
import { Search, Shield, Eye, Users, CheckCircle2, RefreshCw, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";

type AppRole = "admin"|"producao"|"funcionario"|"financeiro"|"comercial";

interface UsuarioSistema {
  user_id: string;
  display_name: string | null;
  username: string | null;
  approved: boolean;
  blocked: boolean;
  role: AppRole;
  created_at: string;
}

const ROLE_CFG: Record<AppRole,{label:string;color:string;bg:string;border:string;Icon:React.ElementType}> = {
  admin:       {label:"Administrador", color:"text-purple-600 dark:text-purple-400", bg:"bg-purple-500/10", border:"border-purple-500/20", Icon:Shield},
  producao:    {label:"Produção",      color:"text-green-600 dark:text-green-400",   bg:"bg-green-500/10",  border:"border-green-500/20",  Icon:CheckCircle2},
  funcionario: {label:"Funcionário",   color:"text-blue-600 dark:text-blue-400",     bg:"bg-blue-500/10",   border:"border-blue-500/20",   Icon:Users},
  financeiro:  {label:"Financeiro",    color:"text-amber-600 dark:text-amber-400",   bg:"bg-amber-500/10",  border:"border-amber-500/20",  Icon:Eye},
  comercial:   {label:"Comercial",     color:"text-cyan-600 dark:text-cyan-400",     bg:"bg-cyan-500/10",   border:"border-cyan-500/20",   Icon:Users},
};

export function UsuariosProducaoPanel({ isAdmin }: { isAdmin: boolean }) {
  const [usuarios,setUsuarios]=useState<UsuarioSistema[]>([]);
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState("");
  const [filtroRole,setFiltroRole]=useState<"todos"|AppRole>("todos");

  const load=useCallback(async()=>{
    setLoading(true);
    try {
      // Busca perfis + papéis em paralelo
      const [{data:profiles},{data:roles}]=await Promise.all([
        supabase.from("profiles").select("user_id,display_name,username,approved,blocked,created_at").order("created_at",{ascending:false}),
        supabase.from("user_roles").select("user_id,role"),
      ]);

      const rolesMap:Record<string,AppRole>={};
      (roles||[]).forEach((r:{user_id:string;role:string})=>{rolesMap[r.user_id]=r.role as AppRole;});

      const users:UsuarioSistema[]=(profiles||[]).map((p:{user_id:string;display_name:string|null;username:string|null;approved:boolean;blocked:boolean;created_at:string})=>({
        user_id:p.user_id,
        display_name:p.display_name,
        username:p.username,
        approved:p.approved,
        blocked:p.blocked,
        role:rolesMap[p.user_id]||"funcionario",
        created_at:p.created_at,
      }));
      setUsuarios(users);
    } catch(e){
      toast.error("Erro ao carregar usuários");
      logger.error("UsuariosProducaoPanel load error:", e);
    }
    setLoading(false);
  },[]);

  useEffect(()=>{load();},[load]);

  async function handleRoleChange(userId:string,role:AppRole){
    if(!isAdmin){toast.error("Sem permissão");return;}
    try {
      const {error}=await supabase.from("user_roles").upsert({user_id:userId,role},{onConflict:"user_id"});
      if(error) throw error;
      setUsuarios(prev=>prev.map(u=>u.user_id===userId?{...u,role}:u));
      toast.success("Papel atualizado!");
    } catch(e){
      toast.error("Erro ao atualizar papel");
      logger.error("UsuariosProducaoPanel handleRoleChange error:", e);
    }
  }

  async function handleToggleBlocked(u:UsuarioSistema){
    if(!isAdmin){toast.error("Sem permissão");return;}
    try {
      const {error}=await supabase.from("profiles").update({blocked:!u.blocked}).eq("user_id",u.user_id);
      if(error) throw error;
      setUsuarios(prev=>prev.map(x=>x.user_id===u.user_id?{...x,blocked:!x.blocked}:x));
      toast.success(u.blocked?"Usuário desbloqueado":"Usuário bloqueado");
    } catch(e){
      toast.error("Erro ao atualizar usuário");
    }
  }

  const filtered=usuarios.filter(u=>{
    const name=u.display_name||u.username||"";
    const matchSearch=!search||name.toLowerCase().includes(search.toLowerCase());
    const matchRole=filtroRole==="todos"||u.role===filtroRole;
    return matchSearch&&matchRole;
  });

  const counts:Record<string,number>={};
  usuarios.forEach(u=>{counts[u.role]=(counts[u.role]||0)+1;});

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Resumo */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border bg-card/60 p-3 text-center"><p className="text-xl font-bold">{usuarios.length}</p><p className="text-[10px] text-muted-foreground">Total</p></div>
        <div className="rounded-xl border bg-green-500/5 border-green-500/20 p-3 text-center"><p className="text-xl font-bold text-green-600">{usuarios.filter(u=>u.approved&&!u.blocked).length}</p><p className="text-[10px] text-muted-foreground">Ativos</p></div>
        <div className="rounded-xl border bg-red-500/5 border-red-500/20 p-3 text-center"><p className="text-xl font-bold text-red-600">{usuarios.filter(u=>u.blocked).length}</p><p className="text-[10px] text-muted-foreground">Bloqueados</p></div>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"/><Input className="pl-8 h-9 text-sm" placeholder="Buscar usuário..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <select value={filtroRole} onChange={e=>setFiltroRole(e.target.value as typeof filtroRole)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm">
          <option value="todos">Todos</option>
          {(Object.keys(ROLE_CFG) as AppRole[]).map(r=><option key={r} value={r}>{ROLE_CFG[r].label}</option>)}
        </select>
        <Button size="sm" variant="outline" className="h-9 px-2" onClick={load} disabled={loading}><RefreshCw className={cn("h-4 w-4",loading&&"animate-spin")}/></Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2"><RefreshCw className="h-4 w-4 animate-spin"/>Carregando...</div>
      ) : filtered.length===0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-2">
          <Users className="h-8 w-8 opacity-30"/><p>{usuarios.length===0?"Nenhum usuário encontrado":"Nenhum resultado"}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(u=>{
            const cfg=ROLE_CFG[u.role]||ROLE_CFG.funcionario;
            const nome=u.display_name||u.username||"Usuário";
            return (
              <div key={u.user_id} className={cn("rounded-xl border p-4 space-y-3 transition-all", u.blocked?"bg-red-500/5 border-red-500/20":"bg-card/60")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-3">
                    <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0 text-sm font-bold",cfg.bg,cfg.color)}>
                      {nome.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{nome}</p>
                      {u.username&&<p className="text-[11px] text-muted-foreground">@{u.username}</p>}
                      <p className="text-[10px] text-muted-foreground">Desde {new Date(u.created_at).toLocaleDateString("pt-BR")}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {u.blocked && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 font-medium">Bloqueado</span>}
                    {!u.approved && !u.blocked && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium">Pendente</span>}
                    <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium",cfg.bg,cfg.color)}>{cfg.label}</span>
                  </div>
                </div>

                {isAdmin && (
                  <div className="flex items-center gap-2 pt-1 border-t border-border">
                    <select value={u.role} onChange={e=>handleRoleChange(u.user_id,e.target.value as AppRole)}
                      className="flex-1 h-7 rounded-lg border border-input bg-background px-2 text-[11px]">
                      {(Object.keys(ROLE_CFG) as AppRole[]).map(r=><option key={r} value={r}>{ROLE_CFG[r].label}</option>)}
                    </select>
                    <button onClick={()=>handleToggleBlocked(u)}
                      className={cn("h-7 px-2 rounded-lg text-[11px] flex items-center gap-1 transition-colors",
                        u.blocked?"bg-green-500/10 text-green-600 hover:bg-green-500/20":"bg-red-500/10 text-red-600 hover:bg-red-500/20")}>
                      <UserX className="h-3 w-3"/>{u.blocked?"Desbloquear":"Bloquear"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!isAdmin && (
        <div className="rounded-xl border bg-amber-500/5 border-amber-500/20 p-3 text-center text-sm text-amber-700 dark:text-amber-400">
          Apenas administradores podem alterar papéis e bloquear usuários
        </div>
      )}
    </div>
  );
}
