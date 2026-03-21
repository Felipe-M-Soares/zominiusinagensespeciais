import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Upload, Trash2, Download, FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";

interface Manual {
  id: string;
  title: string;
  description: string;
  file_path: string;
  file_size: number;
  created_at: string;
}

export default function Manuals() {
  const { isAdmin, user } = useAuth();
  const navigate = useNavigate();
  const [manuals, setManuals] = useState<Manual[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchManuals = async () => {
    const { data, error } = await supabase
      .from("manuals")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error) setManuals((data as Manual[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchManuals(); }, []);

  const handleUpload = async () => {
    if (!file || !title.trim()) {
      toast.error("Preencha o título e selecione um arquivo PDF");
      return;
    }
    setUploading(true);
    try {
      const filePath = `${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("manuais")
        .upload(filePath, file, { contentType: "application/pdf" });

      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase.from("manuals").insert({
        title: title.trim(),
        description: description.trim(),
        file_path: filePath,
        file_size: file.size,
      } as any);

      if (dbError) throw dbError;

      toast.success("Manual adicionado com sucesso");
      setDialogOpen(false);
      setTitle("");
      setDescription("");
      setFile(null);
      fetchManuals();
    } catch (err: any) {
      console.error("Upload error:", err);
      toast.error("Erro ao enviar o manual");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (manual: Manual) => {
    if (!confirm(`Excluir "${manual.title}"?`)) return;
    await supabase.storage.from("manuais").remove([manual.file_path]);
    await supabase.from("manuals").delete().eq("id", manual.id);
    toast.success("Manual excluído");
    fetchManuals();
  };

  const getDownloadUrl = async (filePath: string) => {
    const { data } = await supabase.storage.from("manuais").createSignedUrl(filePath, 300);
    return data?.signedUrl ?? '';
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="container mx-auto px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Logo className="h-8 object-contain" />
            <h1 className="text-sm sm:text-base font-semibold">Manuais</h1>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={() => setDialogOpen(true)} className="h-8 gap-1">
              <Plus className="h-4 w-4" /> Adicionar
            </Button>
          )}
        </div>
      </header>

      <main className="container mx-auto px-3 sm:px-4 py-6 max-w-3xl">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : manuals.length === 0 ? (
          <div className="text-center py-20">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">Nenhum manual disponível</p>
          </div>
        ) : (
          <div className="space-y-3">
            {manuals.map((m) => (
              <div key={m.id} className="flex items-center gap-3 p-4 rounded-lg border border-border bg-card hover:shadow-sm transition-shadow">
                <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
                  <FileText className="h-5 w-5 text-destructive" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium truncate">{m.title}</h3>
                  {m.description && <p className="text-xs text-muted-foreground truncate">{m.description}</p>}
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {formatSize(m.file_size)} • {new Date(m.created_at).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={async () => {
                    if (!user) {
                      toast.error("Faça login para baixar manuais");
                      navigate("/login");
                      return;
                    }
                    const url = await getDownloadUrl(m.file_path);
                    if (url) window.open(url, '_blank');
                  }}>
                    <Download className="h-4 w-4" />
                  </Button>
                  {isAdmin && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(m)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
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
            <DialogTitle>Adicionar Manual</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Título *</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Manual do Implante HE" />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição opcional" rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label>Arquivo PDF *</Label>
              <input type="file" accept=".pdf" ref={fileRef} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="hidden" />
              <Button variant="outline" className="w-full gap-2" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4" />
                {file ? file.name : "Selecionar PDF"}
              </Button>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleUpload} disabled={uploading}>{uploading ? "Enviando..." : "Enviar"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
