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
AlertDialog,
AlertDialogAction,
AlertDialogCancel,
AlertDialogContent,
AlertDialogDescription,
AlertDialogFooter,
AlertDialogHeader,
AlertDialogTitle,
AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
Dialog,
DialogContent,
DialogHeader,
DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Trash2, KeyRound, CheckCircle, XCircle, UserPlus } from "lucide-react";

// FIX: supabase.functions.invoke() coloca erros HTTP (4xx/5xx) em error.context.body,
// não em error.message (que é sempre "Edge Function returned a non-2xx status code").
// Sem este helper, o usuário via sempre a mensagem genérica em vez do erro real da função.
async function readInvokeError(error: unknown): Promise<string> {
  try {
    const e = error as { context?: Response; message?: string };
    if (e?.context && typeof e.context.json === "function") {
      const body = await e.context.json() as { error?: string };
      if (body?.error) return String(body.error);
    }
  } catch { /* ignore */ }
  return (error as { message?: string })?.message ?? "Erro desconhecido";
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

// FIX: Criação de conta padrão pelo admin
const [createDialog, setCreateDialog] = useState(false);
const [newUserEmail, setNewUserEmail] = useState("");
const [newUserName, setNewUserName] = useState("");
const [newUserPassword, setNewUserPassword] = useState("");
const [newUserRole, setNewUserRole] = useState<"admin" | "client">("client");
const [creatingUser, setCreatingUser] = useState(false);

const fetchUsers = async () => {
  setLoading(true);
  try {
    const { data: profiles, error: pErr } = await supabase.from("profiles").select("*");
    const { data: roles, error: rErr } = await supabase.from("user_roles").select("*");

    if (pErr || rErr) {
      toast.error("Erro ao carregar usuários");
      return;
    }

    const roleMap = new Map((roles ?? []).map(r => [r.user_id, r.role]));
    const merged: UserProfile[] = (profiles ?? []).map(p => ({
      user_id: p.user_id,
      display_name: p.display_name,
      email: p.email,
      created_at: p.created_at,
      role: (roleMap.get(p.user_id) as "admin" | "client") ?? "client",
      approved: p.approved ?? false,
    }));
    setUsers(merged);
  } catch (err) {
    console.error("fetchUsers error:", err);
    toast.error("Erro inesperado ao carregar usuários");
  } finally {
    // FIX: setLoading(false) agora está em finally — garante que o spinner
    // sempre para mesmo em caso de exceção inesperada.
    setLoading(false);
  }
};

useEffect(() => { fetchUsers(); }, []);

const changeRole = async (userId: string, newRole: "admin" | "client") => {
  // CODE-005 FIX: Verify the update actually affected a row (silent failure otherwise)
  const { data, error } = await supabase
    .from("user_roles")
    .update({ role: newRole })
    .eq("user_id", userId)
    .select("user_id");
  if (error) {
    toast.error("Erro ao alterar função.");
  } else if (!data || data.length === 0) {
    toast.error("Usuário não encontrado para alterar função.");
  } else {
    toast.success("Função atualizada");
    fetchUsers();
  }
};

const toggleApproval = async (userId: string, approve: boolean) => {
  // CODE-005 FIX: Verify the update actually affected a row (silent failure otherwise)
  const { data, error } = await supabase
    .from("profiles")
    .update({ approved: approve })
    .eq("user_id", userId)
    .select("user_id");
  if (error) {
    toast.error("Erro ao alterar aprovação.");
  } else if (!data || data.length === 0) {
    toast.error("Perfil não encontrado para alterar aprovação.");
  } else {
    toast.success(approve ? "Usuário aprovado" : "Aprovação removida");
    fetchUsers();
  }
};

const resetPassword = async () => {
  if (!passwordDialog || !newPassword.trim()) return;
  if (newPassword.length < 8) {
    toast.error("A senha deve ter no mínimo 8 caracteres");
    return;
  }
  // FIX: bcrypt limite de 72 chars — sem este check o Supabase trunca silenciosamente
  if (newPassword.length > 72) {
    toast.error("A senha deve ter no máximo 72 caracteres");
    return;
  }
  setResettingPassword(true);
  try {
    const { error } = await supabase.functions.invoke("admin-reset-password", {
      body: { target_user_id: passwordDialog.user_id, new_password: newPassword },
    });

    if (error) {
      console.error("Password reset error:", error);
      const msg = await readInvokeError(error);
      toast.error("Erro ao redefinir senha: " + msg);
    } else {
      toast.success(`Senha de ${passwordDialog.display_name || passwordDialog.email} alterada`);
      setPasswordDialog(null);
      setNewPassword("");
    }
  } catch (err: any) {
    toast.error("Erro inesperado: " + err.message);
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
      console.error("Delete user error:", error);
      const msg = await readInvokeError(error);
      toast.error("Erro ao excluir conta: " + msg);
    } else {
      toast.success("Conta excluída com sucesso");
      fetchUsers();
    }
  } catch (err: any) {
    toast.error("Erro inesperado: " + err.message);
  } finally {
    setDeletingId(null);
  }
};

