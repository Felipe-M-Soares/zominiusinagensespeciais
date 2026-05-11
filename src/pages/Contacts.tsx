import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Trash2, Plus, User, MapPin, Phone, MessageCircle, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";
import { logger } from "@/lib/logger";
import { getStoredTheme, applyTheme } from "@/pages/Settings";

interface Contact {
  id: string;
  name: string;
  contact: string;
  location: string;
  created_at: string;
}

export default function Contacts() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);

  const [isDark, setIsDark] = useState(() => {
    const theme = getStoredTheme();
    if (theme === "system") return window.matchMedia("(prefers-color-scheme: dark)").matches;
    return theme === "dark";
  });
  const toggleTheme = useCallback(() => {
    const next = !isDark;
    setIsDark(next);
    applyTheme(next ? "dark" : "light");
  }, [isDark]);

  // FIX: useCallback + AbortController — evita memory leak se o componente
  // desmontar enquanto o fetch está em andamento.
  const fetchContacts = useCallback(async () => {
    if (fetchAbortRef.current) fetchAbortRef.current.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    try {
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .order("name");
      if (controller.signal.aborted) return;
      if (error) {
        logger.error("Error fetching contacts:", error);
        toast.error("Erro ao carregar contatos");
      } else {
        setContacts((data as Contact[]) ?? []);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logger.error("fetchContacts unexpected error:", err);
      toast.error("Erro ao carregar contatos");
    } finally {
      if (!fetchAbortRef.current?.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContacts();
    return () => { fetchAbortRef.current?.abort(); };
  }, [fetchContacts]);

  const openAddDialog = () => {
    setEditingContact(null);
    setName(""); setContact(""); setLocation("");
    setDialogOpen(true);
  };

  const openEditDialog = (c: Contact) => {
    setEditingContact(c);
    setName(c.name); setContact(c.contact); setLocation(c.location);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim() || !contact.trim()) { toast.error("Preencha nome e contato"); return; }
    if (name.trim().length > 100 || contact.trim().length > 100 || location.trim().length > 100) {
      toast.error("Campos excedem o tamanho máximo permitido (100 caracteres)."); return;
    }
    setSaving(true);
    try {
      if (editingContact) {
        const { error } = await supabase.from("contacts")
          .update({ name: name.trim(), contact: contact.trim(), location: location.trim() })
          .eq("id", editingContact.id);
        if (error) { toast.error("Erro ao atualizar contato"); }
        else { toast.success("Contato atualizado"); setDialogOpen(false); fetchContacts(); }
      } else {
        const { error } = await supabase.from("contacts")
          .insert({ name: name.trim(), contact: contact.trim(), location: location.trim() });
        if (error) { toast.error("Erro ao adicionar contato"); }
        else { toast.success("Contato adicionado"); setDialogOpen(false); fetchContacts(); }
      }
    } catch (err) {
      // FIX: sem este catch, uma exceção de rede deixava setSaving(true) para sempre,
      // travando o botão "Salvar" permanentemente até recarregar a página.
      logger.error("handleSave error:", err);
      toast.error("Erro inesperado. Tente novamente.");
    } finally { setSaving(false); }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const c = deleteTarget; setDeleteTarget(null);
    const { error } = await supabase.from("contacts").delete().eq("id", c.id);
    if (error) { toast.error("Erro ao excluir contato"); return; }
    toast.success("Contato excluído"); fetchContacts();
  };

  const getWhatsAppUrl = (phone: string): string | null => {
    const digits = phone.replace(/\D/g, "");
    const normalized = !digits.startsWith("55") && digits.length <= 11 ? "55" + digits : digits;
    if (!/^\d{12,13}$/.test(normalized)) return null;
    const message = encodeURIComponent("Olá! Vim do app Concept Usinagens, poderia me ajudar?");
    return `https://wa.me/${normalized}?text=${message}`;
  };

  const ACCENT_COLORS = [
    { bg: "from-blue-500/20 to-blue-400/5", icon: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
    { bg: "from-emerald-500/20 to-emerald-400/5", icon: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
    { bg: "from-violet-500/20 to-violet-400/5", icon: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
    { bg: "from-amber-500/20 to-amber-400/5", icon: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
    { bg: "from-rose-500/20 to-rose-400/5", icon: "bg-rose-500/15 text-rose-600 dark:text-rose-400" },
    { bg: "from-cyan-500/20 to-cyan-400/5", icon: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400" },
  ];
  const getAccent = (n: string) => ACCENT_COLORS[(n.charCodeAt(0) || 0) % ACCENT_COLORS.length];

  return (
    <div className="min-h-screen bg-gradient-to-br from-transparent to-accent/10">
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir contato</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir "{deleteTarget?.name}"? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <header className="border-b border-border/50 bg-card/80 backdrop-blur-md sticky top-0 z-10">
        <div className="container mx-auto px-4 py-2.5 flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Logo className="h-8 object-contain" />
          <h1 className="text-sm font-semibold">Contatos</h1>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={toggleTheme}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors"
              title={isDark ? "Modo claro" : "Modo escuro"}
            >
              {isDark
                ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
                : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              }
            </button>
            {isAdmin && (
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={openAddDialog}>
                <Plus className="h-3.5 w-3.5" /> Adicionar
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
              <User className="h-8 w-8 opacity-30" />
            </div>
            <p className="font-medium">Nenhum contato cadastrado</p>
            <p className="text-xs mt-1 opacity-60">Os contatos aparecerão aqui</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {contacts.map((c) => {
              const accent = getAccent(c.name);
              const waUrl = getWhatsAppUrl(c.contact);
              return (
                <div
                  key={c.id}
                  className="group relative rounded-2xl bg-card overflow-hidden transition-all duration-300 hover:-translate-y-1"
                  style={{ boxShadow: "0 1px 2px hsl(var(--border) / 0.3), 0 4px 12px -2px hsl(var(--border) / 0.15), inset 0 1px 0 hsl(0 0% 100% / 0.06)" }}
                >
                  {/* Top accent bar */}
                  <div className="h-0.5 bg-gradient-to-r from-transparent via-brand to-transparent opacity-60 group-hover:opacity-100 transition-opacity" />

                  {/* Gradient header */}
                  <div className={`px-4 pt-4 pb-3 bg-gradient-to-br ${accent.bg}`}>
                    <div className="flex items-center gap-3">
                      <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${accent.icon} text-lg font-bold select-none`}>
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-[13px] leading-tight line-clamp-1">{c.name}</p>
                        {c.location && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <MapPin className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                            <span className="text-[11px] text-muted-foreground/70 truncate">{c.location}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Phone row */}
                  <div className="px-4 py-2.5 border-t border-border/30 flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                    <span className="text-[11px] text-muted-foreground truncate">{c.contact}</span>
                  </div>

                  {/* Actions footer */}
                  <div className="px-3 pb-3 pt-1 flex items-center justify-between gap-2">
                    {waUrl ? (
                      <button
                        onClick={() => window.open(waUrl, "_blank", "noopener,noreferrer")}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-600 dark:text-green-400 text-[11px] font-medium transition-colors"
                      >
                        <MessageCircle className="h-3 w-3" />
                        WhatsApp
                      </button>
                    ) : (
                      <div />
                    )}
                    {isAdmin && (
                      <div className="flex gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => openEditDialog(c)}>
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:bg-destructive/10" onClick={() => setDeleteTarget(c)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingContact ? "Editar Contato" : "Adicionar Contato"}</DialogTitle>
            <DialogDescription>
              {editingContact ? "Atualize as informações do contato." : "Preencha os dados do novo contato."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do contato" maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label>Contato *</Label>
              <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Telefone, e-mail, etc." maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label>Localidade</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Cidade, estado, etc." maxLength={100} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
