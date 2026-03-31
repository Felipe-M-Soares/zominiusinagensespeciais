import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// FIX CRÍTICO: getCorsHeaders() estava sendo chamada mas nunca definida neste arquivo,
// causando ReferenceError em toda importação de CSV. Definição adicionada aqui.
function getCorsHeaders(req: Request): Record<string, string> {
  const allowed = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
  const origin = req.headers.get("origin") ?? "";
  const responseOrigin = allowed === "*" ? "*" : (origin === allowed ? origin : allowed);
  return {
    "Access-Control-Allow-Origin": responseOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// VULN-007: Limits to prevent DoS
const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_RECORDS = 10_000;

function parseCSV(text: string): Record<string, string>[] {
  // Remove BOM
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];

  // SEC: Limite por linha para prevenir DoS via linha única gigante.
  // Um CSV com uma linha de 10MB e vírgulas a cada byte geraria 10M colunas.
  const MAX_LINE_BYTES = 100_000; // 100KB por linha é mais que suficiente para dados de dispositivos

  const delimiter = lines[0].includes(';') ? ';' : ',';

  const parseRow = (line: string): string[] => {
    // SEC: Rejeita linhas excessivamente longas antes de processar
    if (line.length > MAX_LINE_BYTES) {
      console.warn(`CSV line truncated (${line.length} chars > ${MAX_LINE_BYTES} limit)`)
      line = line.slice(0, MAX_LINE_BYTES)
    }
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    if (values.length < 2) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

function toBool(val: string | boolean | undefined, def = false): boolean {
  if (typeof val === 'boolean') return val;
  if (!val) return def;
  const v = String(val).toLowerCase().trim();
  return v === 'true' || v === 'sim' || v === '1' || v === 'yes';
}

// SEC: Trunca string a um máximo seguro para prevenir inserção de campos gigantes no DB.
// Um CSV malicioso com campos de 10MB cada poderia saturar o banco mesmo passando no limite de 10MB do body.
function t(s: string, max: number): string {
  return typeof s === 'string' ? s.trim().slice(0, max) : '';
}

function mapCSVRow(r: Record<string, string>) {
  // Support both old and new CSV column names
  const model = r['Model'] || r['model'] || r['devices/model'] || '';
  const internalCode = r['Internal_Code'] || r['internal_code'] || r['devices/internal_code'] || '';
  const udiDi = r['Udi_Di'] || r['udi_di'] || r['devices/udi_di'] || '';
  const reference = r['reference'] || r['Reference'] || r['devices/reference'] || '';
  const exocad = r['Exocad'] || r['exocad'] || r['devices/software_compatibility/exocad'] || '';
  const anvisaReg = r['Register_Anvisa'] || r['anvisa_registration'] || r['devices/anvisa_registration'] || '';
  const primaryMaterial = r['Primary_Material'] || r['primary_material'] || r['devices/composition/primary_material'] || '';
  const classCode = r['Classification_Code'] || r['classification_code'] || r['devices/technical_information/classification_code'] || 'III';
  const brandName = r['Brand_Name'] || r['brand_name'] || r['devices/brand_name'] || '';
  const country = r['Manufacturer_Country'] || r['manufacturer_country'] || r['devices/manufacturer_country'] || '';
  const gmdn = r['Gmdn'] || r['gmdn'] || '';
  const singleUse = r['Labeled As A Single-Use Device?'] || r['single_use'] || r['devices/technical_information/single_use'] || '';
  const sterile = r['Labeled As A Sterile Device?'] || r['sterile'] || r['devices/technical_information/sterile'] || '';
  const category = r['Medical Device Category'] || '';

  return {
    udi_di: t(udiDi, 200),
    reference: t(reference, 200),
    model: t(model, 300),
    internal_code: t(internalCode, 100),
    anvisa_registration: t(anvisaReg, 100),
    brand_name: t(brandName, 200),
    primary_material: t(primaryMaterial, 200),
    classification_code: t(classCode, 50),
    risk_class: t(classCode, 10),
    sterile: toBool(sterile),
    single_use: toBool(singleUse),
    implantable: true,
    intended_use: t(gmdn || 'Componente protético para implante dentário', 1000),
    body_region: t(category || 'Oral', 200),
    compatible_systems: [],
    manufacturer_country: t(country, 100),
    exocad_compatibility: t(exocad, 200),
  };
}

function mapJSONDevice(d: any) {
  return {
    udi_di:               t(d.udi_di || "", 200),
    reference:            t(d.reference || "", 200),
    model:                t(d.model || "", 300),
    internal_code:        t(d.internal_code || "", 100),
    anvisa_registration:  t(d.anvisa_registration || "", 100),
    brand_name:           t(d.brand_name || "", 200),
    primary_material:     t(d.composition?.primary_material || "", 200),
    classification_code:  t(d.technical_information?.classification_code || "", 50),
    risk_class:           t(d.technical_information?.classification_code || "III", 10),
    sterile:              typeof d.technical_information?.sterile === "boolean" ? d.technical_information.sterile : false,
    single_use:           typeof d.technical_information?.single_use === "boolean" ? d.technical_information.single_use : false,
    implantable:          true,
    intended_use:         t(d.intended_use || "Componente protético para implante dentário", 1000),
    body_region:          t(d.body_region || "Oral", 200),
    compatible_systems:   [],
    manufacturer_country: t(d.manufacturer_country || "", 100),
    exocad_compatibility: t(d.software_compatibility?.exocad || "", 200),
  };
}

function mapAnvisaDevice(d: any) {
  const id  = (typeof d.identificacao_dispositivo === "object" && d.identificacao_dispositivo) ? d.identificacao_dispositivo : {};
  const fab = (typeof d.fabricante === "object" && d.fabricante) ? d.fabricante : {};
  const car = (typeof d.caracteristicas_dispositivo === "object" && d.caracteristicas_dispositivo) ? d.caracteristicas_dispositivo : {};

  return {
    udi_di:               t(id.udi_di || "", 200),
    reference:            t(id.referencia || "", 200),
    model:                t(id.modelo || "", 300),
    internal_code:        t(id.codigo_interno || "", 100),
    anvisa_registration:  t(id.numero_registro_anvisa || "", 100),
    brand_name:           t(id.nome_marca || "", 200),
    primary_material:     t(car.material_primario || "", 200),
    classification_code:  t(id.codigo_gmdn || id.codigo_classificacao || "III", 50),
    risk_class:           t(id.codigo_classificacao || "III", 10),
    sterile:              car.esteril === true,
    single_use:           car.uso_unico === true,
    implantable:          true,
    intended_use:         t(id.codigo_gmdn || "Componente protético para implante dentário", 1000),
    body_region:          "Oral",
    compatible_systems:   [],
    manufacturer_country: t(fab.pais_fabricante || "", 100),
    exocad_compatibility: t(id.exocad || "", 200),
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC: Rejeita métodos diferentes de POST explicitamente
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      console.error("Missing required environment variables");
      return new Response(JSON.stringify({ error: "Erro de configuração do servidor" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SEC: Lê o body com limite real de bytes — não confiar apenas no content-length header,
    // pois ele pode ser omitido ou falsificado por um atacante.
    // Lemos como ArrayBuffer e verificamos o tamanho ANTES de fazer JSON.parse.
    const rawBuffer = await req.arrayBuffer();
    if (rawBuffer.byteLength > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ error: `Arquivo muito grande. Limite: ${MAX_BODY_BYTES / 1024 / 1024}MB` }), {
        status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const rawText = new TextDecoder().decode(rawBuffer);

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Token inválido" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: roleData } = await adminClient
      .from("user_roles").select("role").eq("user_id", user.id).maybeSingle();

    if (roleData?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Apenas administradores" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse o JSON do buffer já lido (rawText) — não chamar req.json() que releria o body
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawText);
    } catch {
      return new Response(JSON.stringify({ error: "Corpo da requisição inválido (JSON malformado)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let mapped: unknown[] = [];

    if (body.csv && typeof body.csv === 'string') {
      const rows = parseCSV(body.csv);
      mapped = rows.map(mapCSVRow).filter(d => d.udi_di);
    } else if (Array.isArray(body.dispositivos_medicos) && body.dispositivos_medicos.length > 0) {
      mapped = body.dispositivos_medicos.map(mapAnvisaDevice).filter((d: any) => d.udi_di);
    } else if (Array.isArray(body.devices) && body.devices.length > 0) {
      mapped = body.devices.map(mapJSONDevice).filter((d: any) => d.udi_di);
    } else {
      return new Response(JSON.stringify({ error: "Envie 'csv', 'devices' ou 'dispositivos_medicos'" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Make udi_di unique - if duplicates exist, append internal_code
    const seen = new Map<string, number>();
    for (const d of mapped) {
      const count = seen.get(d.udi_di) || 0;
      if (count > 0) {
        d.udi_di = `${d.udi_di}-${d.internal_code || count}`;
      }
      seen.set(d.udi_di, count + 1);
    }
    // Final dedup safety
    const deduped = new Map<string, any>();
    for (const d of mapped) {
      deduped.set(d.udi_di, d);
    }
    mapped = Array.from(deduped.values());

    if (mapped.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum dispositivo encontrado nos dados" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // VULN-007 FIX: Limit maximum records per import to prevent DoS
    if (mapped.length > MAX_RECORDS) {
      return new Response(JSON.stringify({ error: `Muitos registros. Limite: ${MAX_RECORDS} por importação` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // OPS-003 FIX: replace_all requires explicit confirmation token to prevent accidental mass deletion
    if (body.replace_all === true) {
      if (body.confirm_replace !== "CONFIRMAR_SUBSTITUICAO") {
        return new Response(JSON.stringify({
          error: "Para substituir todos os dispositivos, inclua confirm_replace: 'CONFIRMAR_SUBSTITUICAO' no corpo da requisição"
        }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await adminClient.from("devices").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    }

    const BATCH = 500;
    let inserted = 0;
    let skipped = 0;

    for (let i = 0; i < mapped.length; i += BATCH) {
      const batch = mapped.slice(i, i + BATCH);
      const { error } = await adminClient
        .from("devices")
        .upsert(batch, { onConflict: "udi_di", ignoreDuplicates: false })
        .select("id");

      if (error) {
        console.error(`Batch ${i} error:`, error);
        skipped += batch.length;
      } else {
        inserted += batch.length;
      }
    }

    return new Response(JSON.stringify({ success: true, inserted, skipped, total: mapped.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("import-devices error:", err);
    return new Response(JSON.stringify({ error: "Erro interno na importação." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
