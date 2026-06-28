/**
 * FeedbackButton — Botão de "Reportar problema / Sugestão" disponível para
 * qualquer usuário autenticado. Grava via RPC enviar_feedback() (nunca
 * INSERT direto na tabela — ver migration 20260041000000_feedback_reports.sql
 * para o desenho de segurança: rate limit, validação server-side, user_id
 * sempre fixado pela sessão, nunca pelo que o cliente envia).
 */
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Bug, Lightbulb, MessageCircleQuestion, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { APP_VERSION } from "@/lib/appInfo";

type TipoFeedback = "bug" | "sugestao" | "outro";

const TIPOS: { value: TipoFeedback; label: string; icon: React.ElementType; desc: string }[] = [
  { value: "bug",      label: "Reportar problema", icon: Bug,                   desc: "Algo não funcionou como esperado" },
  { value: "sugestao", label: "Sugestão",           icon: Lightbulb,            desc: "Uma ideia para melhorar o sistema" },
  { value: "outro",    label: "Outro",              icon: MessageCircleQuestion, desc: "Qualquer outro comentário" },
];

interface FeedbackButtonProps {
  /** Quando true, renderiza só o item de menu (sem trigger próprio) — para uso dentro de um dropdown/sidebar existente. */
  asMenuItem?: boolean;
  className?: string;
}

export function FeedbackButton({ asMenuItem, className }: FeedbackButtonProps) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState<TipoFeedback>("bug");
  const [mensagem, setMensagem] = useState("");
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);

  function reset() {
    setTipo("bug"); setMensagem(""); setSent(false);
  }

  async function handleSend() {
    const msg = mensagem.trim();
    if (msg.length < 5) {
      toast.error("Escreva uma mensagem com pelo menos 5 caracteres.");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("enviar_feedback", {
        p_tipo: tipo,
        p_mensagem: msg.slice(0, 4000),
        p_pagina: location.pathname,
        p_app_version: APP_VERSION,
      });
      const result = data as { ok?: boolean; error?: string } | null;
      if (error || result?.ok === false) {
        toast.error(result?.error ?? "Não foi possível enviar. Tente novamente.");
        return;
      }
      setSent(true);
    } catch {
      toast.error("Erro ao enviar. Verifique sua conexão.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {asMenuItem ? (
        <button
          type="button"
          onClick={() => { reset(); setOpen(true); }}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors",
            className
          )}
        >
          <Bug className="w-4 h-4 shrink-0" />
          <span>Reportar problema</span>
        </button>
      ) : (
        <Button variant="outline" size="sm" className={cn("gap-1.5", className)} onClick={() => { reset(); setOpen(true); }}>
          <Bug className="h-3.5 w-3.5" /> Reportar problema
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          {sent ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="h-12 w-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-semibold">Recebemos sua mensagem!</p>
                <p className="text-[12px] text-muted-foreground mt-1">A equipe responsável vai analisar em breve.</p>
              </div>
              <Button size="sm" onClick={() => setOpen(false)}>Fechar</Button>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Reportar problema ou sugestão</DialogTitle>
              </DialogHeader>

              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  {TIPOS.map(t => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setTipo(t.value)}
                      className={cn(
                        "flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 text-center transition-all",
                        tipo === t.value ? "border-primary bg-accent" : "border-border hover:border-primary/40"
                      )}
                    >
                      <t.icon className="h-4 w-4" />
                      <span className="text-[11px] font-medium leading-tight">{t.label}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground -mt-1">
                  {TIPOS.find(t => t.value === tipo)?.desc}
                </p>

                <Textarea
                  value={mensagem}
                  onChange={e => setMensagem(e.target.value.slice(0, 4000))}
                  placeholder={tipo === "bug"
                    ? "Descreva o que aconteceu, o que você esperava que acontecesse, e em qual tela."
                    : "Conte sua ideia ou comentário com o máximo de detalhe que puder."}
                  rows={5}
                  maxLength={4000}
                  className="resize-none text-sm"
                  autoFocus
                />
                <p className="text-[10px] text-muted-foreground text-right">{mensagem.length}/4000</p>
              </div>

              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
                <Button size="sm" onClick={handleSend} disabled={saving || mensagem.trim().length < 5} className="gap-1.5">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Enviar
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
