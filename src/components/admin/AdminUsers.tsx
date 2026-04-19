import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Trash2, KeyRound, CheckCircle, XCircle, UserPlus, ShieldX, ShieldCheck } from "lucide-react";

interface UserProfile {
  user_id: string;
  display_name: string | null;
  login: string | null;
  created_at: string;
  role: "admin" | "client";
  approved: boolean;
  blocked: boolean;
  must_change_password: boolean;
}

// ── Validação de senha forte ─────────────────────────────────────────────────
function validatePassword(pwd: string): string | null {
  if (pwd.length < 8)           return "Senha muito curta — mínimo 8 caracteres.";
  if (pwd.length > 72)          return "Senha longa demais — máximo 72 caracteres.";
  if (!/[A-Z]/.test(pwd))       return "Precisa de ao menos 1 letra maiúscula.";
  if (!/[a-z]/.test(pwd))       return "Precisa de ao menos 1 letra minúscula.";
  if (!/[0-9]/.test(pwd))       return "Precisa de ao menos 1 número.";
  if (!/[^A-Za-z0-9]/.test(pwd))return "Precisa de ao menos 1 caractere especial (!@#$%...).";
  return null;
}

function passwordStrength(pwd: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pwd.length >= 8)  score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  const levels = [
    { label: "",         color: "" },
    { label: "Muito fraca", color: "bg-destructive" },
    { label: "Fraca",    color: "bg-orange-400" },
    { label: "Razoável", color: "bg-warning" },
    { label: "Boa",      color: "bg-success" },
    { label: "Forte",    color: "bg-success" },
  ];
  return { score, ...levels[score] };
}

