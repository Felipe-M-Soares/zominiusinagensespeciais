/**
 * supabase/functions/sefaz-emitir-devolucao/index.ts
 *
 * Edge Function — Emissão de NF-e de Devolução de Mercadoria / Troca
 * Mesma infraestrutura de assinatura/transmissão de supabase/functions/sefaz-emitir
 * (Web Crypto API nativa do Deno, RSA-SHA1 conforme SEFAZ), adaptada para:
 *   - tpNF configurável (0=entrada — devolução recebida do cliente,
 *                        1=saída  — envio da mercadoria de troca)
 *   - bloco <NFref><refNFe> referenciando a chave de acesso da NF-e original
 *     (obrigatório para o SEFAZ associar a devolução/troca à venda anterior)
 *
 * Deploy:
 *   supabase functions deploy sefaz-emitir-devolucao
 *
 * Usa os MESMOS secrets já configurados para sefaz-emitir (certificado A1,
 * CNPJ, endereço do emitente etc.) — não precisa configurar nada de novo.
 */

import { getCorsHeaders } from "../_shared/cors.ts";
import { log } from "../_shared/log.ts";

// ─── Tipos ─────────────────────────────────────────────────────────────────

interface ItemFiscal {
  itemId: string;
  descricao: string;
  ncm: string;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnitario: string;
  aliqICMS: string;
  cst: string;
}

interface DadosFiscaisDevolucao {
  tipoNota: "nfe" | "nfce";
  tipoOperacao: "devolucao" | "troca";
  tpNF: "0" | "1"; // 0=entrada 1=saída
  numero: string;
  serie: string;
  naturezaOperacao: string;
  refNFe: string; // chave de acesso (44 dígitos) da NF-e original — pode vir vazia em nota avulsa sem referência
  destDocumento: string;
  destNome: string;
  destEmail: string;
  destEndereco: string;
  itens: ItemFiscal[];
  valorFrete: string;
  modFrete: string;
  informacoesAdicionais: string;
}

interface Payload {
  registroId: string;
  dadosFiscais: DadosFiscaisDevolucao;
}

// ─── Configuração via Env (mesma do sefaz-emitir) ──────────────────────────

function getConfig() {
  const e = (k: string, d = "") => Deno.env.get(k) ?? d;
  return {
    tpAmb:       parseInt(e("SEFAZ_TP_AMB", "2")),
    versao:      "4.00",
    cnpj:        e("SEFAZ_CNPJ").replace(/\D/g, ""),
    razaoSocial: e("SEFAZ_RAZAO_SOCIAL"),
    ie:          e("SEFAZ_IE"),
    crt:         parseInt(e("SEFAZ_CRT", "1")),
    uf:          e("SEFAZ_UF", "SP"),
    cMun:        e("SEFAZ_C_MUN", "3550308"),
    municipio:   e("SEFAZ_MUNICIPIO", "SAO PAULO"),
    logradouro:  e("SEFAZ_LOGRADOURO"),
    numero:      e("SEFAZ_NUMERO"),
    bairro:      e("SEFAZ_BAIRRO"),
    cep:         e("SEFAZ_CEP").replace(/\D/g, ""),
    pfxB64:      e("SEFAZ_PFX_BASE64"),
    pfxSenha:    e("SEFAZ_PFX_SENHA"),
    debug:       e("DEBUG") === "true",
  };
}
type Cfg = ReturnType<typeof getConfig>;

const CUF: Record<string, string> = {
  AC:"12",AL:"27",AP:"16",AM:"13",BA:"29",CE:"23",DF:"53",ES:"32",
  GO:"52",MA:"21",MT:"51",MS:"50",MG:"31",PA:"15",PB:"25",PR:"41",
  PE:"26",PI:"22",RJ:"33",RN:"24",RS:"43",RO:"11",RR:"14",SC:"42",
  SP:"35",SE:"28",TO:"17",
};

