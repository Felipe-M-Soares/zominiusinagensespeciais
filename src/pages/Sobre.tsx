import { useNavigate } from "react-router-dom";
import { BookOpen, ChevronRight, FileText, Info, Keyboard, MessageSquareWarning } from "lucide-react";
import { Logo } from "@/components/Logo";
import { FeedbackButton } from "@/components/FeedbackButton";
import { useAuth } from "@/hooks/useAuth";
import { ROLE_LABELS, type AppRole } from "@/types/roles";
import { APP_VERSION, APP_NAME, LICENSED_TO, BUILD_DATE } from "@/lib/appInfo";

export default function Sobre() {
  const navigate = useNavigate();
  const { role } = useAuth();

  const ajuda = [
    { icon: BookOpen, titulo: "Guia de uso", desc: "Passo a passo das tarefas do dia a dia, por módulo", path: "/guia", destaque: true },
    { icon: FileText, titulo: "Manuais", desc: "PDFs de equipamentos e da qualidade", path: "/manual", destaque: false },
  ];

  return (
    <div className="flex flex-col h-full bg-transparent">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="px-3 sm:px-4 h-12 sm:h-14 flex items-center gap-2">
          <Info className="h-4 w-4 text-primary shrink-0" />
          <div>
            <h1 className="text-sm font-semibold leading-tight">Sobre / Ajuda</h1>
            <p className="hidden sm:block text-[10px] text-muted-foreground leading-tight">Guia de uso, manuais, versão e contato com o suporte</p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="px-3 sm:px-4 py-4 sm:py-6 max-w-2xl mx-auto space-y-4">
          <section className="rounded-2xl border bg-card overflow-hidden">
            <h2 className="px-4 pt-4 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Precisa de ajuda?</h2>
            <ul className="divide-y">
              {ajuda.map(a => (
                <li key={a.path}>
                  <button type="button" onClick={() => navigate(a.path)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/40 transition-colors">
                    <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${a.destaque ? "bg-brand/15 text-brand" : "bg-primary/10 text-primary"}`}>
                      <a.icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{a.titulo}</p>
                      <p className="text-xs text-muted-foreground">{a.desc}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border bg-card p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
                <MessageSquareWarning className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">Encontrou um problema ou tem uma ideia?</h2>
                <p className="text-xs text-muted-foreground">Conte para a equipe responsável. A mensagem já vai com a tela em que você estava.</p>
              </div>
            </div>
            <FeedbackButton className="w-full h-11 rounded-xl" />
          </section>

          <section className="rounded-2xl border bg-card p-4">
            <div className="flex items-center gap-3 mb-3">
              <Logo className="h-8 w-auto object-contain" />
            </div>
            <dl className="divide-y text-sm">
              {[
                ["Sistema", APP_NAME],
                ["Versão", APP_VERSION],
                ["Build", BUILD_DATE],
                ["Seu perfil", role ? (ROLE_LABELS[role as AppRole] ?? role) : "—"],
                ["Licenciado para", LICENSED_TO],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-medium text-right break-words min-w-0">{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <p className="hidden md:flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <Keyboard className="h-3.5 w-3.5" /> Atalho: Ctrl+K abre a busca do Estoque (para quem tem acesso).
          </p>
        </div>
      </main>
    </div>
  );
}
