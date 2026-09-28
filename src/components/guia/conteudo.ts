/**
 * Conteúdo do Guia de uso — fonte única para a tela /guia e para o PDF
 * (public/guia-de-uso.pdf é gerado a partir deste arquivo).
 *
 * Regras de escrita: português simples, orientado a tarefas ("como fazer"),
 * com os nomes reais das abas e botões. Use **negrito** para nomes de botões,
 * abas e campos (a tela e o PDF entendem essa marcação).
 *
 * Perfis: `perfis` vazio/ausente = todo mundo. A seção passa os perfis para as
 * tarefas que não definem os seus. Admin vê tudo; Gerente vê tudo que tiver
 * algum perfil operacional (nunca o que é só "admin").
 *
 * NÃO coloque aqui nada operacional sensível (endereços internos, chaves,
 * comandos de banco etc.) — este conteúdo é público dentro do app e no PDF.
 */
import type { AppRole } from "@/types/roles";

export type IconeGuia =
  | "inicio" | "perfis" | "fluxo" | "componentes" | "estoque" | "comercial" | "financeiro"
  | "producao" | "qualidade" | "processos" | "admin" | "faq" | "glossario";

export interface TarefaGuia {
  /** Parte final da âncora: #<secao>-<id>. Só letras minúsculas, números e hífen. */
  id: string;
  titulo: string;
  /** Quem usa. Ausente = herda da seção (ou todos). */
  perfis?: AppRole[];
  /** Uma frase dizendo para que serve. */
  resumo?: string;
  passos: string[];
  dicas?: string[];
  atencao?: string[];
  /** Rota específica para "Abrir no sistema" (ex.: "/financeiro?aba=contas"). */
  rota?: string;
  /** Outras palavras que as pessoas usam para buscar esta tarefa (não aparecem na tela). */
  palavras?: string;
}

export interface SecaoGuia {
  id: string;
  titulo: string;
  /** Uma ou duas frases no topo da seção. */
  resumo: string;
  icone: IconeGuia;
  /** Rota do módulo (botão "Abrir o módulo"). */
  rota?: string;
  perfis?: AppRole[];
  /** "modulo" aparece no índice de módulos; "geral" é ajuda transversal. */
  tipo: "geral" | "modulo";
  tarefas: TarefaGuia[];
}

export interface EtapaFluxo {
  quem: string;
  perfis: AppRole[];
  titulo: string;
  texto: string;
  /** Âncora da tarefa detalhada (#secao-tarefa). */
  ancora?: string;
  situacao?: string;
}

export interface PerguntaFAQ {
  id: string;
  pergunta: string;
  resposta: string[];
  perfis?: AppRole[];
  /** Âncora de uma tarefa relacionada. */
  ancora?: string;
}

export interface TermoGlossario {
  termo: string;
  definicao: string;
}

