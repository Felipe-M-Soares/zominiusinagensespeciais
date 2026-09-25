import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { log } from "../_shared/log.ts";

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_RECORDS = 10_000;

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCSV(text: string): Record<string, string>[] {
  // Remove BOM
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];

  const MAX_LINE_BYTES = 100_000;
  const delimiter = lines[0].includes(";") ? ";" : ",";

  const parseRow = (line: string): string[] => {
    if (line.length > MAX_LINE_BYTES) line = line.slice(0, MAX_LINE_BYTES);
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  // Normaliza header: remove acentos, lowercase, sem espaços/hifens → underscore
  // Ex: "Região do Corpo" → "regiao_do_corpo", "Titânio" → "titanio"
  const normalizeHeader = (h: string): string =>
    h.trim()
      .replace(/^["']|["']$/g, "")
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove diacritics (acentos)
      .toLowerCase()
      .replace(/[\s-]+/g, "_")          // espaço/hífen → underscore
      .replace(/[^a-z0-9_]/g, "");     // remove caracteres especiais restantes

  const rawHeaders = parseRow(lines[0]);
  const headers = rawHeaders.map(h => h.trim().replace(/^["']|["']$/g, "").trim());
  const normalizedHeaders = headers.map(normalizeHeader);

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    if (values.length < 2) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      const v = (values[idx] ?? "").replace(/^["']|["']$/g, "").trim();
      const norm = normalizedHeaders[idx];
      // Armazena com a chave original, lowercase, uppercase, normalizada e sem underscores
      row[h] = v;
      row[h.toLowerCase()] = v;
      row[h.toUpperCase()] = v;
      row[norm] = v;                              // ex: "regiao_do_corpo"
      row[norm.replace(/_/g, "")] = v;           // ex: "regiaodocorpo"
      row[h.replace(/_/g, "").toLowerCase()] = v;
    });
    rows.push(row);
  }
  return rows;
}

function toBool(val: string | boolean | undefined, def = false): boolean {
  if (typeof val === "boolean") return val;
  if (!val) return def;
  const v = String(val).toLowerCase().trim();
  return v === "true" || v === "sim" || v === "1" || v === "yes" || v === "s";
}

function t(s: unknown, max: number): string {
  return typeof s === "string" ? s.trim().slice(0, max) : "";
}

/**
 * Lookup flexível de campo no CSV.
 * FIX ACENTO/MAIÚSCULA: normaliza cada chave removendo acentos antes de comparar.
 * Ex: "Região" → "regiao", "Titânio" → "titanio"
 */
function normalizeKey(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function g(r: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const norm = normalizeKey(k);
    const tries = [k, k.toLowerCase(), k.toUpperCase(), k.replace(/_/g, "").toLowerCase(), norm, norm.replace(/_/g, "")];
    for (const t of tries) {
      if (r[t] !== undefined && r[t] !== "") return r[t];
    }
  }
  return "";
}

function mapCSVRow(r: Record<string, string>) {
  // UDI-DI: múltiplas variações comuns em exportações ANVISA e planilhas internas
  const udiDi = g(r,
    "udi_di", "Udi_Di", "UDI_DI", "UDI-DI", "udi-di", "UDIDI", "udidi",
    "udi di", "UDI DI", "devices/udi_di", "udi"
  );

  const reference = g(r,
    "reference", "Reference", "REFERENCE", "Referencia", "referencia",
    "REFERENCIA", "REF", "ref", "devices/reference"
  );

  const model = g(r,
    "model", "Model", "MODEL", "Modelo", "modelo", "MODELO",
    "devices/model", "nome"
  );

  const internalCode = g(r,
    "internal_code", "Internal_Code", "INTERNAL_CODE", "InternalCode",
    "Codigo_Interno", "codigo_interno", "CODIGO_INTERNO", "codigo",
    "devices/internal_code"
  );

  const anvisaReg = g(r,
    "anvisa_registration", "Anvisa_Registration", "ANVISA_REGISTRATION",
    "Register_Anvisa", "registro_anvisa", "REGISTRO_ANVISA",
    "Anvisa", "anvisa", "ANVISA", "devices/anvisa_registration",
    "numero_registro"
  );

  const brandName = g(r,
    "brand_name", "Brand_Name", "BRAND_NAME", "BrandName",
    "Marca", "marca", "MARCA", "devices/brand_name"
  );

  const primaryMaterial = g(r,
    "primary_material", "Primary_Material", "PRIMARY_MATERIAL", "PrimaryMaterial",
    "Material_Principal", "material_principal", "MATERIAL_PRINCIPAL",
    "Material", "material", "MATERIAL", "devices/composition/primary_material"
  );

  const classCode = g(r,
    "classification_code", "Classification_Code", "CLASSIFICATION_CODE", "ClassificationCode",
    "Codigo_Classificacao", "codigo_classificacao", "CODIGO_CLASSIFICACAO",
    "devices/technical_information/classification_code", "classe", "Classe"
  ) || "III";

  const country = g(r,
    "manufacturer_country", "Manufacturer_Country", "MANUFACTURER_COUNTRY",
    "ManufacturerCountry", "Pais_Fabricante", "pais_fabricante", "PAIS_FABRICANTE",
    "Pais", "pais", "PAIS", "devices/manufacturer_country", "country"
  );

  const exocad = g(r,
    "exocad_compatibility", "Exocad_Compatibility", "EXOCAD_COMPATIBILITY",
    "Exocad", "exocad", "EXOCAD",
    "devices/software_compatibility/exocad", "software_compatibility"
  );

  const intendedUse = g(r,
    "intended_use", "Intended_Use", "INTENDED_USE", "IntendedUse",
    "uso_pretendido", "Uso_Pretendido", "gmdn", "GMDN", "Gmdn",
    "descricao", "description"
  );

  const bodyRegion = g(r,
    "body_region", "Body_Region", "BODY_REGION", "BodyRegion",
    "regiao_corpo", "Regiao_Corpo", "category", "Category",
    "Medical Device Category", "categoria", "Categoria"
  );

  const singleUse = g(r,
    "single_use", "Single_Use", "SINGLE_USE", "SingleUse",
    "uso_unico", "Uso_Unico",
    "Labeled As A Single-Use Device?", "single use", "uso único"
  );

  const sterile = g(r,
    "sterile", "Sterile", "STERILE",
    "esteril", "Esteril", "ESTERIL",
    "Labeled As A Sterile Device?", "estéril"
  );

  return {
    udi_di:               t(udiDi, 200),
    reference:            t(reference || udiDi, 200), // fallback: usa udi_di como ref se não tiver
    model:                t(model, 300),
    internal_code:        t(internalCode, 100),
    anvisa_registration:  t(anvisaReg, 100),
    brand_name:           t(brandName, 200),
    primary_material:     t(primaryMaterial, 200),
    classification_code:  t(classCode, 50),
    risk_class:           t(classCode, 10),
    sterile:              toBool(sterile),
    single_use:           toBool(singleUse),
    implantable:          true,
    intended_use:         t(intendedUse || "Componente protético para implante dentário", 1000),
    body_region:          t(bodyRegion || "Oral", 200),
    compatible_systems:   [],
    manufacturer_country: t(country, 100),
    exocad_compatibility: t(exocad, 200),
  };
}

function mapJSONDevice(d: Record<string, unknown>) {
  const tech = (typeof d.technical_information === "object" && d.technical_information) ? d.technical_information as Record<string, unknown> : {};
  const comp = (typeof d.composition === "object" && d.composition) ? d.composition as Record<string, unknown> : {};
  const compat = (typeof d.software_compatibility === "object" && d.software_compatibility) ? d.software_compatibility as Record<string, unknown> : {};
  return {
    udi_di:               t(d.udi_di || "", 200),
    reference:            t(d.reference || d.udi_di || "", 200),
    model:                t(d.model || "", 300),
    internal_code:        t(d.internal_code || "", 100),
    anvisa_registration:  t(d.anvisa_registration || "", 100),
    brand_name:           t(d.brand_name || "", 200),
    primary_material:     t(comp.primary_material || d.primary_material || "", 200),
    classification_code:  t(tech.classification_code || d.classification_code || "", 50),
    risk_class:           t(tech.classification_code || d.risk_class || "III", 10),
    sterile:              typeof tech.sterile === "boolean" ? tech.sterile : toBool(d.sterile as string | boolean | undefined),
    single_use:           typeof tech.single_use === "boolean" ? tech.single_use : toBool(d.single_use as string | boolean | undefined),
    implantable:          true,
    intended_use:         t(d.intended_use || "Componente protético para implante dentário", 1000),
    body_region:          t(d.body_region || "Oral", 200),
    compatible_systems:   [],
    manufacturer_country: t(d.manufacturer_country || "", 100),
    exocad_compatibility: t(compat.exocad || d.exocad_compatibility || "", 200),
  };
}

function mapAnvisaDevice(d: Record<string, unknown>) {
  const id  = (typeof d.identificacao_dispositivo === "object" && d.identificacao_dispositivo) ? d.identificacao_dispositivo as Record<string, unknown> : {};
  const fab = (typeof d.fabricante === "object" && d.fabricante) ? d.fabricante as Record<string, unknown> : {};
  const car = (typeof d.caracteristicas_dispositivo === "object" && d.caracteristicas_dispositivo) ? d.caracteristicas_dispositivo as Record<string, unknown> : {};

  return {
    udi_di:               t(id.udi_di || "", 200),
    reference:            t(id.referencia || id.udi_di || "", 200),
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

// ─── main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Erro de configuração do servidor" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Lê body com limite de tamanho real
    const rawBuffer = await req.arrayBuffer();
    if (rawBuffer.byteLength > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ error: `Arquivo muito grande. Limite: ${MAX_BODY_BYTES / 1024 / 1024}MB` }), {
        status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const rawText = new TextDecoder().decode(rawBuffer);

    // CORREÇÃO JWT: padrão oficial Supabase para Edge Functions.
    // Passa o Authorization header no global.headers ao criar o cliente.
    // getUser() SEM argumento lê do header — forma mais confiável.
    const token = authHeader.replace("Bearer ", "").trim();
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      // Loga o erro real para debug no Supabase Dashboard → Edge Functions → Logs
      log.error("import-devices", "JWT validation failed:", userError?.message ?? "no user returned");
      return new Response(JSON.stringify({ error: "Sessão expirada ou inválida. Faça login novamente." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: roleData } = await adminClient
      .from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
    if (roleData?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Apenas administradores podem importar dispositivos" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse body JSON
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawText);
    } catch {
      return new Response(JSON.stringify({ error: "Corpo da requisição inválido (JSON malformado)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Mapeamento de dados ──────────────────────────────────────────────────
    let mapped: ReturnType<typeof mapCSVRow>[] = [];

    if (body.csv && typeof body.csv === "string") {
      const rows = parseCSV(body.csv);

      if (rows.length === 0) {
        return new Response(JSON.stringify({ error: "CSV vazio ou sem linhas de dados." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Log das colunas detectadas para debug
      const detectedCols = Object.keys(rows[0])
        .filter(k => k === k.trim() && k.length > 0)
        .filter((v, i, a) => a.indexOf(v) === i) // dedup
        .slice(0, 20);
      log.info("import-devices", "CSV columns detected:", detectedCols.join(" | "));

      const allMapped = rows.map(mapCSVRow);
      mapped = allMapped.filter(d => d.udi_di && d.udi_di.length > 0);

      if (mapped.length === 0 && rows.length > 0) {
        // Mostra as colunas reais para ajudar o usuário a diagnosticar
        const realCols = Object.keys(rows[0])
          .filter(k => !k.match(/^[A-Z_]+$/)) // remove as versões uppercase duplicadas do lookup
          .slice(0, 15)
          .join(", ");
        return new Response(JSON.stringify({
          error: `Nenhum registro com UDI-DI encontrado. Colunas detectadas: [${realCols}]. ` +
            `Certifique-se que existe uma coluna chamada "udi_di", "Udi_Di", "UDI-DI" ou similar.`
        }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

    } else if (Array.isArray(body.dispositivos_medicos) && body.dispositivos_medicos.length > 0) {
      mapped = (body.dispositivos_medicos as Record<string, unknown>[]).map(mapAnvisaDevice).filter(d => d.udi_di);
    } else if (Array.isArray(body.devices) && body.devices.length > 0) {
      mapped = (body.devices as Record<string, unknown>[]).map(mapJSONDevice).filter(d => d.udi_di);
    } else {
      return new Response(JSON.stringify({ error: "Envie 'csv', 'devices' ou 'dispositivos_medicos'" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mapped.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum dispositivo válido encontrado nos dados." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mapped.length > MAX_RECORDS) {
      return new Response(JSON.stringify({ error: `Muitos registros. Limite: ${MAX_RECORDS} por importação` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Deduplicação ─────────────────────────────────────────────────────────
    // Se UDI-DIs repetidos, sufixar com internal_code ou índice ordinal.
    // FIX BUG: a versão anterior mutava d.udi_di antes de incrementar o contador
    // da chave original, fazendo o contador original sempre ficar em 1.
    // Para uma 3ª ocorrência: seen.get(original)=1, count=1, sufixo="-1",
    // colide com a 2ª ocorrência. Agora salvamos a chave original antes de mutá-la.
    const seen = new Map<string, number>();
    for (const d of mapped) {
      const originalKey = d.udi_di;
      const count = seen.get(originalKey) ?? 0;
      seen.set(originalKey, count + 1); // incrementa o contador ANTES de mutar
      if (count > 0) {
        d.udi_di = `${originalKey}-${d.internal_code || count}`;
      }
    }
    // Dedup final por mapa
    const deduped = new Map<string, typeof mapped[0]>();
    for (const d of mapped) deduped.set(d.udi_di, d);
    const finalMapped = Array.from(deduped.values());

    // ── Substituição total opcional ──────────────────────────────────────────
    if (body.replace_all === true) {
      if (body.confirm_replace !== "CONFIRMAR_SUBSTITUICAO") {
        return new Response(JSON.stringify({
          error: "Para substituir todos os dispositivos, inclua confirm_replace: 'CONFIRMAR_SUBSTITUICAO'"
        }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // SEGURANÇA: deleta em lotes para evitar timeout e registra quantos foram removidos.
      // Se o delete falhar, abortamos ANTES de apagar — evita catálogo vazio acidental.
      const { error: deleteError } = await adminClient
        .from("devices")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");

      if (deleteError) {
        log.error("import-devices", "replace_all delete error:", deleteError.message);
        return new Response(JSON.stringify({
          error: "Erro ao limpar catálogo antes da importação: " + deleteError.message
        }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── Upsert em batches ────────────────────────────────────────────────────
    // FIX: se replace_all=true e algum batch falhar, abortamos e retornamos erro.
    // Continuando após falha com replace_all poderíamos deixar o catálogo parcialmente vazio.
    const BATCH = 500;
    let inserted = 0;
    let skipped = 0;
    const wasReplaceAll = body.replace_all === true;

    for (let i = 0; i < finalMapped.length; i += BATCH) {
      const batch = finalMapped.slice(i, i + BATCH);
      const { error } = await adminClient
        .from("devices")
        .upsert(batch, { onConflict: "udi_di", ignoreDuplicates: false });

      if (error) {
        log.error("import-devices", `Batch ${i / BATCH + 1} error:`, error.message);
        if (wasReplaceAll) {
          // Catálogo já foi deletado e a importação falhou — informa claramente
          return new Response(JSON.stringify({
            error: `Falha no batch ${i / BATCH + 1}. O catálogo pode estar incompleto. Reimporte novamente. Detalhe: ${error.message}`
          }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        skipped += batch.length;
      } else {
        inserted += batch.length;
      }
    }

    return new Response(JSON.stringify({ success: true, inserted, skipped, total: finalMapped.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("import-devices", "import-devices error:", msg);
    return new Response(JSON.stringify({ error: "Erro interno na importação. Verifique o arquivo e tente novamente." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
