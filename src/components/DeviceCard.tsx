import { useState } from "react";
import type { Device } from "@/types/device";
import { Shield, Package, Activity, Copy, Check, Cpu, ImageOff } from "lucide-react";

interface Props {
  device: Device;
  onClick: (device: Device) => void;
}

// Mapa de país → emoji de bandeira
export function countryFlag(country: string): string {
  const map: Record<string, string> = {
    "Brasil": "🇧🇷", "Brazil": "🇧🇷", "BR": "🇧🇷",
    "Estados Unidos": "🇺🇸", "United States": "🇺🇸", "USA": "🇺🇸", "US": "🇺🇸",
    "Alemanha": "🇩🇪", "Germany": "🇩🇪", "DE": "🇩🇪",
    "França": "🇫🇷", "France": "🇫🇷", "FR": "🇫🇷",
    "Itália": "🇮🇹", "Italy": "🇮🇹", "IT": "🇮🇹",
    "Suíça": "🇨🇭", "Switzerland": "🇨🇭", "CH": "🇨🇭",
    "Israel": "🇮🇱", "IL": "🇮🇱",
    "Suécia": "🇸🇪", "Sweden": "🇸🇪", "SE": "🇸🇪",
    "Coreia do Sul": "🇰🇷", "South Korea": "🇰🇷", "KR": "🇰🇷",
    "Japão": "🇯🇵", "Japan": "🇯🇵", "JP": "🇯🇵",
    "China": "🇨🇳", "CN": "🇨🇳",
    "Reino Unido": "🇬🇧", "United Kingdom": "🇬🇧", "UK": "🇬🇧", "GB": "🇬🇧",
    "Canadá": "🇨🇦", "Canada": "🇨🇦", "CA": "🇨🇦",
    "Austrália": "🇦🇺", "Australia": "🇦🇺", "AU": "🇦🇺",
    "Holanda": "🇳🇱", "Netherlands": "🇳🇱", "NL": "🇳🇱",
    "Bélgica": "🇧🇪", "Belgium": "🇧🇪", "BE": "🇧🇪",
    "Espanha": "🇪🇸", "Spain": "🇪🇸", "ES": "🇪🇸",
    "Portugal": "🇵🇹", "PT": "🇵🇹",
    "Argentina": "🇦🇷", "AR": "🇦🇷",
    "México": "🇲🇽", "Mexico": "🇲🇽", "MX": "🇲🇽",
    "Índia": "🇮🇳", "India": "🇮🇳", "IN": "🇮🇳",
    "Turquia": "🇹🇷", "Turkey": "🇹🇷", "TR": "🇹🇷",
    "Polônia": "🇵🇱", "Poland": "🇵🇱", "PL": "🇵🇱",
    "Áustria": "🇦🇹", "Austria": "🇦🇹", "AT": "🇦🇹",
    "Dinamarca": "🇩🇰", "Denmark": "🇩🇰", "DK": "🇩🇰",
    "Finlândia": "🇫🇮", "Finland": "🇫🇮", "FI": "🇫🇮",
    "Noruega": "🇳🇴", "Norway": "🇳🇴", "NO": "🇳🇴",
  };
  return map[country.trim()] ?? "🌐";
}

