/**
 * DesenhoTecnicoUploader — Upload em massa de desenhos técnicos (PDF) a partir
 * de um único arquivo .zip com pastas e subpastas.
 *
 * Para cada PDF dentro do zip, tenta casar com uma ou mais peças do banco em
 * QUATRO etapas:
 *   1. Correspondência EXATA — nome do próprio arquivo (sem extensão) ou de
 *      alguma pasta ancestral bate exatamente com a referência, modelo ou
 *      código interno cadastrado, ignorando acentos, maiúsculas/minúsculas,
 *      espaços, traços, underscores e pontuação (ex: "UCEAR-4814",
 *      "ucear_4814" e "UCEAR 4814" são todos tratados como o mesmo texto).
 *   2. FAMÍLIA POR ALTURA — mesmo esquema já usado no upload de imagens (ver
 *      DeviceImageUploader.tsx): o nome do arquivo é a base do código, sem o
 *      dígito de altura/variante, que aparece só nas peças cadastradas, no
 *      FINAL do trecho numérico. Ex: arquivo "PIM 4818N" cobre as peças
 *      "PIM 48181N", "PIM 48182N" ... "PIM 48186N" — mesmas letras antes e
 *      depois dos números, dígitos da peça começam com os dígitos do arquivo.
 *      Um único PDF é vinculado a TODAS as peças da família de uma vez.
 *   3. Correspondência APROXIMADA (fallback) — se nada bateu nas etapas
 *      acima, verifica se o nome do arquivo/pasta CONTÉM a referência
 *      cadastrada (ou é contido por ela) — cobre casos como
 *      "UCEAR 4814 Rev02.pdf" ou "Desenho_UCEAR4814". Só aceita esse tipo de
 *      match quando ele aponta pra EXATAMENTE UMA peça (se mais de uma
 *      referência poderia bater, fica marcado como sem match pra não
 *      arriscar vincular o desenho errado).
 *   4. Correspondência POR CONTEÚDO (fallback final) — cobre os "desenhos de
 *      família" que não seguem o padrão numérico da etapa 2: o desenho tem
 *      uma "Tabela de dimensões variáveis" listando os códigos reais das
 *      peças (a peça em si costuma ter um código só de "Código do Desenho",
 *      tipo "ERM 3516C", que não bate com nenhuma referência cadastrada
 *      sozinho). Se o nome do arquivo não casou com nada, o texto de dentro
 *      do PDF é lido (via pdfjs) e cada referência/modelo cadastrado é
 *      procurado literalmente nesse texto — se aparecer mais de um código da
 *      tabela, o MESMO PDF é vinculado a TODAS as peças encontradas.
 *
 * Casos "família", "aproximado" e "por conteúdo" aparecem marcados na prévia
 * pra conferência antes de enviar.
 */

