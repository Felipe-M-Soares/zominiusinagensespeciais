/**
 * Blocos visuais do Guia de uso: ícones, tarefa expansível, seção de módulo,
 * fluxo "Da venda à entrega", perfis, perguntas frequentes e glossário.
 */
import { memo } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, BookA, Boxes, ChevronDown, CircleHelp, Cpu, ExternalLink, Factory,
  Lightbulb, Link2, Receipt, Rocket, Route, Settings, ShieldCheck, ShoppingBag, Users, Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { canAccessRoute, ROLE_LABELS, type AppRole } from "@/types/roles";
import { TextoGuia } from "./TextoGuia";
import {
  ancoraTarefa, perfisDaTarefa,
  type EtapaFluxo, type IconeGuia, type PerfilGuia, type PerguntaFAQ, type SecaoGuia, type TarefaGuia, type TermoGlossario,
} from "./conteudo";

export const ICONES: Record<IconeGuia, React.ElementType> = {
  inicio: Rocket, perfis: Users, fluxo: Route, componentes: Cpu, estoque: Boxes, comercial: ShoppingBag,
  financeiro: Receipt, producao: Factory, qualidade: ShieldCheck, processos: Workflow, admin: Settings,
  faq: CircleHelp, glossario: BookA,
};

/** Cor do ícone de cada seção (mesma paleta das abas dos módulos). */
export const TOM: Record<IconeGuia, string> = {
  inicio: "bg-primary/10 text-primary",
  perfis: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  fluxo: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  componentes: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  estoque: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  comercial: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  financeiro: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  producao: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  qualidade: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  processos: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  admin: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  faq: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  glossario: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
};

