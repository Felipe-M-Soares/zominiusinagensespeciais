/**
 * Consultas públicas brasileiras (CEP e CNPJ) com fallback.
 *
 * - CEP:  BrasilAPI v2 (agrega Correios/ViaCEP/WideNet) → fallback ViaCEP.
 * - CNPJ: BrasilAPI (dados da Receita Federal) — preenche razão social,
 *         endereço, telefone e e-mail no cadastro de cliente.
 *
 * Ambas são gratuitas e não exigem chave. Timeout curto para não travar o
 * formulário se o serviço estiver lento; qualquer falha devolve null e o
 * usuário continua preenchendo manualmente.
 */

export interface EnderecoCep {
  cep: string;
  logradouro: string;
  bairro: string;
  municipio: string;
  uf: string;
}

export interface DadosCnpj extends Partial<EnderecoCep> {
  razaoSocial: string;
  nomeFantasia?: string;
  numero?: string;
  complemento?: string;
  telefone?: string;
  email?: string;
  situacao?: string;
}

const TIMEOUT_MS = 6000;

async function fetchJson<T>(url: string): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function somenteDigitos(v: string): string {
  return (v ?? "").replace(/\D/g, "");
}

/** Formata CPF (11) ou CNPJ (14) progressivamente enquanto o usuário digita. */
export function formatarDocumento(v: string): string {
  const d = somenteDigitos(v).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
  }
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

/** Formata telefone BR: (11) 91234-5678 / (11) 1234-5678. */
export function formatarTelefone(v: string): string {
  const d = somenteDigitos(v).slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export async function buscarCep(cep: string): Promise<EnderecoCep | null> {
  const c = somenteDigitos(cep);
  if (c.length !== 8) return null;

  type BrasilApiCep = { cep: string; street?: string; neighborhood?: string; city?: string; state?: string };
  const b = await fetchJson<BrasilApiCep>(`https://brasilapi.com.br/api/cep/v2/${c}`);
  if (b?.city) {
    return {
      cep: c,
      logradouro: b.street ?? "",
      bairro: b.neighborhood ?? "",
      municipio: b.city ?? "",
      uf: b.state ?? "",
    };
  }

  type ViaCep = { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
  const v = await fetchJson<ViaCep>(`https://viacep.com.br/ws/${c}/json/`);
  if (v && !v.erro && v.localidade) {
    return {
      cep: c,
      logradouro: v.logradouro ?? "",
      bairro: v.bairro ?? "",
      municipio: v.localidade ?? "",
      uf: v.uf ?? "",
    };
  }
  return null;
}

export async function buscarCnpj(cnpj: string): Promise<DadosCnpj | null> {
  const c = somenteDigitos(cnpj);
  if (c.length !== 14) return null;

  type BrasilApiCnpj = {
    razao_social?: string;
    nome_fantasia?: string;
    cep?: string;
    logradouro?: string;
    descricao_tipo_de_logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    municipio?: string;
    uf?: string;
    ddd_telefone_1?: string;
    email?: string | null;
    descricao_situacao_cadastral?: string;
  };
  const r = await fetchJson<BrasilApiCnpj>(`https://brasilapi.com.br/api/cnpj/v1/${c}`);
  if (!r?.razao_social) return null;

  const tipo = (r.descricao_tipo_de_logradouro ?? "").trim();
  const logr = (r.logradouro ?? "").trim();
  // "CAXIAS DO SUL" → "Caxias do Sul" (preposições ficam minúsculas).
  const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e", "d'"]);
  const titleCase = (s: string) =>
    s.toLowerCase().split(/\s+/).filter(Boolean)
      .map((w, i) => (i > 0 && MINUSCULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(" ");

  return {
    razaoSocial: r.razao_social,
    nomeFantasia: r.nome_fantasia || undefined,
    cep: somenteDigitos(r.cep ?? ""),
    logradouro: titleCase([tipo, logr].filter(Boolean).join(" ")),
    numero: r.numero ?? "",
    complemento: r.complemento ?? "",
    bairro: titleCase(r.bairro ?? ""),
    municipio: titleCase(r.municipio ?? ""),
    uf: (r.uf ?? "").toUpperCase(),
    telefone: r.ddd_telefone_1 ? formatarTelefone(r.ddd_telefone_1) : undefined,
    email: r.email ? r.email.toLowerCase() : undefined,
    situacao: r.descricao_situacao_cadastral,
  };
}
