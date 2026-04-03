import { useState, useEffect, useRef, useCallback } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { invokeWithAuth } from "@/lib/invokeEdgeFunction";
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
import { Plus, Pencil, Trash2, Search, Upload, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

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
};

export function AdminDevices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(value), 350);
  }, []);
  const [editDevice, setEditDevice] = useState<Partial<TablesInsert<"devices">> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // FIX CSV: aceita apenas .json e .csv (remove .txt da lista).
  // Valida colunas obrigatórias no CSV antes de enviar para evitar registros incompletos.
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (importing) return;

    const MAX_FILE_SIZE_MB = 10;
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      toast.error(`Arquivo muito grande. Máximo: ${MAX_FILE_SIZE_MB}MB`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const isJson = file.name.toLowerCase().endsWith(".json");
    const isCsv = file.name.toLowerCase().endsWith(".csv");

    // FIX: só aceita JSON e CSV — sem .txt para evitar ambiguidade
    if (!isJson && !isCsv) {
      toast.error("Tipo de arquivo inválido. Aceitos: .json, .csv");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setImporting(true);
    try {
      // CORREÇÃO ENCODING: CSVs do Excel/ANVISA frequentemente são ISO-8859-1 ou Windows-1252.
      // file.text() usa UTF-8 por padrão e corrompe acentos e símbolos (®, Ø, §, ã, ç...).
      // Estratégia: tenta UTF-8 → se corrompido, tenta Windows-1252 (superset do ISO-8859-1,
      // padrão do Excel no Windows Brasil) → fallback para ISO-8859-1.
      const readFileWithEncoding = (f: File, encoding: string): Promise<string> =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string ?? "");
          reader.onerror = () => reject(new Error("Erro ao ler arquivo"));
          reader.readAsText(f, encoding);
        });

      // Detecta assinatura de Latin-1/Windows-1252 mal-decodificado como UTF-8.
      // Bytes 0xC2–0xC7 seguidos de 0x80–0xBF são produzidos quando bytes >= 0x80
      // do ISO/Win-1252 são interpretados como sequências UTF-8 de 2 bytes.
      // Cobre: ® → Â®, Ø → Ã\x98, § → Â§, ã → Ã£, ç → Ã§, â → Ã¢, etc.
      const looksCorrupted = (s: string) => /[\u00c2\u00c3\u00c4\u00c5\u00c6\u00c7][\u0080-\u00bf]/.test(s);

      let text = await readFileWithEncoding(file, "UTF-8");
      if (looksCorrupted(text)) {
        // Windows-1252 é o padrão do Excel no Windows — tenta primeiro
        const win1252 = await readFileWithEncoding(file, "windows-1252");
        // Se win-1252 ainda parecer corrompido, tenta ISO-8859-1
        text = looksCorrupted(win1252)
          ? await readFileWithEncoding(file, "ISO-8859-1")
          : win1252;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let body: Record<string, any>;

      if (isCsv) {
        const firstLine = text.split("\n")[0] ?? "";
        const delimiter = firstLine.includes(";") ? ";" : ",";

        // Normaliza header: remove acentos, lowercase, hífens/espaços → underscore
        // Assim "Referência" casa com "reference", "UDI-DI" casa com "udi_di", etc.
        const normalizeH = (h: string) =>
          h.trim().replace(/^["']|["']$/g, "").trim()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .toLowerCase().replace(/[\s\-]+/g, "_").replace(/[^a-z0-9_]/g, "");

        const headers = firstLine.split(delimiter).map(normalizeH);

        // Variações aceitas de cada campo obrigatório (já normalizadas)
        const requiredVariants: Record<string, string[]> = {
          "udi_di":    ["udi_di", "udidi", "udi"],
          "model":     ["model", "modelo", "nome"],
          "reference": ["reference", "referencia", "ref"],
        };
        const missing: string[] = [];
        for (const [field, variants] of Object.entries(requiredVariants)) {
          const found = headers.some(h => variants.includes(h));
          if (!found) missing.push(field);
        }
        if (missing.length > 0) {
          toast.error(
            `CSV inválido. Colunas obrigatórias não encontradas: ${missing.join(", ")}. ` +
            `Colunas detectadas: ${headers.slice(0, 8).join(", ")}`
          );
          return;
        }
        body = { csv: text, replace_all: true, confirm_replace: "CONFIRMAR_SUBSTITUICAO" };
      } else {
        // JSON
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          toast.error("Arquivo JSON inválido. Verifique o formato.");
          return;
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          toast.error("JSON deve ser um objeto com campo 'devices' ou 'dispositivos_medicos'.");
          return;
        }
        const safe = parsed as Record<string, unknown>;
        if (!safe.devices && !safe.dispositivos_medicos) {
          toast.error("JSON deve conter o campo 'devices' ou 'dispositivos_medicos'.");
          return;
        }
        body = {
          replace_all: true,
          confirm_replace: "CONFIRMAR_SUBSTITUICAO",
          ...(safe.devices !== undefined && { devices: safe.devices }),
          ...(safe.dispositivos_medicos !== undefined && { dispositivos_medicos: safe.dispositivos_medicos }),
        };
      }

      toast.info("Importação iniciada... Isso pode levar alguns minutos.");

      // FIX JWT: usa invokeWithAuth para garantir token fresco antes do invoke
      const { data: importData, errorMsg } = await invokeWithAuth<{ inserted: number; skipped: number; total: number }>(
        "import-devices",
        { body }
      );

      if (errorMsg) {
        console.error("Import error:", errorMsg);
        toast.error(errorMsg);
      } else if (importData) {
        toast.success(`Importação concluída: ${importData.inserted} dispositivos importados de ${importData.total}`);
        setPage(0);
        fetchDevices(debouncedSearch, 0);
      }
    } catch (err) {
      console.error("Import parse error:", err);
      toast.error("Erro ao processar arquivo.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const fetchDevices = async (searchQuery = debouncedSearch, currentPage = page) => {
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

  useEffect(() => {
    fetchDevices(debouncedSearch, 0);
    setPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  useEffect(() => {
    if (page === 0) return;
    fetchDevices(debouncedSearch, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const filtered = devices;

  const handleSave = async () => {
    if (!editDevice) return;

    const parseResult = deviceSchema.safeParse(editDevice);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0];
      toast.error(firstError?.message ?? "Dados inválidos no formulário");
      return;
    }

    setSaving(true);
    try {
      if (isNew) {
        const { error } = await supabase.from("devices").insert(parseResult.data as TablesInsert<"devices">);
        if (error) { console.error("Device insert error:", error); toast.error("Erro ao criar o dispositivo."); }
        else { toast.success("Dispositivo criado"); setEditDevice(null); fetchDevices(debouncedSearch, page); }
      } else {
        const { id } = editDevice as Device;
        const { id: _omittedId, ...updates } = parseResult.data as TablesInsert<"devices"> & { id?: string };
        const { error } = await supabase.from("devices").update(updates).eq("id", id!);
        if (error) { console.error("Device update error:", error); toast.error("Erro ao atualizar o dispositivo."); }
        else { toast.success("Dispositivo atualizado"); setEditDevice(null); fetchDevices(debouncedSearch, page); }
      }
    } finally {
      setSaving(false);
    }
  };

  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);

  const handleDeleteAllDevices = async () => {
    setDeletingAll(true);
    try {
      let deleted = 0;
      const MAX_ITERATIONS = 200; // protege contra loop infinito (máx 100.000 registros)
      let iterations = 0;

      while (iterations < MAX_ITERATIONS) {
        iterations++;
        const { data: rows, error: fetchErr } = await supabase
          .from("devices")
          .select("id")
          .limit(500);
        if (fetchErr) throw fetchErr;
        if (!rows || rows.length === 0) break;
        const ids = rows.map((r: { id: string }) => r.id);
        const { error: delErr } = await supabase
          .from("devices")
          .delete()
          .in("id", ids);
        if (delErr) throw delErr;
        deleted += ids.length;
      }

      if (iterations >= MAX_ITERATIONS) {
        toast.warning(`Limite de iterações atingido. ${deleted.toLocaleString("pt-BR")} peças excluídas. Recarregue a página e repita se necessário.`);
      } else {
        toast.success(`${deleted.toLocaleString("pt-BR")} peças excluídas com sucesso`);
      }
      setPage(0);
      fetchDevices("", 0);
    } catch (err) {
      console.error("deleteAll error:", err);
      toast.error("Erro ao excluir todas as peças");
    } finally {
      setDeletingAll(false);
      setDeleteAllConfirm(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirmId) return;
    const { error } = await supabase.from("devices").delete().eq("id", deleteConfirmId);
    if (error) toast.error("Erro ao excluir");
    else { toast.success("Excluído"); fetchDevices(debouncedSearch, page); }
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
          <Input placeholder="Buscar dispositivos..." value={search} onChange={e => handleSearchChange(e.target.value)} className="pl-10" />
        </div>
        <div className="flex items-center gap-2">
          {/* FIX CSV: aceita apenas .json e .csv */}
          <input type="file" accept=".json,.csv" ref={fileInputRef} onChange={handleImportFile} className="hidden" />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing}>
            {importing ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
            {importing ? "Importando..." : "Importar"}
          </Button>
          <Button
            variant="outline"
            className="text-destructive border-destructive/40 hover:bg-destructive/10"
            onClick={() => setDeleteAllConfirm(true)}
            disabled={deletingAll || totalCount === 0}
            title="Excluir todas as peças do catálogo"
          >
            <ShieldAlert className="h-4 w-4 mr-1" />
            Excluir Tudo
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
              {filtered.map(d => (
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

      {/* Dialog confirmar exclusão de TODAS as peças */}
      <AlertDialog open={deleteAllConfirm} onOpenChange={setDeleteAllConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir TODAS as peças?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é <strong>irreversível</strong>. Todos os{" "}
              {totalCount.toLocaleString("pt-BR")} dispositivos serão removidos
              permanentemente do catálogo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingAll}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAllDevices}
              disabled={deletingAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingAll
                ? "Excluindo..."
                : `Excluir tudo (${totalCount.toLocaleString("pt-BR")})`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
              <div className="space-y-1.5"><Label>Código Interno</Label><Input value={editDevice.internal_code ?? ""} onChange={e => updateField("internal_code", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Registro ANVISA</Label><Input value={editDevice.anvisa_registration ?? ""} onChange={e => updateField("anvisa_registration", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Marca</Label><Input value={editDevice.brand_name ?? ""} onChange={e => updateField("brand_name", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Material Principal</Label><Input value={editDevice.primary_material ?? ""} onChange={e => updateField("primary_material", e.target.value)} /></div>
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
              <div className="space-y-1.5"><Label>País do Fabricante</Label><Input value={editDevice.manufacturer_country ?? ""} onChange={e => updateField("manufacturer_country", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Compatibilidade Exocad</Label><Input value={editDevice.exocad_compatibility ?? ""} onChange={e => updateField("exocad_compatibility", e.target.value)} /></div>
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
