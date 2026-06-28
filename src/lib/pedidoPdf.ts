/**
 * Geração de PDF de Pedido / Orçamento — client-side, via jsPDF.
 *
 * Segurança: todo texto vindo de dados do usuário (nome de cliente, peça,
 * observações) passa por sanitizeText() antes de entrar no PDF. A
 * documentação oficial do jsPDF recomenda explicitamente sanitizar input
 * de usuário antes de repassar à lib — isto não é opcional aqui, porque
 * nomes de cliente/peça vêm de campos de texto livre preenchidos por
 * vendedoras, não são constantes do código.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import logoZomini from "@/assets/logo_zomini.png";
import { COMPANY_NAME, COMPANY_DOCUMENT, COMPANY_ADDRESS, COMPANY_PHONE, COMPANY_EMAIL } from "@/lib/appInfo";
import type { Cliente, PedidoCompleto } from "@/types/comercial";

const FORMA_PAGAMENTO_LABELS: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  boleto: "Boleto",
  cartao_debito: "Cartão de Débito",
  cartao_credito: "Cartão de Crédito",
};

const STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente", separando: "Separando", pronto: "Pronto",
  faturado: "Faturado", enviado: "Enviado", cancelado: "Cancelado", retorno: "Em retorno",
};

/**
 * Remove caracteres de controle e limita o tamanho — defesa contra input
 * malformado/malicioso antes de repassar a texto livre para o jsPDF.
 * Não tenta fazer sanitização de HTML (o PDF não interpreta HTML), o risco
 * real aqui é texto absurdamente longo ou caracteres de controle que
 * possam confundir o layout — então a defesa é normalizar e truncar.
 */
function sanitizeText(s: string | null | undefined, maxLen = 200): string {
  if (!s) return "";
  // eslint-disable-next-line no-control-regex
  const cleaned = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
  return cleaned.slice(0, maxLen);
}

