import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// VULN-005 FIX: Use consistent domain across all edge functions
const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "https://conceptusinagensespeciais-lac.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// VULN-007: Limits to prevent DoS
const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_RECORDS = 10_000;

function parseCSV(text: string): Record<string, string>[] {
  // Remove BOM
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes(';') ? ';' : ',';

  const parseRow = (line: string): string[] => {
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
  const mriSafe = r['Is The Device Safe In An Mri Environment?'] || '';
  const sterilizationMethod = r['Sterilization Method'] || '';
  const category = r['Medical Device Category'] || '';
  const sac = r["Information From The Manufacturer'S Consumer Service Department (As Indicated On The Label)"] || r['Information From The Manufacturer\'S Consumer Service Department (As Indicated On The Label)'] || '';

  return {
    udi_di: udiDi,
    reference: reference,
    model: model,
    internal_code: internalCode,
    anvisa_registration: anvisaReg,
    brand_name: brandName,
    primary_material: primaryMaterial,
    classification_code: classCode,
    risk_class: classCode,
    sterile: toBool(sterile),
    single_use: toBool(singleUse),
    implantable: true,
    intended_use: gmdn || 'Componente protético para implante dentário',
    body_region: category || 'Oral',
    compatible_systems: [],
    manufacturer_country: country,
    exocad_compatibility: exocad,
  };
}

function mapJSONDevice(d: any) {
  return {
    udi_di: d.udi_di || "",
    reference: d.reference || "",
    model: d.model || "",
    internal_code: d.internal_code || "",
    anvisa_registration: d.anvisa_registration || "",
    brand_name: d.brand_name || "",
    primary_material: d.composition?.primary_material || "",
    classification_code: d.technical_information?.classification_code || "",
    risk_class: d.technical_information?.classification_code || "III",
    sterile: d.technical_information?.sterile ?? false,
    single_use: d.technical_information?.single_use ?? false,
    implantable: true,
    intended_use: d.intended_use || "Componente protético para implante dentário",
    body_region: d.body_region || "Oral",
    compatible_systems: d.software_compatibility ? [d.software_compatibility] : [],
    manufacturer_country: d.manufacturer_country || "",
    exocad_compatibility: d.software_compatibility?.exocad || "",
  };
}

function mapAnvisaDevice(d: any) {
  const id = d.identificacao_dispositivo || {};
  const fab = d.fabricante || {};
  const car = d.caracteristicas_dispositivo || {};

  return {
    udi_di: id.udi_di || "",
    reference: id.referencia || "",
    model: id.modelo || "",
    internal_code: id.codigo_interno || "",
    anvisa_registration: id.numero_registro_anvisa || "",
    brand_name: id.nome_marca || "",
    primary_material: car.material_primario || "",
    classification_code: id.codigo_gmdn || id.codigo_classificacao || "III",
    risk_class: id.codigo_classificacao || "III",
    sterile: car.esteril ?? false,
    single_use: car.uso_unico ?? false,
    implantable: true,
    intended_use: id.codigo_gmdn || "Componente protético para implante dentário",
    body_region: "Oral",
    compatible_systems: [],
    manufacturer_country: fab.pais_fabricante || "",
    exocad_compatibility: id.exocad || "",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // CODE-006 FIX: Validate env vars early with informative error
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      console.error("Missing required environment variables");
      return new Response(JSON.stringify({ error: "Erro de configuração do servidor" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // VULN-007 FIX: Enforce maximum body size to prevent DoS/OOM attacks
    const contentLength = req.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ error: `Arquivo muito grande. Limite: ${MAX_BODY_BYTES / 1024 / 1024}MB` }), {
        status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const body = await req.json();
    let mapped: any[] = [];

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