import { useState, useCallback, useMemo, useRef } from "react";
// zip.js lê o .zip DIRETO DO DISCO, entrada por entrada (BlobReader lê fatias
// do arquivo sob demanda). O JSZip antigo carregava o zip INTEIRO na memória —
// com zips grandes (centenas de MB / 1GB) isso estourava a RAM da aba e o app
// crashava/fechava, principalmente em celular. Essa troca resolve o crash.
import { ZipReader, BlobReader, BlobWriter, type FileEntry } from "@zip.js/zip.js";
import * as pdfjsLib from "pdfjs-dist";
import {
  X, CheckCircle2, AlertTriangle, XCircle,
  FileText, ArrowUpCircle, Loader2, FileArchive, Copy, Sparkles, Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";

// Worker do pdfjs — mesmo setup usado em DesenhoTecnicoViewer.tsx / ExcelStockImport.tsx
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// Limite alto o suficiente pra zips de várias centenas de PDFs (alguns GB).
// zip.js lê o índice + cada entrada sob demanda (não carrega o zip inteiro
// na RAM), então o tamanho do arquivo em si não é o gargalo — o gargalo
// real era o algoritmo de correspondência (ver normalização pré-computada
// abaixo), já corrigido.
const MAX_ZIP_SIZE_MB = 3072; // 3GB
// PDFs maiores que isso não passam pela leitura de texto (fallback por
// conteúdo) — extrair texto de PDFs gigantes é o que mais consome memória.
// Ajustado de 20 pra 10 pra 5 pra evitar o travamento, mas 5MB acabou
// excluindo exatamente os "desenhos de família" (uma peça-mãe com tabela de
// variações, tipo "ERM 3516C") que o fallback por conteúdo existe pra
// tratar — esses desenhos tendem a ser mais pesados que um desenho de peça
// única. Voltado pra 25MB: a proteção real contra travamento agora é o
// orçamento de memória por sessão abaixo (mais robusto que só limitar por
// arquivo), somado ao limite de páginas e às pausas mais frequentes.
const MAX_PDF_TEXT_MB = 25;
// Trava de segurança adicional: soma o tamanho (descomprimido) de tudo que
// já foi lido por conteúdo nesta sessão. Mais confiável que só contar
// arquivos, porque o que derruba a aba é a quantidade de memória usada, não
// a quantidade de arquivos — poucos PDFs pesados derrubam a aba tão rápido
// quanto milhares leves. Passado esse total, para e marca o resto como "sem
// correspondência" (dá pra enviar o que já casou e rodar de novo depois).
const MAX_BYTES_CONTEUDO_POR_SESSAO = 300 * 1024 * 1024; // 300MB
// Trava de segurança pro fallback por conteúdo: ler texto de milhares de
// PDFs em sequência (decodificar + parsear com pdf.js) é a etapa mais
// pesada do processo — é isso que trava/derruba a aba em zips com muitos
// arquivos sem nome batendo com o catálogo. Passado esse limite numa
// mesma sessão, para de tentar por conteúdo e marca o resto como
// "sem correspondência" — o usuário consegue enviar o que já casou e
// rodar de novo pro restante, em vez de perder tudo com a aba fechando.
const MAX_PDFS_CONTEUDO_POR_SESSAO = 400;
// Candidatos de nome com menos que isso (já normalizado) não entram na
// correspondência aproximada — evita casar "01" com qualquer peça que tenha
// "01" em algum canto da referência.
const MIN_FUZZY_LEN = 4;

interface Device {
  id: string;
  reference: string;
  model: string;
  internal_code: string | null;
  desenho_tecnico_path: string | null;
}

interface FileResult {
  zipPath:    string;   // caminho completo dentro do zip, só pra exibição
  refName:    string;   // nome usado para o match (arquivo ou pasta)
  entry:      FileEntry;
  devices:    Device[]; // 0 = sem match · 1 = normal · 2+ = desenho de família
  matchMode?: "exato" | "familia" | "aproximado" | "conteudo";
  status:     "pending" | "uploading" | "done" | "error" | "no_match" | "duplicate" | "ja_enviado";
  error?:     string;
}

/** Remove acentos, caixa e QUALQUER separador (espaço, traço, underscore, ponto...) */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function stemName(filename: string) {
  return filename.replace(/\.[^.]+$/, "");
}

function sanitizePath(name: string): string {
  return name
    .replace(/\.\.+/g, ".")
    // eslint-disable-next-line no-control-regex -- \x00 é intencional: remove byte nulo de nomes de arquivo antes de usar como path de storage.
    .replace(/[/\\<>:"|?*\x00]/g, "_")
    .trim();
}

interface DeviceIndex {
  list: { device: Device; refNorm: string; modelNorm: string; codeNorm: string }[];
  exactMap: Map<string, Device>;
}

/**
 * Pré-computa a normalização de cada peça UMA VEZ (não a cada comparação) e
 * monta um mapa para correspondência exata em O(1).
 *
 * Antes disso, findMatchByName chamava norm() — que faz normalize("NFD") +
 * replace por regex, ambos relativamente caros — para CADA peça do catálogo
 * a CADA candidato de nome de arquivo/pasta, repetido para cada PDF do zip.
 * Com um catálogo de milhares de peças e um zip com milhares de desenhos
 * (como um zip de ~1-2GB de desenhos técnicos costuma ter), isso virava
 * dezenas de milhões de operações de string síncronas — exatamente o que
 * travava a aba durante a leitura do zip, não o tamanho do arquivo em si.
 *
 * Compara também contra internal_code — muitos desenhos técnicos são
 * arquivados pelo código interno da peça, não pela referência/modelo do
 * catálogo, e isso ficava de fora da comparação antes.
 *
 * IMPORTANTE: internal_code só entra na correspondência EXATA, e só quando
 * é único no catálogo (se duas ou mais peças compartilham o mesmo código
 * interno normalizado, nenhuma delas entra no mapa — evita vincular o
 * desenho errado por causa de um código genérico repetido). Não entra na
 * correspondência aproximada — diferente de referência/modelo, código
 * interno costuma ser mais curto/genérico, e permitir correspondência
 * aproximada nele estava casando peças completamente diferentes.
 */
function buildDeviceIndex(devices: Device[]): DeviceIndex {
  const list = devices.map(d => ({
    device: d,
    refNorm: norm(d.reference),
    modelNorm: norm(d.model),
    codeNorm: norm(d.internal_code ?? ""),
  }));
  const exactMap = new Map<string, Device>();
  const codeCount = new Map<string, number>();
  for (const { codeNorm } of list) {
    if (codeNorm) codeCount.set(codeNorm, (codeCount.get(codeNorm) ?? 0) + 1);
  }
  for (const { device, refNorm, modelNorm, codeNorm } of list) {
    if (refNorm && !exactMap.has(refNorm)) exactMap.set(refNorm, device);
    if (modelNorm && !exactMap.has(modelNorm)) exactMap.set(modelNorm, device);
    if (codeNorm && codeCount.get(codeNorm) === 1 && !exactMap.has(codeNorm)) exactMap.set(codeNorm, device);
  }
  return { list, exactMap };
}

/** Extrai (letras)(dígitos)(letras) de um código já normalizado — ex: "pim48181n" → {prefix:"pim", digits:"48181", suffix:"n"}. */
function parseCodeParts(normStr: string): { prefix: string; digits: string; suffix: string } | null {
  const m = normStr.match(/^([a-z]*)(\d+)([a-z]*)$/);
  if (!m) return null;
  return { prefix: m[1], digits: m[2], suffix: m[3] };
}

/**
 * Família por altura — mesmo esquema já usado no upload de imagens (ver
 * DeviceImageUploader.tsx): o candidato (nome do arquivo/pasta) é a BASE do
 * código, sem o dígito de altura/variante — esse dígito extra existe só nas
 * peças cadastradas, sempre no FINAL do trecho numérico, com as mesmas
 * letras antes e depois. Ex: candidato "pim4818n" cobre "pim48181n",
 * "pim48182n" ... "pim48186n" (dígitos da peça começam com os do arquivo).
 */
function findFamilyByHeight(candNorm: string, index: DeviceIndex): Device[] {
  const cand = parseCodeParts(candNorm);
  if (!cand || !cand.digits) return [];
  const found: Device[] = [];
  for (const { device, refNorm } of index.list) {
    const dp = parseCodeParts(refNorm);
    if (!dp) continue;
    if (
      dp.prefix === cand.prefix &&
      dp.suffix === cand.suffix &&
      dp.digits.length > cand.digits.length &&
      dp.digits.startsWith(cand.digits)
    ) {
      found.push(device);
    }
  }
  return found;
}

/** Tenta casar por nome do arquivo, depois por cada pasta ancestral — só correspondência EXATA. */
function findExactMatch(zipPath: string, index: DeviceIndex): { device: Device; refName: string } | null {
  const parts = zipPath.split("/").filter(Boolean);
  const fileName = parts[parts.length - 1];
  const candidates = [stemName(fileName), ...parts.slice(0, -1).reverse()];

  // correspondência exata (referência, modelo ou código interno, normalizados) — O(1) via Map.
  for (const candidate of candidates) {
    const candNorm = norm(candidate);
    if (!candNorm) continue;
    const match = index.exactMap.get(candNorm);
    if (match) return { device: match, refName: candidate };
  }
  return null;
}

/** Tenta achar uma família por altura em cada candidato (arquivo, depois pastas ancestrais). */
function findFamilyMatch(zipPath: string, index: DeviceIndex): { devices: Device[]; refName: string } | null {
  const parts = zipPath.split("/").filter(Boolean);
  const fileName = parts[parts.length - 1];
  const candidates = [stemName(fileName), ...parts.slice(0, -1).reverse()];

  for (const candidate of candidates) {
    const candNorm = norm(candidate);
    if (!candNorm || candNorm.length < MIN_FUZZY_LEN) continue;
    const familia = findFamilyByHeight(candNorm, index);
    if (familia.length > 0) return { devices: familia, refName: candidate };
  }
  return null;
}

/** Correspondência aproximada (fallback) — só aceita se apontar pra uma única peça. */
function findFuzzyMatch(zipPath: string, index: DeviceIndex): { device: Device; refName: string } | null {
  const parts = zipPath.split("/").filter(Boolean);
  const fileName = parts[parts.length - 1];
  const candidates = [stemName(fileName), ...parts.slice(0, -1).reverse()];

  // só referência/modelo — código interno costuma ser curto/genérico demais
  // pra correspondência aproximada com segurança.
  for (const candidate of candidates) {
    const candNorm = norm(candidate);
    if (!candNorm || candNorm.length < MIN_FUZZY_LEN) continue;
    const matches: Device[] = [];
    for (const { device, refNorm, modelNorm } of index.list) {
      const refHit  = refNorm.length  >= MIN_FUZZY_LEN && (candNorm.includes(refNorm)  || refNorm.includes(candNorm));
      const modelHit = modelNorm.length >= MIN_FUZZY_LEN && (candNorm.includes(modelNorm) || modelNorm.includes(candNorm));
      if (refHit || modelHit) {
        matches.push(device);
        if (matches.length > 1) break; // já sabemos que não é único, pode parar cedo
      }
    }
    if (matches.length === 1) return { device: matches[0], refName: candidate };
  }
  return null;
}


/**
 * Extrai todo o texto de um PDF (via pdfjs) — usado só como fallback quando
 * o nome do arquivo não bateu com nada. Funciona para PDFs "de verdade"
 * (com camada de texto, como a maioria dos desenhos exportados de CAD); se o
 * PDF for uma imagem escaneada sem texto, simplesmente não encontra nada e o
 * arquivo continua marcado como "sem match" — sem quebrar o restante do envio.
 */
async function extrairTextoPdf(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({
    data: buf,
    disableFontFace: true, // só lemos texto, nunca renderizamos — não precisa montar as fontes
    disableAutoFetch: true,
    disableStream: true,
  }).promise;
  try {
    let texto = "";
    const maxPaginas = Math.min(pdf.numPages, 2); // desenhos técnicos raramente passam de 1-2 páginas
    for (let p = 1; p <= maxPaginas; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      texto += content.items.map(it => ("str" in it ? it.str : "")).join(" ") + " ";
      page.cleanup();
    }
    return texto;
  } finally {
    // Libera a memória do documento — sem isso, ler dezenas de PDFs em
    // sequência acumula buffers e derruba a aba.
    await (pdf as unknown as { destroy(): Promise<void> }).destroy();
  }
}

/**
 * Procura, dentro do texto já extraído do PDF, TODAS as referências/modelos
 * cadastrados que aparecem literalmente ali — é assim que um "desenho de
 * família" (uma peça-mãe com uma tabela de alturas/variações) acaba casando
 * com várias peças ao mesmo tempo: os códigos da tabela aparecem no texto do
 * PDF mesmo que o nome do arquivo seja só o código genérico do desenho.
 */
function findMatchesByContent(textoPdf: string, index: DeviceIndex): Device[] {
  const textoNorm = norm(textoPdf);
  if (!textoNorm) return [];
  const found: Device[] = [];
  for (const { device, refNorm, modelNorm } of index.list) {
    const refHit = refNorm.length >= MIN_FUZZY_LEN && textoNorm.includes(refNorm);
    const modelHit = modelNorm.length >= MIN_FUZZY_LEN && textoNorm.includes(modelNorm);
    if (refHit || modelHit) found.push(device);
  }
  return found;
}

interface Props {
  onClose: () => void;
  onDone:  () => void;
}

export function DesenhoTecnicoUploader({ onClose, onDone }: Props) {
  const [results,   setResults]   = useState<FileResult[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [progresso, setProgresso] = useState<{ atual: number; total: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [done,      setDone]      = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processZip = useCallback(async (zipFile: File) => {
    if (!zipFile.name.toLowerCase().endsWith(".zip")) {
      toast.error("Selecione um arquivo .zip");
      return;
    }
    if (zipFile.size > MAX_ZIP_SIZE_MB * 1024 * 1024) {
      toast.error(`Arquivo muito grande. Máximo: ${(MAX_ZIP_SIZE_MB / 1024).toFixed(0)}GB`);
      return;
    }

    setExtracting(true);
    setProgresso(null);
    let zipReader: ZipReader<Blob> | null = null;
    try {
      // Lê SÓ o índice do zip (central directory) — o conteúdo dos PDFs
      // continua no disco e é lido um por vez, sob demanda.
      zipReader = new ZipReader(new BlobReader(zipFile));
      const todas = await zipReader.getEntries();
      const entries = todas.filter((e): e is FileEntry =>
        !e.directory &&
        /\.pdf$/i.test(e.filename) &&
        !e.filename.split("/").some(seg => seg.startsWith("__MACOSX") || seg.startsWith("."))
      );

      if (entries.length === 0) {
        toast.error("Nenhum PDF encontrado dentro do .zip.");
        setExtracting(false);
        return;
      }

      // Busca o catálogo INTEIRO paginando — um único select() sem range()
      // é limitado pelo Supabase/PostgREST (por padrão, 1000 linhas por
      // requisição). Como o catálogo de peças é maior que isso (por isso é
      // paginado em outros lugares do app, ver useDevices.ts), um select()
      // simples aqui deixava peças de fora silenciosamente — desenhos delas
      // NUNCA batiam com nada, não importa o quão bem nomeado o arquivo
      // estivesse. Buscando tudo em páginas resolve isso.
      const devicesTyped: Device[] = [];
      {
        const DEVICES_PAGE = 1000;
        for (let from = 0; ; from += DEVICES_PAGE) {
          const { data: page, error: pageErr } = await supabase
            .from("devices")
            .select("id, reference, model, internal_code, desenho_tecnico_path")
            .range(from, from + DEVICES_PAGE - 1);
          if (pageErr) {
            toast.error("Erro ao buscar componentes do banco.");
            setExtracting(false);
            return;
          }
          if (!page || page.length === 0) break;
          devicesTyped.push(...(page as Device[]));
          if (page.length < DEVICES_PAGE) break;
        }
      }
      const deviceIndex = buildDeviceIndex(devicesTyped);
      const usedDeviceIds = new Set<string>();
      const fileResults: FileResult[] = new Array(entries.length);

      // 1ª passada — SÓ pelo nome (rápida: normalização pré-computada + Map
      // para correspondência exata). Processada em lotes com um respiro
      // entre eles para a aba não ficar "não responde" em zips com muitos
      // arquivos, mesmo essa etapa já sendo bem mais rápida que antes.
      const semMatchPorNome: number[] = [];
      const NOME_CHUNK = 200;
      for (let start = 0; start < entries.length; start += NOME_CHUNK) {
        const chunk = entries.slice(start, start + NOME_CHUNK);
        chunk.forEach((entry, offset) => {
          const idx = start + offset;
          const refName = stemName(entry.filename.split("/").pop()!);

          const exato = findExactMatch(entry.filename, deviceIndex);
          if (exato) {
            const jaTemDesenho = !!exato.device.desenho_tecnico_path;
            fileResults[idx] = {
              zipPath: entry.filename, refName: exato.refName, entry,
              devices: [exato.device], matchMode: "exato",
              status: jaTemDesenho ? "ja_enviado" : "pending",
            };
            return;
          }

          const familia = findFamilyMatch(entry.filename, deviceIndex);
          if (familia) {
            const pendentes = familia.devices.filter(d => !d.desenho_tecnico_path);
            fileResults[idx] = {
              zipPath: entry.filename, refName: familia.refName, entry,
              devices: pendentes.length > 0 ? pendentes : familia.devices,
              matchMode: "familia",
              status: pendentes.length > 0 ? "pending" : "ja_enviado",
            };
            return;
          }

          const aproximado = findFuzzyMatch(entry.filename, deviceIndex);
          if (aproximado) {
            const jaTemDesenho = !!aproximado.device.desenho_tecnico_path;
            fileResults[idx] = {
              zipPath: entry.filename, refName: aproximado.refName, entry,
              devices: [aproximado.device], matchMode: "aproximado",
              status: jaTemDesenho ? "ja_enviado" : "pending",
            };
            return;
          }

          fileResults[idx] = { zipPath: entry.filename, refName, entry, devices: [], status: "no_match" };
          semMatchPorNome.push(idx);
        });
        if (start + NOME_CHUNK < entries.length) await new Promise(r => setTimeout(r, 0));
      }

      // 2ª passada — fallback por conteúdo, UM PDF POR VEZ, com progresso na
      // tela e devolvendo o controle pra UI entre um e outro. Ler vários PDFs
      // em paralelo era o segundo motivo do travamento em zips grandes.
      const maxBytes = MAX_PDF_TEXT_MB * 1024 * 1024;
      const alvoConteudo = semMatchPorNome.slice(0, MAX_PDFS_CONTEUDO_POR_SESSAO);
      let bytesProcessados = 0;
      let paradaPorOrcamento = false;
      let processadosEfetivo = 0;
      for (let k = 0; k < alvoConteudo.length; k++) {
        if (bytesProcessados >= MAX_BYTES_CONTEUDO_POR_SESSAO) { paradaPorOrcamento = true; break; }
        const idx = alvoConteudo[k];
        const entry = entries[idx];
        processadosEfetivo = k + 1;
        setProgresso({ atual: k + 1, total: alvoConteudo.length });
        const tamanho = entry.uncompressedSize ?? 0;
        if (tamanho > maxBytes) continue; // PDF grande demais pra ler texto
        try {
          const blob = await entry.getData(new BlobWriter("application/pdf"));
          const texto = await extrairTextoPdf(blob);
          const doConteudo = findMatchesByContent(texto, deviceIndex);
          if (doConteudo.length > 0) {
            // Mesma checagem do match por nome: não reprocessa peças que já
            // têm desenho técnico enviado de uma sessão anterior.
            const pendentes = doConteudo.filter(d => !d.desenho_tecnico_path);
            if (pendentes.length > 0) {
              fileResults[idx] = { ...fileResults[idx], devices: pendentes, matchMode: "conteudo", status: "pending" };
            } else {
              fileResults[idx] = { ...fileResults[idx], devices: doConteudo, matchMode: "conteudo", status: "ja_enviado" };
            }
          }
          bytesProcessados += tamanho;
        } catch (e) {
          logger.error(`Falha ao ler texto do PDF ${entry.filename}:`, e);
        }
        // Respira: deixa o navegador renderizar/responder entre PDFs. A cada
        // 8 arquivos, uma pausa mais longa — dá tempo real do motor JS
        // rodar o garbage collector antes de acumular memória demais (o
        // intervalo de 25 arquivos ainda travava a aba em lotes grandes).
        await new Promise(r => setTimeout(r, (k + 1) % 8 === 0 ? 250 : 0));
      }
      setProgresso(null);
      const cortouPorLimite = semMatchPorNome.length > processadosEfetivo;
      if (cortouPorLimite) {
        const motivo = paradaPorOrcamento
          ? "muita memória usada nesta leva (PDFs pesados)"
          : "muitos arquivos sem nome batendo com o catálogo";
        toast.warning(
          `Processados ${processadosEfetivo} de ${semMatchPorNome.length} PDFs (parou por ${motivo}). ` +
          `Envie os que já casaram e rode o upload de novo pra continuar o restante — evita travar a aba num lote só desse tamanho.`,
          { duration: 10000 }
        );
      }

      // 3ª passada — resolve duplicatas na ordem original (mesma regra de antes:
      // a primeira ocorrência fica com a peça, as demais viram "duplicate").
      for (const r of fileResults) {
        if (r.status !== "pending") continue;
        const novos = r.devices.filter(d => !usedDeviceIds.has(d.id));
        if (novos.length === 0) { r.status = "duplicate"; continue; }
        novos.forEach(d => usedDeviceIds.add(d.id));
        r.devices = novos;
      }

      fileResults.sort((a, b) => {
        if (a.status === b.status) return a.zipPath.localeCompare(b.zipPath);
        const order = { pending: 0, duplicate: 1, ja_enviado: 1, no_match: 2, uploading: 3, done: 4, error: 5 };
        return order[a.status] - order[b.status];
      });

      setResults(fileResults);
      setDone(false);
    } catch (e) {
      logger.error("processZip error:", e);
      toast.error("Não foi possível ler o arquivo .zip. Verifique se não está corrompido.");
    } finally {
      setProgresso(null);
      setExtracting(false);
      // NÃO fecha o zipReader aqui: as entries continuam sendo lidas do disco
      // na hora do upload. O reader não segura o conteúdo na memória.
    }
  }, []);

  const counts = useMemo(() => {
    const matched = results.filter(r => r.status === "pending");
    return {
      matched: matched.length,
      totalPecas: matched.reduce((s, r) => s + r.devices.length, 0),
      fuzzy: matched.filter(r => r.matchMode === "aproximado").length,
      familia: matched.filter(r => r.matchMode === "familia").length,
      conteudo: matched.filter(r => r.matchMode === "conteudo").length,
      noMatch: results.filter(r => r.status === "no_match").length,
      duplicate: results.filter(r => r.status === "duplicate").length,
      jaEnviado: results.filter(r => r.status === "ja_enviado").length,
      total: results.length,
      done: results.filter(r => r.status === "done").length,
      errors: results.filter(r => r.status === "error").length,
    };
  }, [results]);

  async function handleUpload() {
    const toUpload = results.filter(r => r.status === "pending");
    if (toUpload.length === 0) return;

    setUploading(true);
    setResults(prev => prev.map(r => r.status === "pending" ? { ...r, status: "uploading" } : r));

    const PARALLEL = 3; // 3 uploads simultâneos — estável também em celular
    const errors = new Map<string, string>();

    async function uploadOne(item: FileResult): Promise<void> {
      // Lê o PDF do zip só agora, direto do disco — um por vez dentro do lote.
      const blob = await item.entry.getData(new BlobWriter("application/pdf"));
      for (const device of item.devices) {
        const path = `${sanitizePath(device.reference)}.pdf`;
        const { error: upErr } = await supabase.storage
          .from("desenhos-tecnicos")
          .upload(path, blob, { upsert: true, contentType: "application/pdf", cacheControl: "31536000" });
        if (upErr) throw upErr;

        const { error: dbErr } = await supabase
          .from("devices")
          .update({ desenho_tecnico_path: path })
          .eq("id", device.id);
        if (dbErr) throw dbErr;
      }
    }

    for (let i = 0; i < toUpload.length; i += PARALLEL) {
      const batch = toUpload.slice(i, i + PARALLEL);
      const settled = await Promise.allSettled(batch.map(uploadOne));
      settled.forEach((res, idx) => {
        if (res.status === "rejected") {
          const msg = res.reason instanceof Error ? res.reason.message : String(res.reason);
          errors.set(batch[idx].zipPath, msg);
        }
      });
      setResults(prev => prev.map(r => {
        if (r.status !== "uploading") return r;
        if (errors.has(r.zipPath)) return { ...r, status: "error", error: errors.get(r.zipPath) };
        if (batch.some(b => b.zipPath === r.zipPath)) return { ...r, status: "done" };
        return r;
      }));
    }

    setUploading(false);
    setDone(true);
    onDone();
  }

  const statusIcon = (s: FileResult["status"]) => {
    if (s === "pending")    return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/40" />;
    if (s === "uploading")  return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    if (s === "done")       return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (s === "error")      return <XCircle className="h-4 w-4 text-red-500" />;
    if (s === "no_match")   return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    if (s === "duplicate")  return <Copy className="h-4 w-4 text-muted-foreground" />;
    if (s === "ja_enviado") return <CheckCircle2 className="h-4 w-4 text-muted-foreground" />;
  };

  function resetar() {
    setResults([]);
    setDone(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full max-w-2xl bg-card rounded-t-2xl sm:rounded-2xl border border-border/40 shadow-2xl flex flex-col max-h-[90vh]">

        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30 shrink-0">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <div>
              <h3 className="font-semibold text-sm">Upload de Desenhos Técnicos (.zip)</h3>
              <p className="text-[11px] text-muted-foreground">
                Casa pelo nome do arquivo/pasta ou, se não achar, procura os códigos dentro do próprio PDF
              </p>
            </div>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {results.length === 0 && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={extracting}
                className="w-full flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border/50 p-8 hover:border-primary/50 hover:bg-primary/5 transition-colors disabled:opacity-60"
              >
                <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                  {extracting
                    ? <Loader2 className="h-6 w-6 text-primary animate-spin" />
                    : <FileArchive className="h-6 w-6 text-primary" />}
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold">
                    {extracting
                      ? (progresso
                          ? `Lendo conteúdo dos PDFs... ${progresso.atual}/${progresso.total}`
                          : "Lendo índice do .zip...")
                      : "Selecionar arquivo .zip"}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">Pastas e subpastas são varridas automaticamente · até 3GB</p>
                  <p className="text-[10px] text-muted-foreground/70">Arquivos grandes podem levar alguns minutos para carregar — não feche esta tela</p>
                </div>
              </button>
              <input ref={fileInputRef} type="file" accept=".zip,application/zip" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) processZip(f); }} />
            </div>
          )}

          {results.length > 0 && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-3 text-center">
                  <p className="text-xl font-bold text-green-600">{counts.matched}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Arquivos casaram</p>
                </div>
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-center">
                  <p className="text-xl font-bold text-amber-600">{counts.noMatch}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Sem match</p>
                </div>
                <div className="rounded-xl border border-border/40 p-3 text-center">
                  <p className="text-xl font-bold">{counts.total}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">PDFs no zip</p>
                </div>
              </div>
              {counts.totalPecas > counts.matched && (
                <p className="text-[11px] text-violet-600 flex items-center gap-1.5">
                  <Layers className="h-3 w-3" /> {counts.totalPecas} peças serão vinculadas ao todo — alguns desenhos cobrem mais de uma peça (desenho de família).
                </p>
              )}
              {counts.familia > 0 && (
                <p className="text-[11px] text-blue-600 flex items-center gap-1.5">
                  <Layers className="h-3 w-3" /> {counts.familia} desenho(s) casado(s) por família de altura (mesmo código-base, dígito de altura na peça) — confira antes de enviar.
                </p>
              )}
              {counts.conteudo > 0 && (
                <p className="text-[11px] text-violet-600 flex items-center gap-1.5">
                  <Layers className="h-3 w-3" /> {counts.conteudo} desenho(s) casado(s) pelos códigos encontrados dentro do próprio PDF — confira antes de enviar.
                </p>
              )}
              {counts.fuzzy > 0 && (
                <p className="text-[11px] text-amber-600 flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3" /> {counts.fuzzy} correspondência(s) aproximada(s) — confira antes de enviar.
                </p>
              )}
              {counts.duplicate > 0 && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <Copy className="h-3 w-3" /> {counts.duplicate} PDF(s) ignorado(s) por casar só com peça(s) que já receberam outro arquivo neste envio.
                </p>
              )}
              {counts.jaEnviado > 0 && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3" /> {counts.jaEnviado} PDF(s) ignorado(s) — a peça já tem desenho técnico enviado (não reenvia automaticamente).
                </p>
              )}

              <div className="rounded-xl border border-border/40 overflow-hidden divide-y divide-border/20 max-h-72 overflow-y-auto">
                {results.map((r, i) => (
                  <div key={i} className={cn(
                    "flex items-center gap-3 px-3 py-2 text-[12px]",
                    r.status === "no_match"  && "bg-amber-500/5",
                    r.status === "duplicate" && "bg-muted/20",
                    r.status === "ja_enviado" && "bg-muted/20",
                    r.status === "done"      && "bg-green-500/5",
                    r.status === "error"     && "bg-red-500/5",
                    r.status === "pending" && r.matchMode === "aproximado" && "bg-amber-500/5",
                    r.status === "pending" && r.matchMode === "familia"   && "bg-blue-500/5",
                    r.status === "pending" && r.matchMode === "conteudo"  && "bg-violet-500/5",
                  )}>
                    <FileText className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-mono font-medium truncate" title={r.zipPath}>{r.zipPath}</p>
                      {r.status === "no_match" ? (
                        <p className="text-amber-600 text-[10px]">Nenhuma peça encontrada (nem pelo nome, nem pelo conteúdo do PDF)</p>
                      ) : r.status === "duplicate" ? (
                        <p className="text-muted-foreground text-[10px] truncate">Já casado por outro arquivo: {r.devices.map(d => d.reference).join(", ")}</p>
                      ) : r.status === "ja_enviado" ? (
                        <p className="text-muted-foreground text-[10px] truncate">Peça já tem desenho enviado: {r.devices.map(d => d.reference).join(", ")}</p>
                      ) : r.status === "error" ? (
                        <p className="text-red-500 text-[10px] truncate">{r.error}</p>
                      ) : r.devices.length > 0 ? (
                        <p className={cn(
                          "text-[10px] truncate",
                          r.matchMode === "aproximado" ? "text-amber-600" : r.matchMode === "familia" ? "text-blue-600" : r.matchMode === "conteudo" ? "text-violet-600" : "text-muted-foreground"
                        )}>
                          {r.matchMode === "aproximado" && "≈ "}
                          {r.matchMode === "familia" && `${r.devices.length} peça${r.devices.length !== 1 ? "s" : ""} (família de altura): `}
                          {r.matchMode === "conteudo" && `${r.devices.length} peça${r.devices.length !== 1 ? "s" : ""} (desenho de família): `}
                          {r.devices.map(d => d.reference).join(", ")}
                          {r.matchMode === "aproximado" && " (aproximado)"}
                          {r.matchMode === "conteudo" && " — achado dentro do PDF"}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0">{statusIcon(r.status)}</div>
                  </div>
                ))}
              </div>

              {!uploading && (
                <button onClick={resetar} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                  ← Selecionar outro arquivo
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-border/30 shrink-0">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={uploading}>
            {done ? "Fechar" : "Cancelar"}
          </Button>

          {counts.matched > 0 && !done && (
            <Button className="flex-1 gap-2" onClick={handleUpload} disabled={uploading}>
              {uploading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <ArrowUpCircle className="h-4 w-4" />}
              {uploading
                ? "Enviando..."
                : `Enviar ${counts.matched} desenho${counts.matched !== 1 ? "s" : ""} (${counts.totalPecas} peça${counts.totalPecas !== 1 ? "s" : ""})`}
            </Button>
          )}

          {done && (
            <div className="flex-1 flex items-center justify-center gap-2 text-green-600 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4" />
              {counts.done} enviado{counts.done !== 1 ? "s" : ""}
              {counts.errors > 0 && (
                <span className="text-red-500 ml-2">({counts.errors} erro{counts.errors !== 1 ? "s" : ""})</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