function fmtMoeda(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtData(iso: string | null, comHora = false): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : iso + "T12:00:00");
  return comHora
    ? d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Converte a URL do logo (resolvida pelo Vite em build, aponta para um
 * arquivo estático servido pelo navegador) para um data URL base64.
 * addImage do jsPDF não aceita uma URL simples como entrada — só
 * data:image/... base64, HTMLImageElement ou HTMLCanvasElement (confirmado
 * na documentação oficial e em relatos de erro "Supplied Data is not a
 * valid base64-String" ao tentar passar URL direto). Sem essa conversão, o
 * logo simplesmente não apareceria no PDF gerado, falhando em silêncio
 * dentro do try/catch que envolve addImage.
 */
async function carregarLogoBase64(): Promise<string | null> {
  try {
    const resp = await fetch(logoZomini);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function gerarPdfPedido(
  pedido: PedidoCompleto,
  cliente: Cliente | null,
  opts?: { titulo?: "Orçamento" | "Pedido"; formaPagamento?: string | null; parcelas?: number | null }
) {
  const titulo = opts?.titulo ?? (pedido.status === "pendente" ? "Orçamento" : "Pedido");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const marginX = 14;
  let y = 16;

  // ── Cabeçalho: logo + dados da empresa ──────────────────────────────────
  const logoBase64 = await carregarLogoBase64();
  if (logoBase64) {
    try {
      doc.addImage(logoBase64, "PNG", marginX, y - 4, 22, 22);
    } catch {
      // Se mesmo o base64 falhar por algum formato inesperado, segue sem o
      // logo — nunca trava a geração do documento por causa de uma imagem
      // decorativa.
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(sanitizeText(COMPANY_NAME, 80), marginX + 26, y + 2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(100);
  let infoY = y + 7;
  const infoLines = [COMPANY_DOCUMENT, COMPANY_ADDRESS, [COMPANY_PHONE, COMPANY_EMAIL].filter(Boolean).join(" · ")]
    .filter(Boolean).map(s => sanitizeText(s, 120));
  for (const line of infoLines) {
    doc.text(line, marginX + 26, infoY);
    infoY += 4;
  }
  doc.setTextColor(0);

  // Título do documento + número do pedido, alinhado à direita
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(titulo.toUpperCase(), pageW - marginX, y + 2, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Nº ${pedido.id.slice(0, 8).toUpperCase()}`, pageW - marginX, y + 8, { align: "right" });
  doc.text(`Emitido em ${fmtData(new Date().toISOString(), true)}`, pageW - marginX, y + 13, { align: "right" });
  doc.setTextColor(0);

  y = Math.max(infoY, y + 16) + 4;
  doc.setDrawColor(220);
  doc.line(marginX, y, pageW - marginX, y);
  y += 7;

  // ── Dados do cliente e do pedido ─────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Cliente", marginX, y);
  doc.text("Pedido", pageW / 2 + 4, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const clienteLines = [
    sanitizeText(cliente?.nome ?? pedido.cliente_nome, 80),
    cliente?.documento ? `CPF/CNPJ: ${sanitizeText(cliente.documento, 30)}` : null,
    cliente?.telefone ? `Tel: ${sanitizeText(cliente.telefone, 30)}` : null,
    cliente?.email ? sanitizeText(cliente.email, 60) : null,
    cliente?.endereco ? sanitizeText(cliente.endereco, 100) : null,
  ].filter(Boolean) as string[];

  const pedidoLines = [
    `Status: ${STATUS_LABELS[pedido.status] ?? pedido.status}`,
    `Data: ${fmtData(pedido.created_at)}`,
    pedido.prazo_entrega ? `Prazo de entrega: ${fmtData(pedido.prazo_entrega)}` : null,
    pedido.vendedora_nome ? `Vendedor(a): ${sanitizeText(pedido.vendedora_nome, 60)}` : null,
  ].filter(Boolean) as string[];

  let cy1 = y, cy2 = y;
  for (const l of clienteLines) { doc.text(l, marginX, cy1); cy1 += 4.5; }
  for (const l of pedidoLines) { doc.text(l, pageW / 2 + 4, cy2); cy2 += 4.5; }
  y = Math.max(cy1, cy2) + 4;

  // ── Tabela de itens ───────────────────────────────────────────────────────
  const rows = pedido.itens.map(item => {
    const unit = item.valor_unitario ?? 0;
    const total = unit * item.quantidade;
    return [
      sanitizeText(item.device_model, 60) || "—",
      sanitizeText(item.device_reference, 30) || "—",
      String(item.quantidade),
      fmtMoeda(unit),
      fmtMoeda(total),
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [["Peça", "Referência", "Qtd.", "Valor Unit.", "Total"]],
    body: rows,
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 8.5, cellPadding: 2.2 },
    headStyles: { fillColor: [124, 58, 237], textColor: 255, fontStyle: "bold" },
    columnStyles: {
      2: { halign: "right", cellWidth: 16 },
      3: { halign: "right", cellWidth: 28 },
      4: { halign: "right", cellWidth: 28 },
    },
  });

  // jspdf-autotable anexa lastAutoTable ao doc em runtime, mas a lib não
  // exporta esse campo no .d.ts (o tipo do doc ali é declarado como `any`
  // dentro da própria lib) — por isso o cast explícito aqui, restrito só ao
  // formato que de fato usamos, em vez de `any` genérico.
  const docComAutoTable = doc as jsPDF & { lastAutoTable?: { finalY: number } };
  y = (docComAutoTable.lastAutoTable?.finalY ?? y) + 8;

  // ── Totais ────────────────────────────────────────────────────────────────
  const subtotal = pedido.itens.reduce((s, i) => s + (i.valor_unitario ?? 0) * i.quantidade, 0);
  const frete = pedido.frete ?? 0;
  const total = subtotal + frete;

  const totaisX = pageW - marginX - 60;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Subtotal", totaisX, y);
  doc.text(fmtMoeda(subtotal), pageW - marginX, y, { align: "right" });
  y += 5;
  if (frete > 0) {
    doc.text("Frete", totaisX, y);
    doc.text(fmtMoeda(frete), pageW - marginX, y, { align: "right" });
    y += 5;
  }
  doc.setDrawColor(200);
  doc.line(totaisX, y, pageW - marginX, y);
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("TOTAL", totaisX, y);
  doc.text(fmtMoeda(total), pageW - marginX, y, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  y += 9;

  // ── Forma de pagamento ───────────────────────────────────────────────────
  if (opts?.formaPagamento) {
    const label = FORMA_PAGAMENTO_LABELS[opts.formaPagamento] ?? sanitizeText(opts.formaPagamento, 40);
    const parcelasTxt = opts.formaPagamento === "cartao_credito" && (opts.parcelas ?? 1) > 1
      ? ` em ${opts.parcelas}x` : "";
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`Forma de pagamento: ${label}${parcelasTxt}`, marginX, y);
    y += 7;
  }

  // ── Observações ───────────────────────────────────────────────────────────
  if (pedido.observacoes) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text("Observações", marginX, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    const obsLines = doc.splitTextToSize(sanitizeText(pedido.observacoes, 1000), pageW - marginX * 2);
    doc.text(obsLines, marginX, y);
    y += obsLines.length * 4 + 4;
  }

  // ── Rodapé ────────────────────────────────────────────────────────────────
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(7.5);
  doc.setTextColor(150);
  doc.text(
    titulo === "Orçamento" ? "Este documento não possui valor fiscal." : "Documento gerado pelo sistema.",
    pageW / 2, pageH - 10, { align: "center" }
  );

  return doc;
}

export async function baixarPdfPedido(
  pedido: PedidoCompleto,
  cliente: Cliente | null,
  opts?: { titulo?: "Orçamento" | "Pedido"; formaPagamento?: string | null; parcelas?: number | null }
) {
  const doc = await gerarPdfPedido(pedido, cliente, opts);
  const titulo = opts?.titulo ?? (pedido.status === "pendente" ? "Orcamento" : "Pedido");
  const numero = pedido.id.slice(0, 8).toUpperCase();
  doc.save(`${titulo}-${numero}.pdf`);
}
