import { useState } from "react";
import type { Device } from "@/types/device";
import { Badge } from "@/components/ui/badge";
import { Shield, Package, Globe, Cpu, Activity, Copy, Check } from "lucide-react";

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
  const [copied, setCopied] = useState(false);

  const handleCopyUDI = (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = device.udi_di || device.anvisa_registration;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
  <div
    role="button"
    tabIndex={0}
    className="w-full text-left group relative rounded-2xl bg-card overflow-hidden transition-all duration-300 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
    style={{
      boxShadow:
        "0 1px 2px hsl(var(--border) / 0.3), 0 4px 12px -2px hsl(var(--border) / 0.15), inset 0 1px 0 hsl(0 0% 100% / 0.06)",
    }}
    onClick={() => onClick(device)}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(device); }}
  >
    {/* Top accent bar */}
    <div className="h-0.5 bg-gradient-to-r from-transparent via-brand to-transparent opacity-60 group-hover:opacity-100 transition-opacity" />

    <div className="p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h3 className="text-[13px] font-semibold leading-snug text-foreground group-hover:text-brand transition-colors line-clamp-2">
            {device.model}
          </h3>
          <p className="text-[11px] text-muted-foreground font-mono tracking-tight">{device.reference}</p>
        </div>
        <Badge
          variant="outline"
          className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 border-brand/25 text-brand/80 bg-brand/5 rounded-lg"
        >
          {device.classification_code}
        </Badge>
      </div>

      {/* Brand */}
      {device.brand_name && (
        <p className="text-[11px] text-muted-foreground/70 truncate -mt-1">{device.brand_name}</p>
      )}

      {/* Status pills */}
      <div className="flex flex-wrap gap-1">
        {device.sterile && (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/8 px-2 py-0.5 text-[10px] font-medium text-success">
            <Shield className="h-2.5 w-2.5" />
            Estéril
          </span>
        )}
        {device.single_use && (
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/12 px-2 py-0.5 text-[10px] font-medium text-orange-500">
            <Package className="h-2.5 w-2.5" />
            Uso único
          </span>
        )}
        {device.implantable && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand/8 px-2 py-0.5 text-[10px] font-medium text-brand">
            <Activity className="h-2.5 w-2.5" />
            Implantável
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground/60 pt-2 border-t border-border/20">
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
            <span className="flex items-center gap-0.5 text-brand/60">
              <Cpu className="h-2.5 w-2.5 text-brand" />
              Exocad
            </span>
          )}
        </div>
      </div>
    </div>
  </div>
);
}
