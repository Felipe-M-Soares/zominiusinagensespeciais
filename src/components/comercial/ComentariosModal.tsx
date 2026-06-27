import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { MessageSquare, X, Send } from "lucide-react";
import { toast } from "sonner";
import type { Comentario } from "@/types/comercial";

export function ComentariosModal({ pedidoId, onClose }: { pedidoId: string | null; onClose: () => void }) {
  const { user } = useAuth();
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [texto, setTexto] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pedidoId) return;
    setLoading(true);
    supabase
      .from("pedido_comentarios")
      .select("id, user_name, texto, created_at")
      .eq("pedido_id", pedidoId)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (!error) setComentarios((data ?? []) as Comentario[]);
        setLoading(false);
      });
  }, [pedidoId]);

  if (!pedidoId) return null;

  async function handleEnviar() {
    if (!texto.trim() || saving) return;
    setSaving(true);
    const { data: profile } = await supabase
      .from("profiles").select("display_name").eq("user_id", user?.id).maybeSingle();
    const userName = (profile as { display_name?: string } | null)?.display_name ?? user?.email ?? "Usuário";
    const { data, error } = await supabase.from("pedido_comentarios").insert({
      pedido_id: pedidoId,
      user_id: user?.id ?? null,
      user_name: userName,
      texto: texto.trim().slice(0, 2000),
    }).select("id, user_name, texto, created_at").single();
    setSaving(false);
    if (error) { toast.error("Erro ao enviar comentário."); return; }
    setComentarios(prev => [...prev, data as Comentario]);
    setTexto("");
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border/30 shadow-xl flex flex-col max-h-[75vh] animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/20 shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-violet-500" />
            <p className="text-sm font-semibold">Comentários internos</p>
          </div>
          <button type="button" onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted/40 text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {loading && <div className="flex justify-center py-6"><div className="h-5 w-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>}
          {!loading && comentarios.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">Nenhum comentário ainda.</p>
          )}
          {comentarios.map(cm => (
            <div key={cm.id} className={cn(
              "rounded-xl px-3 py-2 max-w-[88%] text-[12px]",
              cm.user_name === user?.email
                ? "ml-auto bg-violet-500/10 border border-violet-500/20 text-violet-700 dark:text-violet-300"
                : "bg-muted/30 border border-border/20 text-foreground"
            )}>
              <p className="font-semibold text-[10px] text-muted-foreground mb-0.5">{cm.user_name}</p>
              <p className="leading-relaxed whitespace-pre-wrap">{cm.texto}</p>
              <p className="text-[9px] text-muted-foreground/60 mt-1 text-right">
                {new Date(cm.created_at).toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })}
              </p>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-border/20 shrink-0">
          <input type="text" value={texto} onChange={e => setTexto(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEnviar(); } }}
            placeholder="Escreva um comentário..." maxLength={2000}
            className="flex-1 h-9 rounded-xl border border-border/50 bg-background text-[12px] px-3 focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
          <button type="button" onClick={handleEnviar} disabled={!texto.trim() || saving}
            className="h-9 w-9 flex items-center justify-center rounded-xl bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-40">
            {saving ? <div className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
