/**
 * Admin › Usuários — criar conta, editar (nome, perfil, bloqueio), aprovar,
 * alterar senha e excluir. Lista em cards (funciona igual no celular e no
 * computador). Contas são criadas/senhas redefinidas pelas Edge Functions
 * admin-create-user / admin-reset-password; exclusão pela RPC admin_delete_user.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Trash2, KeyRound, CheckCircle, UserPlus, ShieldX, ShieldCheck, Pencil, MoreVertical, Search, X,
  Eye, EyeOff, Loader2, RefreshCw, Users, Clock,
} from "lucide-react";
import type { AppRole } from "@/types/roles";
import { APP_ROLES, ROLE_LABELS } from "@/types/roles";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { validatePassword, passwordStrength } from "@/lib/passwordUtils";

interface UserProfile {
  user_id: string;
  display_name: string | null;
  login: string | null;
  created_at: string;
  role: AppRole;
  approved: boolean;
  blocked: boolean;
  must_change_password: boolean;
}

type Filtro = "todos" | "pendentes" | "bloqueados";

/** O que cada perfil vê — ajuda o admin a escolher. */
const ROLE_HINT: Record<AppRole, string> = {
  admin: "Tudo, inclusive esta área Admin",
  gerente: "Todos os módulos, sem a área Admin",
  estoque: "Componentes e Estoque",
  qualidade: "Componentes, Estoque e Qualidade",
  comercial: "Comercial (só os próprios pedidos)",
  financeiro: "Financeiro",
  producao: "Componentes, Produção e Processos",
  processos: "Processos",
};

const nomeDe = (u: Pick<UserProfile, "display_name" | "login">) => u.display_name ?? u.login ?? "usuário";

function PasswordStrengthInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const [show, setShow] = useState(false);
  const strength = value ? passwordStrength(value) : null;
  const err = value.length > 0 ? validatePassword(value) : null;
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          placeholder="Crie uma senha segura"
          value={value}
          onChange={e => onChange(e.target.value)}
          maxLength={72}
          autoComplete="new-password"
          className="pr-11 h-11"
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          aria-label={show ? "Ocultar senha" : "Mostrar senha"}
          className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {strength && strength.score > 0 && (
        <div className="space-y-1">
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className={cn("h-1 flex-1 rounded-full transition-colors", i <= strength.score ? strength.color : "bg-muted")} />
            ))}
          </div>
          <p className={cn("text-[11px] font-medium", err ? "text-destructive" : "text-muted-foreground")}>
            {err ?? strength.label}
          </p>
        </div>
      )}
      {value.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          Mín. 8 caracteres, com maiúscula, minúscula, número e símbolo (!@#…).
        </p>
      )}
    </div>
  );
}

/**
 * Extrai a mensagem de erro REAL de uma chamada de Edge Function.
 * Quando a função responde 4xx/5xx, o supabase.functions.invoke devolve só
 * "Edge Function returned a non-2xx status code" — a mensagem verdadeira
 * (ex: "Apenas administradores...", "Missing env: ...") fica no corpo da
 * resposta, dentro de error.context. Esta função vai buscá-la lá.
 */
async function extrairErroFuncao(
  error: { message?: string; context?: unknown } | null,
  data: { error?: string } | null,
): Promise<string | null> {
  if (!error) return data?.error ?? null;
  const ctx = (error as { context?: unknown }).context;
  if (ctx instanceof Response) {
    try {
      const body = await ctx.clone().json() as { error?: string; message?: string };
      if (body?.error || body?.message) return body.error ?? body.message ?? null;
    } catch { /* corpo não é JSON — usa a mensagem genérica mesmo */ }
  }
  return error.message ?? "Erro ao chamar função";
}

