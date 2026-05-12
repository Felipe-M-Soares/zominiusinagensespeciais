import { useState, useEffect, useRef, useCallback } from "react";
import { z } from "zod";
import { useDebounce } from "@/hooks/useDebounce";
import { supabase } from "@/integrations/supabase/client";
import { fetchDevicesPage } from "@/lib/supabaseUtils";
import { invokeWithAuth } from "@/lib/invokeEdgeFunction";
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
import { logger } from "@/lib/logger";

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
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    debouncedFn(value);
  }, []);
  const [editDevice, setEditDevice] = useState<Partial<TablesInsert<"devices">> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── helpers de parse (mesmo padrão da Edge Function, mas no browser) ─────────
  const readFileWithEncoding = (f: File, encoding: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve(ev.target?.result as string ?? "");
      reader.onerror = () => reject(new Error("Erro ao ler arquivo"));
      reader.readAsText(f, encoding);
    });

  const looksCorrupted = (s: string) =>
    /[\u00c2\u00c3\u00c4\u00c5\u00c6\u00c7][\u0080-\u00bf]/.test(s) || s.includes("\uFFFD");

  const normalizeKey = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");

  function parseCSVBrowser(text: string): Record<string, string>[] {
    const clean = text.replace(/^\uFEFF/, "");
    const lines = clean.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];
    const delim = lines[0].includes(";") ? ";" : ",";
    const parseRow = (line: string) => {
      const res: string[] = []; let cur = ""; let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
        else if (c === delim && !inQ) { res.push(cur.trim()); cur = ""; }
        else cur += c;
      }
      res.push(cur.trim()); return res;
    };
    const rawHeaders = parseRow(lines[0]);
    const headers = rawHeaders.map(h => h.trim().replace(/^["']|["']$/g, "").trim());
    const normHeaders = headers.map(normalizeKey);
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = parseRow(lines[i]);
      if (vals.every(v => !v)) continue;
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        const v = (vals[idx] ?? "").replace(/^["']|["']$/g, "").trim();
        const nk = normHeaders[idx];
        row[h] = v; row[h.toLowerCase()] = v; row[nk] = v; row[nk.replace(/_/g, "")] = v;
      });
      rows.push(row);
    }
    return rows;
  }

  function g(r: Record<string, string>, ...keys: string[]): string {
    for (const k of keys) {
      const nk = normalizeKey(k);
      for (const t of [k, k.toLowerCase(), nk, nk.replace(/_/g, "")]) {
        if (r[t] !== undefined && r[t] !== "") return r[t];
      }
    }
    return "";
  }

  function toBool(val: string | undefined, def = false): boolean {
    if (!val) return def;
    const v = val.toLowerCase().trim();
    return v === "true" || v === "sim" || v === "1" || v === "yes" || v === "s";
  }

  function tr(s: unknown, max: number) { return typeof s === "string" ? s.trim().slice(0, max) : ""; }

  function mapRow(r: Record<string, string>) {
    const udi    = g(r, "udi_di","UDI-DI","udidi","udi","UDI_DI");
    const ref    = g(r, "reference","referencia","ref","Referencia");
    const model  = g(r, "model","modelo","nome","Model","Modelo");
    const cls    = g(r, "classification_code","Codigo_Classificacao","classe","Classe","Classification_Code") || "III";
    return {
      udi_di:               tr(udi, 200),
      reference:            tr(ref || udi, 200),
      model:                tr(model, 300),
      internal_code:        tr(g(r,"internal_code","codigo_interno","Codigo_Interno"), 100),
      anvisa_registration:  tr(g(r,"anvisa_registration","registro_anvisa","Anvisa","anvisa"), 100),
      brand_name:           tr(g(r,"brand_name","marca","Marca","Brand_Name"), 200),
      primary_material:     tr(g(r,"primary_material","material","Material","material_principal"), 200),
      secondary_material:   tr(g(r,"secondary_material","material_secundario"), 200),
      surface_treatment:    tr(g(r,"surface_treatment","tratamento_superficie"), 200),
      classification_code:  tr(cls, 50),
      risk_class:           (["I","II","III","IV"].includes(cls) ? cls : "III") as "I"|"II"|"III"|"IV",
      sterile:              toBool(g(r,"sterile","esteril","Esteril","Estéril","labeled_as_a_sterile_device","labeledasasteriledevice","Labeled As A Sterile Device?")),
      single_use:           toBool(g(r,"single_use","uso_unico","Uso_Unico","labeled_as_a_single_use_device","labeledasasingleusedevice","Labeled As A Single-Use Device?")),
      implantable:          true,
      intended_use:         tr(g(r,"intended_use","uso_pretendido","gmdn","descricao") || "Componente protético para implante dentário", 1000),
      body_region:          tr(g(r,"body_region","regiao_corpo","categoria") || "Oral", 200),
      compatible_systems:   [] as string[],
      manufacturer_country: tr(g(r,"manufacturer_country","pais_fabricante","pais"), 100),
      exocad_compatibility: tr(g(r,"exocad_compatibility","exocad"), 200),
    };
  }

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
    const isCsv  = file.name.toLowerCase().endsWith(".csv");
    if (!isJson && !isCsv) {
      toast.error("Tipo de arquivo inválido. Aceitos: .json, .csv");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setImporting(true);
    try {
      // 1. Lê arquivo com encoding correto (UTF-8, fallback windows-1252/ISO-8859-1)
      let text = await readFileWithEncoding(file, "UTF-8");
      if (looksCorrupted(text)) {
        const w = await readFileWithEncoding(file, "windows-1252");
        text = looksCorrupted(w) ? await readFileWithEncoding(file, "ISO-8859-1") : w;
      }

      // 2. Parse → array de dispositivos mapeados (tudo no browser, sem Edge Function)
      type DeviceInsert = ReturnType<typeof mapRow>;
      let mapped: DeviceInsert[] = [];

      if (isCsv) {
        const rows = parseCSVBrowser(text);
        if (rows.length === 0) { toast.error("CSV vazio ou sem dados."); return; }

        const firstRow = rows[0];
        const hasUdi   = Object.keys(firstRow).some(k => ["udi_di","udidi","udi","udi-di"].includes(normalizeKey(k)));
        const hasModel = Object.keys(firstRow).some(k => ["model","modelo","nome"].includes(normalizeKey(k)));
        if (!hasUdi || !hasModel) {
          toast.error(`CSV inválido. Necessário: 'udi_di' e 'model'. Detectado: ${Object.keys(firstRow).filter((_, i) => i < 8).join(", ")}`);
          return;
        }
        mapped = rows.map(mapRow).filter(d => d.udi_di.length > 0);
      } else {
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { toast.error("Arquivo JSON inválido."); return; }
        const safe = parsed as Record<string, unknown>;
        const list = (Array.isArray(safe.devices) ? safe.devices :
                      Array.isArray(safe.dispositivos_medicos) ? safe.dispositivos_medicos : null) as Record<string,unknown>[] | null;
        if (!list) { toast.error("JSON deve ter campo 'devices' ou 'dispositivos_medicos'."); return; }
        mapped = list.map(d => mapRow(d as Record<string, string>)).filter(d => d.udi_di.length > 0);
      }

      if (mapped.length === 0) { toast.error("Nenhum dispositivo válido encontrado."); return; }

      // 3. Deduplicar por udi_di
      const seen = new Map<string, number>();
      for (const d of mapped) {
        const orig = d.udi_di;
        const cnt = seen.get(orig) ?? 0;
        seen.set(orig, cnt + 1);
        if (cnt > 0) d.udi_di = `${orig}-${d.internal_code || cnt}`;
      }
      const deduped = Array.from(new Map(mapped.map(d => [d.udi_di, d])).values());

      toast.info(`Importando ${deduped.length} dispositivos...`);

      // 4. Apaga catálogo atual e insere em batches diretamente via supabase client.
      //    O RLS já garante que só admins conseguem fazer DELETE e INSERT na tabela devices.
      //    Isso elimina a dependência da Edge Function (que estava causando erros de CORS/rede).
      const { error: deleteError } = await supabase
        .from("devices")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");

      if (deleteError) {
        toast.error("Erro ao limpar catálogo: " + deleteError.message);
        return;
      }

      const BATCH = 500;
      let inserted = 0;
      let skipped  = 0;
      // Coleta os IDs dos devices inseridos para criar stock_items depois
      const insertedDeviceIds: string[] = [];

      for (let i = 0; i < deduped.length; i += BATCH) {
        const batch = deduped.slice(i, i + BATCH);
        const { data: upserted, error } = await supabase
          .from("devices")
          .upsert(batch, { onConflict: "udi_di", ignoreDuplicates: false })
          .select("id");

        if (error) {
          logger.error(`Batch ${Math.floor(i / BATCH) + 1} error:`, error.message);
          skipped += batch.length;
        } else {
          inserted += batch.length;
          if (upserted) insertedDeviceIds.push(...upserted.map((d: { id: string }) => d.id));
        }
      }

      if (inserted === 0) {
        toast.error("Nenhum dispositivo foi importado. Verifique o arquivo e tente novamente.");
        return;
      }

      // 5. Cria stock_item na fase "intermediaria" para cada device importado que ainda não tem.
      //    Busca os que já existem e insere apenas os novos — evita conflito com o
      //    partial unique index (stock_items_device_intermediaria_unique).
      let stockCreated = 0;
      if (insertedDeviceIds.length > 0) {
        for (let i = 0; i < insertedDeviceIds.length; i += BATCH) {
          const idBatch = insertedDeviceIds.slice(i, i + BATCH);

          // Descobre quais já têm stock_item intermediaria
          const { data: existing } = await supabase
            .from("stock_items")
            .select("device_id")
            .in("device_id", idBatch)
            .eq("fase", "intermediaria");

          const existingIds = new Set((existing ?? []).map((r: { device_id: string }) => r.device_id));
          const toInsert = idBatch
            .filter(id => !existingIds.has(id))
            .map(device_id => ({
              device_id,
              quantity: 0,
              quantity_reserved: 0,
              min_quantity: 0,
              fase: "intermediaria" as const,
            }));

          if (toInsert.length > 0) {
            const { data: stockInserted, error: stockErr } = await supabase
              .from("stock_items")
              .insert(toInsert)
              .select("id");

            if (stockErr) {
              logger.warn(`Stock insert batch warning:`, stockErr.message);
            } else {
              stockCreated += stockInserted?.length ?? 0;
            }
          }
        }
      }

      const stockMsg = stockCreated > 0
        ? ` · ${stockCreated} adicionados ao estoque intermediário`
        : "";
      toast.success(`Importação concluída: ${inserted} dispositivos${skipped > 0 ? ` (${skipped} com erro)` : ""}${stockMsg}`);
      setPage(0);
      fetchDevices(debouncedSearch, 0);

    } catch (err) {
      logger.error("Import error:", err);
      toast.error("Erro ao processar arquivo.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const fetchAbortDevicesRef = useRef<AbortController | null>(null);

  const fetchDevices = useCallback(async (searchQuery: string, currentPage: number) => {
    fetchAbortDevicesRef.current?.abort();
    const ctrl = new AbortController();
    fetchAbortDevicesRef.current = ctrl;
    setLoading(true);
    try {
      const { data, count } = await fetchDevicesPage<Device>(searchQuery, currentPage, PAGE_SIZE);
      if (ctrl.signal.aborted) return;
      setDevices(data);
      setTotalCount(count);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      toast.error("Erro ao carregar dispositivos");
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(0);
    fetchDevices(debouncedSearch, 0);
    return () => { fetchAbortDevicesRef.current?.abort(); };
  }, [debouncedSearch, fetchDevices]);

  useEffect(() => {
    if (page === 0) return;
    fetchDevices(debouncedSearch, page);
  }, [page, debouncedSearch, fetchDevices]);

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
        const { data: newDevice, error } = await supabase
          .from("devices")
          .insert(parseResult.data as TablesInsert<"devices">)
          .select("id")
          .single();
        if (error) { logger.error("Device insert error:", error); toast.error("Erro ao criar o dispositivo."); }
        else {
          // Adiciona automaticamente ao controle de estoque com quantidade 0
          if (newDevice?.id) {
            await supabase.from("stock_items").upsert({
              device_id: newDevice.id,
              quantity: 0,
              min_quantity: 0,
              fase: "intermediaria",
            }, { onConflict: "device_id,fase", ignoreDuplicates: true }).then(({ error: sErr }) => {
              if (sErr) logger.warn("Auto stock insert warning:", sErr.message);
            });
          }
          toast.success("Dispositivo criado e adicionado ao estoque intermediário");
          setEditDevice(null);
          fetchDevices(debouncedSearch, page);
        }
      } else {
        const { id } = editDevice as Device;
        const { id: _omittedId, ...updates } = parseResult.data as TablesInsert<"devices"> & { id?: string };
        const { error } = await supabase.from("devices").update(updates).eq("id", id!);
        if (error) { logger.error("Device update error:", error); toast.error("Erro ao atualizar o dispositivo."); }
        else { toast.success("Dispositivo atualizado"); setEditDevice(null); fetchDevices(debouncedSearch, page); }
      }
    } finally {
      setSaving(false);
    }
  };

  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [deleteAllTyped, setDeleteAllTyped] = useState("");

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
      logger.error("deleteAll error:", err);
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
      <AlertDialog open={deleteAllConfirm} onOpenChange={(open) => { setDeleteAllConfirm(open); if (!open) setDeleteAllTyped(""); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir TODAS as peças?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é <strong>irreversível</strong>. Todos os{" "}
              {totalCount.toLocaleString("pt-BR")} dispositivos serão removidos
              permanentemente do catálogo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* SAFETY: exige digitação da palavra "EXCLUIR" para confirmar operação destrutiva */}
          <div className="px-1 space-y-1.5">
            <p className="text-sm text-muted-foreground">
              Digite <strong className="text-destructive font-mono">EXCLUIR</strong> para confirmar:
            </p>
            <Input
              value={deleteAllTyped}
              onChange={e => setDeleteAllTyped(e.target.value)}
              placeholder="EXCLUIR"
              className="font-mono"
              disabled={deletingAll}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingAll} onClick={() => setDeleteAllTyped("")}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAllDevices}
              disabled={deletingAll || deleteAllTyped !== "EXCLUIR"}
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
