import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, Search, Upload, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

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
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editDevice, setEditDevice] = useState<Partial<TablesInsert<"devices">> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast.error("Sessão expirada"); return; }

      let body: any;
      if (file.name.endsWith('.csv') || file.name.endsWith('.txt')) {
        body = { csv: text, replace_all: true };
      } else {
        body = { ...JSON.parse(text), replace_all: true };
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
        fetchDevices();
      }
    } catch (err) {
      console.error("Import parse error:", err);
      toast.error("Erro ao processar arquivo.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const fetchDevices = async () => {
    setLoading(true);
    const BATCH = 1000;
    let all: Device[] = [];
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from("devices")
        .select("*")
        .order("model")
        .range(from, from + BATCH - 1);

      if (error) { toast.error("Erro ao carregar dispositivos"); break; }
      const rows = data ?? [];
      all = all.concat(rows);
      if (rows.length < BATCH) break;
      from += BATCH;
    }

    setDevices(all);
    setLoading(false);
  };

  useEffect(() => { fetchDevices(); }, []);

  const filtered = devices.filter(d => {
    const q = search.toLowerCase();
    return !q || d.model.toLowerCase().includes(q) || d.reference.toLowerCase().includes(q) || d.udi_di.includes(q);
  });

  const handleSave = async () => {
    if (!editDevice) return;
    setSaving(true);
    if (isNew) {
      const { error } = await supabase.from("devices").insert(editDevice as TablesInsert<"devices">);
      if (error) { console.error("Device insert error:", error); toast.error("Erro ao criar o dispositivo."); }
      else toast.success("Dispositivo criado");
    } else {
      const { id, created_at, updated_at, ...updates } = editDevice as Device;
      const { error } = await supabase.from("devices").update(updates).eq("id", id!);
      if (error) { console.error("Device update error:", error); toast.error("Erro ao atualizar o dispositivo."); }
      else toast.success("Dispositivo atualizado");
    }
    setSaving(false);
    setEditDevice(null);
    fetchDevices();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir este dispositivo?")) return;
    const { error } = await supabase.from("devices").delete().eq("id", id);
    if (error) toast.error("Erro ao excluir");
    else { toast.success("Excluído"); fetchDevices(); }
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

      <p className="text-xs text-muted-foreground">{devices.length.toLocaleString("pt-BR")} dispositivos cadastrados</p>

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
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(d.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filtered.length > 100 && <p className="text-center text-sm text-muted-foreground py-2">Mostrando 100 de {filtered.length}</p>}
        </div>
      )}

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
