import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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

  const fetchContacts = async () => {
    const { data } = await supabase
      .from("contacts")
      .select("*")
      .order("name");
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
    setSaving(true);

    if (editingContact) {
      const { error } = await supabase
        .from("contacts")
        .update({
          name: name.trim(),
          contact: contact.trim(),
          location: location.trim(),
        })
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
    setSaving(false);
  };

  const handleDelete = async (c: Contact) => {
    if (!confirm(`Excluir "${c.name}"?`)) return;
    await supabase.from("contacts").delete().eq("id", c.id);
    toast.success("Contato excluído");
    fetchContacts();
  };

  const getWhatsAppUrl = (phone: string) => {
    const digits = phone.replace(/\D/g, "");
    const message = encodeURIComponent("Olá! Vim do app Concept Usinagens, poderia me ajudar?");
    return `https://wa.me/${digits}?text=${message}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-accent/30">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/80 backdrop-blur-md sticky top-0 z-10">
        <div className="container mx-auto px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Logo className="h-8 object-contain" />
            <div className="hidden sm:block h-5 w-px bg-border" />
            <h1 className="text-sm sm:text-base font-semibold">Contatos</h1>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={openAddDialog} className="h-8 gap-1.5 text-xs">
              <Plus className="h-4 w-4" /> Adicionar
            </Button>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-3 sm:px-4 py-6 max-w-2xl">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="text-center py-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="h-16 w-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <User className="h-8 w-8 text-primary/50" />
            </div>
            <p className="text-muted-foreground font-medium">Nenhum contato cadastrado</p>
            <p className="text-muted-foreground/60 text-sm mt-1">Adicione contatos para começar</p>
          </div>
        ) : (
          <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {contacts.map((c, i) => (
              <div
                key={c.id}
                className="group relative flex items-center gap-3 sm:gap-4 p-4 rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm shadow-sm hover:shadow-md hover:border-primary/20 transition-all duration-200"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                {/* Avatar */}
                <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shrink-0 ring-1 ring-primary/10">
                  <span className="text-sm font-semibold text-primary">
                    {c.name.charAt(0).toUpperCase()}
                  </span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 space-y-0.5">
                  <h3 className="text-sm font-semibold truncate text-foreground">{c.name}</h3>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Phone className="h-3 w-3 shrink-0 text-primary/50" />
                    <span className="truncate">{c.contact}</span>
                  </div>
                  {c.location && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0 text-primary/50" />
                      <span className="truncate">{c.location}</span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-1.5 shrink-0">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 rounded-lg border-green-200 hover:bg-green-50 hover:border-green-300 dark:border-green-800 dark:hover:bg-green-950 dark:hover:border-green-700"
                    asChild
                  >
                    <a href={getWhatsAppUrl(c.contact)} target="_blank" rel="noopener noreferrer">
                      <MessageCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                    </a>
                  </Button>
                  {isAdmin && (
                    <div className="flex gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" onClick={() => openEditDialog(c)}>
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" onClick={() => handleDelete(c)}>
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

      {/* Dialog */}
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