function wsUrl(uf: string, tipo: "nfe" | "nfce", tpAmb: number): string {
  const isHom = tpAmb === 2;
  const map: Record<string, Record<string, [string, string]>> = {
    SP: {
      nfe:  ["https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx",
             "https://nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx"],
      nfce: ["https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx",
             "https://nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx"],
    },
    MG: {
      nfe:  ["https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4",
             "https://nfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4"],
      nfce: ["https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4",
             "https://nfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4"],
    },
    RS: {
      nfe:  ["https://homologacao.sefaz.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
             "https://nfe.sefaz.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx"],
      nfce: ["https://homologacao.sefaz.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
             "https://nfe.sefaz.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx"],
    },
  };
  const pair = map[uf]?.[tipo] ?? [
    "https://hom.sefazvirtual.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx",
    "https://nfe.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx",
  ];
  return isHom ? pair[0] : pair[1];
}

// ─── Utilitários ──────────────────────────────────────────────────────────

function san(s: string, max = 60): string {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
    .replace(/[^\x20-\x7E]/g, "")
    .toUpperCase().slice(0, max);
}

function gerarCNF(): string {
  const arr = new Uint8Array(4);
  crypto.getRandomValues(arr);
  const n = new DataView(arr.buffer).getUint32(0);
  return (n % 99_999_999).toString().padStart(8, "0");
}