export function DeviceCard({ device, onClick }: Props) {
  const [copied, setCopied] = useState(false);
  const [imgError, setImgError] = useState(false);

  const hasImage = !!device.icon_url && !imgError;

  const handleCopyRef = (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = device.reference || device.udi_di;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const pills = [
    device.sterile     && { icon: Shield,   label: "Estéril",     cls: "bg-success/10 text-success border-success/20" },
    device.single_use  && { icon: Package,  label: "Uso único",   cls: "bg-orange-500/10 text-orange-500 border-orange-500/20" },
    device.implantable && { icon: Activity, label: "Implantável", cls: "bg-brand/10 text-brand border-brand/20" },
  ].filter(Boolean) as Array<{ icon: React.ElementType; label: string; cls: string }>;

  return (
    <div
      role="button"
      tabIndex={0}
      className="group relative flex flex-col rounded-2xl bg-card overflow-hidden cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring border border-border/30 hover:border-brand/30"
      onClick={() => onClick(device)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(device); }}
    >
      {/* ── Área de imagem: sempre quadrada, mesmo tamanho para todas as peças ── */}
      {/*
        aspect-square garante proporção 1:1 igual em todos os cards.
        object-contain com padding uniforme (p-5) mantém a peça inteira visível
        sem cortar, independente do tamanho real do conteúdo da imagem.
        Sem scale no hover — evita a ilusão de que peças têm tamanhos diferentes.
        bg-muted/25 serve como "caixa neutra" que não compete com a peça.
      */}
      <div className="relative w-full aspect-square bg-muted/25 overflow-hidden shrink-0">

        {/* Overlays de badge — sempre visíveis, acima da imagem ou do fallback */}
        <div className="absolute top-2 right-2 z-10">
          <span className="inline-flex items-center rounded-lg bg-card/90 backdrop-blur-sm border border-brand/20 px-2 py-0.5 text-[10px] font-mono font-bold text-brand/80 leading-none shadow-sm">
            {device.classification_code}
          </span>
        </div>

        {device.manufacturer_country && (
          <div className="absolute top-2 left-2 z-10">
            <span
              className="flex items-center justify-center h-6 w-6 rounded-lg bg-card/80 backdrop-blur-sm border border-border/30 text-sm shadow-sm"
              title={device.manufacturer_country}
            >
              {countryFlag(device.manufacturer_country)}
            </span>
          </div>
        )}

        {hasImage ? (
          <img
            src={device.icon_url!}
            alt={device.model}
            onError={() => setImgError(true)}
            /*
              w-full h-full preenche todo o quadrado.
              object-contain garante que a peça inteira apareça sem corte.
              p-5 (20px) cria margem uniforme em todos os lados — peças com
              formatos diferentes (longa, curta, quadrada) todas ficam
              proporcionais dentro do mesmo espaço.
            */
            className="w-full h-full object-contain p-5"
          />
        ) : (
          /* Fallback: mesmo espaço, padrão de pontos sutil */
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 select-none">
            <div
              className="absolute inset-0 opacity-[0.035]"
              style={{
                backgroundImage: "radial-gradient(circle, hsl(var(--foreground)) 1px, transparent 1px)",
                backgroundSize: "18px 18px",
              }}
            />
            <ImageOff className="h-8 w-8 text-muted-foreground/20" />
            <span className="text-[9px] font-medium text-muted-foreground/30 uppercase tracking-widest">
              sem foto
            </span>
          </div>
        )}
      </div>

      {/* ── Separador accent ── */}
      <div className="h-px bg-gradient-to-r from-transparent via-brand/30 to-transparent group-hover:via-brand/60 transition-colors duration-300" />

      {/* ── Conteúdo ── */}
      <div className="flex flex-col flex-1 p-3 gap-2">

        {/* Nome + marca */}
        <div className="space-y-0.5 min-w-0">
          <h3 className="text-[13px] font-semibold leading-snug text-foreground group-hover:text-brand transition-colors line-clamp-2">
            {device.model}
          </h3>
          {device.brand_name && (
            <p className="text-[10px] text-muted-foreground/60 truncate">{device.brand_name}</p>
          )}
        </div>

        {/* Referência com copy */}
        <button
          type="button"
          onClick={handleCopyRef}
          title="Clique para copiar referência"
          className="group/copy flex items-center gap-1.5 w-fit max-w-full rounded-lg bg-muted/30 hover:bg-brand/8 border border-border/30 hover:border-brand/25 px-2 py-1 transition-colors"
        >
          {copied
            ? <Check className="h-3 w-3 text-success shrink-0" />
            : <Copy className="h-3 w-3 text-muted-foreground/40 group-hover/copy:text-brand/60 shrink-0 transition-colors" />
          }
          <span className={`font-mono text-[11px] truncate ${copied ? "text-success" : "text-muted-foreground group-hover/copy:text-foreground"}`}>
            {device.reference || device.udi_di}
          </span>
        </button>

        {/* Pills de características */}
        {pills.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {pills.map(({ icon: Icon, label, cls }) => (
              <span
                key={label}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-medium leading-none ${cls}`}
              >
                <Icon className="h-2.5 w-2.5" />
                {label}
              </span>
            ))}
          </div>
        )}

        {/* Rodapé — ANVISA + Exocad */}
        <div className="flex items-center justify-between gap-2 pt-1.5 mt-auto border-t border-border/15">
          <span className="font-mono text-[10px] text-muted-foreground/50 truncate flex-1">
            {device.anvisa_registration || device.udi_di || "—"}
          </span>
          {device.exocad_compatibility && device.exocad_compatibility !== "N.A" && (
            <span className="flex items-center gap-0.5 text-[10px] text-brand/60 shrink-0">
              <Cpu className="h-2.5 w-2.5 text-brand" />
              <span className="hidden sm:inline text-[9px]">Exocad</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