function StatusChip({ u }: { u: UserProfile }) {
  if (u.blocked) return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-destructive/10 text-destructive"><ShieldX className="h-3 w-3" />Bloqueado</span>;
  if (!u.approved) return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-warning/15 text-warning"><Clock className="h-3 w-3" />Pendente</span>;
  return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-success/10 text-success"><CheckCircle className="h-3 w-3" />Ativo</span>;
}

function RoleSelect({ value, onChange, disabled, id }: { value: AppRole; onChange: (r: AppRole) => void; disabled?: boolean; id?: string }) {
  return (
    <Select value={value} onValueChange={v => onChange(v as AppRole)} disabled={disabled}>
      <SelectTrigger id={id} className="h-11"><SelectValue /></SelectTrigger>
      <SelectContent>
        {APP_ROLES.map(r => (
          <SelectItem key={r} value={r}>
            <span className="font-medium">{ROLE_LABELS[r]}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AdminUsers({ onCountsChange }: { onCountsChange?: (pendentes: number) => void } = {}) {
  const [users, setUsers]     = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { user: currentUser } = useAuth();
  const fetchAbortRef = useRef<AbortController | null>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const [passwordDialog, setPasswordDialog] = useState<UserProfile | null>(null);
  const [newPassword, setNewPassword]       = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);

  const [createDialog, setCreateDialog]     = useState(false);
  const [newUserLogin, setNewUserLogin]     = useState("");
  const [newUserName, setNewUserName]       = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole]       = useState<AppRole>("estoque");
  const [creatingUser, setCreatingUser]     = useState(false);

  // Edição
  const [editUser, setEditUser] = useState<UserProfile | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<AppRole>("estoque");
  const [editBlocked, setEditBlocked] = useState(false);
  const [editApproved, setEditApproved] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);

  const [downgradeConfirm, setDowngradeConfirm] = useState<{ userId: string; userName: string; newRole: AppRole; after?: () => void } | null>(null);
  const [blockConfirm, setBlockConfirm] = useState<UserProfile | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<UserProfile | null>(null);

  const fetchUsers = useCallback(async () => {
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    setLoading(true);
    try {
      const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] = await Promise.all([
        supabase.from("profiles").select("*"),
        supabase.from("user_roles").select("*"),
      ]);
      if (controller.signal.aborted) return;
      if (pErr || rErr) { toast.error("Erro ao carregar usuários"); return; }

      const roleMap = new Map((roles ?? []).map(r => [r.user_id, r.role]));
      setUsers((profiles ?? []).map(p => ({
        user_id:              p.user_id,
        display_name:         p.display_name,
        login:                (p as { login?: string | null }).login ?? null,
        created_at:           p.created_at,
        role:                 (roleMap.get(p.user_id) as AppRole) ?? "estoque",
        approved:             p.approved ?? false,
        blocked:              (p as { blocked?: boolean }).blocked ?? false,
        must_change_password: (p as { must_change_password?: boolean }).must_change_password ?? false,
      })));
    } catch (err) {
      if (controller.signal.aborted) return;
      logger.error("fetchUsers:", err);
      toast.error("Erro inesperado ao carregar usuários");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    return () => { fetchAbortRef.current?.abort(); };
  }, [fetchUsers]);

  const pendentes = users.filter(u => !u.approved && !u.blocked).length;
  const bloqueados = users.filter(u => u.blocked).length;
  useEffect(() => { if (!loading) onCountsChange?.(pendentes); }, [pendentes, loading, onCountsChange]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return users
      .filter(u => filtro === "todos" || (filtro === "pendentes" ? !u.approved && !u.blocked : u.blocked))
      .filter(u => !q || `${u.display_name ?? ""} ${u.login ?? ""} ${ROLE_LABELS[u.role] ?? u.role}`.toLowerCase().includes(q))
      .sort((a, b) => {
        // Pendentes primeiro, depois por nome.
        const pa = !a.approved && !a.blocked ? 0 : 1;
        const pb = !b.approved && !b.blocked ? 0 : 1;
        return pa - pb || nomeDe(a).localeCompare(nomeDe(b), "pt-BR");
      });
  }, [users, busca, filtro]);

  // ── Ações ──────────────────────────────────────────────────────────────────

  const applyRoleChange = async (userId: string, newRole: AppRole) => {
    const { error } = await supabase.from("user_roles").update({ role: newRole }).eq("user_id", userId);
    if (error) { toast.error("Erro ao alterar perfil: " + error.message, { duration: 8000 }); return false; }
    return true;
  };

  const toggleApproval = async (userId: string, approve: boolean) => {
    const { error } = await supabase.from("profiles").update({ approved: approve }).eq("user_id", userId);
    if (error) toast.error("Erro ao alterar aprovação: " + error.message, { duration: 8000 });
    else { toast.success(approve ? "Usuário aprovado" : "Aprovação removida"); fetchUsers(); }
  };

  const revokeAccess = async (userId: string, userLogin: string | null) => {
    try {
      const { error: profileErr } = await supabase
        .from("profiles")
        .update({ approved: false, blocked: true })
        .eq("user_id", userId);
      if (profileErr) { toast.error("Erro ao bloquear usuário: " + profileErr.message, { duration: 8000 }); return; }
      toast.success(`Acesso de ${userLogin ?? "usuário"} bloqueado.`);
      fetchUsers();
    } catch (err) {
      logger.error("revokeAccess error:", err);
      toast.error("Erro inesperado ao bloquear usuário.");
    }
  };

  const unblockAccess = async (userId: string) => {
    const { error } = await supabase
      .from("profiles")
      .update({ blocked: false, approved: true })
      .eq("user_id", userId);
    if (error) toast.error("Erro ao desbloquear: " + error.message, { duration: 8000 });
    else { toast.success("Usuário desbloqueado e aprovado"); fetchUsers(); }
  };

  const resetPassword = async () => {
    if (!passwordDialog) return;
    const pwdError = validatePassword(newPassword);
    if (pwdError) { toast.error(pwdError); return; }
    setResettingPassword(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-reset-password", {
        body: {
          target_user_id: passwordDialog.user_id,
          new_password:   newPassword,
        },
      });
      let errMsg = await extrairErroFuncao(error, data as { error?: string } | null);
      if (errMsg?.includes("Failed to send a request")) {
        errMsg = "Não foi possível conectar à função 'admin-reset-password'. Publique/atualize as Edge Functions e tente de novo.";
      }
      if (errMsg) {
        toast.error("Erro ao redefinir senha: " + errMsg, { duration: 8000 });
      } else {
        await supabase.from("profiles")
          .update({ must_change_password: true })
          .eq("user_id", passwordDialog.user_id);
        toast.success(`Senha de ${nomeDe(passwordDialog)} redefinida. Ela vai pedir uma nova senha no próximo acesso.`);
        setPasswordDialog(null);
        setNewPassword("");
        fetchUsers();
      }
    } finally {
      setResettingPassword(false);
    }
  };

  const deleteUser = async (userId: string) => {
    setDeletingId(userId);
    try {
      const { data: rpcData, error: rpcErr } = await supabase.rpc("admin_delete_user", {
        p_target_user_id: userId,
      });
      const errMsg = rpcErr?.message ?? (rpcData as { error?: string } | null)?.error ?? null;
      if (errMsg) toast.error("Erro ao excluir: " + errMsg, { duration: 8000 });
      else { toast.success("Conta excluída"); fetchUsers(); }
    } finally {
      setDeletingId(null);
    }
  };

  const resetCreateForm = () => {
    setNewUserLogin(""); setNewUserName(""); setNewUserPassword(""); setNewUserRole("estoque");
  };

  const createUser = async () => {
    if (!newUserLogin.trim() || !newUserName.trim() || !newUserPassword) {
      toast.error("Preencha todos os campos."); return;
    }
    const pwErr = validatePassword(newUserPassword);
    if (pwErr) { toast.error(pwErr); return; }
    setCreatingUser(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-create-user", {
        body: {
          login:        newUserLogin.trim().toLowerCase(),
          password:     newUserPassword,
          display_name: newUserName.trim(),
          role:         newUserRole,
        },
      });
      let errMsg = await extrairErroFuncao(error, data as { error?: string } | null);
      if (errMsg?.includes("Failed to send a request")) {
        errMsg = "Não foi possível conectar à função 'admin-create-user'. Publique/atualize as Edge Functions e tente de novo.";
      }
      if (errMsg) {
        toast.error("Erro ao criar conta: " + errMsg, { duration: 8000 });
      } else {
        toast.success(`Conta de ${newUserName.trim()} criada.`);
        setCreateDialog(false);
        resetCreateForm();
        fetchUsers();
      }
    } finally {
      setCreatingUser(false);
    }
  };

  // ── Edição (nome, perfil, bloqueio, aprovação) ─────────────────────────────

  const abrirEdicao = (u: UserProfile) => {
    setEditUser(u);
    setEditName(u.display_name ?? "");
    setEditRole(u.role);
    setEditBlocked(u.blocked);
    setEditApproved(u.approved);
  };

  const editIsSelf = editUser?.user_id === currentUser?.id;

  const salvarEdicaoConfirmada = async () => {
    if (!editUser) return;
    setSavingEdit(true);
    try {
      let ok = true;
      const nome = editName.trim();
      const patch: { display_name?: string; blocked?: boolean; approved?: boolean } = {};
      if (nome && nome !== (editUser.display_name ?? "")) patch.display_name = nome;
      if (editBlocked !== editUser.blocked) {
        patch.blocked = editBlocked;
        // Mesma regra de antes: bloquear tira a aprovação; desbloquear aprova.
        patch.approved = !editBlocked;
      } else if (!editBlocked && editApproved !== editUser.approved) {
        patch.approved = editApproved;
      }
      if (Object.keys(patch).length) {
        const { error } = await supabase.from("profiles").update(patch).eq("user_id", editUser.user_id);
        if (error) { toast.error("Erro ao salvar: " + error.message, { duration: 8000 }); ok = false; }
      }
      if (ok && editRole !== editUser.role) ok = await applyRoleChange(editUser.user_id, editRole);
      if (ok) {
        toast.success(`Dados de ${nome || nomeDe(editUser)} atualizados.`);
        setEditUser(null);
      }
      fetchUsers();
    } finally {
      setSavingEdit(false);
    }
  };

  const salvarEdicao = () => {
    if (!editUser) return;
    if (!editName.trim()) { toast.error("Informe o nome."); return; }
    if (editIsSelf && editRole !== "admin") {
      toast.error("Você não pode remover sua própria permissão de administrador.");
      return;
    }
    if (editUser.role === "admin" && editRole !== "admin") {
      setDowngradeConfirm({ userId: editUser.user_id, userName: nomeDe(editUser), newRole: editRole, after: salvarEdicaoConfirmada });
      return;
    }
    salvarEdicaoConfirmada();
  };

  const bloqueioDesabilitado = !!editUser && (editIsSelf || (editUser.role === "admin" && !editUser.blocked));

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <section className="space-y-3">
      {/* Barra de ações */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input className="pl-9 pr-9 h-11 rounded-xl bg-card" placeholder="Buscar nome, login ou perfil…" value={busca}
            onChange={e => setBusca(e.target.value)} aria-label="Buscar usuário" />
          {busca && (
            <button type="button" onClick={() => setBusca("")} aria-label="Limpar busca"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" className="h-11 w-11 rounded-xl shrink-0" onClick={fetchUsers} aria-label="Atualizar lista" title="Atualizar">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
          <Button className="h-11 rounded-xl gap-2 flex-1 sm:flex-none" onClick={() => setCreateDialog(true)}>
            <UserPlus className="h-4 w-4" /> Criar conta
          </Button>
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto scrollbar-none" role="group" aria-label="Filtrar usuários">
        {([
          ["todos", "Todos", users.length],
          ["pendentes", "Pendentes", pendentes],
          ["bloqueados", "Bloqueados", bloqueados],
        ] as const).map(([id, label, n]) => (
          <button key={id} type="button" onClick={() => setFiltro(id)} aria-pressed={filtro === id}
            className={cn(
              "h-9 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors inline-flex items-center gap-1.5",
              filtro === id ? "border-primary/40 bg-primary/10 text-primary" : "bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60",
              id === "pendentes" && n > 0 && filtro !== id && "border-warning/40 text-warning"
            )}>
            {label}
            <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", filtro === id ? "bg-primary/15" : "bg-muted")}>{n}</span>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border bg-card overflow-hidden">
        {loading && users.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" />Carregando usuários…</div>
        ) : filtrados.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-2 px-6 py-12">
            <div className="h-12 w-12 rounded-2xl bg-muted flex items-center justify-center"><Users className="h-6 w-6 text-muted-foreground" /></div>
            <p className="text-sm font-semibold">{users.length ? "Ninguém encontrado" : "Nenhum usuário"}</p>
            <p className="text-xs text-muted-foreground">{users.length ? "Mude a busca ou o filtro." : "Crie a primeira conta no botão acima."}</p>
          </div>
        ) : (
          <ul className="divide-y">
            {filtrados.map(u => {
              const isSelf = u.user_id === currentUser?.id;
              const pendente = !u.approved && !u.blocked;
              return (
                <li key={u.user_id} className={cn("p-3 sm:px-4 flex items-center gap-3", pendente && "bg-warning/[0.05]")}>
                  <button type="button" onClick={() => abrirEdicao(u)} className="flex items-center gap-3 min-w-0 flex-1 text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title="Editar">
                  <div className={cn(
                    "h-10 w-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold",
                    u.blocked ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
                  )}>
                    {nomeDe(u).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">
                      {u.display_name ?? "—"}{isSelf && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(você)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      <span className="font-mono">{u.login ?? "—"}</span> · desde {new Date(u.created_at).toLocaleDateString("pt-BR")}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-foreground">{ROLE_LABELS[u.role]?.split(" (")[0] ?? u.role}</span>
                      <StatusChip u={u} />
                      {u.must_change_password && !u.blocked && (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-muted-foreground bg-muted/60"><KeyRound className="h-3 w-3" />Trocar senha no acesso</span>
                      )}
                    </div>
                  </div>
                  </button>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {pendente && !isSelf && (
                      <Button size="sm" className="h-9 rounded-xl gap-1.5 bg-success text-success-foreground hover:bg-success/90" onClick={() => toggleApproval(u.user_id, true)}>
                        <CheckCircle className="h-4 w-4" /><span className="hidden sm:inline">Aprovar</span>
                      </Button>
                    )}
                    <Button variant="outline" size="sm" className="h-9 rounded-xl gap-1.5 hidden sm:inline-flex" onClick={() => abrirEdicao(u)} aria-label={`Editar ${nomeDe(u)}`}>
                      <Pencil className="h-4 w-4" />Editar
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={`Ações para ${nomeDe(u)}`}>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem className="gap-2 py-2.5" onClick={() => abrirEdicao(u)}>
                          <Pencil className="h-4 w-4" />Editar nome / perfil
                        </DropdownMenuItem>
                        <DropdownMenuItem className="gap-2 py-2.5" onClick={() => { setPasswordDialog(u); setNewPassword(""); }}>
                          <KeyRound className="h-4 w-4" />Alterar senha
                        </DropdownMenuItem>
                        {u.blocked && !isSelf && (
                          <DropdownMenuItem className="gap-2 py-2.5 text-success focus:text-success" onClick={() => unblockAccess(u.user_id)}>
                            <ShieldCheck className="h-4 w-4" />Desbloquear
                          </DropdownMenuItem>
                        )}
                        {u.approved && !u.blocked && !isSelf && u.role !== "admin" && (
                          <DropdownMenuItem className="gap-2 py-2.5 text-destructive focus:text-destructive" onClick={() => setBlockConfirm(u)}>
                            <ShieldX className="h-4 w-4" />Bloquear acesso
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="gap-2 py-2.5 text-destructive focus:text-destructive"
                          disabled={isSelf || deletingId === u.user_id}
                          onClick={() => setDeleteConfirm(u)}
                        >
                          <Trash2 className="h-4 w-4" />{isSelf ? "Não pode excluir a si mesmo" : "Excluir conta"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Criar conta ─────────────────────────────────── */}
      <Dialog open={createDialog} onOpenChange={v => { if (!creatingUser) { setCreateDialog(v); if (!v) resetCreateForm(); } }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><UserPlus className="h-4 w-4 text-primary" />Criar conta</DialogTitle>
            <DialogDescription>A conta já nasce aprovada. Passe o login e a senha para a pessoa; no primeiro acesso ela pode trocar a senha.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="nu-nome">Nome completo *</Label>
              <Input id="nu-nome" className="h-11" placeholder="Nome" value={newUserName} onChange={e => setNewUserName(e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nu-login">Login *</Label>
              <Input id="nu-login" className="h-11" type="text" placeholder="ex: joao.silva" value={newUserLogin}
                onChange={e => setNewUserLogin(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""))}
                autoComplete="off" autoCapitalize="none" />
              <p className="text-[11px] text-muted-foreground">Só letras minúsculas, números, ponto, hífen e sublinhado.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nu-senha">Senha inicial *</Label>
              <PasswordStrengthInput id="nu-senha" value={newUserPassword} onChange={setNewUserPassword} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nu-perfil">Perfil</Label>
              <RoleSelect id="nu-perfil" value={newUserRole} onChange={setNewUserRole} />
              <p className="text-[11px] text-muted-foreground">Acesso: {ROLE_HINT[newUserRole]}.</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-11" onClick={() => { setCreateDialog(false); resetCreateForm(); }} disabled={creatingUser}>Cancelar</Button>
            <Button className="h-11 gap-2" onClick={createUser}
              disabled={creatingUser || !newUserLogin.trim() || !newUserName.trim() || !!validatePassword(newUserPassword)}>
              {creatingUser ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {creatingUser ? "Criando…" : "Criar conta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Editar usuário ──────────────────────────────── */}
      <Dialog open={!!editUser} onOpenChange={v => { if (!v && !savingEdit) setEditUser(null); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="h-4 w-4 text-primary" />Editar usuário</DialogTitle>
            <DialogDescription>
              Login: <span className="font-mono text-foreground">{editUser?.login ?? "—"}</span> (o login não muda).
            </DialogDescription>
          </DialogHeader>
          {editUser && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ed-nome">Nome</Label>
                <Input id="ed-nome" className="h-11" value={editName} onChange={e => setEditName(e.target.value)} maxLength={100} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ed-perfil">Perfil</Label>
                <RoleSelect id="ed-perfil" value={editRole} onChange={setEditRole} disabled={editIsSelf} />
                <p className="text-[11px] text-muted-foreground">
                  {editIsSelf ? "Você não pode mudar o seu próprio perfil." : `Acesso: ${ROLE_HINT[editRole]}.`}
                </p>
              </div>
              {!editBlocked && !editIsSelf && (
                <label className="flex items-center justify-between gap-3 rounded-xl border p-3 cursor-pointer">
                  <span className="text-sm">
                    <span className="font-medium block">Acesso aprovado</span>
                    <span className="text-xs text-muted-foreground">Desligado, a pessoa vê a tela “Acesso suspenso”.</span>
                  </span>
                  <Switch checked={editApproved} onCheckedChange={setEditApproved} />
                </label>
              )}
              <label className={cn("flex items-center justify-between gap-3 rounded-xl border p-3", bloqueioDesabilitado ? "opacity-60" : "cursor-pointer", editBlocked && "border-destructive/40 bg-destructive/5")}>
                <span className="text-sm">
                  <span className={cn("font-medium block", editBlocked && "text-destructive")}>Bloqueado</span>
                  <span className="text-xs text-muted-foreground">
                    {editIsSelf ? "Você não pode bloquear a si mesmo."
                      : editUser.role === "admin" && !editUser.blocked ? "Para bloquear um admin, mude o perfil dele antes."
                      : "Bloqueado, o login para de funcionar na hora."}
                  </span>
                </span>
                <Switch checked={editBlocked} onCheckedChange={setEditBlocked} disabled={bloqueioDesabilitado} />
              </label>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-11" onClick={() => setEditUser(null)} disabled={savingEdit}>Cancelar</Button>
            <Button className={cn("h-11 gap-2", editBlocked && !editUser?.blocked && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
              onClick={salvarEdicao} disabled={savingEdit}>
              {savingEdit && <Loader2 className="h-4 w-4 animate-spin" />}
              {editBlocked && !editUser?.blocked ? "Salvar e bloquear" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Alterar senha ───────────────────────────────── */}
      <Dialog open={!!passwordDialog} onOpenChange={v => { if (!v && !resettingPassword) setPasswordDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" />Alterar senha</DialogTitle>
            <DialogDescription>
              Nova senha para <strong className="text-foreground">{passwordDialog ? nomeDe(passwordDialog) : ""}</strong>. No próximo acesso ela vai precisar criar uma senha pessoal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="rp-senha">Nova senha</Label>
            <PasswordStrengthInput id="rp-senha" value={newPassword} onChange={setNewPassword} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-11" onClick={() => setPasswordDialog(null)} disabled={resettingPassword}>Cancelar</Button>
            <Button className="h-11 gap-2" onClick={resetPassword} disabled={resettingPassword || !!validatePassword(newPassword)}>
              {resettingPassword && <Loader2 className="h-4 w-4 animate-spin" />}
              {resettingPassword ? "Salvando…" : "Alterar senha"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Confirmações ────────────────────────────────── */}
      <AlertDialog open={!!blockConfirm} onOpenChange={v => { if (!v) setBlockConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bloquear acesso de {blockConfirm ? nomeDe(blockConfirm) : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              O login <strong className="font-mono">{blockConfirm?.login ?? "usuário"}</strong> para de funcionar imediatamente. Os dados da pessoa continuam no sistema e dá para desbloquear depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (blockConfirm) revokeAccess(blockConfirm.user_id, blockConfirm.login); setBlockConfirm(null); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Bloquear acesso
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteConfirm} onOpenChange={v => { if (!v) setDeleteConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a conta de {deleteConfirm ? nomeDe(deleteConfirm) : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              A conta é apagada de vez e não pode ser recuperada. Se a pessoa só saiu da empresa, prefira <strong>Bloquear acesso</strong>, que mantém o histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteConfirm) deleteUser(deleteConfirm.user_id); setDeleteConfirm(null); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir conta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!downgradeConfirm} onOpenChange={v => { if (!v) setDowngradeConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldX className="h-4 w-4" /> Tirar o acesso de administrador?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{downgradeConfirm?.userName}</strong> deixa de ser administrador e passa a ter o perfil{" "}
              <strong>{downgradeConfirm ? ROLE_LABELS[downgradeConfirm.newRole] : ""}</strong>, perdendo o acesso a esta área Admin imediatamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                const c = downgradeConfirm;
                setDowngradeConfirm(null);
                if (!c) return;
                if (c.after) { c.after(); return; }
                if (await applyRoleChange(c.userId, c.newRole)) { toast.success("Perfil atualizado"); fetchUsers(); }
              }}>
              Sim, mudar perfil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
