/**
 * Tipos e peças comuns do módulo Processos (ferramentas, faltas, códigos CNC).
 * As interfaces espelham as colunas das tabelas do Supabase (ferramentas_cnc,
 * programas_cnc, fornecedores/maquinas_producao para os seletores) — ver
 * migration 20260045000000_processos.sql.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { LinguagemCnc } from "@/lib/programasCnc";

export type TipoFerramenta = "broca" | "inserto" | "pastilha" | "fresa" | "alargador" | "outros";
export type StatusFerramenta = "ativo" | "alerta" | "substituir" | "inativo";

export interface Ferramenta {
  id: string;
  codigo: string;
  descricao: string;
  tipo: TipoFerramenta;
  maquina_codigo: string | null;
  vida_util_pecas: number;
  vida_util_horas: number | null;
  pecas_produzidas: number;
  horas_uso: number;
  status: StatusFerramenta;
  ultima_troca: string | null;
  fornecedor_id: string | null;
  custo_unitario: number | null;
  observacoes: string | null;
}

export interface Programa {
  id: string;
  nome: string;
  maquina_codigo: string | null;
  linguagem: LinguagemCnc;
  conteudo: string;
  updated_at: string;
}

export interface FornecedorOption { id: string; razao_social: string }
export interface MaquinaOption { codigo: string; nome: string }

export const TIPOS: TipoFerramenta[] = ["broca", "inserto", "pastilha", "fresa", "alargador", "outros"];
export const TIPO_LABEL: Record<TipoFerramenta, string> = {
  broca: "Broca", inserto: "Inserto", pastilha: "Pastilha", fresa: "Fresa", alargador: "Alargador", outros: "Outros",
};

export const STATUS_LABEL: Record<StatusFerramenta, string> = {
  ativo: "Em uso", alerta: "Perto do limite", substituir: "Trocar", inativo: "Inativa",
};
export const STATUS_TONE: Record<StatusFerramenta, string> = {
  ativo: "text-success bg-success/10",
  alerta: "text-warning bg-warning/15",
  substituir: "text-destructive bg-destructive/10",
  inativo: "text-muted-foreground bg-muted",
};

// "Falta" para uma ferramenta de vida útil (ao contrário de peça de estoque com
// quantidade) é ela estar perto ou além do limite de peças que pode produzir
// antes de precisar ser trocada — status já calculado no banco pela RPC
// atualizar_status_ferramentas() (chamada após cada "+1 peça produzida").
export const emFaltaStatus = (f: Ferramenta) => f.status === "alerta" || f.status === "substituir";

export function pctVida(f: Ferramenta): number | null {
  return f.vida_util_pecas > 0 ? Math.round((f.pecas_produzidas / f.vida_util_pecas) * 100) : null;
}

/** Máquinas e fornecedores ativos para os seletores. */
export function useDropdownOptions() {
  const [fornecedores, setFornecedores] = useState<FornecedorOption[]>([]);
  const [maquinas, setMaquinas] = useState<MaquinaOption[]>([]);
  useEffect(() => {
    let vivo = true;
    supabase.from("fornecedores").select("id, razao_social").eq("ativo", true).order("razao_social")
      .then(({ data }) => { if (vivo) setFornecedores((data ?? []) as FornecedorOption[]); });
    supabase.from("maquinas_producao").select("codigo, nome").order("codigo")
      .then(({ data }) => { if (vivo) setMaquinas((data ?? []) as MaquinaOption[]); });
    return () => { vivo = false; };
  }, []);
  return { fornecedores, maquinas };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function Field({ label, children, className, htmlFor }: { label: string; children: React.ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, text, action }: { icon: React.ElementType; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 px-6 py-12">
      <div className="h-12 w-12 rounded-2xl bg-muted flex items-center justify-center">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="text-sm font-semibold">{title}</p>
      {text && <p className="text-xs text-muted-foreground max-w-sm">{text}</p>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

export function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", className)}>{children}</span>;
}