function PasswordStrengthInput({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  const strength = value ? passwordStrength(value) : null;
  const err = value.length > 0 ? validatePassword(value) : null;
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Input
          type={show ? "text" : "password"}
          placeholder="Crie uma senha segura"
          value={value}
          onChange={e => onChange(e.target.value)}
          maxLength={72}
          autoComplete="new-password"
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
        >
          {show
            ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
        </button>
      </div>
      {strength && strength.score > 0 && (
        <div className="space-y-1">
          <div className="flex gap-1">
            {[1,2,3,4,5].map(i => (
              <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= strength.score ? strength.color : "bg-muted"}`} />
            ))}
          </div>
          <p className={`text-[10px] font-medium ${err ? "text-destructive" : "text-muted-foreground"}`}>
            {err ?? strength.label}
          </p>
        </div>
      )}
      {value.length === 0 && (
        <p className="text-[10px] text-muted-foreground/60">
          Mín. 8 chars · maiúscula · minúscula · número · especial
        </p>
      )}
    </div>
  );
}

export function AdminUsers() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { user: currentUser } = useAuth();
  // FIX: ref para cancelar fetch se o componente desmontar durante a requisição
  const fetchAbortRef = useRef<AbortController | null>(null);

  const [passwordDialog, setPasswordDialog] = useState<UserProfile | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);

  const [createDialog, setCreateDialog] = useState(false);
  const [newUserLogin, setNewUserLogin] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"admin" | "client">("client");
  const [creatingUser, setCreatingUser] = useState(false);

  // FIX: useCallback + AbortController — evita atualizar estado em componente
  // desmontado e cancela fetches duplicados se chamado várias vezes seguidas.
  const fetchUsers = useCallback(async () => {
    if (fetchAbortRef.current) fetchAbortRef.current.abort();
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
        user_id: p.user_id,
        display_name: p.display_name,
        login: (p as { login?: string | null }).login ?? null,
        created_at: p.created_at,
        role: (roleMap.get(p.user_id) as "admin" | "client") ?? "client",
        approved: p.approved ?? false,
        blocked: (p as { blocked?: boolean }).blocked ?? false,
        must_change_password: (p as { must_change_password?: boolean }).must_change_password ?? false,
      })));
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error("fetchUsers:", err);
      toast.error("Erro inesperado ao carregar usuários");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    return () => { fetchAbortRef.current?.abort(); };
  }, [fetchUsers]);

  const changeRole = async (userId: string, newRole: "admin" | "client") => {
    // SEGURANÇA: admin não pode rebaixar a si mesmo — evita lock-out acidental
    if (userId === currentUser?.id && newRole !== "admin") {
      toast.error("Você não pode remover sua própria permissão de administrador.");
      return;
    }
    const { error } = await supabase.from("user_roles").update({ role: newRole }).eq("user_id", userId);
    if (error) toast.error("Erro ao alterar função: " + error.message);
    else { toast.success("Função atualizada"); fetchUsers(); }
  };

  const toggleApproval = async (userId: string, approve: boolean) => {
    const { error } = await supabase.from("profiles").update({ approved: approve }).eq("user_id", userId);
    if (error) toast.error("Erro ao alterar aprovação: " + error.message);
    else { toast.success(approve ? "Usuário aprovado" : "Aprovação removida"); fetchUsers(); }
  };

  // REVOGAR: bloqueia o email do usuário (blocked=true + approved=false)
  // A sessão ativa é invalidada via Edge Function admin-reset-password com senha aleatória,
  // forçando logout imediato. Usuário vê mensagem de bloqueio ao tentar logar novamente.
  const revokeAccess = async (userId: string, userLogin: string | null) => {
    try {
      // Marca blocked=true e approved=false no banco.
      // O polling de 30s em useAuth detecta e faz signOut + mostra tela de bloqueio.
      // NÃO alteramos a senha — assim o admin pode desbloquear sem precisar redefinir.
      const { error: profileErr } = await supabase
        .from("profiles")
        .update({ approved: false, blocked: true })
        .eq("user_id", userId);

      if (profileErr) {
        toast.error("Erro ao bloquear usuário: " + profileErr.message);
        return;
      }

      toast.success(`Acesso de ${userLogin ?? "usuário"} bloqueado.`);
      fetchUsers();
    } catch (err) {
      console.error("revokeAccess error:", err);
      toast.error("Erro inesperado ao bloquear usuário.");
    }
  };

  const unblockAccess = async (userId: string) => {
    const { error } = await supabase
      .from("profiles")
      .update({ blocked: false, approved: true })
      .eq("user_id", userId);
    if (error) toast.error("Erro ao desbloquear: " + error.message);
    else { toast.success("Usuário desbloqueado e aprovado"); fetchUsers(); }
  };

  const resetPassword = async () => {
    if (!passwordDialog || newPassword.length < 8) return;
    if (newPassword.length > 72) { toast.error("Senha deve ter no máximo 72 caracteres."); return; }
    setResettingPassword(true);
    try {
      const { data: rpcData, error: rpcErr } = await supabase.rpc("admin_reset_password", {
        p_target_user_id: passwordDialog.user_id,
        p_new_password:   newPassword,
      });
      const errMsg = rpcErr?.message ?? (rpcData as { error?: string } | null)?.error ?? null;
      if (errMsg) {
        toast.error("Erro ao redefinir senha: " + errMsg);
      } else {
        // Marca must_change_password para o usuário trocar no próximo acesso
        await supabase.from("profiles")
          .update({ must_change_password: true })
          .eq("user_id", passwordDialog.user_id);
        toast.success(`Senha de ${passwordDialog.display_name ?? passwordDialog.login ?? "usuário"} redefinida. Usuário deverá criar nova senha no próximo acesso.`);
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
      const { data: rpcData3, error: rpcErr3 } = await supabase.rpc("admin_delete_user", {
        p_target_user_id: userId,
      });
      const errMsg3 = rpcErr3?.message ?? (rpcData3 as {error?: string} | null)?.error ?? null;
      if (errMsg3) {
        toast.error("Erro ao excluir: " + errMsg3);
      } else {
        toast.success("Conta excluída");
        fetchUsers();
      }
    } finally {
      setDeletingId(null);
    }
  };

  const createUser = async () => {
    if (!newUserLogin.trim() || !newUserName.trim() || !newUserPassword) {
      toast.error("Preencha todos os campos."); return;
    }
    const pwErr = validatePassword(newUserPassword);
    if (pwErr) { toast.error(pwErr); return; }
    setCreatingUser(true);
    try {
      const { data: rpcData, error: rpcErr } = await supabase.rpc("admin_create_user", {
        p_login:        newUserLogin.trim().toLowerCase(),
        p_password:     newUserPassword,
        p_display_name: newUserName.trim(),
        p_role:         newUserRole,
      });
      const errMsg = rpcErr?.message ?? (rpcData as {error?: string} | null)?.error ?? null;
      if (errMsg) {
        toast.error("Erro ao criar conta: " + errMsg);
      } else {
        toast.success("Conta criada!");
        setCreateDialog(false);
        setNewUserLogin(""); setNewUserName(""); setNewUserPassword(""); setNewUserRole("client");
        fetchUsers();
      }
    } finally {
      setCreatingUser(false);
    }
  };

  if (loading) return (
    <div className="flex justify-center py-10">
      <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
    </div>
  );

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button size="sm" className="gap-1.5" onClick={() => setCreateDialog(true)}>
          <UserPlus className="h-4 w-4" /> Criar Conta
        </Button>
      </div>

      <Dialog open={createDialog} onOpenChange={setCreateDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Criar Conta de Usuário</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Conta criada já aprovada. O usuário definirá sua senha no primeiro acesso.</p>
            <div className="space-y-2">
              <Label>Nome completo *</Label>
              <Input placeholder="Nome" value={newUserName} onChange={e => setNewUserName(e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-2">
              <Label>Login *</Label>
              <Input type="text" placeholder="ex: joao.silva" value={newUserLogin} onChange={e => setNewUserLogin(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g,""))} autoComplete="off" />
            </div>
            <div className="space-y-2">
              <Label>Senha inicial *</Label>
              <PasswordStrengthInput value={newUserPassword} onChange={setNewUserPassword} />
            </div>
            <div className="space-y-2">
              <Label>Perfil</Label>
              <Select value={newUserRole} onValueChange={v => setNewUserRole(v as "admin" | "client")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">Cliente</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateDialog(false)}>Cancelar</Button>
              <Button onClick={createUser} disabled={creatingUser || !newUserLogin.trim() || !newUserName.trim() || !!validatePassword(newUserPassword)}>
                {creatingUser ? "Criando..." : "Criar Conta"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="rounded-lg border overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Login</TableHead>
              <TableHead>Cadastro</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map(u => {
              const isSelf = u.user_id === currentUser?.id;
              return (
                <TableRow key={u.user_id}>
                  <TableCell className="font-medium">{u.display_name ?? "—"}</TableCell>
                  <TableCell className="text-sm">{u.login ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(u.created_at).toLocaleDateString("pt-BR")}</TableCell>
                  <TableCell>
                    {u.blocked
                      ? <Badge variant="destructive" className="gap-1"><ShieldX className="h-3 w-3" /> Bloqueado</Badge>
                      : u.approved
                        ? <Badge variant="default" className="gap-1 bg-green-600"><CheckCircle className="h-3 w-3" /> Aprovado</Badge>
                        : <Badge variant="secondary" className="gap-1 text-orange-600"><XCircle className="h-3 w-3" /> Pendente</Badge>
                    }
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Select value={u.role} onValueChange={v => changeRole(u.user_id, v as "admin" | "client")} disabled={isSelf}>
                        <SelectTrigger className="w-[110px] h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="client">Cliente</SelectItem>
                        </SelectContent>
                      </Select>

                      {/* Usuário bloqueado: mostrar botão de desbloquear */}
                      {u.blocked && !isSelf && (
                        <Button variant="outline" size="sm" className="h-8 text-green-600 border-green-300 hover:bg-green-50"
                          onClick={() => unblockAccess(u.user_id)}>
                          <ShieldCheck className="h-4 w-4 mr-1" /> Desbloquear
                        </Button>
                      )}

                      {/* Usuário pendente (não aprovado, não bloqueado): botão Aprovar */}
                      {!u.approved && !u.blocked && !isSelf && (
                        <Button variant="outline" size="sm" className="h-8 text-green-600 border-green-300 hover:bg-green-50"
                          onClick={() => toggleApproval(u.user_id, true)}>
                          <CheckCircle className="h-4 w-4 mr-1" /> Aprovar
                        </Button>
                      )}

                      {/* Usuário aprovado e não bloqueado: botão Revogar */}
                      {u.approved && !u.blocked && !isSelf && u.role !== "admin" && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="sm" className="h-8 text-red-600 border-red-300 hover:bg-red-50">
                              <ShieldX className="h-4 w-4 mr-1" /> Revogar
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Bloquear acesso de {u.display_name ?? u.login ?? "usuário"}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                O login <strong>{u.login ?? "usuário"}</strong> será bloqueado imediatamente.
                                O usuário verá uma mensagem de "Acesso Bloqueado" ao tentar entrar e não conseguirá acessar o sistema até que um administrador o desbloqueie.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => revokeAccess(u.user_id, u.login)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                Bloquear Acesso
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}

                      <Button variant="outline" size="icon" className="h-8 w-8" title="Alterar senha"
                        onClick={() => { setPasswordDialog(u); setNewPassword(""); }}>
                        <KeyRound className="h-4 w-4" />
                      </Button>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="icon" className="h-8 w-8"
                            disabled={isSelf || deletingId === u.user_id}
                            title={isSelf ? "Não pode excluir sua própria conta" : "Excluir conta"}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir conta de {u.display_name ?? u.login ?? "usuário"}?</AlertDialogTitle>
                            <AlertDialogDescription>Esta ação é irreversível.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteUser(u.user_id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                              {deletingId === u.user_id ? "Excluindo..." : "Excluir"}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!passwordDialog} onOpenChange={() => setPasswordDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Alterar senha</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Nova senha para <strong>{passwordDialog?.display_name ?? passwordDialog?.login ?? "usuário"}</strong>
            </p>
            <div className="space-y-2">
              <Label>Nova senha</Label>
              <Input type="password" placeholder="Mínimo 8 caracteres" value={newPassword}
                onChange={e => setNewPassword(e.target.value)} minLength={8} maxLength={72} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPasswordDialog(null)}>Cancelar</Button>
              <Button onClick={resetPassword} disabled={resettingPassword || newPassword.length < 8}>
                {resettingPassword ? "Salvando..." : "Alterar senha"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
