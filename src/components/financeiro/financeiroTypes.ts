import {
  Factory, FlaskConical, Cpu, Wrench, Monitor, Building,
  FileText, Building2, Package, Zap, DollarSign,
} from "lucide-react";

export type CategoriaCompra =
  | "maquina" | "materia_prima" | "equipamento" | "insumo_producao"
  | "computador" | "mobiliario" | "material_escritorio" | "ativo_empresa"
  | "energia" | "aluguel" | "servico" | "manutencao" | "outro";

export interface LancamentoFinanceiro {
  id: string;
  tipo: "compra_producao" | "compra_empresa" | "custo_operacional";
  categoria: CategoriaCompra;
  descricao: string;
  fornecedor: string | null;
  valor: number;
  data_lancamento: string;
  nota_fiscal_manual: string | null;
  chave_nfe: string | null;
  status_nf: "sem_nf" | "manual" | "autorizada" | "pendente";
  observacoes: string | null;
  recorrente: boolean;
  periodicidade: "mensal" | "bimestral" | "trimestral" | "anual" | null;
  created_at: string;
  created_by: string | null;
}

export const CATEGORIAS_PRODUCAO: { valor: CategoriaCompra; label: string; icon: typeof Package }[] = [
  { valor: "maquina",         label: "Máquina / Equip. Produção", icon: Factory      },
  { valor: "materia_prima",   label: "Matéria-Prima",             icon: FlaskConical },
  { valor: "insumo_producao", label: "Insumo de Produção",        icon: Cpu          },
  { valor: "manutencao",      label: "Manutenção",                icon: Wrench       },
];

export const CATEGORIAS_EMPRESA: { valor: CategoriaCompra; label: string; icon: typeof Package }[] = [
  { valor: "computador",          label: "Computador / TI",        icon: Monitor   },
  { valor: "mobiliario",          label: "Mobiliário",             icon: Building  },
  { valor: "material_escritorio", label: "Material de Escritório", icon: FileText  },
  { valor: "ativo_empresa",       label: "Ativo Permanente",       icon: Building2 },
  { valor: "outro",               label: "Outros",                 icon: Package   },
];

export const CATEGORIAS_CUSTO: { valor: CategoriaCompra; label: string; icon: typeof Package }[] = [
  { valor: "energia",    label: "Energia Elétrica",  icon: Zap        },
  { valor: "aluguel",    label: "Aluguel / Locação",  icon: Building   },
  { valor: "servico",    label: "Serviço / Software", icon: Monitor    },
  { valor: "manutencao", label: "Manutenção Geral",   icon: Wrench     },
  { valor: "outro",      label: "Outros Custos",      icon: DollarSign },
];
