import { supabase } from "@/integrations/supabase/client";

// ─── NCM auto-suggest ─────────────────────────────────────────────────────────
// Tabela TIPI simplificada para dispositivos médico-odontológicos.
// Complementa o trigger do banco com lógica client-side baseada no nome/ref.
const NCM_RULES: { pattern: RegExp; ncm: string; desc: string; ipi: number }[] = [
  // Implantes e fixadores
  { pattern: /implant|fixture|parafus.*titan|screw.*impl/i,    ncm: "90212910", desc: "Implante dental / parafuso", ipi: 0 },
  // Pilares e próteses
  { pattern: /pilar|abutment|pr[oó]tese|coroa|crown/i,         ncm: "90213990", desc: "Prótese / componente protético", ipi: 0 },
  // Instrumentos / brocas / fresas
  { pattern: /broca|fresa|drill|bur|instrumen|tool|kit\s/i,    ncm: "90184990", desc: "Instrumento odontológico", ipi: 0 },
  // Componentes de conexão / transfer / análogo
  { pattern: /transfer|analog|análog|captur|impression/i,      ncm: "90213990", desc: "Componente de moldagem/transferência", ipi: 0 },
  // Torquímetro / chaves
  { pattern: /torqu|chave|ratchet|wrench|driver/i,             ncm: "90183990", desc: "Instrumento cirúrgico/odontológico", ipi: 0 },
  // Membranas / enxertos
  { pattern: /membran|enxert|graft|colog[eê]n|collagen/i,      ncm: "30059099", desc: "Material de enxerto / membrana", ipi: 0 },
  // Biomateriais / osso sintético
  { pattern: /biomateri|osso|bone|oss[eé]o|xeno|alo|allogen/i, ncm: "30059099", desc: "Biomaterial / substituto ósseo", ipi: 0 },
  // Parafusos em geral (não implante)
  { pattern: /parafuso|screw/i,                                 ncm: "90213990", desc: "Parafuso protético", ipi: 0 },
  // Cicatrizadores / caps / cover
  { pattern: /cicatriz|healing|cover\s*screw|tap|tampa/i,      ncm: "90213990", desc: "Cicatrizador / cap", ipi: 0 },
  // Componentes de munhão / UCLA
  { pattern: /ucla|munhão|munhao|calcinável|calcinable/i,       ncm: "90213990", desc: "Componente UCLA / calcinável", ipi: 0 },
];

export async function sugerirNcmParaPeca(deviceId: string, model: string, reference: string): Promise<{ ncm: string; desc: string; ipi: number } | null> {
  // 1. Tenta o RPC do banco (usa risk_class, implantable, body_region, classification_code)
  try {
    const { data } = await supabase.rpc("resolve_ncm_device_by_id", { p_device_id: deviceId });
    if (data && typeof data === "string" && data.length >= 8) {
      return { ncm: data.replace(/\./g, ""), desc: "Sugerido pelo banco (classificação)", ipi: 0 };
    }
  } catch (_) { /* fallback para client-side */ }

  // 2. Client-side por palavras-chave no nome + referência
  const texto = `${model} ${reference}`;
  for (const rule of NCM_RULES) {
    if (rule.pattern.test(texto)) {
      return { ncm: rule.ncm, desc: rule.desc, ipi: rule.ipi };
    }
  }
  return null;
}
