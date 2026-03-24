import { useState, useEffect, useRef } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { fetchDevicesPage } from "@/lib/supabaseUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, Search, Upload, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

// VULN-009 FIX: Validate device form with Zod before sending to Supabase
const deviceSchema = z.object({
  udi_di: z.string().min(1, "UDI-DI é obrigatório").max(200),
  model: z.string().min(1, "Modelo é obrigatório").max(300),
  reference: z.string().min(1, "Referência é obrigatória").max(200),
  internal_code: z.string().max(100).optional().default(""),
  anvisa_registration: z.string().max(100).optional().default(""),
  brand_name: z.string().max(200).optional().default(""),
  primary_material: z.string().max(200).optional().default(""),
  secondary_material: z.string().max(200).optional().default(""),
  surface_treatment: z.string().max(200).optional().default(""),
  classification_code: z.string().min(1, "Código de classificação é obrigatório").max(50),
  risk_class: z.enum(["I", "II", "III", "IV"]),
  sterile: z.boolean().default(false),
  single_use: z.boolean().default(false),
  implantable: z.boolean().default(true),
  intended_use: z.string().min(1, "Uso pretendido é obrigatório").max(1000),
  body_region: z.string().min(1, "Região do corpo é obrigatória").max(200),
  manufacturer_country: z.string().max(100).optional().default(""),
  exocad_compatibility: z.string().max(200).optional().default(""),
});

type Device = Tables<"devices">;

const emptyDevice: Omit<TablesInsert<"devices">, "id" | "created_at" | "updated_at"> = {
  udi_di: "",
  model: "",
  reference: "",
  internal_code: "",
  anvisa_registration: "",
  brand_name: "",
  primary_material: "",
  secondary_material: "",
  surface_treatment: "",
  classification_code: "",
  risk_class: "III",
  sterile: false,
  single_use: false,
  implantable: true,
  intended_use: "",
  body_region: "",
  compatible_systems: [],
  manufacturer_country: "",
  exocad_compatibility: "",
} as any;

