import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Download, Upload, FileUp, Trash2, ChevronDown } from "lucide-react";
import { toast } from "sonner";

const MAX_FILE_SIZE_MB = 20;

// BUG-007 FIX: Sanitize filename - remove special chars/spaces that break signed URLs
function sanitizeFilename(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();
}

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
  const [downloading, setDownloading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // BUG-001 FIX: Replace window.confirm with AlertDialog state
  const [deleteTarget, setDeleteTarget] = useState<Catalog | null>(null);

  const fetchCatalogs = async () => {
    try {
      const { data, error } = await supabase
        .from("catalogs")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) {
        console.error("Error fetching catalogs:", error);
        toast.error("Erro ao carregar catálogos");
      } else {
        setCatalogs((data as Catalog[]) ?? []);
      }
    } catch (err) {
      console.error("fetchCatalogs unexpected error:", err);
      toast.error("Erro ao carregar catálogos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCatalogs(); }, []);

  // FIX DEFINITIVO: Usar URL assinada com ?download diretamente (sem fetch/CORS).
  // createSignedUrl com opção download força Content-Disposition: attachment no Supabase.
  const handleDownload = async (catalog: Catalog) => {
    if (downloading) return;
    setDownloading(true);
    try {
      const safeFilename = (catalog.title.endsWith(".pdf") ? catalog.title : catalog.title + ".pdf")
        .replace(/[^a-zA-Z0-9._\-\s]/g, "_");
      const { data, error } = await supabase.storage
        .from("manuals")
        .createSignedUrl(catalog.file_path, 300, { download: safeFilename });
      if (error || !data?.signedUrl) {
        toast.error("Erro ao gerar link de download");
        return;
      }
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setDownloading(false);
    }
  };

  const handleUpload = async () => {
    if (!file || !title.trim()) {
      toast.error("Preencha o título e selecione um PDF");
      return;
    }
    // BUG-005 FIX: Validate file size before upload
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      toast.error(`Arquivo muito grande. Máximo: ${MAX_FILE_SIZE_MB}MB`);
      return;
    }
    // BUG-006 FIX: Validate MIME type - accept=".pdf" is client-only and can be bypassed
    if (file.type !== "application/pdf") {
      toast.error("Apenas arquivos PDF são permitidos");
      return;
    }

    setUploading(true);
    try {
      // BUG-007 FIX: Sanitize filename to avoid broken signed URLs with spaces/accents
      const safeName = sanitizeFilename(file.name);
      const filePath = `catalog_${Date.now()}_${safeName}`;
      const { error: uploadErr } = await supabase.storage
        .from("manuals")
        .upload(filePath, file, { contentType: "application/pdf" });
      if (uploadErr) throw uploadErr;

      const { error: dbErr } = await supabase.from("catalogs").insert({
        title: title.trim(),
        file_path: filePath,
        file_size: file.size,
      });
      if (dbErr) {
        await supabase.storage.from("manuals").remove([filePath]);
        throw dbErr;
      }

      toast.success("Catálogo adicionado!");
      setDialogOpen(false);
      setTitle("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      fetchCatalogs();
    } catch (err: any) {
      console.error(err);
      toast.error("Erro ao enviar catálogo");
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const catalog = deleteTarget;
    setDeleteTarget(null);
    const { error: storageErr } = await supabase.storage.from("manuals").remove([catalog.file_path]);
    if (storageErr) console.error("Storage delete error:", storageErr);
    const { error: dbErr } = await supabase.from("catalogs").delete().eq("id", catalog.id);
    if (dbErr) {
      toast.error("Erro ao remover catálogo");
      return;
    }
    toast.success("Catálogo removido");
    fetchCatalogs();
  };

  if (loading) return null;

  return (
    <>
      {/* BUG-001 FIX: AlertDialog replaces window.confirm() */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover catálogo</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover "{deleteTarget?.title}"? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {catalogs.length === 1 && (
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => handleDownload(catalogs[0])} disabled={downloading}>
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Catálogo</span>
        </Button>
      )}

      {catalogs.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={downloading}>
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
                  <Label>Arquivo PDF * (máx. {MAX_FILE_SIZE_MB}MB)</Label>
                  <input type="file" accept=".pdf,application/pdf" ref={fileRef} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="hidden" />
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
                        <Button variant="ghost" size="sm" className="h-7 text-destructive gap-1 shrink-0" onClick={() => setDeleteTarget(c)}>
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
