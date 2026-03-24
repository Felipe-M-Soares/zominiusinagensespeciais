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
import { Trash2, KeyRound, CheckCircle, XCircle } from "lucide-react";

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

  const fetchUsers = async () => {
    setLoading(true);
    const { data: profiles, error: pErr } = await supabase.from("profiles").select("*");
    const { data: roles, error: rErr } = await supabase.from("user_roles").select("*");

    if (pErr || rErr) { toast.error("Erro ao carregar usuários"); setLoading(false); return; }

    const roleMap = new Map((roles ?? []).map(r => [r.user_id, r.role]));
    const merged: UserProfile[] = (profiles ?? []).map(p => ({
      user_id: p.user_id,
      display_name: p.display_name,
      email: p.email,
      created_at: p.created_at,
      role: (roleMap.get(p.user_id) as "admin" | "client") ?? "client",
      approved: (p as any).approved ?? false,
    }));
    setUsers(merged);
    setLoading(false);
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
      .update({ approved: approve } as any)
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
    setResettingPassword(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      // FIX: "return" dentro de try{} ainda executa o finally{} — correto.
      // O bug anterior era um early return ANTES do setResettingPassword(true),
      // aqui está seguro pois o finally sempre limpa o estado.
      if (!session) { toast.error("Sessão expirada"); return; }

      const { error } = await supabase.functions.invoke("admin-reset-password", {
        body: { target_user_id: passwordDialog.user_id, new_password: newPassword },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) {
        console.error("Password reset error:", error);
        toast.error("Erro ao redefinir senha.");
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
      const { data: { session } } = await supabase.auth.getSession();
      // FIX: mesmo padrão — return dentro de try é seguro porque finally executa
      if (!session) { toast.error("Sessão expirada"); return; }

      const { error } = await supabase.functions.invoke("delete-account", {
        body: { target_user_id: userId },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) {
        console.error("Delete user error:", error);
        toast.error("Erro ao excluir conta.");
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

  if (loading) {
    return <div className="flex justify-center py-10"><div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <>
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