function calcDV(s: string): number {
  let soma = 0, peso = 2;
  for (let i = s.length - 1; i >= 0; i--) {
    soma += parseInt(s[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}

function gerarChave(c: Cfg, d: DadosFiscaisDevolucao): { chave: string; cNF: string } {
  const mod  = d.tipoNota === "nfce" ? "65" : "55";
  const cUF  = CUF[c.uf] ?? "35";
  const now  = new Date();
  const aamm = String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, "0");
  const cNF  = gerarCNF();
  const base = `${cUF}${aamm}${c.cnpj}${mod}${d.serie.padStart(3,"0")}${d.numero.padStart(9,"0")}1${cNF}`;
  return { chave: base + calcDV(base), cNF };
}

function dhEmi(): string {
  return new Date().toISOString().slice(0, 19) + "-03:00";
}

// ─── XML NF-e de devolução/troca ───────────────────────────────────────────

function buildXml(c: Cfg, d: DadosFiscaisDevolucao, chave: string, cNF: string): string {
  const mod     = d.tipoNota === "nfce" ? 65 : 55;
  const cUF     = CUF[c.uf] ?? "35";
  const vFrete  = parseFloat(d.valorFrete) || 0;
  const vProd   = d.itens.reduce((a, i) => a + i.quantidade * (parseFloat(i.valorUnitario) || 0), 0);
  const vNF     = vProd + vFrete;
  const vICMS   = d.itens.reduce((a, i) =>
    a + i.quantidade * (parseFloat(i.valorUnitario)||0) * ((parseFloat(i.aliqICMS)||0) / 100), 0);
  const vPIS    = vProd * 0.0065;
  const vCOFINS = vProd * 0.03;

  const docDest = d.destDocumento.replace(/\D/g, "");
  const destXml = d.destNome ? `<dest>${
    docDest.length === 11 ? `<CPF>${docDest}</CPF>` :
    docDest.length === 14 ? `<CNPJ>${docDest}</CNPJ>` : ""
  }<xNome>${san(d.destNome)}</xNome><indIEDest>9</indIEDest>${
    d.destEmail ? `<email>${d.destEmail.slice(0,60)}</email>` : ""
  }</dest>` : "";

  // Referência à NF-e original (devolução/troca) — exigido pelo SEFAZ para
  // associar esta nota à venda que está sendo devolvida/trocada.
  const refChave = (d.refNFe ?? "").replace(/\D/g, "");
  const nfRefXml = refChave.length === 44 ? `<NFref><refNFe>${refChave}</refNFe></NFref>` : "";

  const detXml = d.itens.map((item, idx) => {
    const vProdI = item.quantidade * (parseFloat(item.valorUnitario) || 0);
    const vICMSI = vProdI * ((parseFloat(item.aliqICMS)||0) / 100);
    return `<det nItem="${idx+1}"><prod><cProd>${item.itemId.slice(0,20)}</cProd><cEAN>SEM GTIN</cEAN><xProd>${san(item.descricao)}</xProd><NCM>${item.ncm.replace(/\D/g,"").slice(0,8).padStart(8,"0")}</NCM><CFOP>${item.cfop.replace(/\D/g,"").slice(0,4)}</CFOP><uCom>${san(item.unidade,6)}</uCom><qCom>${item.quantidade.toFixed(4)}</qCom><vUnCom>${(parseFloat(item.valorUnitario)||0).toFixed(10)}</vUnCom><vProd>${vProdI.toFixed(2)}</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>${san(item.unidade,6)}</uTrib><qTrib>${item.quantidade.toFixed(4)}</qTrib><vUnTrib>${(parseFloat(item.valorUnitario)||0).toFixed(10)}</vUnTrib><indTot>1</indTot></prod><imposto><ICMS><ICMS00><orig>0</orig><CST>${item.cst}</CST><modBC>3</modBC><vBC>${vProdI.toFixed(2)}</vBC><pICMS>${(parseFloat(item.aliqICMS)||0).toFixed(2)}</pICMS><vICMS>${vICMSI.toFixed(2)}</vICMS></ICMS00></ICMS><PIS><PISAliq><CST>01</CST><vBC>${vProdI.toFixed(2)}</vBC><pPIS>0.65</pPIS><vPIS>${(vProdI*0.0065).toFixed(2)}</vPIS></PISAliq></PIS><COFINS><COFINSAliq><CST>01</CST><vBC>${vProdI.toFixed(2)}</vBC><pCOFINS>3.00</pCOFINS><vCOFINS>${(vProdI*0.03).toFixed(2)}</vCOFINS></COFINSAliq></COFINS></imposto></det>`;
  }).join("");

  const tpNF = d.tpNF === "1" ? 1 : 0;
  const idDest = 1; // simplificação: operação interna (mesma abordagem do sefaz-emitir)

  return `<?xml version="1.0" encoding="UTF-8"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${chave}" versao="${c.versao}"><ide><cUF>${cUF}</cUF><cNF>${cNF}</cNF><natOp>${san(d.naturezaOperacao)}</natOp><mod>${mod}</mod><serie>${d.serie.padStart(3,"0")}</serie><nNF>${d.numero.padStart(9,"0")}</nNF><dhEmi>${dhEmi()}</dhEmi><tpNF>${tpNF}</tpNF><idDest>${idDest}</idDest><cMunFG>${c.cMun}</cMunFG><tpImp>${mod===65?4:1}</tpImp><tpEmis>1</tpEmis><cDV>${chave.slice(-1)}</cDV><tpAmb>${c.tpAmb}</tpAmb><finNFe>4</finNFe><indFinal>${mod===65?1:0}</indFinal><indPres>${mod===65?1:0}</indPres><procEmi>0</procEmi><verProc>1.0.0</verProc></ide><emit><CNPJ>${c.cnpj}</CNPJ><xNome>${san(c.razaoSocial)}</xNome><enderEmit><xLgr>${san(c.logradouro)}</xLgr><nro>${c.numero}</nro><xBairro>${san(c.bairro)}</xBairro><cMun>${c.cMun}</cMun><xMun>${san(c.municipio)}</xMun><UF>${c.uf}</UF><CEP>${c.cep}</CEP><cPais>1058</cPais><xPais>Brasil</xPais></enderEmit><IE>${c.ie}</IE><CRT>${c.crt}</CRT></emit>${destXml}${nfRefXml}${detXml}<total><ICMSTot><vBC>${vProd.toFixed(2)}</vBC><vICMS>${vICMS.toFixed(2)}</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>${vProd.toFixed(2)}</vProd><vFrete>${vFrete.toFixed(2)}</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>${vPIS.toFixed(2)}</vPIS><vCOFINS>${vCOFINS.toFixed(2)}</vCOFINS><vOutro>0.00</vOutro><vNF>${vNF.toFixed(2)}</vNF></ICMSTot></total><transp><modFrete>${d.modFrete}</modFrete></transp>${d.informacoesAdicionais?`<infAdic><infCpl>${san(d.informacoesAdicionais,500)}</infCpl></infAdic>`:""}</infNFe></NFe>`;
}

// ─── Assinatura Digital (idêntica ao sefaz-emitir) ─────────────────────────
// Ver limitação honesta sobre C14N simplificado documentada em
// supabase/functions/sefaz-emitir/index.ts — vale igualmente aqui.

function c14nSimple(xml: string): string {
  return xml
    .replace(/\r\n|\r/g, "\n")
    .replace(/>\s+</g, "><")
    .trim();
}

async function sha1B64(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data);
  const hash  = await crypto.subtle.digest("SHA-1", bytes);
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

async function importRsaSha1(pemKey: string): Promise<CryptoKey> {
  const b64 = pemKey
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, "")
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8", der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-1" },
    false, ["sign"]
  );
}

