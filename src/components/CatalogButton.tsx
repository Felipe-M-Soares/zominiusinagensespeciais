import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Download, Upload, FileUp, Trash2, ChevronDown } from "lucide-react";
import { toast } from "sonner";

interface Catalog {
  id: string;
  title: string;
  file_path: string;
  file_size: number;
}

export function CatalogButton() {
  const { isAdmin } = useAuth();
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchCatalogs = async () => {
    const { data } = await supabase
      .from("catalogs")
      .select("*")
      .order("created_at", { ascending: false });
    setCatalogs((data as Catalog[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchCatalogs(); }, []);

  const handleDownload = async (catalog: Catalog) => {
    const { data } = await supabase.storage.from("manuals").createSignedUrl(catalog.file_path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  const handleUpload = async () => {
    if (!file || !title.trim()) {
      toast.error("Preencha o título e selecione um PDF");
      return;
    }
    setUploading(true);
    try {
      const filePath = `catalog_${Date.now()}_${file.name}`;
      const { error: uploadErr } = await supabase.storage
        .from("manuals")
        .upload(filePath, file, { contentType: "application/pdf" });
      if (uploadErr) throw uploadErr;

      const { error: dbErr } = await supabase.from("catalogs").insert({
        title: title.trim(),
        file_path: filePath,
        file_size: file.size,
      });
      if (dbErr) throw dbErr;

      toast.success("Catálogo adicionado!");
      setDialogOpen(false);
      setTitle("");
      setFile(null);
      fetchCatalogs();
    } catch (err: any) {
      console.error(err);
      toast.error("Erro ao enviar catálogo");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (catalog: Catalog) => {
    if (!confirm(`Remover "${catalog.title}"?`)) return;
    await supabase.storage.from("manuals").remove([catalog.file_path]);
    await supabase.from("catalogs").delete().eq("id", catalog.id);
    toast.success("Catálogo removido");
    fetchCatalogs();
  };

  if (loading) return null;

  return (
    <>
      {catalogs.length === 1 && (
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => handleDownload(catalogs[0])}>
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Catálogo</span>
        </Button>
      )}

      {catalogs.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Catálogos</span>
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            {catalogs.map((c) => (
              <DropdownMenuItem key={c.id} className="gap-2 cursor-pointer" onClick={() => handleDownload(c)}>
                <Download className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{c.title}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {isAdmin && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setDialogOpen(true)}
            title="Adicionar catálogo"
          >
            <FileUp className="h-4 w-4" />
          </Button>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Adicionar Catálogo PDF</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Título *</Label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Catálogo 2026" />
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

                {catalogs.length > 0 && (
                  <div className="border-t border-border pt-4 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Catálogos existentes</p>
                    {catalogs.map((c) => (
                      <div key={c.id} className="flex items-center justify-between p-2 rounded-md bg-muted/30">
                        <span className="text-sm truncate mr-2">{c.title}</span>
                        <Button variant="ghost" size="sm" className="h-7 text-destructive gap-1 shrink-0" onClick={() => handleDelete(c)}>
                          <Trash2 className="h-3.5 w-3.5" /> Remover
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </>
  );
}
