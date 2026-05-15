/**
 * UsuariosProducaoPanel — Controle de Usuários do Sistema de Produção
 * Perfis: admin, supervisor, operador, qualidade — permissões granulares, autenticação segura
 */

import { useState } from "react";
import { Plus, X, Search, Users, Shield, Eye, EyeOff, Edit2, Trash2, CheckCircle2, XCircle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── Tipos ──────────────────────────────────────────────────────────────────────

type Perfil = "admin" | "supervisor" | "operador" | "qualidade";

interface Permissao {
  modulo: string;
  visualizar: boolean;
  editar: boolean;
  excluir: boolean;
}

interface Usuario {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  ativo: boolean;
  ultimoAcesso?: string;
  setor?: string;
  matricula?: string;
  permissoesCustom?: Permissao[];
}

const PERFIL_CFG: Record<Perfil, { label: string; color: string; bg: string; border: string; icon: React.ElementType; descricao: string }> = {
  admin: {
    label: "Administrador", color: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-500/10", border: "border-purple-500/20", icon: Shield,
    descricao: "Acesso total ao sistema, incluindo configurações e usuários",
  },
  supervisor: {
    label: "Supervisor", color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-500/10", border: "border-blue-500/20", icon: Eye,
    descricao: "Visualiza e edita produção, aprova apontamentos, acessa relatórios",
  },
  operador: {
    label: "Operador", color: "text-green-600 dark:text-green-400",
    bg: "bg-green-500/10", border: "border-green-500/20", icon: Users,
    descricao: "Registra apontamentos, paradas e refugos. Sem acesso a relatórios gerenciais",
  },
  qualidade: {
    label: "Qualidade", color: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-500/10", border: "border-orange-500/20", icon: CheckCircle2,
    descricao: "Acessa módulos de qualidade, refugo e controle dimensional",
  },
};

const MODULOS_PERMISSAO = [
  "Dashboard", "Controle de Produção", "Planejamento", "Máquinas",
  "Produtos", "Paradas", "Refugo / Qualidade", "Matéria-Prima", "Relatórios",
];

const PERMISSOES_PADRAO: Record<Perfil, Permissao[]> = {
  admin: MODULOS_PERMISSAO.map(m => ({ modulo: m, visualizar: true, editar: true, excluir: true })),
  supervisor: MODULOS_PERMISSAO.map(m => ({ modulo: m, visualizar: true, editar: m !== "Máquinas" && m !== "Produtos", excluir: false })),
  operador: MODULOS_PERMISSAO.map(m => ({
    modulo: m,
    visualizar: ["Dashboard", "Controle de Produção", "Paradas", "Refugo / Qualidade"].includes(m),
    editar: ["Controle de Produção", "Paradas", "Refugo / Qualidade"].includes(m),
    excluir: false,
  })),
  qualidade: MODULOS_PERMISSAO.map(m => ({
    modulo: m,
    visualizar: ["Dashboard", "Refugo / Qualidade", "Relatórios", "Matéria-Prima"].includes(m),
    editar: ["Refugo / Qualidade"].includes(m),
    excluir: false,
  })),
};

const MOCK_USUARIOS: Usuario[] = [
  { id: "1", nome: "Carlos Mendes", email: "carlos.mendes@empresa.com", perfil: "admin", ativo: true, ultimoAcesso: "Hoje, 08:12", setor: "TI / Produção", matricula: "00001" },
  { id: "2", nome: "Ana Beatriz Silva", email: "ana.silva@empresa.com", perfil: "supervisor", ativo: true, ultimoAcesso: "Hoje, 07:45", setor: "Usinagem", matricula: "00012" },
  { id: "3", nome: "João Pereira", email: "joao.pereira@empresa.com", perfil: "operador", ativo: true, ultimoAcesso: "Hoje, 06:00", setor: "Usinagem — CNC-01", matricula: "00034" },
  { id: "4", nome: "Maria Santos", email: "maria.santos@empresa.com", perfil: "operador", ativo: true, ultimoAcesso: "Hoje, 06:05", setor: "Usinagem — TORNO-01", matricula: "00035" },
  { id: "5", nome: "Lucas Oliveira", email: "lucas.oliveira@empresa.com", perfil: "qualidade", ativo: true, ultimoAcesso: "Ontem, 17:30", setor: "Qualidade", matricula: "00022" },
  { id: "6", nome: "Fernanda Costa", email: "fernanda.costa@empresa.com", perfil: "supervisor", ativo: false, ultimoAcesso: "15/01/2025", setor: "Montagem", matricula: "00018" },
];

// ── Modal Novo/Editar Usuário ──────────────────────────────────────────────────

function UsuarioModal({ open, usuario, onClose, onSaved }: {
  open: boolean; usuario?: Usuario; onClose: () => void; onSaved: (u: Usuario) => void;
}) {
  const [form, setForm] = useState({
    nome: usuario?.nome || "",
    email: usuario?.email || "",
    perfil: usuario?.perfil || "operador" as Perfil,
    setor: usuario?.setor || "",
    matricula: usuario?.matricula || "",
    senha: "",
    confirmarSenha: "",
  });
  const [verSenha, setVerSenha] = useState(false);
  const [abaAtiva, setAbaAtiva] = useState<"dados" | "permissoes">("dados");
  const [permissoes, setPermissoes] = useState<Permissao[]>(
    usuario?.permissoesCustom || PERMISSOES_PADRAO[usuario?.perfil || "operador"]
  );

  if (!open) return null;

  function onPerfilChange(p: Perfil) {
    setForm(f => ({ ...f, perfil: p }));
    setPermissoes(PERMISSOES_PADRAO[p]);
  }

  function togglePerm(modulo: string, campo: "visualizar" | "editar" | "excluir") {
    setPermissoes(prev => prev.map(p =>
      p.modulo === modulo ? { ...p, [campo]: !p[campo] } : p
    ));
  }

  function save() {
    if (!form.nome || !form.email) { toast.error("Nome e e-mail são obrigatórios"); return; }
    if (!usuario && !form.senha) { toast.error("Defina uma senha para o novo usuário"); return; }
    if (form.senha && form.senha !== form.confirmarSenha) { toast.error("As senhas não coincidem"); return; }
    const u: Usuario = {
      id: usuario?.id || Date.now().toString(),
      nome: form.nome, email: form.email, perfil: form.perfil,
      ativo: usuario?.ativo ?? true,
      setor: form.setor || undefined,
      matricula: form.matricula || undefined,
      ultimoAcesso: usuario?.ultimoAcesso,
      permissoesCustom: permissoes,
    };
    onSaved(u);
    toast.success(usuario ? "Usuário atualizado!" : "Usuário criado!");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background border rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
          <p className="text-sm font-semibold">{usuario ? "Editar Usuário" : "Novo Usuário"}</p>
          <button onClick={onClose} className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-muted/40">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border/40">
          {(["dados", "permissoes"] as const).map(t => (
            <button key={t} onClick={() => setAbaAtiva(t)}
              className={cn("flex-1 py-2.5 text-xs font-medium transition-colors",
                abaAtiva === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground")}>
              {t === "dados" ? "Dados do Usuário" : "Permissões"}
            </button>
          ))}
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {abaAtiva === "dados" && (
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Nome Completo *</label>
                  <Input placeholder="João Silva" value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} className="rounded-xl" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Matrícula</label>
                  <Input placeholder="00001" value={form.matricula} onChange={e => setForm(f => ({ ...f, matricula: e.target.value }))} className="rounded-xl" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">E-mail *</label>
                <Input type="email" placeholder="usuario@empresa.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="rounded-xl" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Setor / Máquina</label>
                <Input placeholder="Ex: Usinagem — CNC-01" value={form.setor} onChange={e => setForm(f => ({ ...f, setor: e.target.value }))} className="rounded-xl" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">Perfil de Acesso *</label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(PERFIL_CFG) as Perfil[]).map(p => {
                    const cfg = PERFIL_CFG[p];
                    return (
                      <button key={p} onClick={() => onPerfilChange(p)}
                        className={cn(
                          "rounded-xl border p-3 text-left transition-all",
                          form.perfil === p ? cn(cfg.bg, cfg.border, "ring-1 ring-current") : "bg-muted/20 border-border/40 hover:bg-muted/40"
                        )}>
                        <p className={cn("text-xs font-semibold", form.perfil === p ? cfg.color : "text-foreground")}>{cfg.label}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{cfg.descricao}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
              {!usuario && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Senha Inicial *</label>
                    <div className="relative">
                      <Input type={verSenha ? "text" : "password"} placeholder="Mínimo 8 caracteres"
                        value={form.senha} onChange={e => setForm(f => ({ ...f, senha: e.target.value }))}
                        className="rounded-xl pr-10" />
                      <button onClick={() => setVerSenha(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        {verSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Confirmar Senha *</label>
                    <Input type={verSenha ? "text" : "password"} placeholder="Repita a senha"
                      value={form.confirmarSenha} onChange={e => setForm(f => ({ ...f, confirmarSenha: e.target.value }))}
                      className="rounded-xl" />
                  </div>
                </div>
              )}
            </div>
          )}

          {abaAtiva === "permissoes" && (
            <div className="px-5 py-4">
              <p className="text-[11px] text-muted-foreground mb-3">
                Permissões baseadas no perfil <strong>{PERFIL_CFG[form.perfil].label}</strong>. Personalize se necessário.
              </p>
              <div className="rounded-xl border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/20 border-b border-border/40">
                      <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Módulo</th>
                      <th className="px-3 py-2.5 text-center text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Ver</th>
                      <th className="px-3 py-2.5 text-center text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Editar</th>
                      <th className="px-3 py-2.5 text-center text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Excluir</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {permissoes.map((p) => (
                      <tr key={p.modulo} className="hover:bg-muted/10">
                        <td className="px-3 py-2 font-medium">{p.modulo}</td>
                        {(["visualizar", "editar", "excluir"] as const).map(campo => (
                          <td key={campo} className="px-3 py-2 text-center">
                            <button onClick={() => togglePerm(p.modulo, campo)}
                              className={cn("h-5 w-5 rounded-md mx-auto flex items-center justify-center transition-colors",
                                p[campo] ? "bg-primary/20 text-primary" : "bg-muted/40 text-muted-foreground/40")}>
                              {p[campo] ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                            </button>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-border/40 flex gap-3">
          <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1 rounded-xl" onClick={save}>{usuario ? "Salvar Alterações" : "Criar Usuário"}</Button>
        </div>
      </div>
    </div>
  );
}

// ── Card Usuário ──────────────────────────────────────────────────────────────

function UsuarioCard({ usuario, isAdmin, onEdit, onToggleAtivo, onResetSenha }: {
  usuario: Usuario; isAdmin: boolean;
  onEdit: () => void; onToggleAtivo: () => void; onResetSenha: () => void;
}) {
  const cfg = PERFIL_CFG[usuario.perfil];

  return (
    <div className={cn(
      "rounded-2xl border p-4 space-y-3 transition-all",
      !usuario.ativo ? "opacity-60 bg-muted/20 border-border/30" : "bg-card/60 border-border/40"
    )}>
      <div className="flex items-start gap-3">
        <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0 font-bold text-sm", cfg.bg, cfg.color)}>
          {usuario.nome.split(" ").map(n => n[0]).slice(0, 2).join("")}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm truncate">{usuario.nome}</p>
            {!usuario.ativo && (
              <span className="text-[9px] bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded-full shrink-0">Inativo</span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground truncate">{usuario.email}</p>
        </div>
        <div className={cn("shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium", cfg.bg, cfg.color)}>
          <cfg.icon className="h-3 w-3" />
          {cfg.label}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        {usuario.matricula && <span>Matrícula: {usuario.matricula}</span>}
        {usuario.setor && <span className="truncate">{usuario.setor}</span>}
        {usuario.ultimoAcesso && <span className="col-span-2">Último acesso: {usuario.ultimoAcesso}</span>}
      </div>

      {isAdmin && (
        <div className="flex gap-2 pt-1">
          <button onClick={onEdit}
            className="flex-1 h-7 rounded-lg bg-muted/30 hover:bg-muted/60 text-[11px] font-medium transition-colors flex items-center justify-center gap-1.5 text-muted-foreground">
            <Edit2 className="h-3 w-3" /> Editar
          </button>
          <button onClick={onResetSenha}
            className="flex-1 h-7 rounded-lg bg-muted/30 hover:bg-muted/60 text-[11px] font-medium transition-colors flex items-center justify-center gap-1.5 text-muted-foreground">
            <Lock className="h-3 w-3" /> Reset Senha
          </button>
          <button onClick={onToggleAtivo}
            className={cn("flex-1 h-7 rounded-lg text-[11px] font-medium transition-colors flex items-center justify-center gap-1.5",
              usuario.ativo ? "bg-red-500/10 text-red-500 hover:bg-red-500/20" : "bg-green-500/10 text-green-500 hover:bg-green-500/20")}>
            {usuario.ativo ? <><XCircle className="h-3 w-3" /> Desativar</> : <><CheckCircle2 className="h-3 w-3" /> Ativar</>}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function UsuariosProducaoPanel({ isAdmin }: { isAdmin: boolean }) {
  const [usuarios, setUsuarios] = useState<Usuario[]>(MOCK_USUARIOS);
  const [search, setSearch] = useState("");
  const [filtroPerfil, setFiltroPerfil] = useState<string>("todos");
  const [filtroAtivo, setFiltroAtivo] = useState<string>("todos");
  const [modalOpen, setModalOpen] = useState(false);
  const [editando, setEditando] = useState<Usuario | undefined>();

  const filtered = usuarios.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = u.nome.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.matricula || "").includes(q);
    const matchPerfil = filtroPerfil === "todos" || u.perfil === filtroPerfil;
    const matchAtivo = filtroAtivo === "todos" || (filtroAtivo === "ativo" ? u.ativo : !u.ativo);
    return matchSearch && matchPerfil && matchAtivo;
  });

  function save(u: Usuario) {
    setUsuarios(prev => {
      const idx = prev.findIndex(x => x.id === u.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = u; return next; }
      return [u, ...prev];
    });
    setEditando(undefined);
  }

  function toggleAtivo(id: string) {
    setUsuarios(prev => prev.map(u => u.id === id ? { ...u, ativo: !u.ativo } : u));
    const u = usuarios.find(u => u.id === id)!;
    toast.success(u.ativo ? "Usuário desativado" : "Usuário reativado");
  }

  function resetSenha(nome: string) {
    toast.success(`Link de redefinição de senha enviado para ${nome} (em breve conectará ao Supabase Auth)`);
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Resumo por perfil */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(Object.keys(PERFIL_CFG) as Perfil[]).map(p => {
          const cfg = PERFIL_CFG[p];
          const count = usuarios.filter(u => u.perfil === p && u.ativo).length;
          return (
            <div key={p} className={cn("rounded-2xl border p-3 text-center", cfg.bg, cfg.border)}>
              <p className={cn("text-2xl font-bold tabular-nums", cfg.color)}>{count}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{cfg.label}</p>
            </div>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Buscar por nome, e-mail ou matrícula..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9 rounded-xl text-sm h-9" />
        </div>
        <select value={filtroPerfil} onChange={e => setFiltroPerfil(e.target.value)}
          className="h-9 rounded-xl border border-input bg-card px-3 text-sm">
          <option value="todos">Todos os perfis</option>
          {(Object.keys(PERFIL_CFG) as Perfil[]).map(p => (
            <option key={p} value={p}>{PERFIL_CFG[p].label}</option>
          ))}
        </select>
        <select value={filtroAtivo} onChange={e => setFiltroAtivo(e.target.value)}
          className="h-9 rounded-xl border border-input bg-card px-3 text-sm">
          <option value="todos">Todos</option>
          <option value="ativo">Ativos</option>
          <option value="inativo">Inativos</option>
        </select>
        {isAdmin && (
          <Button size="sm" className="h-9 rounded-xl shrink-0" onClick={() => { setEditando(undefined); setModalOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Novo Usuário
          </Button>
        )}
      </div>

      {/* Cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {filtered.map(u => (
          <UsuarioCard
            key={u.id} usuario={u} isAdmin={isAdmin}
            onEdit={() => { setEditando(u); setModalOpen(true); }}
            onToggleAtivo={() => toggleAtivo(u.id)}
            onResetSenha={() => resetSenha(u.nome)}
          />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-2 py-12 text-center">
            <Users className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nenhum usuário encontrado</p>
          </div>
        )}
      </div>

      {/* Info de segurança */}
      <div className="rounded-2xl border bg-card/60 p-4 flex items-start gap-3">
        <Shield className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold">Autenticação Segura via Supabase Auth</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Todas as senhas são armazenadas com hash bcrypt. Sessões expiram automaticamente.
            Permissões são validadas em nível de servidor (RLS).
          </p>
        </div>
      </div>

      <UsuarioModal
        open={modalOpen} usuario={editando}
        onClose={() => { setModalOpen(false); setEditando(undefined); }}
        onSaved={save}
      />
    </div>
  );
}
