import { useState, useEffect } from "react";
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
    // BUG-003 FIX: Replace window.confirm with AlertDialog state
    const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);

    const fetchContacts = async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .order("name");
      if (error) {
        console.error("Error fetching contacts:", error);
        toast.error("Erro ao carregar contatos");
      }
      setContacts((data as Contact[]) ?? []);
      setLoading(false);
    };

    useEffect(() => { fetchContacts(); }, []);

    const openAddDialog = () => {
      setEditingContact(null);
      setName("");
      setContact("");
      setLocation("");
      setDialogOpen(true);
    };

    const openEditDialog = (c: Contact) => {
      setEditingContact(c);
      setName(c.name);
      setContact(c.contact);
      setLocation(c.location);
      setDialogOpen(true);
    };

    const handleSave = async () => {
      if (!name.trim() || !contact.trim()) {
        toast.error("Preencha nome e contato");
        return;
      }
      // FIX: try/finally garante que setSaving(false) sempre é chamado,
      // mesmo se o Supabase lançar uma exceção inesperada.
      setSaving(true);
      try {
        if (editingContact) {
          const { error } = await supabase
            .from("contacts")
            .update({ name: name.trim(), contact: contact.trim(), location: location.trim() })
            .eq("id", editingContact.id);
          if (error) {
            toast.error("Erro ao atualizar contato");
          } else {
            toast.success("Contato atualizado");
            setDialogOpen(false);
            fetchContacts();
          }
        } else {
          const { error } = await supabase.from("contacts").insert({
            name: name.trim(),
            contact: contact.trim(),
            location: location.trim(),
          } as any);
          if (error) {
            toast.error("Erro ao adicionar contato");
          } else {
            toast.success("Contato adicionado");
            setDialogOpen(false);
            fetchContacts();
          }
        }
      } finally {
        setSaving(false);
      }
    };

    const handleDeleteConfirm = async () => {
      if (!deleteTarget) return;
      const c = deleteTarget;
      setDeleteTarget(null);
      const { error } = await supabase.from("contacts").delete().eq("id", c.id);
      if (error) {
        toast.error("Erro ao excluir contato");
        return;
      }
      toast.success("Contato excluído");
      fetchContacts();
    };

    // BUG-011 FIX: Add Brazilian country code (+55) if not present
    const getWhatsAppUrl = (phone: string) => {
      let digits = phone.replace(/\D/g, "");
      if (!digits.startsWith("55") && digits.length <= 11) digits = "55" + digits;
      const message = encodeURIComponent("Olá! Vim do app Concept Usinagens, poderia me ajudar?");
      return `https://wa.me/${digits}?text=${message}`;
    };

    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-accent/30">
        {/* BUG-003 FIX: AlertDialog replaces window.confirm() */}
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
            {isAdmin && (
              <Button size="sm" className="ml-auto h-8 gap-1.5 text-xs" onClick={openAddDialog}>
                <Plus className="h-3.5 w-3.5" /> Adicionar
              </Button>
            )}
          </div>
        </header>

        <main className="container mx-auto px-4 py-5">
          {loading ? (
            <div className="flex justify-center py-20">
              <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : contacts.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <User className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Nenhum contato cadastrado</p>
            </div>
          ) : (
            <div className="space-y-3">
              {contacts.map((c) => (
                <div key={c.id} className="group flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:bg-accent/30 transition-colors">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{c.name}</p>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      <span className="truncate">{c.contact}</span>
                    </div>
                    {c.location && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        <span className="truncate">{c.location}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 rounded-lg text-green-600 hover:text-green-700 hover:bg-green-50"
                      onClick={() => window.open(getWhatsAppUrl(c.contact), "_blank")}
                      title="WhatsApp"
                    >
                      <MessageCircle className="h-4 w-4" />
                    </Button>
                    {isAdmin && (
                      <div className="flex gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" onClick={() => openEditDialog(c)}>
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" onClick={() => setDeleteTarget(c)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
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
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do contato" />
              </div>
              <div className="space-y-1.5">
                <Label>Contato *</Label>
                <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Telefone, e-mail, etc." />
              </div>
              <div className="space-y-1.5">
                <Label>Localidade</Label>
                <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Cidade, estado, etc." />
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
  