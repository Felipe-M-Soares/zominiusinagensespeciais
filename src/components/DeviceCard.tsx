import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { Device } from "@/types/device";
import { Shield, Package, Activity, Copy, Check, Box } from "lucide-react";

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
  const trimmed = country.trim();
  return map[trimmed] ?? "🌐";
}

export function DeviceCard({ device, onClick }: Props) {
  const [copied,    setCopied]    = useState(false);
  const [imgError,  setImgError]  = useState(false);

  // Reseta imgError quando icon_url muda (ex: imagem atualizada em sessão ativa)
  useEffect(() => { setImgError(false); }, [device.icon_url]);

  const handleCopyUDI = (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = device.udi_di || device.anvisa_registration;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const hasImage = !!(device.icon_url && !imgError);

  return (
  <div
    role="button"
    tabIndex={0}
    className={cn(
      "w-full text-left group relative rounded-xl overflow-hidden transition-all duration-300",
      "hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 cursor-pointer",
      // Superfície neutra, com elevação sutil que cresce no hover — sem glow colorido
      "bg-card border border-border/60",
      "shadow-[0_1px_2px_hsl(0_0%_0%/0.04)]",
      "hover:border-border hover:shadow-[0_8px_24px_-8px_hsl(0_0%_0%/0.12)]",
      "dark:shadow-[0_1px_0_hsl(0_0%_100%/0.04)_inset]",
      "dark:hover:shadow-[0_12px_32px_-12px_hsl(0_0%_0%/0.5)]"
    )}
    onClick={() => onClick(device)}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(device); }}
  >
    {/* Imagem do componente */}
    <div className={cn(
      "relative w-full overflow-hidden bg-[#fafafa] dark:bg-white/[0.03] flex items-center justify-center transition-all border-b border-border/50",
      hasImage ? "h-36" : "h-0 border-b-0"
    )}>
      {hasImage && (
        <img
          src={device.icon_url!}
          alt={device.model}
          loading="lazy"
          decoding="async"
          onError={() => setImgError(true)}
          className="h-full w-full object-contain p-4 group-hover:scale-[1.03] transition-transform duration-300"
        />
      )}
    </div>

    <div className="relative p-4 space-y-3">
      {/* Header: nome em destaque + selo ativo */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-semibold leading-snug text-foreground transition-colors line-clamp-2 min-w-0">
          {device.model}
        </h3>
        <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success tracking-wide mt-0.5">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          Ativo
        </span>
      </div>

      {/* Referência + marca — apoio, discreto */}
      <p className="text-[12px] text-muted-foreground truncate -mt-1.5">
        {device.reference}
        {device.brand_name && <span className="text-muted-foreground/60"> · {device.brand_name}</span>}
      </p>

      {/* GTIN/UDI — destaque tipográfico sem fundo saturado */}
      <button
        type="button"
        title="Clique para copiar o GTIN/UDI"
        onClick={handleCopyUDI}
        className={cn(
          "w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 transition-colors group/copy text-left",
          "bg-muted/40 dark:bg-white/[0.04] border border-border/50",
          "hover:bg-muted/70 dark:hover:bg-white/[0.07] hover:border-border"
        )}
      >
        <div className="min-w-0">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-medium mb-0.5">GTIN / UDI</p>
          <p className={cn("text-[14px] font-mono font-semibold tracking-tight truncate", copied ? "text-success" : "text-foreground")}>
            {device.anvisa_registration || device.udi_di || "—"}
          </p>
        </div>
        {copied
          ? <Check className="h-4 w-4 text-success shrink-0" />
          : <Copy className="h-3.5 w-3.5 text-muted-foreground/50 group-hover/copy:text-foreground shrink-0 transition-colors" />}
      </button>

      {/* Material — apoio, discreto */}
      {device.primary_material && (
        <p className="text-[11px] text-muted-foreground truncate" title={device.primary_material}>
          {device.primary_material}
        </p>
      )}

      {/* Status pills — neon, cada categoria com sua cor original */}
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-0.5 text-[10px] font-medium text-brand tracking-wide">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          Classe {device.classification_code || "—"}
        </span>
        {device.sterile && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-0.5 text-[10px] font-medium text-success tracking-wide">
            <Shield className="h-2.5 w-2.5" />
            Estéril
          </span>
        )}
        {device.single_use && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/10 px-2.5 py-0.5 text-[10px] font-medium text-orange-500 tracking-wide">
            <Package className="h-2.5 w-2.5" />
            Uso único
          </span>
        )}
        {device.implantable && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-2.5 py-0.5 text-[10px] font-medium text-violet-500 tracking-wide">
            <Activity className="h-2.5 w-2.5" />
            Implantável
          </span>
        )}
      </div>

      {/* Footer — país e Exocad */}
      <div className="flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground/70 pt-2.5 border-t border-border/40">
        {device.manufacturer_country ? (
          <span className="flex items-center gap-1" title={device.manufacturer_country}>
            <span>{countryFlag(device.manufacturer_country)}</span>
            <span>{device.manufacturer_country}</span>
          </span>
        ) : <span />}
        {device.exocad_compatibility && device.exocad_compatibility !== "N.A" && (
          <span className="flex items-center gap-1 font-medium text-foreground/60">
            <Box className="h-2.5 w-2.5" />
            Exocad
          </span>
        )}
      </div>
    </div>
  </div>
);
}