export interface PerfilGuia {
  role: AppRole;
  nome: string;
  resumo: string;
  modulos: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Perfis
// ─────────────────────────────────────────────────────────────────────────────

export const PERFIS_GUIA: PerfilGuia[] = [
  { role: "admin", nome: "Admin", resumo: "Vê e faz tudo, inclusive usuários, backup, auditoria, ativação do emissor de NF-e e limpeza de históricos.", modulos: ["Todos os módulos", "Admin"] },
  { role: "gerente", nome: "Gerente", resumo: "Todos os módulos com as funções de cada perfil (vende, separa, fatura, aponta, analisa). Não entra no Admin, não apaga históricos e não ativa o emissor.", modulos: ["Componentes", "Estoque", "Qualidade", "Comercial", "Financeiro", "Produção", "Processos"] },
  { role: "comercial", nome: "Comercial (vendedora)", resumo: "Clientes, pedidos, histórico e tabela de preços (sem custo). Cada vendedora vê os próprios pedidos e clientes.", modulos: ["Comercial"] },
  { role: "estoque", nome: "Estoque", resumo: "Entradas, retiradas e movimentos entre fases, separação de pedidos, recebimento de material de embalagem.", modulos: ["Componentes", "Estoque"] },
  { role: "financeiro", nome: "Financeiro", resumo: "Faturamento (NF-e), devoluções fiscais, contas a pagar e a receber, conciliação bancária, preços e custos.", modulos: ["Financeiro"] },
  { role: "producao", nome: "Produção", resumo: "Diário, apontamento detalhado, planejamento, paradas, refugo, matéria-prima, metas e indicadores. Também usa Processos.", modulos: ["Componentes", "Produção", "Processos"] },
  { role: "qualidade", nome: "Qualidade", resumo: "Devoluções e laudos, pós-venda e recall, regularização ANVISA, rastreio de lotes e GS1. Consulta o Estoque.", modulos: ["Componentes", "Estoque (consulta)", "Qualidade"] },
  { role: "processos", nome: "Processos", resumo: "Ferramentas de corte, faltas, compras, fornecedores e programas CNC.", modulos: ["Processos"] },
];

// ─────────────────────────────────────────────────────────────────────────────
// Fluxo ponta a ponta: da venda à entrega
// ─────────────────────────────────────────────────────────────────────────────

export const FLUXO_VENDA: EtapaFluxo[] = [
  {
    quem: "Comercial", perfis: ["comercial"], titulo: "Cria o pedido",
    texto: "A vendedora escolhe o cliente e as peças em **Novo pedido**. As peças ficam reservadas na expedição. Depois confere e toca em **Confirmar pedido**.",
    ancora: "comercial-novo-pedido", situacao: "Aguardando confirmação → Em separação",
  },
  {
    quem: "Estoque", perfis: ["estoque"], titulo: "Separa por lote",
    texto: "Na aba **Pedidos** do Estoque, escolhe os lotes de cada peça e toca em **Marcar como pronto**. As peças saem da expedição pelos lotes escolhidos. Se algo estiver errado, usa **Devolver ao Comercial**.",
    ancora: "estoque-separar-pedido", situacao: "Em separação → Pronto",
  },
  {
    quem: "Financeiro", perfis: ["financeiro"], titulo: "Fatura",
    texto: "Em **Faturamento → A faturar**, emite a NF-e (**Emitir NF-e**) ou registra a nota feita em outro sistema (**Registrar NF-e**, lendo o XML — ou **Registrar vários XMLs** para muitas notas de uma vez). A conta a receber é criada sozinha, por parcela.",
    ancora: "financeiro-registrar-nfe", situacao: "Pronto → Faturado/Enviado",
  },
  {
    quem: "Estoque", perfis: ["estoque"], titulo: "Embala e despacha",
    texto: "Com a nota emitida, o card do pedido mostra \"NF emitida — pedido enviado\". O estoque imprime o pedido (**Imprimir**), embala e despacha. A vendedora acompanha a NF no card do pedido.",
    ancora: "estoque-imprimir-pedido", situacao: "Enviado",
  },
  {
    quem: "Financeiro", perfis: ["financeiro"], titulo: "Recebe",
    texto: "Quando o cliente paga, o financeiro dá baixa em **Contas → A receber** (**Receber**) ou importa o extrato do banco em **Conciliar extrato**.",
    ancora: "financeiro-baixa", situacao: "Conta paga",
  },
  {
    quem: "Qualidade", perfis: ["qualidade"], titulo: "Rastreia e trata devoluções",
    texto: "Cada envio fica ligado ao lote e ao cliente em **Pós-venda** (para recall). Se a peça voltar, a Qualidade registra o retorno, faz o laudo e o Financeiro faz a NF de devolução; o valor vira crédito do cliente.",
    ancora: "qualidade-devolucao", situacao: "Rastreável",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Seções
// ─────────────────────────────────────────────────────────────────────────────

export const SECOES_GUIA: SecaoGuia[] = [
  // ── Primeiros passos ────────────────────────────────────────────────────────
  {
    id: "inicio", titulo: "Primeiros passos", icone: "inicio", tipo: "geral",
    resumo: "Entrar no sistema, criar a sua senha, achar o menu no celular e no computador e pedir ajuda.",
    tarefas: [
      {
        id: "login", titulo: "Entrar no sistema", palavras: "senha acesso entrar logar",
        passos: [
          "Abra o endereço do sistema no navegador (celular ou computador).",
          "Digite o seu **Login** (ex.: joao.silva) e a **Senha** que o administrador passou.",
          "Toque em **Entrar**. Você cai direto na tela do seu perfil (ex.: vendedora cai no Comercial).",
        ],
        dicas: [
          "Se aparecer \"Caps Lock está ativado\", desligue o Caps Lock antes de digitar a senha.",
          "O login precisa de internet. Sem conexão aparece um aviso.",
        ],
        atencao: [
          "Esqueceu a senha? Peça ao administrador para redefinir. Não existe \"recuperar por e-mail\".",
          "\"Acesso bloqueado\" ou \"Acesso suspenso\" significa que o administrador desativou a conta — fale com ele.",
        ],
      },
      {
        id: "primeira-senha", titulo: "Criar a sua senha no primeiro acesso", palavras: "trocar senha nova senha primeiro acesso",
        resumo: "No primeiro acesso (ou depois que o administrador redefinir a senha) o sistema pede uma senha pessoal.",
        passos: [
          "Depois de entrar, aparece a tela **Primeiro acesso**.",
          "Em **Nova senha**, crie uma senha com 8 caracteres ou mais, uma letra maiúscula, uma minúscula, um número e um símbolo (ex.: ! @ # $).",
          "Os requisitos ficam verdes conforme você digita. Repita a senha em **Repita a senha**.",
          "Toque em **Definir senha e entrar**.",
        ],
        dicas: ["Só você sabe essa senha. Não anote em papel colado no monitor."],
      },
      {
        id: "menu-celular", titulo: "Usar o menu no celular", palavras: "navegar abas telefone",
        passos: [
          "Na parte de baixo da tela fica a barra com até 4 módulos do seu perfil e o botão **Menu**.",
          "Toque em **Menu** para abrir a gaveta: todos os módulos, **Guia de uso**, **Manuais**, **Sobre / Ajuda**, **Reportar problema**, **Modo escuro** e **Sair**.",
          "No topo, o logo leva para a sua tela inicial e o botão **Guia** abre este guia.",
          "Dentro de cada módulo, as abas ficam logo abaixo do título. Arraste para o lado para ver todas.",
        ],
        dicas: ["A aba aberta fica no endereço da página: se atualizar a tela, você continua na mesma aba (Estoque, Financeiro, Qualidade, Processos e Admin)."],
      },
      {
        id: "menu-computador", titulo: "Usar o menu no computador",
        passos: [
          "O menu fica na lateral esquerda, com as partes **Módulos**, **Administração** (só admin) e **Ajuda**.",
          "Use o ícone ao lado do logo para **recolher** o menu e ganhar espaço. Com ele recolhido, passe o mouse no ícone para ver o nome.",
          "No rodapé do menu ficam **Modo escuro/Modo claro**, o seu nome e perfil e o botão **Sair**.",
        ],
        dicas: ["Atalho: **Ctrl+K** (ou Cmd+K no Mac) abre a busca do Estoque, para quem tem acesso."],
      },
      {
        id: "modo-escuro", titulo: "Ligar o modo escuro", palavras: "tema escuro claro noturno",
        passos: [
          "Computador: no rodapé do menu lateral, clique em **Modo escuro** (ou **Modo claro** para voltar).",
          "Celular: toque em **Menu** e depois em **Modo escuro**.",
        ],
        dicas: ["A escolha fica salva no aparelho."],
      },
      {
        id: "notificacoes", titulo: "Ver notificações",
        passos: [
          "Vendedoras: o sino fica no topo do módulo Comercial. Um número indica avisos novos (ex.: pedido que voltou do estoque).",
          "Admin: o sino fica no rodapé do menu lateral (computador) ou no topo (celular).",
          "Abra o sino e toque em **Marcar todas como lidas** (ou **Ler todas**) depois de ver.",
        ],
      },
      {
        id: "reportar-problema", titulo: "Reportar um problema ou dar uma sugestão", palavras: "erro bug suporte ajuda feedback sugestao",
        passos: [
          "Celular: **Menu → Reportar problema**. Computador: **Sobre / Ajuda** no menu lateral.",
          "Escolha o tipo: **Problema**, **Sugestão** ou **Outro**.",
          "Escreva o que aconteceu (o que você tentou fazer e o que apareceu) e envie.",
        ],
        dicas: ["A mensagem já vai com a tela em que você estava. O administrador acompanha em Admin → Feedback."],
      },
      {
        id: "manuais", titulo: "Abrir manuais e catálogos em PDF",
        passos: [
          "Abra **Manuais** no menu (Ajuda) para ver e baixar os manuais em PDF.",
          "Em Componentes, os botões **Catálogo** e **Manuais** no topo abrem os arquivos dos produtos.",
        ],
      },
    ],
  },

  // ── Componentes ────────────────────────────────────────────────────────────
  {
    id: "componentes", titulo: "Componentes", icone: "componentes", tipo: "modulo", rota: "/",
    perfis: ["estoque", "qualidade", "producao"],
    resumo: "Catálogo dos dispositivos cadastrados (base ANVISA): dados técnicos, UDI/GTIN, imagens e desenhos técnicos.",
    tarefas: [
      {
        id: "buscar", titulo: "Buscar um componente",
        passos: [
          "Abra **Componentes** no menu.",
          "Bipe o código de barras com o leitor ou digite nome, referência ou UDI no campo de busca.",
          "Use **Filtros** para material, classe, esterilidade, uso único e Exocad, ou toque numa letra para filtrar pela inicial.",
          "Toque no card para ver todos os dados (registro ANVISA, materiais, uso pretendido etc.).",
        ],
        dicas: ["**Limpar busca e filtros** volta a lista completa."],
      },
      {
        id: "desenho", titulo: "Ver ou imprimir o desenho técnico",
        passos: [
          "Encontre a peça em Componentes.",
          "No card, toque em **Desenho técnico**. O PDF abre para ver ou imprimir.",
        ],
        dicas: ["No card também dá para tocar no GTIN/UDI para copiar o código."],
        atencao: ["Se o botão não aparecer, a peça ainda não tem desenho carregado — o admin envia em Admin → Dispositivos → Desenhos."],
      },
    ],
  },

  // ── Estoque ─────────────────────────────────────────────────────────────────
  {
    id: "estoque", titulo: "Estoque", icone: "estoque", tipo: "modulo", rota: "/estoque",
    perfis: ["estoque"],
    resumo: "As peças passam por fases: Intermediário (entrada por lote) → Expedição (embalada, pronta para venda) ⇄ Retrabalho. Aqui também se separam os pedidos do Comercial e se registra o material de embalagem recebido.",
    tarefas: [
      {
        id: "fases", titulo: "Entender as fases e a tela", perfis: ["estoque", "qualidade"], rota: "/estoque?aba=dashboard",
        passos: [
          "**Visão geral**: busca \"Onde está a peça?\" (todas as fases, lotes, localização, reservas), itens que precisam de atenção e últimas movimentações.",
          "**Intermediário**: peças que acabaram de chegar da produção, por lote.",
          "**Expedição**: peças prontas para venda. É daqui que o Comercial vende.",
          "**Retrabalho**: peças que precisam voltar a ser trabalhadas (ou que voltaram de cliente).",
          "**Recebimento**: material de embalagem (etiqueta, envelope, sachê).",
          "**Pedidos**: separação dos pedidos confirmados pelo Comercial.",
          "Toque numa peça para abrir o detalhe com as abas **Lotes**, **Movimentações** e **Ajustes**.",
        ],
        dicas: ["O perfil Qualidade consulta tudo, mas não altera."],
      },
      {
        id: "adicionar-peca", titulo: "Colocar uma peça nova no estoque", rota: "/estoque?aba=intermediaria",
        passos: [
          "Em uma fase (ex.: Intermediário), toque em **Adicionar peça**.",
          "Busque pelo modelo, referência, UDI ou bipe o código.",
          "Toque em **Adicionar ao estoque**. A peça aparece com saldo zero; faça a **Entrada** do lote em seguida.",
        ],
        atencao: ["Se a peça não aparece na busca, ela ainda não existe no catálogo — peça ao admin para cadastrar em Admin → Dispositivos."],
      },
      {
        id: "entrada", titulo: "Dar entrada de um lote (Intermediário)", rota: "/estoque?aba=intermediaria", palavras: "entrada lote chegou producao lancar",
        passos: [
          "Abra a aba **Intermediário** e ache a peça (busque ou bipe).",
          "Toque em **Entrada**.",
          "Digite o **lote** no formato DDMMAAT-NN com turno (ex.: 0101261-01) ou DDMMAA-NN para peça de terceiro (ex.: 010126-01).",
          "Informe a quantidade, uma observação se quiser, e confirme.",
        ],
        dicas: ["Se o lote já existe, o sistema avisa e soma a quantidade ao mesmo lote."],
      },
      {
        id: "mover-expedicao", titulo: "Mover para a Expedição", rota: "/estoque?aba=intermediaria",
        passos: [
          "Na aba **Intermediário**, toque em **Mover p/ Expedição** na peça.",
          "Escolha o lote e a quantidade.",
          "Confira o resultado (quanto fica no intermediário e quanto a expedição recebe) e confirme.",
        ],
        atencao: ["Lote sem numeração não pode ser movido. Registre antes uma entrada com lote válido."],
      },
      {
        id: "retirada", titulo: "Fazer uma retirada da Expedição", rota: "/estoque?aba=expedicao", palavras: "saida baixa tirar",
        passos: [
          "Na aba **Expedição**, toque em **Retirada** na peça.",
          "Escolha o lote com saldo, a quantidade e escreva o motivo na observação.",
          "Confirme.",
        ],
        dicas: ["Venda não se faz por retirada: as peças vendidas saem sozinhas quando o pedido é marcado como pronto."],
      },
      {
        id: "retrabalho", titulo: "Enviar para retrabalho e concluir", rota: "/estoque?aba=retrabalho",
        passos: [
          "Na **Expedição**, toque em **Retrabalho** na peça, escolha o lote e a quantidade.",
          "As unidades vão para a fila da aba **Retrabalho**, mantendo o mesmo lote.",
          "Quando terminar, na aba **Retrabalho** toque em **Concluir → Expedição**, escolha o lote e a quantidade.",
        ],
      },
      {
        id: "estorno", titulo: "Corrigir um lançamento errado (estorno)", palavras: "corrigir desfazer erro lancamento errado",
        resumo: "Movimentações não são apagadas (rastreabilidade ANVISA). Para corrigir, faz-se um lançamento contrário.",
        passos: [
          "Abra a peça e vá na aba **Movimentações**.",
          "No lançamento errado, toque em **Estornar**.",
          "Escreva o motivo do estorno (obrigatório) e confirme. É lançada uma entrada/saída contrária no mesmo lote.",
          "Se precisar, faça o lançamento certo em seguida.",
        ],
        atencao: [
          "Só entradas e retiradas feitas à mão podem ser estornadas. Movimentos automáticos (mover entre fases, retrabalho, pedidos, notas fiscais) não — estornar só um lado deixaria as fases ou o pedido errados. Nesses casos faça o movimento contrário pelo botão da fase ou fale com o Comercial/Financeiro.",
          "Para estornar uma entrada, o lote precisa ter saldo suficiente.",
        ],
      },
      {
        id: "ajustes", titulo: "Ajustar mínimo, localização e observações",
        passos: [
          "Abra a peça e vá na aba **Ajustes**.",
          "Preencha **Estoque mínimo (un.)** — abaixo disso a peça aparece como \"Baixo\". Use 0 para não alertar.",
          "Preencha **Localização** (ex.: Prateleira B3, gaveta 2) e **Observações**, e salve.",
        ],
      },
      {
        id: "alertas", titulo: "Ver alertas de estoque baixo", perfis: ["estoque", "qualidade"],
        passos: [
          "Na **Visão geral**, o quadro **Precisa de atenção** lista as peças abaixo do mínimo.",
          "Nas fases, o aviso **abaixo do mínimo** no topo abre a lista **Estoque baixo**.",
          "Use o filtro **Situação do saldo** (em **Filtros**) para ver só as peças baixas ou zeradas.",
        ],
        dicas: ["Sem mínimo definido não há alerta. Defina na aba Ajustes de cada peça."],
      },
      {
        id: "separar-pedido", titulo: "Separar um pedido do Comercial", rota: "/estoque?aba=pedidos", palavras: "separacao pronto lote pedido venda",
        passos: [
          "Abra a aba **Pedidos**. O número na aba mostra quantos estão para separar.",
          "Toque no pedido para abrir. As peças já vêm reservadas e o sistema sugere os lotes mais antigos primeiro.",
          "Marque os lotes de cada peça e ajuste as quantidades com − e +.",
          "Com mais de uma peça, toque em **Confirmar esta peça** em cada uma.",
          "Toque em **Marcar como pronto**. As peças saem da expedição pelos lotes escolhidos e o pedido vai para o Financeiro faturar.",
        ],
        dicas: [
          "**Endereço** muda o endereço de entrega (em branco = endereço do cadastro do cliente).",
          "Se faltar peça ou a quantidade estiver errada, use **Devolver ao Comercial** e escreva o motivo. As reservas continuam valendo e a vendedora é avisada.",
        ],
        atencao: ["Cancelar pedido no estoque é só para admin. O cancelamento libera as reservas."],
      },
      {
        id: "imprimir-pedido", titulo: "Imprimir e despachar o pedido", rota: "/estoque?aba=pedidos",
        passos: [
          "Depois que o Financeiro fatura, o pedido aparece como **NF emitida — pedido enviado**.",
          "Abra o pedido e toque em **Imprimir** para a folha de separação/envio.",
          "Embale e despache.",
          "Para um resumo do mês, use **Imprimir mês** no topo da lista (imprime os pedidos da lista atual).",
        ],
      },
      {
        id: "recebimento", titulo: "Registrar material de embalagem recebido", rota: "/estoque?aba=recebimento",
        passos: [
          "Abra a aba **Recebimento** e toque em **Registrar recebimento**.",
          "Bipe ou digite o **Número do Lote**, escolha o **Tipo de Material** (etiqueta, envelope ou sachê), a quantidade e a descrição (ex.: térmica 40x60mm).",
          "Informe o fornecedor/NF se quiser e salve.",
          "Quando o material for usado, toque em **Confirmar retirada**. Ele passa para \"Retirado\" e não volta.",
        ],
      },
      {
        id: "etiquetas-listas", titulo: "Etiquetas, listas e importação",
        passos: [
          "Toque no menu **⋮** (Mais opções) no topo do Estoque.",
          "**Lotes do intermediário**: ver os lotes com saldo e imprimir a etiqueta (impressora Zebra ou impressão comum).",
          "**Lista para imprimir**: lista das peças da fase.",
          "**Todas as movimentações**: histórico geral.",
          "**Importar Excel / PDF** e **Importar CSV**: carregar saldos de uma planilha.",
        ],
      },
    ],
  },

  // ── Comercial ───────────────────────────────────────────────────────────────
  {
    id: "comercial", titulo: "Comercial", icone: "comercial", tipo: "modulo", rota: "/comercial",
    perfis: ["comercial"],
    resumo: "Clientes, pedidos de venda, histórico e tabela de preços. Abas: Painel, Pedidos, Clientes, Histórico e Preços.",
    tarefas: [
      {
        id: "cadastrar-cliente", titulo: "Cadastrar ou editar um cliente", palavras: "cliente cnpj cpf cadastro endereco",
        passos: [
          "Abra a aba **Clientes** e toque em **Novo cliente** (ou em **Editar cadastro** num cliente).",
          "Preencha o **Nome** e o **CPF ou CNPJ**. Com CNPJ, toque na lupa para buscar os dados na Receita.",
          "Preencha o **CEP**: rua, bairro e cidade são completados sozinhos. Confira o número.",
          "Informe a **Inscrição estadual** (número, ISENTO ou vazio para consumidor), telefone e e-mail, e salve.",
        ],
        dicas: ["O endereço é usado na NF-e. Cadastro incompleto atrasa o faturamento."],
        atencao: ["Se o CPF/CNPJ já existe, aparece o aviso com **Usar este**. Use o cadastro que já existe em vez de criar outro."],
      },
      {
        id: "clientes-repetidos", titulo: "Juntar clientes repetidos", perfis: ["gerente"],
        passos: [
          "Na aba **Clientes**, toque no botão âmbar **N repetidos** (aparece só quando há repetidos).",
          "Os cadastros com o mesmo CPF/CNPJ ou o mesmo nome aparecem agrupados.",
          "Escolha qual cadastro **fica**. Os pedidos e o histórico dos outros passam para ele e os campos vazios são completados.",
        ],
        atencao: ["Não dá para desfazer. Confira antes qual cadastro está mais completo."],
      },
      {
        id: "novo-pedido", titulo: "Fazer um novo pedido", palavras: "venda orcamento vender pedido",
        passos: [
          "Na aba **Pedidos**, toque em **Novo pedido**.",
          "**Cliente**: busque por nome, CNPJ/CPF ou cidade (ou **Cadastrar cliente novo**). Veja os alertas: títulos vencidos, crédito e último pedido.",
          "**Peças disponíveis**: todas as peças de Componentes aparecem. Busque e toque em **+** para adicionar. Os filtros **Já comprou** e **Favoritas** (estrela) ajudam a achar rápido.",
          "No carrinho, ajuste a quantidade com − e + e, se for o caso, o **Desconto %** de cada peça.",
          "Escolha o **Pagamento** (PIX, Boleto, Cartão crédito, Cartão débito, Dinheiro) e as parcelas, **Prazo de entrega**, **Frete** e **Entrega** (endereço do cliente ou outro).",
          "No celular, toque em **Revisar pedido**. Confira o total e toque em **Criar pedido**.",
          "O pedido fica **Aguardando confirmação**. Quando estiver tudo certo, toque em **Confirmar pedido** no card: ele vai para o Estoque separar.",
        ],
        dicas: [
          "As peças são reservadas assim que o pedido é criado — ninguém vende a mesma peça duas vezes.",
          "**Orçamento** no card gera o PDF para mandar ao cliente antes de confirmar.",
          "**Repetir** cria um novo pedido igual a um anterior.",
        ],
        atencao: [
          "Só dá para adicionar peça com saldo na **Expedição**. As outras aparecem apagadas com \"sem saldo na expedição\" ou \"sem saldo · N em produção\".",
          "O desconto é limitado ao máximo da tabela de preços. Acima disso, só admin, gerente ou financeiro liberam.",
          "\"Peça sem preço\": avise o financeiro para cadastrar o preço.",
        ],
      },
      {
        id: "usar-credito", titulo: "Usar o crédito de devolução do cliente",
        passos: [
          "No **Novo pedido**, escolha o cliente. Se ele tiver crédito, aparece **Usar crédito de devolução (R$ ...)**.",
          "Marque a opção. O valor é abatido do total (até o valor do pedido).",
          "Crie o pedido normalmente. O card mostra \"crédito −R$ ...\" e a conta a receber já sai com o desconto.",
        ],
      },
      {
        id: "editar-dados", titulo: "Editar pagamento, prazo, frete ou entrega",
        passos: [
          "No card do pedido **Aguardando confirmação**, toque no lápis (**Editar dados do pedido**).",
          "Mude pagamento, prazo, frete, entrega ou observações e salve.",
        ],
        atencao: ["Só dá para editar enquanto o pedido está aguardando confirmação. Depois de confirmado, fale com o Estoque (ele pode devolver o pedido ao Comercial)."],
      },
      {
        id: "adicionar-peca", titulo: "Adicionar ou remover peça de um pedido",
        passos: [
          "No card do pedido **Aguardando confirmação**, toque em **Peça**.",
          "Busque a peça, escolha a quantidade e o desconto (até o máximo) e confirme. A reserva é feita junto.",
          "Para tirar uma peça, toque no **×** ao lado dela (o pedido precisa ter mais de uma peça).",
        ],
      },
      {
        id: "pedido-voltou", titulo: "Pedido que voltou do Estoque",
        passos: [
          "O card fica laranja com a situação **Voltou do estoque**. Toque em **Ver motivo**.",
          "Toque em **Editar pedido**, corrija (peças, quantidades, condições) e toque em **Salvar e reenviar ao estoque**.",
          "Ou, se nada precisar mudar, toque em **Reenviar ao Estoque**.",
        ],
        dicas: ["Use **Recados** para conversar com o estoque e o financeiro sobre o pedido."],
      },
      {
        id: "acompanhar", titulo: "Acompanhar os pedidos",
        passos: [
          "Na aba **Pedidos**, use a busca (cliente, nº do pedido, NF ou vendedora) e os contadores por situação (Aguardando, Em separação, Prontos, Faturados, Voltaram, Cancelados).",
          "A barra de etapas do card mostra: Pedido → Separação → Pronto → Faturado → Enviado.",
          "Com a nota emitida, o card mostra o número da NF, o pagamento e o rastreio (quando houver). **PDF** baixa o pedido.",
        ],
      },
      {
        id: "historico", titulo: "Ver histórico e relatório de vendas",
        passos: [
          "**Histórico**: filtre por situação, vendedora e período; **Excel** exporta a lista. **Movimentações** mostra as entradas e saídas da expedição ligadas aos pedidos.",
          "Num cliente, toque em **Histórico de pedidos** para ver o que ele comprou e o último pedido.",
          "**Painel**: vendas por mês, clientes que mais compraram, peças mais vendidas e o relatório de pedidos em PDF.",
        ],
      },
      {
        id: "tabela-precos", titulo: "Consultar a tabela de preços", palavras: "preco valor lista",
        passos: [
          "Abra a aba **Preços**.",
          "Busque por nome, referência ou código. Veja o preço de venda, o desconto máximo e o preço mínimo.",
          "Use **Imprimir** ou **Excel** para mandar a tabela.",
        ],
        dicas: ["Os preços são definidos pelo Financeiro. A tabela do Comercial não mostra custo nem margem."],
      },
    ],
  },

  // ── Financeiro ──────────────────────────────────────────────────────────────
  {
    id: "financeiro", titulo: "Financeiro", icone: "financeiro", tipo: "modulo", rota: "/financeiro",
    perfis: ["financeiro"],
    resumo: "Faturamento com NF-e, devoluções fiscais, contas a pagar e a receber, fluxo de caixa, preços e configurações. Abas: Visão geral, Faturamento, Contas, Preços e custos, Configurações.",
    tarefas: [
      {
        id: "visao-geral", titulo: "Ver o resumo do dia", rota: "/financeiro?aba=visao",
        passos: [
          "Abra **Financeiro → Visão geral**.",
          "Veja os cards de resumo (toque para abrir a lista) e o quadro **Vencidas e vencendo nos próximos 7 dias**.",
        ],
      },
      {
        id: "emitir-nfe", titulo: "Faturar com o emissor ativo (Emitir NF-e)", rota: "/financeiro?aba=faturamento", palavras: "nota fiscal nfe nf faturar emitir",
        passos: [
          "Abra **Faturamento → A faturar**. Aparecem os pedidos que o Estoque marcou como prontos.",
          "Se aparecer \"Cadastro do cliente incompleto\", corrija os dados pedidos na própria janela.",
          "Toque em **Emitir NF-e**. Confira a natureza da operação, NCM e CFOP de cada item e as informações adicionais.",
          "Toque em **Emitir NF-e** na janela. Com a nota autorizada, abra o DANFE em **Abrir DANFE** e toque em **Concluir**.",
        ],
        dicas: [
          "O CFOP é ajustado sozinho para dentro/fora do estado. Lote, validade e registro ANVISA vão em cada item.",
          "Se a SEFAZ estiver processando, acompanhe em **Notas emitidas**.",
        ],
      },
      {
        id: "registrar-nfe", titulo: "Faturar sem emissor (Registrar NF-e pelo XML)", rota: "/financeiro?aba=faturamento", palavras: "nota fiscal nfe nf xml faturar importar",
        resumo: "Quando a nota é emitida em outro sistema, registre-a aqui para faturar o pedido e criar a conta a receber.",
        passos: [
          "Emita a nota no sistema que vocês usam e baixe o **XML**.",
          "Em **Faturamento → A faturar**, toque em **Registrar NF-e** no pedido.",
          "Escolha ou arraste o XML. Chave, número, data e valor são preenchidos sozinhos e o XML fica guardado por 5 anos.",
          "Sem o XML, digite a **Chave de acesso (44 números)**, a data e o valor.",
          "Confirme. O pedido fica faturado/enviado e a conta a receber é criada por parcela.",
        ],
        atencao: [
          "Se o valor da nota for diferente do pedido ou o destinatário não for o cliente do pedido, o sistema pede para você marcar a confirmação. Confira antes.",
          "O XML precisa ser da nota da própria empresa (o CNPJ do emitente é conferido).",
        ],
      },
      {
        id: "registrar-varios-xmls", titulo: "Registrar vários XMLs de uma vez", rota: "/financeiro?aba=faturamento", palavras: "nota fiscal nfe nf xml lote importar varias notas danfe",
        resumo: "Para quando várias notas foram emitidas em outro sistema: o sistema liga cada nota ao pedido certo sozinho.",
        passos: [
          "Em **Faturamento → A faturar**, toque em **Registrar vários XMLs**.",
          "Solte (ou escolha) os XMLs das notas. Pode mandar os PDFs do DANFE junto: o PDF é ligado à nota pela chave no nome do arquivo ou pelo mesmo nome do XML.",
          "Cada nota é ligada ao pedido pronto do mesmo CPF/CNPJ e mesmo total (diferença de até R$ 0,05).",
          "Confira as etiquetas: **verde** = cliente e valor batem (já vem marcada); **âmbar** = cliente bate, valor diferente (marque só depois de conferir).",
          "Se precisar, troque o pedido no seletor de cada nota.",
          "Toque em **Registrar N notas**. Os pedidos ficam faturados e as contas a receber são criadas.",
        ],
        dicas: [
          "Notas que já estão no sistema e notas de devolução são puladas sozinhas (devolução se registra em Devoluções e trocas).",
          "O botão **Registrar NF-e** de cada pedido continua funcionando para uma nota só.",
        ],
        atencao: [
          "Etiqueta âmbar: a conta a receber usa o valor da nota, não o do pedido.",
          "Duas notas não podem apontar para o mesmo pedido — ajuste antes de registrar.",
        ],
      },
      {
        id: "emitir-lote", titulo: "Emitir notas em lote", rota: "/financeiro?aba=faturamento", palavras: "nota fiscal nfe nf emitir varias lote",
        resumo: "Com o emissor ativo e mais de um pedido pronto, emite uma NF-e por pedido de uma vez.",
        passos: [
          "Em **Faturamento → A faturar**, toque em **Emitir em lote** (aparece só com o emissor ativo e mais de um pedido).",
          "Marque os pedidos. Pedidos com cadastro do cliente incompleto ficam desativados — corrija o cadastro antes.",
          "Toque em **Emitir**. Cada pedido recebe sua NF-e com a natureza, o NCM e o CFOP padrão.",
          "Veja o resultado de cada linha. Os que falharem podem ser enviados de novo.",
        ],
        atencao: ["Se aparecer o aviso de **homologação**, as notas são de teste e não têm valor fiscal."],
      },
      {
        id: "notas-emitidas", titulo: "Consultar notas emitidas", rota: "/financeiro?aba=faturamento", palavras: "nota fiscal nfe nf danfe xml",
        passos: [
          "Em **Faturamento → Notas emitidas**, escolha o mês e a situação, ou busque por número, cliente ou chave.",
          "Na nota: **DANFE** abre o PDF; em **Mais ações**: **Baixar XML**, **Copiar chave**, **Consultar na SEFAZ**, **Anexar XML** ou **Anexar DANFE (PDF)**.",
          "**Excel** exporta a lista do mês.",
        ],
      },
      {
        id: "cancelar-nfe", titulo: "Cancelar uma nota", rota: "/financeiro?aba=faturamento", palavras: "nota fiscal nfe nf cancelamento",
        passos: [
          "Em **Notas emitidas**, abra **Mais ações → Cancelar nota**.",
          "Escreva o motivo (mínimo 15 caracteres).",
          "Nota emitida em outro sistema: cancele primeiro lá (na SEFAZ) e informe aqui o **Protocolo do cancelamento**.",
          "Confirme. O pedido volta para \"pronto\" e as contas a receber da nota são canceladas.",
        ],
        atencao: [
          "Em SP o prazo normal é 24 h depois da emissão. Fora dele a SEFAZ pode recusar — consulte o contador.",
          "Nota com parcela já recebida não pode ser cancelada: estorne a baixa antes.",
        ],
      },
      {
        id: "carta-correcao", titulo: "Fazer carta de correção (CC-e)", rota: "/financeiro?aba=faturamento", palavras: "nota fiscal nfe nf cce corrigir",
        passos: [
          "Em **Notas emitidas**, abra **Mais ações → Carta de correção**.",
          "Escreva todas as correções juntas (ex.: \"Onde se lê Transportadora X, leia-se Transportadora Y\").",
          "Envie. A nota passa a mostrar \"com carta de correção\".",
        ],
        atencao: [
          "Cada nova carta substitui a anterior.",
          "Não pode corrigir valores, impostos, quantidade, preço, dados que mudem remetente/destinatário nem datas.",
        ],
      },
      {
        id: "inutilizar", titulo: "Inutilizar números pulados", rota: "/financeiro?aba=faturamento", palavras: "nota fiscal nfe nf numeracao",
        passos: [
          "Em **Notas emitidas**, toque em **Inutilizar números**.",
          "Informe a série, do número até o número e a justificativa (mínimo 15 caracteres).",
        ],
        dicas: ["Faça até o dia 10 do mês seguinte."],
      },
      {
        id: "devolucao-fiscal", titulo: "Emitir NF-e de devolução ou troca", rota: "/financeiro?aba=faturamento", palavras: "nota fiscal nfe nf devolucao troca",
        passos: [
          "Em **Faturamento → Devoluções e trocas**, abra o registro aprovado pela Qualidade (\"Aprovado pela Qualidade — pronto p/ emitir\").",
          "Toque em **Emitir NF-e** (emissor ativo) ou **Registrar NF-e emitida** (nota feita fora).",
          "Para um caso sem passagem pela Qualidade, use **Nova Devolução/Troca**: vincule a um pedido faturado ou faça nota avulsa, escolha os itens, o motivo e informe a chave da NF-e de venda.",
        ],
        atencao: [
          "Enquanto estiver \"Em análise pela Qualidade\", a nota fica travada.",
          "Sem a chave da NF-e de venda (44 números) a SEFAZ não aceita a devolução.",
        ],
      },
      {
        id: "contas", titulo: "Lançar contas a pagar e a receber", rota: "/financeiro?aba=contas", palavras: "boleto despesa conta pagar receber",
        passos: [
          "Abra **Contas** e escolha **A receber** ou **A pagar**.",
          "Toque em **Nova conta a pagar** (ou **a receber**).",
          "Preencha descrição, categoria, valor e vencimento. Use **Repetir por (meses)** para contas fixas (aluguel, energia).",
          "Salve. Filtre por **Em aberto**, **Vencidas**, **Pagas/Recebidas** ou **Todas**; **Excel** exporta.",
        ],
        dicas: ["As contas a receber das vendas são criadas sozinhas ao faturar — não lance de novo."],
      },
      {
        id: "baixa", titulo: "Dar baixa (pagar ou receber)", rota: "/financeiro?aba=contas", palavras: "pagamento recebimento pagar receber quitar",
        passos: [
          "Em **Contas**, na conta em aberto, toque em **Pagar** ou **Receber**.",
          "Confira a data, o valor, a conta bancária e a forma, e confirme.",
          "Errou? Na conta paga, toque em **Estornar** para desfazer a baixa.",
        ],
        atencao: [
          "A data do pagamento não pode ser no futuro.",
          "Conta que veio de nota fiscal: se a venda foi desfeita, cancele a NF-e (as contas são canceladas junto). O botão cancelar conta é só para acordos (desconto, perdão de dívida).",
        ],
      },
      {
        id: "editar-conta", titulo: "Corrigir uma conta em aberto", rota: "/financeiro?aba=contas", palavras: "editar alterar vencimento valor conta",
        passos: [
          "Em **Contas**, na conta em aberto ou vencida, toque no lápis (**Editar conta**).",
          "Conta lançada à mão: dá para mudar favorecido, descrição, categoria, valor, vencimento, forma, NF e observações.",
          "Conta criada por nota fiscal ou pedido: só vencimento, forma e observações.",
          "Salve.",
        ],
        atencao: ["Valor errado numa conta de nota fiscal se corrige na nota (cancelamento), não na conta."],
      },
      {
        id: "conciliar-ofx", titulo: "Conciliar o extrato do banco (OFX)", rota: "/financeiro?aba=contas", palavras: "banco extrato ofx conciliacao",
        passos: [
          "No internet banking, exporte o extrato em formato **OFX** (às vezes chamado \"Money\").",
          "Em **Contas**, toque em **Conciliar extrato** e escolha a conta bancária do extrato.",
          "Escolha o arquivo. Para cada lançamento o sistema sugere a conta em aberto de mesmo valor e data próxima.",
          "Confira cada sugestão (troque ou escolha **Não baixar**) e confirme. As contas escolhidas recebem baixa.",
        ],
        dicas: ["Pode importar o mesmo extrato de novo sem medo: lançamentos já conciliados são ignorados."],
      },
      {
        id: "fluxo-caixa", titulo: "Ver o fluxo de caixa", rota: "/financeiro?aba=contas",
        passos: [
          "Em **Contas**, escolha **Fluxo de caixa**.",
          "Veja entradas, saídas, resultado e acumulado por mês. Os meses futuros (tracejado) são o previsto pelas contas em aberto.",
        ],
      },
      {
        id: "precos", titulo: "Cadastrar preço, custo, NCM e CFOP", rota: "/financeiro?aba=precos",
        passos: [
          "Abra **Preços e custos** e busque a peça (nome, referência, código ou NCM).",
          "Toque em **Editar**. Informe preço de venda, desconto máximo, custo, NCM (8 números), CFOP (4 números) e IPI.",
          "Veja a margem calculada e salve. Desmarque **Peça ativa** para tirar da venda.",
        ],
        dicas: ["NCM, CFOP e IPI daqui são usados na NF-e. Custo e margem só aparecem no Financeiro."],
      },
      {
        id: "configuracoes", titulo: "Dados fiscais e contas bancárias", rota: "/financeiro?aba=configuracoes",
        passos: [
          "Abra **Configurações**.",
          "Em **Dados fiscais da empresa**, toque em **Buscar na Receita** pelo CNPJ e confira razão social, endereço, IE e regime tributário (confirme com o contador).",
          "Em **Contas bancárias**, toque em **Nova conta** e informe banco, agência, conta, saldo atual e chave PIX.",
        ],
        atencao: ["Conta bancária com pagamentos registrados não pode ser excluída."],
      },
      {
        id: "ativar-emissor", titulo: "Ativar o emissor de NF-e", perfis: ["admin"], rota: "/financeiro?aba=configuracoes",
        passos: [
          "Crie a conta no provedor de emissão, cadastre a empresa e envie o certificado digital A1 no painel dele.",
          "Preencha os **Dados fiscais da empresa** nas Configurações.",
          "Toque em **Ativar emissor**, escolha **Homologação** (testes) e cole a chave de acesso fornecida pelo provedor.",
          "Emita uma nota de teste. Depois troque para **Produção** com a chave de produção.",
        ],
        atencao: ["Só o administrador ativa ou desativa o emissor. Enquanto estiver desligado, use Registrar NF-e."],
      },
      {
        id: "apagar-historico", titulo: "Apagar histórico financeiro", perfis: ["admin"],
        passos: [
          "No topo do Financeiro, toque em **Apagar histórico**.",
          "Digite EXCLUIR para confirmar.",
        ],
        atencao: ["Apaga contas e devoluções sem nota. Notas autorizadas e o que está ligado a elas são mantidos (guarda obrigatória de 5 anos). Faça backup antes."],
      },
    ],
  },

  // ── Produção ────────────────────────────────────────────────────────────────
  {
    id: "producao", titulo: "Produção", icone: "producao", tipo: "modulo", rota: "/producao",
    perfis: ["producao"],
    resumo: "Lançamento do dia, apontamento detalhado, planejamento de ordens, paradas, refugo, matéria-prima e indicadores (OEE). Abas: Diário, Desempenho, Controle, Planejamento, Cadastros, Paradas, Refugo, Mat.-Prima.",
    tarefas: [
      {
        id: "diario", titulo: "Lançar o dia de uma máquina (Diário)", palavras: "lancamento apontamento producao turno",
        passos: [
          "Abra **Produção → Diário**. Confira o **Dia do lançamento** (ou escolha **Outra data**) e o seu nome em **Seu nome (operador)**.",
          "Toque na máquina. Em \"O que aconteceu na máquina?\", escolha **Produziu peças** ou **Só ficou parada**.",
          "Escolha a peça, informe **Quantas peças boas?** e o tempo trabalhado.",
          "Adicione as paradas (motivo e duração), as peças refugadas e a matéria-prima, se houver.",
          "Confira o **Resumo do lançamento** (tempo produtivo, esperado, produzido) e toque em **Salvar lançamento**. A próxima máquina já abre.",
        ],
        dicas: [
          "Errou? Em **Lançados no dia**, toque no lápis para corrigir ou excluir.",
          "O \"esperado\" usa o tempo real da peça quando ela já tem histórico.",
        ],
      },
      {
        id: "controle", titulo: "Apontamento detalhado (Controle / PPI-51)", palavras: "apontamento ppi-51 planilha offline",
        passos: [
          "Abra **Controle** e toque em **Novo apontamento**.",
          "Preencha data, turno, **Máquina**, **Peça**, **Operador**, horas planejadas e **Produzidas (boas)**.",
          "Informe matéria-prima e lote (opcional), avance com **Próximo** para **Paradas** e **Refugo** e registre.",
          "Use **Dia anterior / Próximo dia / Hoje** para ver os apontamentos; **Editar** corrige um apontamento.",
          "Para trazer a planilha PPI-51, toque em **Importar Excel** e arraste o arquivo (.xlsm/.xlsx).",
        ],
        dicas: ["Sem internet o apontamento fica salvo no aparelho e é enviado ao reconectar (aparece a faixa \"Sincronizar agora\")."],
      },
      {
        id: "planejamento", titulo: "Planejar uma ordem de produção", palavras: "ordem op pcp programacao",
        passos: [
          "Abra **Planejamento** e toque em **Nova ordem**.",
          "Escolha a peça (busca por nome, código ou referência), a máquina, a quantidade e a prioridade.",
          "Informe o dia e a hora de início. O fim é calculado pelo ritmo da peça (use **recalcular** ou ajuste à mão).",
          "Salve. Na lista, use **Iniciar** quando começar e **Concluir** quando terminar — isso grava os horários reais.",
          "**Reabrir**, **Editar** e **Cancelar ordem** ficam nas ações. Excluir é só para admin.",
        ],
        dicas: ["O produzido vem dos lançamentos (Diário e Controle) da mesma peça e máquina no período da ordem."],
        atencao: ["\"Horário em conflito\" indica duas ordens ao mesmo tempo na mesma máquina. O planejamento precisa de internet."],
      },
      {
        id: "paradas", titulo: "Registrar uma parada ao vivo",
        passos: [
          "Abra **Paradas** e toque em **Registrar parada**.",
          "Escolha a máquina, o motivo e informe o operador. O cronômetro começa na hora.",
          "Quando a máquina voltar, toque em **encerrar**.",
          "No histórico, toque na parada para corrigir ou excluir.",
        ],
      },
      {
        id: "refugo", titulo: "Registrar refugo com medições",
        passos: [
          "Abra **Refugo** e toque em **Registrar refugo**.",
          "Informe peça, máquina, quantidade, motivo, lote (opcional) e o destino (retrabalho, sucata ou devolução).",
          "Em **Medições**, toque em **Adicionar** para cada cota (nominal, medido e tolerância).",
          "Informe o operador e salve.",
        ],
      },
      {
        id: "materia-prima", titulo: "Controlar a matéria-prima (barras)",
        passos: [
          "Abra **Mat.-Prima**. **Novo material** cadastra código, descrição, mínimo e máximo.",
          "**Movimentar**: escolha **Entrada** ou **Saída**, o material, a quantidade, o lote e o operador.",
          "**Pedir barras**: escolha o fornecedor e as barras. O pedido também aparece em Processos → Compras.",
        ],
      },
      {
        id: "metas-oee", titulo: "Ver OEE e definir metas", palavras: "oee meta eficiencia indicador",
        passos: [
          "Abra **Desempenho → Mês** para o OEE do mês: disponibilidade × performance × qualidade, por máquina, paradas e refugo.",
          "Em **Metas**, toque em **Definir meta do mês** (ou **Alterar meta**): geral ou por máquina, com OEE, disponibilidade, qualidade e peças.",
          "Em **Tempo de peça**, veja o tempo padrão de cada peça, calculado sozinho pelos lançamentos.",
        ],
        dicas: ["OEE acima de 85% é considerado classe mundial."],
      },
      {
        id: "relatorios-semestre", titulo: "Relatórios e apresentação do semestre",
        passos: [
          "**Desempenho → Relatórios**: escolha o tipo (produção por dia, disponibilidade, paradas, refugo) e o período e exporte em **CSV**.",
          "**Desempenho → Semestre**: OEE mês a mês, por máquina, principais paradas e tempo por peça.",
          "Toque em **Baixar apresentação** para baixar a apresentação do semestre. **Alterar meta** define a meta de OEE do semestre.",
        ],
      },
      {
        id: "cadastros", titulo: "Cadastrar máquinas e peças",
        passos: [
          "Abra **Cadastros**. Em **Máquinas**, toque em **Nova máquina** (código, nome, setor, fabricante, manutenção).",
          "Em **Produtos**, toque em **Nova peça**: código, descrição e **tempo de ciclo**. As peças/hora são calculadas.",
          "Quando o ritmo real ficar diferente do cadastro, toque em **Usar este** para atualizar.",
        ],
      },
      {
        id: "apagar-producao", titulo: "Apagar histórico de produção", perfis: ["admin"],
        passos: ["No topo da Produção, toque em **Apagar histórico** e digite EXCLUIR."],
        atencao: ["Apaga todos os apontamentos. Máquinas e produtos continuam cadastrados."],
      },
    ],
  },

  // ── Qualidade ───────────────────────────────────────────────────────────────
  {
    id: "qualidade", titulo: "Qualidade", icone: "qualidade", tipo: "modulo", rota: "/qualidade",
    perfis: ["qualidade"],
    resumo: "Devoluções e laudos, pós-venda e recall (lote → cliente), regularização ANVISA, rastreio de lotes e GS1. Abas: Visão geral, Devoluções, Pós-venda, ANVISA, Lotes, GS1.",
    tarefas: [
      {
        id: "visao-geral", titulo: "Ver o que precisa de atenção", rota: "/qualidade?aba=visao",
        passos: [
          "Abra **Qualidade → Visão geral**.",
          "Veja os cards **Retornos a analisar**, **Recall ativo**, **A regularizar**, **Registro vencendo** e **Retidas no retrabalho**. Toque para abrir a lista já filtrada.",
        ],
      },
      {
        id: "devolucao", titulo: "Registrar uma devolução e fazer o laudo", rota: "/qualidade?aba=devolucao", palavras: "devolucao troca laudo retorno cliente",
        passos: [
          "Quando a peça chegar com a NF de venda, abra **Devoluções** e toque em **Registrar retorno**.",
          "Busque o pedido faturado (nº da NF, cliente ou pedido) e informe quantas peças voltaram.",
          "Confirme. As peças entram no **Retrabalho** com o mesmo lote e o pedido fica travado até o laudo.",
          "Analise e abra o registro. Escolha a decisão: **Devolução**, **Troca** ou **Reprovar**, e escreva o **Laudo da análise**.",
          "Devolução aprovada: as peças voltam para a expedição (mesmo lote) e o cliente ganha crédito. O Financeiro emite a NF de devolução.",
        ],
        atencao: ["O laudo fecha o registro (rastreabilidade) e não pode ser editado depois."],
      },
      {
        id: "pos-venda", titulo: "Pós-venda e recall", rota: "/qualidade?aba=posvenda", palavras: "recall rastreabilidade envio cliente lote",
        passos: [
          "Abra **Pós-venda**. Cada envio mostra lote, peça, cliente e quantidade (é registrado sozinho quando o pedido é faturado).",
          "Busque por lote, peça, cliente ou clínica, ou filtre por situação.",
          "Para recall: selecione os envios (ou **Selecionar todos**) e escolha o **Novo status** (recall ativo, em alerta, normal).",
          "Abra um envio para preencher o destino clínico (clínica, cirurgião, código do paciente) e as ações tomadas.",
          "**Excel** exporta a lista para contato com os clientes.",
        ],
        atencao: ["Nunca escreva o nome do paciente — só o código interno (LGPD)."],
      },
      {
        id: "anvisa", titulo: "Regularização ANVISA", rota: "/qualidade?aba=regularizacao", palavras: "registro notificacao anvisa regularizacao vencimento",
        passos: [
          "Abra **ANVISA**. Cada peça passa por 4 fases: Empresa, Classificação, ANVISA e UDI/GTIN.",
          "Filtre por fase, **Em processo na ANVISA** ou **Vencendo em 1 ano**.",
          "Abra a peça e preencha: licenças (LF, AFE, BPF), classe de risco, situação no Solicita, nº do processo, nº de registro/notificação, data de concessão e validade.",
          "Na parte GS1, gere o GTIN-13 (prefixo + empresa + produto) ou informe o GTIN/UDI-DI; o dígito verificador é conferido.",
        ],
      },
      {
        id: "lotes", titulo: "Rastrear um lote", rota: "/qualidade?aba=lotes",
        passos: [
          "Abra **Lotes** e digite o lote (ex.: 010125-01), modelo, referência, UDI-DI ou nº ANVISA.",
          "Veja **Onde está o lote** (intermediário, expedição, retrabalho, reservas).",
          "Em **Movimentações**, filtre por fase e tipo para ver todo o histórico.",
        ],
      },
      {
        id: "gs1", titulo: "Consultar GTIN e cadastro no CNP (GS1)", rota: "/qualidade?aba=gs1",
        passos: [
          "Abra **GS1**.",
          "**Consultar GTIN**: dados do produto na base GS1.",
          "**Buscar NCM / GPC**: códigos de classificação.",
          "**Verificar CNP**: confere se as peças com GTIN estão no Cadastro Nacional de Produtos.",
        ],
      },
    ],
  },

  // ── Processos ───────────────────────────────────────────────────────────────
  {
    id: "processos", titulo: "Processos", icone: "processos", tipo: "modulo", rota: "/processos",
    perfis: ["processos", "producao"],
    resumo: "Ferramentas de corte (vida útil), faltas, compras, fornecedores e biblioteca de programas CNC. Abas: Ferramentas, Faltas, Compras, Fornecedores, Códigos CNC.",
    tarefas: [
      {
        id: "ferramentas", titulo: "Cadastrar ferramentas e registrar troca", rota: "/processos?aba=ferramentas",
        passos: [
          "Abra **Ferramentas** e toque em **Cadastrar**.",
          "Informe código, tipo, descrição, **Vida útil (peças)** (0 = sem limite), custo, máquina e fornecedor.",
          "Quando trocar a ferramenta na máquina, toque em **Registrar troca**: o contador de peças volta a zero.",
          "Muitas de uma vez: **Baixar modelo**, preencha a planilha e use **Importar planilha (.xlsx)**.",
        ],
      },
      {
        id: "faltas", titulo: "Tratar ferramentas em falta", rota: "/processos?aba=faltas",
        passos: [
          "Abra **Faltas**: aparecem as ferramentas que já usaram 80% ou mais da vida útil.",
          "Toque em **Gerar pedido** na ferramenta. É criado um pedido de compra em rascunho.",
          "Acompanhe em **Compras**.",
        ],
      },
      {
        id: "compras", titulo: "Fazer e receber um pedido de compra", rota: "/processos?aba=compras",
        passos: [
          "Abra **Compras** e toque em **Novo pedido**.",
          "Escolha ou digite o fornecedor, a previsão de entrega e adicione os itens.",
          "Quando mandar ao fornecedor, toque em **Marcar enviado**.",
          "Na chegada, toque em **Confirmar recebimento** e informe o nº da NF de entrada.",
        ],
      },
      {
        id: "fornecedores", titulo: "Cadastrar fornecedores", rota: "/processos?aba=fornecedores",
        passos: [
          "Abra **Fornecedores** e toque em **Novo fornecedor**.",
          "Informe razão social, CNPJ, contato, categoria, cidade e prazo de entrega, e salve.",
        ],
      },
      {
        id: "codigos-cnc", titulo: "Guardar e usar programas CNC", rota: "/processos?aba=codigos",
        passos: [
          "Abra **Códigos CNC**. Busque o programa pelo nome.",
          "Abra o programa para ver o código. Use **Copiar** ou **Baixar** para levar para a máquina.",
          "**Novo** cria um programa colando o código; escolha a máquina e a linguagem e salve.",
        ],
        atencao: ["**Apagar** tira o programa de toda a equipe. Baixe uma cópia antes se precisar."],
      },
      {
        id: "importar-programas", titulo: "Importar programas do CAM", rota: "/processos?aba=codigos",
        passos: [
          "Em **Códigos CNC**, toque em **Importar**.",
          "Escolha ou arraste os arquivos (.nc, .tap, .txt, .mpf, .h, .eia…). Pode escolher vários de uma vez, até 5 MB cada.",
          "Confira o nome, a máquina (detectada pelo nome do arquivo) e a linguagem de cada um.",
          "Se já existir um programa com o mesmo nome na mesma máquina, escolha **substituir** ou **salvar como cópia**.",
        ],
        dicas: ["Arquivos de projeto (binários) são recusados — exporte o programa em texto no CAM."],
      },
    ],
  },

  // ── Admin ───────────────────────────────────────────────────────────────────
  {
    id: "admin", titulo: "Admin", icone: "admin", tipo: "modulo", rota: "/admin",
    perfis: ["admin"],
    resumo: "Só para o administrador: painel geral, usuários e perfis, catálogo de dispositivos, auditoria, feedback, backup e limpeza de históricos.",
    tarefas: [
      {
        id: "criar-usuario", titulo: "Criar uma conta e escolher o perfil", rota: "/admin?aba=users", palavras: "usuario conta login perfil acesso",
        passos: [
          "Abra **Admin → Usuários** e toque em **Criar conta**.",
          "Preencha nome completo, **Login** (letras minúsculas, números, ponto, hífen) e uma senha inicial forte.",
          "Escolha o **Perfil** (veja \"Perfis e o que cada um vê\") e salve.",
          "Passe o login e a senha para a pessoa. No primeiro acesso ela cria a senha dela.",
        ],
      },
      {
        id: "gerenciar-usuarios", titulo: "Aprovar, mudar perfil, redefinir senha ou bloquear", rota: "/admin?aba=users", palavras: "senha redefinir bloquear aprovar perfil",
        passos: [
          "Em **Usuários**, o número na aba mostra quem está aguardando aprovação. Toque em **Aprovar**.",
          "**Editar nome / perfil** muda o nome e o perfil da pessoa (o login não muda).",
          "**Alterar senha** define uma senha nova; no próximo acesso a pessoa cria uma pessoal.",
          "**Bloquear acesso** impede o login na hora (os dados ficam). **Desbloquear** devolve o acesso.",
        ],
        atencao: ["Excluir a conta é definitivo. Prefira bloquear quando alguém sai da empresa."],
      },
      {
        id: "dispositivos", titulo: "Cadastrar dispositivos, imagens e desenhos", rota: "/admin?aba=devices",
        passos: [
          "Abra **Dispositivos**. **Novo** cadastra um dispositivo (modelo, referência, UDI-DI, registro ANVISA, materiais…). Ele já entra no estoque intermediário.",
          "**Imagens**: arraste uma pasta ou arquivos; as imagens são ligadas às peças pela referência.",
          "**Desenhos**: envie um .zip com os PDFs dos desenhos técnicos; o sistema liga pelo nome do arquivo ou pelo código dentro do PDF.",
          "**Mais ações → Importar catálogo (.csv / .json)** substitui o catálogo inteiro.",
        ],
        atencao: ["Importar catálogo apaga o catálogo atual. \"Excluir todas as peças\" pede para digitar EXCLUIR e não tem volta."],
      },
      {
        id: "auditoria", titulo: "Consultar a auditoria", rota: "/admin?aba=auditoria",
        passos: [
          "Abra **Auditoria**. Busque por usuário ou ação, ou filtre por tipo de ação.",
          "Toque num registro para ver os detalhes. **Exportar CSV** baixa a lista.",
        ],
      },
      {
        id: "feedback", titulo: "Tratar problemas e sugestões (Feedback)", rota: "/admin?aba=feedback",
        passos: [
          "Abra **Feedback**. O número na aba mostra os novos.",
          "Leia a mensagem (ela traz a tela onde a pessoa estava).",
          "Mude o status para **Em análise** ou **Resolvido** conforme for tratando.",
        ],
      },
      {
        id: "backup", titulo: "Fazer backup e exportar", rota: "/admin", palavras: "backup copia seguranca exportar restaurar",
        passos: [
          "No topo do Admin, toque em **Backup**.",
          "Toque em **Fazer backup agora** e depois em **Baixar JSON** para guardar uma cópia fora do sistema.",
          "**Exportar Planilha Excel** baixa todas as peças com quantidade e localização.",
          "Em **Backup automático**, defina o agendamento.",
          "**Subir backup completo** restaura a partir de um arquivo JSON.",
        ],
        atencao: ["Restaurar substitui os dados atuais. Faça um backup novo antes de restaurar."],
      },
      {
        id: "apagar-historicos", titulo: "Apagar históricos", rota: "/admin",
        passos: [
          "Faça um backup antes.",
          "Os botões **Apagar histórico** ficam no topo de cada módulo (Financeiro, Produção, Auditoria), em **Estoque → Mais opções → Apagar histórico…** e na janela **Backup → Apagar histórico por módulo**.",
          "Digite EXCLUIR para confirmar.",
        ],
        atencao: [
          "Não pode ser desfeito.",
          "Notas fiscais autorizadas e o que está ligado a elas nunca são apagados (guarda de 5 anos).",
        ],
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Perguntas frequentes / problemas comuns
// ─────────────────────────────────────────────────────────────────────────────

export const FAQ_GUIA: PerguntaFAQ[] = [
  {
    id: "peca-nao-aparece", perfis: ["comercial"], ancora: "comercial-novo-pedido",
    pergunta: "A peça não aparece (ou aparece apagada) no novo pedido.",
    resposta: [
      "Apagada com \"sem saldo na expedição\" ou \"sem saldo · N em produção\": não há saldo livre na **Expedição** (ou está todo reservado para outros pedidos). Peça ao Estoque para conferir — talvez as peças ainda estejam no Intermediário ou no Retrabalho.",
      "Não aparece de jeito nenhum: confira se o filtro **Já comprou** ou **Favoritas** está ligado (volte para **Todas**) e se a peça está cadastrada e ativa em Componentes/tabela de preços (fale com o admin ou o financeiro).",
    ],
  },
  {
    id: "nao-consigo-editar", perfis: ["comercial", "financeiro"], ancora: "comercial-editar-dados",
    pergunta: "Não consigo editar o pedido (ou a nota).",
    resposta: [
      "Pedido: só dá para editar enquanto está **Aguardando confirmação** (ou quando **Voltou do estoque**). Depois de confirmado, peça ao Estoque para usar **Devolver ao Comercial**.",
      "Nota fiscal autorizada não pode ser editada nem apagada (regra fiscal). Para corrigir texto use a **carta de correção**; para desfazer, **cancele a nota**.",
      "Registro de devolução com laudo fica fechado (rastreabilidade).",
    ],
  },
  {
    id: "desconto-barrado", perfis: ["comercial"],
    pergunta: "O desconto não passa do limite.",
    resposta: ["Cada peça tem um desconto máximo na tabela de preços. Acima disso só admin, gerente ou financeiro podem liberar — ou o Financeiro ajusta o desconto máximo da peça."],
  },
  {
    id: "pedido-nao-aparece-faturar", perfis: ["financeiro"], ancora: "estoque-separar-pedido",
    pergunta: "O pedido não aparece em \"A faturar\".",
    resposta: ["Só aparecem pedidos que o Estoque marcou como **pronto**. Se ainda estiver em separação, fale com o Estoque."],
  },
  {
    id: "xml-recusado", perfis: ["financeiro"], ancora: "financeiro-registrar-nfe",
    pergunta: "O XML não é aceito ao registrar a NF-e.",
    resposta: [
      "Confira se é o XML da **NF-e** (não o DANFE em PDF) e se a nota foi emitida pelo CNPJ da empresa.",
      "Se o valor ou o destinatário forem diferentes do pedido, marque a confirmação depois de conferir.",
      "Sem o XML, digite a chave de acesso de 44 números.",
    ],
  },
  {
    id: "nao-cancela-nota", perfis: ["financeiro"], ancora: "financeiro-cancelar-nfe",
    pergunta: "Não consigo cancelar a nota.",
    resposta: [
      "Se alguma parcela já foi recebida, estorne a baixa em **Contas** antes.",
      "Passou de 24 h da emissão: a SEFAZ pode recusar. Consulte o contador.",
      "Nota feita em outro sistema: cancele lá primeiro e informe o protocolo aqui.",
    ],
  },
  {
    id: "nao-consigo-estornar", perfis: ["estoque"], ancora: "estoque-estorno",
    pergunta: "O botão Estornar não aparece na movimentação.",
    resposta: ["Só entradas e retiradas feitas à mão podem ser estornadas, uma vez cada. Movimentos automáticos (mover entre fases, retrabalho, pedidos, notas) não aparecem com Estornar. Para acertar, faça o movimento contrário (ex.: retirada com o motivo)."],
  },
  {
    id: "lote-invalido", perfis: ["estoque"], ancora: "estoque-entrada",
    pergunta: "Aparece \"Lote inválido\".",
    resposta: ["Use DDMMAAT-NN com turno (ex.: 0101261-01) ou DDMMAA-NN para peça de terceiro (ex.: 010126-01)."],
  },
  {
    id: "sem-internet-producao", perfis: ["producao"], ancora: "producao-controle",
    pergunta: "Fiquei sem internet na produção.",
    resposta: [
      "O apontamento do **Controle** fica salvo no aparelho e é enviado quando a internet voltar (toque em **Sincronizar agora** se aparecer a faixa azul).",
      "Planejamento, relatórios e correções precisam de internet.",
    ],
  },
  {
    id: "nao-vejo-modulo",
    pergunta: "Não vejo um módulo ou um botão que o colega vê.",
    resposta: ["Cada perfil vê só os módulos e ações da sua função (veja \"Perfis e o que cada um vê\"). Se precisar de outro acesso, peça ao administrador."],
  },
  {
    id: "tela-desatualizada",
    pergunta: "A tela parece desatualizada ou travada.",
    resposta: ["Toque no botão de atualizar da lista (ícone de setas) ou recarregue a página. Se continuar, use **Reportar problema** contando o que aconteceu."],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Glossário
// ─────────────────────────────────────────────────────────────────────────────

export const GLOSSARIO_GUIA: TermoGlossario[] = [
  { termo: "Lote", definicao: "Número que identifica um grupo de peças feitas juntas (data, turno e sequência, ex.: 0101261-01). Acompanha a peça até o cliente, para rastreabilidade e recall." },
  { termo: "Intermediário", definicao: "Fase do estoque onde entram as peças que saíram da produção, antes de embalar." },
  { termo: "Expedição", definicao: "Fase do estoque com as peças embaladas, prontas para venda. O Comercial só vende o que tem saldo aqui." },
  { termo: "Retrabalho", definicao: "Fase do estoque com peças que precisam ser trabalhadas de novo ou que voltaram de cliente. Mantém o mesmo lote." },
  { termo: "Reserva", definicao: "Quantidade separada para um pedido ainda não faturado. Não pode ser vendida para outro cliente." },
  { termo: "Estorno", definicao: "Lançamento contrário que corrige um erro sem apagar o histórico." },
  { termo: "NF-e", definicao: "Nota fiscal eletrônica. Depois de autorizada pela SEFAZ não pode ser editada nem apagada." },
  { termo: "DANFE", definicao: "Versão em PDF da NF-e, para imprimir e acompanhar a mercadoria." },
  { termo: "XML da nota", definicao: "Arquivo oficial da NF-e. Deve ser guardado por 5 anos — o sistema guarda ao registrar." },
  { termo: "Chave de acesso", definicao: "Número de 44 dígitos que identifica a NF-e na SEFAZ." },
  { termo: "CC-e (carta de correção)", definicao: "Documento que corrige textos de uma NF-e já autorizada (não corrige valores nem quantidades)." },
  { termo: "Inutilização", definicao: "Aviso à SEFAZ de que um número de nota foi pulado e não será usado." },
  { termo: "Emissor", definicao: "Serviço que envia a NF-e para a SEFAZ direto do sistema. Desligado, as notas são feitas fora e registradas pelo XML." },
  { termo: "Homologação", definicao: "Ambiente de testes da NF-e. Notas de homologação não valem e não mexem nos pedidos." },
  { termo: "NCM / CFOP", definicao: "Códigos fiscais do produto (NCM, 8 números) e da operação (CFOP, 4 números) usados na nota." },
  { termo: "Crédito de devolução", definicao: "Valor que o cliente tem a receber depois de uma devolução aprovada. Pode ser usado para abater um novo pedido." },
  { termo: "Baixa", definicao: "Registrar que uma conta foi paga ou recebida." },
  { termo: "Conciliação OFX", definicao: "Importar o extrato do banco (arquivo OFX) para dar baixa nas contas automaticamente, conferindo valor e data." },
  { termo: "Fluxo de caixa", definicao: "Entradas e saídas de dinheiro por mês, realizado e previsto." },
  { termo: "OEE", definicao: "Eficiência global da máquina: disponibilidade (tempo sem paradas) × performance (ritmo) × qualidade (peças boas)." },
  { termo: "Apontamento", definicao: "Registro do que a máquina produziu, das paradas e do refugo num período." },
  { termo: "OP (ordem de produção)", definicao: "Ordem planejada: peça, máquina, quantidade, início e fim previstos." },
  { termo: "Setup", definicao: "Tempo de preparação da máquina para uma nova peça." },
  { termo: "Refugo", definicao: "Peças perdidas ou com defeito, com o motivo e as medições." },
  { termo: "Laudo", definicao: "Conclusão da Qualidade sobre uma peça devolvida (devolução, troca ou reprovação)." },
  { termo: "Recall", definicao: "Recolhimento de peças de um lote já vendido. O Pós-venda mostra quais clientes receberam o lote." },
  { termo: "UDI-DI / GTIN", definicao: "Código de identificação do produto (padrão GS1), impresso no rótulo e no código de barras." },
  { termo: "ANVISA (registro/notificação)", definicao: "Autorização para vender o dispositivo médico. Tem validade e é acompanhada na aba ANVISA." },
  { termo: "Vida útil da ferramenta", definicao: "Quantidade de peças que uma ferramenta de corte faz antes da troca. A partir de 80% ela aparece em Faltas." },
];

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades (usadas pela tela e pelos testes)
// ─────────────────────────────────────────────────────────────────────────────

/** Minúsculas e sem acento, para busca. */
export function normalizarBusca(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\*\*/g, "");
}

/** Âncora de uma tarefa: #<secao>-<tarefa>. */
export function ancoraTarefa(secaoId: string, tarefaId: string): string {
  return `${secaoId}-${tarefaId}`;
}

/** Perfis efetivos de uma tarefa (os dela ou os da seção; vazio = todos). */
export function perfisDaTarefa(secao: SecaoGuia, tarefa: TarefaGuia): AppRole[] {
  return tarefa.perfis ?? secao.perfis ?? [];
}
