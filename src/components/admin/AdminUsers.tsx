import { useState, useEffect } from "react";
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
import { Trash2, KeyRound, CheckCircle, XCircle, UserPlus } from "lucide-react";

/**
 * Lê o corpo real do erro de uma Edge Function.
 * supabase.functions.invoke() coloca erros HTTP em error.context (um Response),
 * não em error.message (que é sempre a mensagem genérica do SDK).
 */
async function readEdgeFunctionError(error: unknown): Promise<string> {
  try {
    const e = error as { context?: Response; message?: string };
    if (e?.context instanceof Response) {
      try {
        const body = await e.context.clone().json() as { error?: string; message?: string };
        if (body?.error) return body.error;
        if (body?.message) return body.message;
      } catch {
        try {
          const text = await e.context.clone().text();
          if (text) return text.slice(0, 300);
        } catch { /* ignore */ }
      }
    }
    return (e?.message) ?? "Erro desconhecido";
  } catch {
    return "Erro desconhecido";
  }
}

interface UserProfile {
  user_id: string;
  display_name: string | null;
  email: string | null;
  created_at: string;
  role: "admin" | "client";
  approved: boolean;
}

export function AdminUsers() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { user: currentUser } = useAuth();

  const [passwordDialog, setPasswordDialog] = useState<UserProfile | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);

  const [createDialog, setCreateDialog] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"admin" | "client">("client");
  const [creatingUser, setCreatingUser] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] = await Promise.all([
        supabase.from("profiles").select("*"),
        supabase.from("user_roles").select("*"),
      ]);
      if (pErr || rErr) { toast.error("Erro ao carregar usuários"); return; }
      const roleMap = new Map((roles ?? []).map(r => [r.user_id, r.role]));
      setUsers((profiles ?? []).map(p => ({
        user_id: p.user_id,
        display_name: p.display_name,
        email: p.email,
        created_at: p.created_at,
        role: (roleMap.get(p.user_id) as "admin" | "client") ?? "client",
        approved: p.approved ?? false,
      })));
    } catch (err) {
      console.error("fetchUsers:", err);
      toast.error("Erro inesperado ao carregar usuários");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const changeRole = async (userId: string, newRole: "admin" | "client") => {
    const { error } = await supabase.from("user_roles").update({ role: newRole }).eq("user_id", userId);
    if (error) toast.error("Erro ao alterar função: " + error.message);
    else { toast.success("Função atualizada"); fetchUsers(); }
  };

  const toggleApproval = async (userId: string, approve: boolean) => {
    const { error } = await supabase.from("profiles").update({ approved: approve }).eq("user_id", userId);
    if (error) toast.error("Erro ao alterar aprovação: " + error.message);
    else { toast.success(approve ? "Usuário aprovado" : "Aprovação removida"); fetchUsers(); }
  };

  const resetPassword = async () => {
    if (!passwordDialog || newPassword.length < 8) return;
    if (newPassword.length > 72) { toast.error("Senha deve ter no máximo 72 caracteres"); return; }
    setResettingPassword(true);
    try {
      // O SDK envia o JWT do usuário logado automaticamente via Authorization header
      // quando há uma sessão ativa — NÃO precisamos passar manualmente.
      const { error } = await supabase.functions.invoke("admin-reset-password", {
        body: { target_user_id: passwordDialog.user_id, new_password: newPassword },
      });
      if (error) {
        const msg = await readEdgeFunctionError(error);
        toast.error("Erro ao redefinir senha: " + msg);
      } else {
        toast.success(`Senha de ${passwordDialog.display_name || passwordDialog.email} alterada`);
        setPasswordDialog(null);
        setNewPassword("");
      }
    } finally {
      setResettingPassword(false);
    }
  };

  const deleteUser = async (userId: string) => {
    setDeletingId(userId);
    try {
      const { error } = await supabase.functions.invoke("delete-account", {
        body: { target_user_id: userId },
      });
      if (error) {
        const msg = await readEdgeFunctionError(error);
        toast.error("Erro ao excluir: " + msg);
      } else {
        toast.success("Conta excluída");
        fetchUsers();
      }
    } finally {
      setDeletingId(null);
    }
  };

  const createUser = async () => {
    if (!newUserEmail.trim() || !newUserName.trim() || newUserPassword.length < 8) {
      toast.error("Preencha todos os campos. Senha: mínimo 8 caracteres."); return;
    }
    if (newUserPassword.length > 72) { toast.error("Senha máximo 72 caracteres."); return; }
    setCreatingUser(true);
    try {
      const { error } = await supabase.functions.invoke("admin-create-user", {
        body: {
          email: newUserEmail.trim().toLowerCase(),
          password: newUserPassword,
          display_name: newUserName.trim(),
          role: newUserRole,
        },
      });
      if (error) {
        const msg = await readEdgeFunctionError(error);
        toast.error("Erro ao criar conta: " + msg);
      } else {
        toast.success("Conta criada!");
        setCreateDialog(false);
        setNewUserEmail(""); setNewUserName(""); setNewUserPassword(""); setNewUserRole("client");
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
            <p className="text-sm text-muted-foreground">Conta criada já aprovada, sem confirmação de email.</p>
            <div className="space-y-2">
              <Label>Nome completo *</Label>
              <Input placeholder="Nome" value={newUserName} onChange={e => setNewUserName(e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input type="email" placeholder="email@empresa.com" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Senha * (mínimo 8 caracteres)</Label>
              <Input type="password" placeholder="Senha inicial" value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)} minLength={8} maxLength={72} />
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
              <Button onClick={createUser} disabled={creatingUser || !newUserEmail.trim() || !newUserName.trim() || newUserPassword.length < 8}>
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
              <TableHead>Email</TableHead>
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
                  <TableCell className="text-sm">{u.email}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(u.created_at).toLocaleDateString("pt-BR")}</TableCell>
                  <TableCell>
                    {u.approved
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

                      {!u.approved && !isSelf && (
                        <Button variant="outline" size="sm" className="h-8 text-green-600 border-green-300 hover:bg-green-50"
                          onClick={() => toggleApproval(u.user_id, true)}>
                          <CheckCircle className="h-4 w-4 mr-1" /> Aprovar
                        </Button>
                      )}
                      {u.approved && !isSelf && u.role !== "admin" && (
                        <Button variant="outline" size="sm" className="h-8 text-orange-600 border-orange-300 hover:bg-orange-50"
                          onClick={() => toggleApproval(u.user_id, false)}>
                          <XCircle className="h-4 w-4 mr-1" /> Revogar
                        </Button>
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
                            <AlertDialogTitle>Excluir conta de {u.display_name || u.email}?</AlertDialogTitle>
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
              Nova senha para <strong>{passwordDialog?.display_name || passwordDialog?.email}</strong>
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
