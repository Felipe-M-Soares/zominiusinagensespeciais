/**
 * Leitura de arquivos de programa CNC para importar na biblioteca
 * (Processos → Códigos CNC). Tudo roda no navegador: o arquivo vira texto
 * e é salvo na tabela programas_cnc — nada é enviado para fora.
 */

export const LINGUAGENS_CNC = ["G-Code", "Fanuc", "Siemens", "Mazak", "Haas", "Heidenhain", "Okuma", "Mitsubishi", "Fagor", "ISO CNC", "Macro B", "Outro"] as const;
export type LinguagemCnc = typeof LINGUAGENS_CNC[number];

/** Extensões comuns de saída de pós-processador (SolidCAM e outros). */
export const EXTENSOES_CNC = [".nc", ".tap", ".txt", ".gcode", ".ngc", ".cnc", ".iso", ".ptp", ".pim", ".prg", ".mpf", ".spf", ".h", ".eia", ".min", ".001", ".ncc", ".anc"];

/** Limite por arquivo — programas de usinagem são texto; 5 MB ≈ 150 mil linhas. */
export const TAMANHO_MAX_BYTES = 5 * 1024 * 1024;

export function extensaoDe(nomeArquivo: string): string {
  const i = nomeArquivo.lastIndexOf(".");
  return i > 0 ? nomeArquivo.slice(i).toLowerCase() : "";
}

export function nomeSemExtensao(nomeArquivo: string): string {
  const i = nomeArquivo.lastIndexOf(".");
  return (i > 0 ? nomeArquivo.slice(0, i) : nomeArquivo).trim();
}

/** Palpite da linguagem pelo tipo de arquivo e pelo começo do código. */
export function detectarLinguagem(nomeArquivo: string, conteudo: string): LinguagemCnc {
  const ext = extensaoDe(nomeArquivo);
  if (ext === ".mpf" || ext === ".spf") return "Siemens";
  if (ext === ".h") return "Heidenhain";
  if (ext === ".eia" || ext === ".min") return "Mazak";
  const inicio = conteudo.slice(0, 2000);
  if (/^\s*(BEGIN PGM|0\s+BEGIN PGM)/im.test(inicio)) return "Heidenhain";
  if (/\bCYCLE\d{2,3}\s*\(|^\s*MSG\s*\(/im.test(inicio)) return "Siemens";
  if (/^\s*%\s*\r?\n\s*O\d{1,5}\b/m.test(inicio) || /^\s*O\d{4,5}\b/m.test(inicio)) return "Fanuc";
  return "G-Code";
}

/** Procura o código de uma máquina cadastrada no nome do arquivo (ex.: "MQ003_bucha.nc"). */
export function detectarMaquina(nomeArquivo: string, codigos: string[]): string | null {
  const alvo = nomeArquivo.toUpperCase();
  const achadas = codigos.filter(c => c && alvo.includes(c.toUpperCase()));
  // Preferir o código mais longo (evita "MQ1" casar dentro de "MQ12").
  return achadas.sort((a, b) => b.length - a.length)[0] ?? null;
}

export type LeituraArquivo =
  | { ok: true; conteudo: string; linhas: number }
  | { ok: false; erro: string };

/**
 * Converte os bytes do arquivo em texto. Tenta UTF-8; se não for UTF-8
 * válido, usa Windows-1252 (comentários com acento gerados no Windows).
 * Recusa arquivos binários (ex.: projeto .prz do SolidCAM, .SLDPRT).
 */
export function decodificarPrograma(bytes: Uint8Array): LeituraArquivo {
  if (bytes.length === 0) return { ok: false, erro: "Arquivo vazio." };
  if (bytes.length > TAMANHO_MAX_BYTES) return { ok: false, erro: "Arquivo maior que 5 MB." };
  const amostra = bytes.subarray(0, Math.min(bytes.length, 8192));
  let controle = 0;
  for (const b of amostra) {
    if (b === 0) return { ok: false, erro: "Não é um programa em texto (arquivo binário)." };
    if (b < 9 || (b > 13 && b < 32 && b !== 26)) controle++;
  }
  if (controle > amostra.length * 0.02) return { ok: false, erro: "Não é um programa em texto (arquivo binário)." };

  let texto: string;
  try { texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { texto = new TextDecoder("windows-1252").decode(bytes); }
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);          // BOM
  texto = texto.replace(/\r\n?/g, "\n");
  while (texto.endsWith(String.fromCharCode(26))) texto = texto.slice(0, -1); // Ctrl-Z de fim de arquivo (DOS)
  if (!texto.trim()) return { ok: false, erro: "Arquivo vazio." };
  return { ok: true, conteudo: texto, linhas: texto.replace(/\n+$/, "").split("\n").length };
}
