/**
 * Utilidades do Financeiro (datas no fuso de Brasília, arquivos fiscais,
 * leitura de XML de NF-e para registrar notas emitidas em outro sistema).
 */
import { supabase } from "@/integrations/supabase/client";
import { chaveValida } from "../../supabase/functions/_shared/focusnfe";

export { chaveValida, cnpjValido, cpfValido } from "../../supabase/functions/_shared/focusnfe";

/** AAAA-MM-DD no horário local (toISOString() usa UTC e vira "amanhã" depois das 21h). */
export function hojeISO(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function mesISO(d = new Date()): string { return hojeISO(d).slice(0, 7); }
export function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + dias); return hojeISO(d);
}
export function fmtData(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = iso.length <= 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString("pt-BR");
}
export function fmtDataHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
/** "1.234,56" / "1234.56" / "1234,5" → número. */
export function parseValor(txt: string): number {
  const t = (txt ?? "").trim().replace(/\s|R\$/g, "");
  if (!t) return 0;
  const norm = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(norm);
  return Number.isFinite(n) ? n : 0;
}
export function mascaraDoc(doc: string | null | undefined): string {
  const d = (doc ?? "").replace(/\D/g, "");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return doc ?? "";
}
export function formatarChave(chave: string | null | undefined): string {
  return (chave ?? "").replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** Campos lidos da chave de acesso. */
export function lerChave(chave: string) {
  const d = chave.replace(/\D/g, "");
  return {
    uf: d.slice(0, 2), aamm: d.slice(2, 6), cnpj: d.slice(6, 20), modelo: d.slice(20, 22),
    serie: String(Number(d.slice(22, 25))), numero: Number(d.slice(25, 34)),
  };
}

export interface NotaXml {
  chave: string; numero: number; serie: string; emitidaEm: string | null; valor: number;
  protocolo: string | null; destinatarioDoc: string | null; destinatarioNome: string | null;
  finalidade: string | null;
}

/** Lê o XML (nfeProc ou NFe) de uma nota para preencher o registro. */
export function lerXmlNota(xml: string): NotaXml | null {
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) return null;
    const tag = (nome: string, raiz: Document | Element = doc) => raiz.getElementsByTagName(nome)[0]?.textContent?.trim() ?? null;
    const inf = doc.getElementsByTagName("infNFe")[0];
    const id = inf?.getAttribute("Id") ?? "";
    const chave = (tag("chNFe") ?? id.replace(/^NFe/, "")).replace(/\D/g, "");
    if (!chaveValida(chave)) return null;
    const ide = doc.getElementsByTagName("ide")[0];
    const dest = doc.getElementsByTagName("dest")[0];
    return {
      chave,
      numero: Number(ide ? tag("nNF", ide) : lerChave(chave).numero),
      serie: String(Number(ide ? tag("serie", ide) : lerChave(chave).serie)),
      emitidaEm: ide ? tag("dhEmi", ide) : null,
      valor: Number(tag("vNF") ?? 0),
      protocolo: tag("nProt"),
      destinatarioDoc: dest ? (tag("CNPJ", dest) ?? tag("CPF", dest)) : null,
      destinatarioNome: dest ? tag("xNome", dest) : null,
      finalidade: ide ? tag("finNFe", ide) : null,
    };
  } catch { return null; }
}

/** Envia XML/PDF para o bucket privado "fiscal" (sem sobrescrever). */
export async function enviarArquivoFiscal(arquivo: File, chave: string, tipo: "xml" | "pdf"): Promise<string> {
  const ano = `20${lerChave(chave).aamm.slice(0, 2)}`;
  const path = `nfe/${ano}/${chave}${tipo === "pdf" ? "-danfe.pdf" : ".xml"}`;
  const { error } = await supabase.storage.from("fiscal").upload(path, arquivo, {
    upsert: false, contentType: tipo === "pdf" ? "application/pdf" : "application/xml",
  });
  if (error && !/exists|duplicate/i.test(error.message)) throw error;
  return path;
}

/** Abre (ou baixa) um arquivo do bucket fiscal por link temporário. */
export async function abrirArquivoFiscal(path: string, baixarComo?: string) {
  const { data, error } = await supabase.storage.from("fiscal").createSignedUrl(path, 120, baixarComo ? { download: baixarComo } : undefined);
  if (error || !data?.signedUrl) throw error ?? new Error("Arquivo indisponível");
  window.open(data.signedUrl, "_blank", "noopener");
}

export const FORMAS_PAGAMENTO: Record<string, string> = {
  pix: "PIX", boleto: "Boleto", dinheiro: "Dinheiro", cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito", transferencia: "Transferência", deposito: "Depósito", cheque: "Cheque", outros: "Outros",
};

/** CSV para Excel (BOM + ; + aspas), protegido contra fórmulas. */
export function baixarCsv(nome: string, cabecalho: string[], linhas: (string | number | null | undefined)[][]) {
  const cel = (v: string | number | null | undefined) => {
    let s = v == null ? "" : typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",")) : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = "﻿" + [cabecalho.map(cel).join(";"), ...linhas.map(l => l.map(cel).join(";"))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