const createUser = async () => {
  if (!newUserEmail.trim() || !newUserName.trim() || newUserPassword.length < 8) {
    toast.error("Preencha todos os campos. Senha: mínimo 8 caracteres.");
    return;
  }
  // FIX: bcrypt limite de 72 chars
  if (newUserPassword.length > 72) {
    toast.error("Senha deve ter no máximo 72 caracteres.");
    return;
  }
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
      const msg = await readInvokeError(error);
      toast.error("Erro ao criar conta: " + msg);
    } else {
      toast.success("Conta criada com sucesso!");
      setCreateDialog(false);
      setNewUserEmail("");
      setNewUserName("");
      setNewUserPassword("");
      setNewUserRole("client");
      fetchUsers();
    }
  } catch (err: any) {
    toast.error("Erro inesperado: " + err.message);
  } finally {
    setCreatingUser(false);
  }
};

if (loading) {
  return <div className="flex justify-center py-10"><div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" /></div>;
}

return (
  <>
    {/* FIX: Botão de criação de conta padrão pelo admin */}
    <div className="flex justify-end mb-4">
      <Button size="sm" className="gap-1.5" onClick={() => setCreateDialog(true)}>
        <UserPlus className="h-4 w-4" /> Criar Conta
      </Button>
    </div>

    <Dialog open={createDialog} onOpenChange={setCreateDialog}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Criar Conta de Usuário</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            A conta será criada já aprovada, sem necessidade de confirmação de email.
          </p>
          <div className="space-y-2">
            <Label>Nome completo *</Label>
            <Input
              placeholder="Nome do usuário"
              value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)}
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <Label>Email *</Label>
            <Input
              type="email"
              placeholder="email@empresa.com"
              value={newUserEmail}
              onChange={(e) => setNewUserEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Senha * (mínimo 8 caracteres)</Label>
            <Input
              type="password"
              placeholder="Senha inicial"
              value={newUserPassword}
              onChange={(e) => setNewUserPassword(e.target.value)}
              minLength={8}
              maxLength={72}
            />
          </div>
          <div className="space-y-2">
            <Label>Perfil</Label>
            <Select value={newUserRole} onValueChange={(v) => setNewUserRole(v as "admin" | "client")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="client">Cliente</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateDialog(false)}>Cancelar</Button>
            <Button
              onClick={createUser}
              disabled={creatingUser || !newUserEmail.trim() || !newUserName.trim() || newUserPassword.length < 8}
            >
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
                  {u.approved ? (
                    <Badge variant="default" className="gap-1 bg-green-600">
                      <CheckCircle className="h-3 w-3" /> Aprovado
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1 text-orange-600">
                      <XCircle className="h-3 w-3" /> Pendente
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Select value={u.role} onValueChange={(v) => changeRole(u.user_id, v as "admin" | "client")}>
                      <SelectTrigger className="w-[120px] h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="client">Cliente</SelectItem>
                      </SelectContent>
                    </Select>

                    {!u.approved && !isSelf && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-green-600 border-green-300 hover:bg-green-50"
                        onClick={() => toggleApproval(u.user_id, true)}
                      >
                        <CheckCircle className="h-4 w-4 mr-1" /> Aprovar
                      </Button>
                    )}
                    {u.approved && !isSelf && u.role !== "admin" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-orange-600 border-orange-300 hover:bg-orange-50"
                        onClick={() => toggleApproval(u.user_id, false)}
                      >
                        <XCircle className="h-4 w-4 mr-1" /> Revogar
                      </Button>
                    )}

                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => { setPasswordDialog(u); setNewPassword(""); }}
                      title="Alterar senha"
                    >
                      <KeyRound className="h-4 w-4" />
                    </Button>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="destructive"
                          size="icon"
                          className="h-8 w-8"
                          disabled={isSelf || deletingId === u.user_id}
                          title={isSelf ? "Não é possível excluir sua própria conta" : "Excluir conta"}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Excluir conta de {u.display_name || u.email}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Esta ação é irreversível. Todos os dados deste usuário serão removidos permanentemente.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteUser(u.user_id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Excluir
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
        <DialogHeader>
          <DialogTitle>Alterar senha</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Definir nova senha para <strong>{passwordDialog?.display_name || passwordDialog?.email}</strong>
          </p>
          <div className="space-y-2">
            <Label>Nova senha</Label>
            <Input
              type="password"
              placeholder="Mínimo 8 caracteres"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              maxLength={72}
            />
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