export function IconeSecao({ icone, className }: { icone: IconeGuia; className?: string }) {
  const Icon = ICONES[icone];
  return (
    <span className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0", TOM[icone], className)}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

function nomePerfis(perfis: AppRole[]): string {
  if (perfis.length === 0) return "Todos";
  if (perfis.length === 1 && perfis[0] === "admin") return "Só admin";
  return perfis.map(p => (ROLE_LABELS[p] ?? p).split(" (")[0]).join(", ");
}

function copiarLink(ancora: string) {
  const url = `${window.location.origin}${window.location.pathname}#${ancora}`;
  const ok = () => toast.success("Link copiado.");
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(ok, () => toast.error("Não foi possível copiar o link."));
  else toast.error("Não foi possível copiar o link.");
}

// ── Tarefa ───────────────────────────────────────────────────────────────────

interface TarefaProps {
  secao: SecaoGuia;
  tarefa: TarefaGuia;
  aberta: boolean;
  onToggle: (ancora: string) => void;
  role: AppRole | null;
}

export const TarefaItem = memo(function TarefaItem({ secao, tarefa, aberta, onToggle, role }: TarefaProps) {
  const navigate = useNavigate();
  const ancora = ancoraTarefa(secao.id, tarefa.id);
  const perfis = perfisDaTarefa(secao, tarefa);
  const rota = tarefa.rota ?? secao.rota;
  const podeAbrir = !!rota && canAccessRoute(role, rota.split("?")[0]);
  const corpoId = `${ancora}-corpo`;

  return (
    <li id={ancora} className="scroll-mt-20">
      <button
        type="button"
        onClick={() => onToggle(ancora)}
        aria-expanded={aberta}
        aria-controls={corpoId}
        className={cn(
          "w-full flex items-start gap-3 px-4 py-3 text-left transition-colors min-h-[52px]",
          "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          aberta && "bg-muted/30"
        )}
      >
        <ChevronDown className={cn("h-4 w-4 mt-1 shrink-0 text-muted-foreground transition-transform", aberta && "rotate-180 text-primary")} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-snug">{tarefa.titulo}</span>
          <span className="block text-xs text-muted-foreground mt-0.5">Para: {nomePerfis(perfis)}</span>
        </span>
      </button>

      {aberta && (
        <div id={corpoId} className="px-4 pb-4 pt-1 sm:pl-11 space-y-3 animate-in fade-in-0 slide-in-from-top-1 duration-150">
          {tarefa.resumo && <p className="text-sm text-muted-foreground"><TextoGuia texto={tarefa.resumo} /></p>}
          <ol className="space-y-2">
            {tarefa.passos.map((p, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                <span className="h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-px tabular-nums">{i + 1}</span>
                <span className="min-w-0 text-foreground/90"><TextoGuia texto={p} /></span>
              </li>
            ))}
          </ol>
          {tarefa.dicas && tarefa.dicas.length > 0 && (
            <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.06] px-3 py-2.5 space-y-1.5">
              {tarefa.dicas.map((d, i) => (
                <p key={i} className="flex gap-2 text-sm text-foreground/90">
                  <Lightbulb className="h-4 w-4 mt-0.5 shrink-0 text-sky-600 dark:text-sky-400" />
                  <span className="min-w-0"><TextoGuia texto={d} /></span>
                </p>
              ))}
            </div>
          )}
          {tarefa.atencao && tarefa.atencao.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2.5 space-y-1.5">
              {tarefa.atencao.map((d, i) => (
                <p key={i} className="flex gap-2 text-sm text-foreground/90">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span className="min-w-0"><TextoGuia texto={d} /></span>
                </p>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {podeAbrir && (
              <button
                type="button"
                onClick={() => navigate(rota!)}
                className="h-10 px-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1.5 hover:bg-primary/90 transition-colors"
              >
                <ExternalLink className="h-4 w-4" />Abrir no sistema
              </button>
            )}
            <button
              type="button"
              onClick={() => copiarLink(ancora)}
              className="h-10 px-3 rounded-xl border text-sm font-medium inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <Link2 className="h-4 w-4" />Copiar link
            </button>
          </div>
        </div>
      )}
    </li>
  );
});

// ── Seção (módulo ou primeiros passos) ───────────────────────────────────────

interface SecaoProps {
  secao: SecaoGuia;
  tarefas: TarefaGuia[];
  abertas: Set<string>;
  onToggle: (ancora: string) => void;
  role: AppRole | null;
  totalTarefas: number;
}

export function SecaoCard({ secao, tarefas, abertas, onToggle, role, totalTarefas }: SecaoProps) {
  const navigate = useNavigate();
  const podeAbrir = !!secao.rota && canAccessRoute(role, secao.rota);
  return (
    <section id={secao.id} data-secao={secao.id} className="scroll-mt-20 rounded-2xl border bg-card overflow-hidden">
      <header className="px-4 py-3.5 flex items-start gap-3 border-b bg-muted/20">
        <IconeSecao icone={secao.icone} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold leading-tight">{secao.titulo}</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
              {tarefas.length < totalTarefas ? `${tarefas.length} de ${totalTarefas}` : tarefas.length} tarefa{totalTarefas !== 1 ? "s" : ""}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1 leading-relaxed">{secao.resumo}</p>
        </div>
        {podeAbrir && (
          <button
            type="button"
            onClick={() => navigate(secao.rota!)}
            className="hidden sm:inline-flex h-9 px-3 rounded-xl border text-xs font-medium items-center gap-1.5 hover:bg-muted/60 transition-colors shrink-0"
          >
            Abrir o módulo<ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </header>
      <ul className="divide-y">
        {tarefas.map(t => (
          <TarefaItem key={t.id} secao={secao} tarefa={t} aberta={abertas.has(ancoraTarefa(secao.id, t.id))} onToggle={onToggle} role={role} />
        ))}
      </ul>
      {podeAbrir && (
        <button
          type="button"
          onClick={() => navigate(secao.rota!)}
          className="sm:hidden w-full h-11 border-t text-sm font-medium text-primary inline-flex items-center justify-center gap-1.5 hover:bg-muted/40"
        >
          Abrir o módulo {secao.titulo}<ArrowRight className="h-4 w-4" />
        </button>
      )}
    </section>
  );
}

// ── Cabeçalho simples para blocos especiais ──────────────────────────────────

function CabecalhoBloco({ icone, titulo, resumo }: { icone: IconeGuia; titulo: string; resumo: string }) {
  return (
    <header className="px-4 py-3.5 flex items-start gap-3 border-b bg-muted/20">
      <IconeSecao icone={icone} />
      <div className="min-w-0">
        <h2 className="text-base font-semibold leading-tight">{titulo}</h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1 leading-relaxed">{resumo}</p>
      </div>
    </header>
  );
}

// ── Fluxo: da venda à entrega ────────────────────────────────────────────────

export function FluxoVenda({ etapas, role, onIr }: { etapas: EtapaFluxo[]; role: AppRole | null; onIr: (ancora: string) => void }) {
  return (
    <section id="fluxo" data-secao="fluxo" className="scroll-mt-20 rounded-2xl border bg-card overflow-hidden">
      <CabecalhoBloco icone="fluxo" titulo="Da venda à entrega" resumo="O caminho de um pedido pelos módulos. Cada etapa é feita por um perfil; toque em “Como fazer” para ver o passo a passo." />
      <ol className="p-4 space-y-0">
        {etapas.map((e, i) => {
          const seu = role === "admin" || role === "gerente" || (role ? e.perfis.includes(role) : false);
          return (
            <li key={i} className="relative flex gap-3 pb-5 last:pb-0">
              {i < etapas.length - 1 && <span aria-hidden className="absolute left-[15px] top-8 bottom-0 w-px bg-border" />}
              <span className={cn(
                "relative z-[1] h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 tabular-nums",
                seu ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}>{i + 1}</span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-semibold">{e.quem}</span>
                  <span className="text-sm font-semibold">{e.titulo}</span>
                  {e.situacao && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{e.situacao}</span>}
                </div>
                <p className="text-sm text-foreground/85 mt-1 leading-relaxed"><TextoGuia texto={e.texto} /></p>
                {e.ancora && (
                  <button type="button" onClick={() => onIr(e.ancora!)} className="mt-1.5 h-9 -ml-1 px-1 text-sm font-medium text-primary inline-flex items-center gap-1 hover:underline">
                    Como fazer<ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ── Perfis ───────────────────────────────────────────────────────────────────

export function PerfisBloco({ perfis, role }: { perfis: PerfilGuia[]; role: AppRole | null }) {
  return (
    <section id="perfis" data-secao="perfis" className="scroll-mt-20 rounded-2xl border bg-card overflow-hidden">
      <CabecalhoBloco icone="perfis" titulo="Perfis e o que cada um vê" resumo="O administrador escolhe o perfil de cada pessoa. O menu mostra só os módulos do seu perfil." />
      <ul className="grid sm:grid-cols-2 gap-px bg-border">
        {perfis.map(p => {
          const seu = p.role === role;
          return (
            <li key={p.role} className={cn("bg-card p-4", seu && "shadow-[inset_3px_0_0_hsl(var(--primary))]")}>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold">{p.nome}</p>
                {seu && <span className="rounded-full bg-primary/15 text-primary px-2 py-0.5 text-[11px] font-semibold">Seu perfil</span>}
              </div>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{p.resumo}</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {p.modulos.map(m => <span key={m} className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">{m}</span>)}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Perguntas frequentes ─────────────────────────────────────────────────────

export function FaqBloco({ itens, abertas, onToggle, onIr }: {
  itens: PerguntaFAQ[]; abertas: Set<string>; onToggle: (ancora: string) => void; onIr: (ancora: string) => void;
}) {
  return (
    <section id="faq" data-secao="faq" className="scroll-mt-20 rounded-2xl border bg-card overflow-hidden">
      <CabecalhoBloco icone="faq" titulo="Perguntas frequentes e problemas comuns" resumo="O que fazer quando algo não sai como esperado." />
      <ul className="divide-y">
        {itens.map(p => {
          const ancora = `faq-${p.id}`;
          const aberta = abertas.has(ancora);
          return (
            <li key={p.id} id={ancora} className="scroll-mt-20">
              <button
                type="button" onClick={() => onToggle(ancora)} aria-expanded={aberta}
                className={cn("w-full flex items-start gap-3 px-4 py-3 text-left min-h-[52px] hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", aberta && "bg-muted/30")}
              >
                <ChevronDown className={cn("h-4 w-4 mt-0.5 shrink-0 text-muted-foreground transition-transform", aberta && "rotate-180 text-primary")} />
                <span className="text-sm font-semibold leading-snug">{p.pergunta}</span>
              </button>
              {aberta && (
                <div className="px-4 pb-4 sm:pl-11 space-y-2">
                  {p.resposta.map((r, i) => <p key={i} className="text-sm text-foreground/85 leading-relaxed"><TextoGuia texto={r} /></p>)}
                  {p.ancora && (
                    <button type="button" onClick={() => onIr(p.ancora!)} className="h-9 -ml-1 px-1 text-sm font-medium text-primary inline-flex items-center gap-1 hover:underline">
                      Ver o passo a passo<ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Glossário ────────────────────────────────────────────────────────────────

export function GlossarioBloco({ termos }: { termos: TermoGlossario[] }) {
  return (
    <section id="glossario" data-secao="glossario" className="scroll-mt-20 rounded-2xl border bg-card overflow-hidden">
      <CabecalhoBloco icone="glossario" titulo="Glossário" resumo="Palavras que aparecem no sistema, em poucas linhas." />
      <dl className="grid sm:grid-cols-2 gap-px bg-border">
        {termos.map((g, i) => (
          <div key={g.termo} className={cn("bg-card px-4 py-3", i === termos.length - 1 && termos.length % 2 === 1 && "sm:col-span-2")}>
            <dt className="text-sm font-semibold">{g.termo}</dt>
            <dd className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{g.definicao}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
