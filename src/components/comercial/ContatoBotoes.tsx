/** Botões de contato rápido (ligar, WhatsApp, e-mail) para cards de cliente. */
import { Mail, MessageCircle, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

export function soDigitos(v: string | null | undefined) {
  return (v ?? "").replace(/\D/g, "");
}

/** Link do WhatsApp: acrescenta 55 quando o número parece brasileiro sem DDI. */
export function linkWhatsApp(tel: string | null | undefined): string | null {
  const d = soDigitos(tel);
  if (d.length < 10) return null;
  return `https://wa.me/${d.length <= 11 ? `55${d}` : d}`;
}

export function ContatoBotoes({ telefone, email, className, compacto }: { telefone: string | null | undefined; email: string | null | undefined; className?: string; compacto?: boolean }) {
  const tel = soDigitos(telefone);
  const wa = linkWhatsApp(telefone);
  if (!tel && !email) return null;
  const cls = cn("inline-flex items-center justify-center gap-1.5 rounded-xl border text-sm font-medium hover:bg-muted transition-colors",
    compacto ? "h-10 w-10" : "h-10 px-3");
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)} onClick={e => e.stopPropagation()}>
      {tel.length >= 8 && (
        <a href={`tel:${tel}`} className={cls} aria-label={`Ligar para ${telefone}`} title={`Ligar: ${telefone}`}>
          <Phone className="h-4 w-4 text-sky-600" />{!compacto && "Ligar"}
        </a>
      )}
      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer" className={cls} aria-label="Abrir conversa no WhatsApp" title="WhatsApp">
          <MessageCircle className="h-4 w-4 text-emerald-600" />{!compacto && "WhatsApp"}
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} className={cls} aria-label={`Enviar e-mail para ${email}`} title={email}>
          <Mail className="h-4 w-4 text-violet-600" />{!compacto && "E-mail"}
        </a>
      )}
    </div>
  );
}