export function AdminDevices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editDevice, setEditDevice] = useState<Partial<TablesInsert<"devices">> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // VULN-007 FIX: Validate file size and type on the client before uploading
    const MAX_FILE_SIZE_MB = 10;
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      toast.error(`Arquivo muito grande. Máximo: ${MAX_FILE_SIZE_MB}MB`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const validTypes = [".json", ".csv", ".txt"];
    const isValidType = validTypes.some(ext => file.name.toLowerCase().endsWith(ext));
    if (!isValidType) {
      toast.error("Tipo de arquivo inválido. Aceitos: .json, .csv, .txt");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setImporting(true);
    try {
      const text = await file.text();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast.error("Sessão expirada"); return; }

      // FIX: Edge function agora exige confirm_replace: "CONFIRMAR_SUBSTITUICAO" para
      // replace_all=true, prevenindo substituição acidental de toda a base de dados.
      let body: any;
      if (file.name.endsWith('.csv') || file.name.endsWith('.txt')) {
        body = { csv: text, replace_all: true, confirm_replace: "CONFIRMAR_SUBSTITUICAO" };
      } else {
        body = { ...JSON.parse(text), replace_all: true, confirm_replace: "CONFIRMAR_SUBSTITUICAO" };
      }

      toast.info("Importação iniciada... Isso pode levar alguns minutos.");

      const res = await supabase.functions.invoke("import-devices", {
        body,
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.error) {
        console.error("Import error:", res.error);
        toast.error("Erro na importação. Tente novamente.");
      } else {
        const d = res.data as { inserted: number; skipped: number; total: number };
        toast.success(`Importação concluída: ${d.inserted} dispositivos importados de ${d.total}`);
        setPage(0); fetchDevices(search, 0);
      }
    } catch (err) {
      console.error("Import parse error:", err);
      toast.error("Erro ao processar arquivo.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // PERF-001 / PERF-003 FIX: Server-side paginated fetch instead of loading everything into memory.
  // CODE-001 FIX: Uses shared fetchDevicesPage from supabaseUtils (no more duplicated while-loop).
  const fetchDevices = async (searchQuery = search, currentPage = page) => {
    setLoading(true);
    try {
      const { data, count } = await fetchDevicesPage<Device>(searchQuery, currentPage, PAGE_SIZE);
      setDevices(data);
      setTotalCount(count);
    } catch (err) {
      toast.error("Erro ao carregar dispositivos");
    } finally {
      setLoading(false);
    }
  };

  // Reset para página 0 quando a busca muda
  useEffect(() => {
    // FIX: O useEffect de [page] também seria disparado na montagem, causando 2 fetches
    // simultâneos. Centralizamos tudo aqui: quando search muda, resetamos a página
    // e buscamos; quando page muda (por paginação), buscamos com a página nova.
    fetchDevices(search, 0);
    setPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    // Só executa para mudanças de página após a montagem inicial (page > 0)
    if (page === 0) return;
    fetchDevices(search, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Server-side filtering means no client-side filter needed
  const filtered = devices;

  const handleSave = async () => {
    if (!editDevice) return;

    // VULN-009 FIX: Validate with Zod before sending to Supabase
    const parseResult = deviceSchema.safeParse(editDevice);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0];
      toast.error(firstError?.message ?? "Dados inválidos no formulário");
      return;
    }

    // FIX: setSaving(false) deve estar em finally — se ocorrer exceção no meio,
    // o botão "Salvar" ficava travado em loading infinito para o usuário.
    setSaving(true);
    try {
      if (isNew) {
        const { error } = await supabase.from("devices").insert(parseResult.data as TablesInsert<"devices">);
        if (error) { console.error("Device insert error:", error); toast.error("Erro ao criar o dispositivo."); }
        else { toast.success("Dispositivo criado"); setEditDevice(null); fetchDevices(search, page); }
      } else {
        const { id } = editDevice as Device;
        const { id: _id, ...updates } = parseResult.data as any;
        const { error } = await supabase.from("devices").update(updates).eq("id", id!);
        if (error) { console.error("Device update error:", error); toast.error("Erro ao atualizar o dispositivo."); }
        else { toast.success("Dispositivo atualizado"); setEditDevice(null); fetchDevices(search, page); }
      }
    } finally {
      setSaving(false);
    }
  };

  // CODE-003 FIX: Replace window.confirm() with AlertDialog (no thread blocking, styleable, works in PWA)
  const handleDeleteConfirm = async () => {
    if (!deleteConfirmId) return;
    const { error } = await supabase.from("devices").delete().eq("id", deleteConfirmId);
    if (error) toast.error("Erro ao excluir");
    else { toast.success("Excluído"); fetchDevices(search, page); }
    setDeleteConfirmId(null);
  };

  const updateField = (key: string, value: unknown) => {
    setEditDevice(prev => prev ? { ...prev, [key]: value } : prev);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar dispositivos..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <div className="flex items-center gap-2">
          <input type="file" accept=".json,.csv,.txt" ref={fileInputRef} onChange={handleImportFile} className="hidden" />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing}>
            {importing ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
            {importing ? "Importando..." : "Importar CSV"}
          </Button>
          <Button onClick={() => { setEditDevice({ ...emptyDevice }); setIsNew(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Novo
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{totalCount.toLocaleString("pt-BR")} dispositivos cadastrados</p>

      {loading ? (
        <div className="flex justify-center py-10"><div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" /></div>
      ) : (
        <div className="rounded-lg border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Modelo</TableHead>
                <TableHead>Referência</TableHead>
                <TableHead>UDI-DI</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Classe</TableHead>
                <TableHead className="w-[100px]">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 100).map(d => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium text-sm max-w-[200px] truncate">{d.model}</TableCell>
                  <TableCell className="text-sm font-mono">{d.reference}</TableCell>
                  <TableCell className="text-xs font-mono">{d.udi_di}</TableCell>
                  <TableCell className="text-sm">{d.primary_material}</TableCell>
                  <TableCell className="text-sm">{d.classification_code}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => { setEditDevice({ ...d }); setIsNew(false); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteConfirmId(d.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {totalCount > PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-2 border-t text-sm text-muted-foreground">
              <span>Página {page + 1} de {Math.ceil(totalCount / PAGE_SIZE)} ({totalCount.toLocaleString("pt-BR")} total)</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>Anterior</Button>
                <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= totalCount}>Próxima</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CODE-003 FIX: AlertDialog instead of window.confirm() for delete confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir dispositivo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O dispositivo será removido permanentemente do catálogo.
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

      <Dialog open={!!editDevice} onOpenChange={() => setEditDevice(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isNew ? "Novo Dispositivo" : "Editar Dispositivo"}</DialogTitle>
          </DialogHeader>
          {editDevice && (
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Modelo *</Label><Input value={editDevice.model ?? ""} onChange={e => updateField("model", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Referência *</Label><Input value={editDevice.reference ?? ""} onChange={e => updateField("reference", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>UDI-DI *</Label><Input value={editDevice.udi_di ?? ""} onChange={e => updateField("udi_di", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Código Interno *</Label><Input value={editDevice.internal_code ?? ""} onChange={e => updateField("internal_code", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Registro ANVISA *</Label><Input value={editDevice.anvisa_registration ?? ""} onChange={e => updateField("anvisa_registration", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Marca</Label><Input value={(editDevice as any).brand_name ?? ""} onChange={e => updateField("brand_name", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Material Principal *</Label><Input value={editDevice.primary_material ?? ""} onChange={e => updateField("primary_material", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Material Secundário</Label><Input value={editDevice.secondary_material ?? ""} onChange={e => updateField("secondary_material", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Tratamento de Superfície</Label><Input value={editDevice.surface_treatment ?? ""} onChange={e => updateField("surface_treatment", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Código Classificação *</Label><Input value={editDevice.classification_code ?? ""} onChange={e => updateField("classification_code", e.target.value)} /></div>
              <div className="space-y-1.5">
                <Label>Classe de Risco *</Label>
                <Select value={editDevice.risk_class ?? "III"} onValueChange={v => updateField("risk_class", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="I">I</SelectItem><SelectItem value="II">II</SelectItem>
                    <SelectItem value="III">III</SelectItem><SelectItem value="IV">IV</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Região do Corpo *</Label><Input value={editDevice.body_region ?? ""} onChange={e => updateField("body_region", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>País do Fabricante</Label><Input value={(editDevice as any).manufacturer_country ?? ""} onChange={e => updateField("manufacturer_country", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Compatibilidade Exocad</Label><Input value={(editDevice as any).exocad_compatibility ?? ""} onChange={e => updateField("exocad_compatibility", e.target.value)} /></div>
              <div className="sm:col-span-2 space-y-1.5"><Label>Uso Pretendido *</Label><Textarea value={editDevice.intended_use ?? ""} onChange={e => updateField("intended_use", e.target.value)} rows={2} /></div>
              <div className="flex items-center gap-3"><Switch checked={!!editDevice.sterile} onCheckedChange={v => updateField("sterile", v)} /><Label>Estéril</Label></div>
              <div className="flex items-center gap-3"><Switch checked={!!editDevice.single_use} onCheckedChange={v => updateField("single_use", v)} /><Label>Uso Único</Label></div>
              <div className="flex items-center gap-3"><Switch checked={editDevice.implantable !== false} onCheckedChange={v => updateField("implantable", v)} /><Label>Implantável</Label></div>
              <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditDevice(null)}>Cancelar</Button>
                <Button onClick={handleSave} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