async function assinarXml(xml: string, chave: string, certPem: string, keyPem: string): Promise<string> {
  const refUri = `NFe${chave}`;
  const infMatch = xml.match(/<infNFe[\s\S]*?<\/infNFe>/);
  if (!infMatch) throw new Error("infNFe não encontrado");
  const infC14n     = c14nSimple(infMatch[0]);
  const digestValue = await sha1B64(infC14n);

  const signedInfo = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod><Reference URI="#${refUri}"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></Transform></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod><DigestValue>${digestValue}</DigestValue></Reference></SignedInfo>`;

  const cryptoKey = await importRsaSha1(keyPem);
  const sigBytes  = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey,
    new TextEncoder().encode(c14nSimple(signedInfo))
  );
  const signatureValue = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));

  const x509 = certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");

  const sigBlock = `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${signedInfo}<SignatureValue>${signatureValue}</SignatureValue><KeyInfo><X509Data><X509Certificate>${x509}</X509Certificate></X509Data></KeyInfo></Signature>`;

  return xml.replace(/<\/NFe>$/, `${sigBlock}</NFe>`);
}

async function pfxParaPem(pfxB64: string, senha: string): Promise<{ keyPem: string; certPem: string }> {
  const forge = (await import("npm:node-forge@1.3.1")).default;

  const pfxDer  = forge.util.decode64(pfxB64);
  const pfxAsn1 = forge.asn1.fromDer(pfxDer);
  const p12     = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, false, senha);

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const keyBags  = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];

  if (!certBags.length) throw new Error("Certificado não encontrado no PFX");
  if (!keyBags.length)  throw new Error("Chave privada não encontrada no PFX");

  return {
    certPem: forge.pki.certificateToPem(certBags[0].cert!),
    keyPem:  forge.pki.privateKeyToPem(keyBags[0].key!),
  };
}

// ─── Envelope SOAP ────────────────────────────────────────────────────────

function buildSoap(xmlAssinado: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeAutorizacaoLote xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4"><nfeDadosMsg><enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><idLote>${Date.now()}</idLote><indSinc>1</indSinc>${xmlAssinado}</enviNFe></nfeDadosMsg></nfeAutorizacaoLote></soap12:Body></soap12:Envelope>`;
}

function parseResp(xml: string) {
  const tag = (t: string) => xml.match(new RegExp(`<${t}[^>]*>([^<]*)<\/${t}>`))?.[1]?.trim() ?? "";
  return { cStat: tag("cStat"), xMotivo: tag("xMotivo"), nProt: tag("nProt"), dhRecbto: tag("dhRecbto") };
}

