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
      "w-full text-left group relative rounded-2xl overflow-hidden transition-all duration-300",
      "hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
      // Vidro translúcido com brilho: claro = sutil, escuro = glow forte (cian/violeta)
      "bg-card border border-brand/15 dark:border-brand/25",
      "shadow-[0_1px_3px_hsl(var(--border)/0.4),0_12px_28px_-14px_hsl(var(--brand)/0.20)]",
      "dark:shadow-[0_0_0_1px_hsl(var(--brand)/0.06),0_24px_48px_-20px_hsl(var(--brand)/0.30)]"
    )}
    onClick={() => onClick(device)}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(device); }}
  >
    {/* Barra lateral neon — identidade visual do card (cian → violeta) */}
    <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-brand to-violet-500 shadow-[0_0_10px_hsl(var(--brand)/0.5)] dark:shadow-[0_0_14px_hsl(var(--brand)/0.7)] z-10" />

    {/* Glow decorativo no canto (só visível no escuro, sutil no claro) */}
    <div className="pointer-events-none absolute -top-10 -left-6 w-40 h-40 rounded-full bg-brand/[0.06] dark:bg-brand/[0.14] blur-2xl" />

    {/* Imagem do componente */}
    <div className={cn(
      "relative w-full overflow-hidden bg-white flex items-center justify-center transition-all",
      hasImage ? "h-36" : "h-0"
    )}>
      {hasImage && (
        <>
          <img
            src={device.icon_url!}
            alt={device.model}
            loading="lazy"
            decoding="async"
            onError={() => setImgError(true)}
            className="h-full w-full object-contain p-3 group-hover:scale-105 transition-transform duration-300"
          />
          {/* Linha neon de transição entre imagem e conteúdo */}
          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-brand via-violet-500 to-brand shadow-[0_0_8px_hsl(var(--brand)/0.6)]" />
          {/* Selo "ativo" flutuante sobre a imagem */}
          <span className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-background/80 dark:bg-black/60 backdrop-blur-sm px-2 py-0.5 text-[9px] font-mono font-medium text-success tracking-wide">
            <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_5px_hsl(var(--success))]" />
            ATIVO
          </span>
        </>
      )}
    </div>

    <div className="relative p-4 pl-[18px] space-y-3 z-[1]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h3 className="text-[13px] font-semibold leading-snug text-foreground group-hover:text-brand transition-colors line-clamp-2">
            {device.model}
          </h3>
          <p className="text-[11px] text-muted-foreground font-mono tracking-tight">{device.reference}</p>
        </div>
        {/* Selo "ativo" inline quando não há imagem (já fica na foto, se houver) */}
        {!hasImage && (
          <span className="shrink-0 flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[9px] font-mono font-medium text-success tracking-wide">
            <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_5px_hsl(var(--success))]" />
            ATIVO
          </span>
        )}
      </div>

      {/* Brand */}
      {device.brand_name && (
        <p className="text-[11px] text-muted-foreground/70 truncate -mt-1">{device.brand_name}</p>
      )}

      {/* Métricas — Classe + Material, em caixinhas estilo HUD */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded-[9px] bg-muted/40 dark:bg-white/[0.03] border border-border/40 dark:border-white/[0.06] px-2.5 py-1.5">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground/70 font-medium">Classe</p>
          <p className="text-[12px] font-mono font-semibold text-foreground">{device.classification_code || "—"}</p>
        </div>
        <div className="rounded-[9px] bg-muted/40 dark:bg-white/[0.03] border border-border/40 dark:border-white/[0.06] px-2.5 py-1.5">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground/70 font-medium">Material</p>
          <p className="text-[12px] font-mono font-semibold text-foreground truncate" title={device.primary_material}>
            {device.primary_material || "—"}
          </p>
        </div>
      </div>

      {/* Status pills */}
      <div className="flex flex-wrap gap-1">
        {device.sterile && (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success border border-success/20">
            <Shield className="h-2.5 w-2.5" />
            Estéril
          </span>
        )}
        {device.single_use && (
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] font-medium text-orange-500 border border-orange-500/20">
            <Package className="h-2.5 w-2.5" />
            Uso único
          </span>
        )}
        {device.implantable && (
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-500 border border-violet-500/20">
            <Activity className="h-2.5 w-2.5" />
            Implantável
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground/60 pt-2 border-t border-border/20 dark:border-white/[0.06]">
        {/* UDI-DI clicável para copiar */}
        <button
          type="button"
          title="Clique para copiar UDI-DI"
          onClick={handleCopyUDI}
          className="font-mono truncate flex items-center gap-1 hover:text-brand transition-colors group/copy"
        >
          {copied
            ? <Check className="h-2.5 w-2.5 text-success shrink-0" />
            : <Copy className="h-2.5 w-2.5 shrink-0 opacity-0 group-hover/copy:opacity-100 transition-opacity" />}
          <span className={copied ? "text-success" : ""}>
            {device.anvisa_registration || device.udi_di}
          </span>
        </button>

        <div className="flex items-center gap-2 shrink-0 ml-2">
          {device.manufacturer_country && (
            <span className="flex items-center gap-0.5" title={device.manufacturer_country}>
              <span>{countryFlag(device.manufacturer_country)}</span>
              <span className="hidden sm:inline">{device.manufacturer_country}</span>
            </span>
          )}
          {device.exocad_compatibility && device.exocad_compatibility !== "N.A" && (
            <span className="flex items-center gap-0.5 text-brand/70">
              <Box className="h-2.5 w-2.5 text-brand" />
              Exocad
            </span>
          )}
        </div>
      </div>
    </div>
  </div>
);
}
