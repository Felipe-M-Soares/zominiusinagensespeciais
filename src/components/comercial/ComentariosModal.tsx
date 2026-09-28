import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
    if (!user?.id) { toast.error("Sessão expirada. Faça login novamente."); return; }
    if (!pedidoId) return;
    setSaving(true);
    const { data: profile } = await supabase
      .from("profiles").select("display_name").eq("user_id", user.id).maybeSingle();
    const userName = (profile as { display_name?: string } | null)?.display_name ?? user.email ?? "Usuário";
    const { data, error } = await supabase.from("pedido_comentarios").insert({
      pedido_id: pedidoId,
      user_id: user.id,
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
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b text-left">
          <DialogTitle className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-primary" />Recados internos</DialogTitle>
          <DialogDescription>Conversa entre comercial, estoque e financeiro sobre este pedido.</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[10rem]">
          {loading && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
          {!loading && comentarios.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">Nenhum recado ainda.</p>
          )}
          {comentarios.map(cm => (
            <div key={cm.id} className={cn(
              "rounded-xl px-3 py-2 max-w-[88%] text-sm",
              cm.user_name === user?.email
                ? "ml-auto bg-primary/10 border border-primary/20"
                : "bg-muted/50 border"
            )}>
              <p className="font-semibold text-xs text-muted-foreground mb-0.5">{cm.user_name}</p>
              <p className="leading-relaxed whitespace-pre-wrap">{cm.texto}</p>
              <p className="text-[11px] text-muted-foreground mt-1 text-right">
                {new Date(cm.created_at).toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })}
              </p>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="flex gap-2 px-4 py-3 border-t shrink-0">
          <input type="text" value={texto} onChange={e => setTexto(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEnviar(); } }}
            placeholder="Escreva um recado..." maxLength={2000} aria-label="Recado"
            className="flex-1 min-w-0 h-11 rounded-xl border border-input bg-background text-sm px-3 focus:outline-none focus:ring-2 focus:ring-ring" />
          <Button type="button" size="icon" onClick={handleEnviar} disabled={!texto.trim() || saving} className="h-11 w-11 shrink-0" aria-label="Enviar recado">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