// ─── Handler principal ────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ sucesso: false, erro: "Method not allowed" }),
      { status: 405, headers: { ...cors, "Content-Type": "application/json" } });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) {
    return new Response(JSON.stringify({ sucesso: false, erro: "Não autenticado." }),
      { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  }
  try {
    const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ sucesso: false, erro: "Sessão inválida." }),
        { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    }
    const { data: roleData } = await userClient
      .from("user_roles").select("role").eq("user_id", user.id).single();
    if (!roleData || !["admin","financeiro"].includes(roleData.role)) {
      return new Response(JSON.stringify({ sucesso: false, erro: "Acesso não autorizado." }),
        { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
    }
  } catch {
    return new Response(JSON.stringify({ sucesso: false, erro: "Falha na autenticação." }),
      { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  }

  try {
    const { dadosFiscais: d } = await req.json() as Payload;
    const c = getConfig();

    if (!c.cnpj || c.cnpj.length !== 14) {
      return new Response(JSON.stringify({ sucesso: false, erro: "SEFAZ_CNPJ inválido. Configure os secrets." }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }
    if (!d.itens?.length) {
      return new Response(JSON.stringify({ sucesso: false, erro: "Nenhum item informado na nota." }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }
    const refDigits = (d.refNFe ?? "").replace(/\D/g, "");
    if (refDigits && refDigits.length !== 44) {
      log.warn("sefaz-emitir-devolucao", `[sefaz] refNFe com ${refDigits.length} dígitos (esperado 44) — emitindo sem o vínculo NFref à nota original.`);
    }

    const { chave, cNF } = gerarChave(c, d);
    log.info("sefaz-emitir-devolucao", `[sefaz] ${d.tipoOperacao.toUpperCase()} ${d.tipoNota.toUpperCase()} nº ${d.numero} → chave ${chave}`);

    const xml = buildXml(c, d, chave, cNF);

    let xmlAssinado = xml;
    if (c.pfxB64) {
      try {
        const { keyPem, certPem } = await pfxParaPem(c.pfxB64, c.pfxSenha);
        xmlAssinado = await assinarXml(xml, chave, certPem, keyPem);
        log.info("sefaz-emitir-devolucao", "[sefaz] XML assinado com sucesso");
      } catch (sigErr) {
        const msg = sigErr instanceof Error ? sigErr.message : String(sigErr);
        log.error("sefaz-emitir-devolucao", "[sefaz] Falha na assinatura digital:", msg);
        if (c.tpAmb === 1) {
          return new Response(JSON.stringify({
            sucesso: false,
            erro: `Falha ao assinar digitalmente a NF-e: ${msg}. Em ambiente de produção, a nota NÃO é enviada sem assinatura válida.`,
          }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
        }
        log.warn("sefaz-emitir-devolucao", "[sefaz] Ambiente de homologação — prosseguindo SEM assinatura (apenas para depurar XML/conectividade).");
      }
    } else if (c.tpAmb === 1) {
      return new Response(JSON.stringify({
        sucesso: false,
        erro: "Certificado digital não configurado (SEFAZ_PFX_BASE64). Em produção, a NF-e não pode ser emitida sem certificado A1 válido.",
      }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    } else {
      log.warn("sefaz-emitir-devolucao", "[sefaz] SEFAZ_PFX_BASE64 não configurado — XML sem assinatura (homologação apenas)");
    }

    const url  = wsUrl(c.uf, d.tipoNota, c.tpAmb);
    const body = buildSoap(xmlAssinado);
    log.info("sefaz-emitir-devolucao", `[sefaz] Enviando para ${url}`);

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
      body,
      signal: AbortSignal.timeout(30_000),
    });

    const xmlResp = await resp.text();
    if (c.debug) log.info("sefaz-emitir-devolucao", "[sefaz] Resposta raw:", xmlResp.slice(0, 800));

    const r  = parseResp(xmlResp);
    const ok = r.cStat === "100";
    log.info("sefaz-emitir-devolucao", `[sefaz] cStat=${r.cStat} xMotivo=${r.xMotivo} nProt=${r.nProt}`);

    return new Response(JSON.stringify({
      sucesso:       ok,
      chaveAcesso:   ok ? chave : undefined,
      protocolo:     r.nProt  || undefined,
      dhAutorizacao: r.dhRecbto || undefined,
      cStat:         r.cStat,
      xMotivo:       r.xMotivo,
      xmlAssinado:   ok ? xmlAssinado : undefined,
      xmlGerado:     c.debug ? xml : undefined,
      rawResp:       c.debug ? xmlResp : undefined,
    }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("sefaz-emitir-devolucao", "[sefaz-emitir-devolucao] Erro:", msg);
    return new Response(JSON.stringify({ sucesso: false, erro: msg }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
