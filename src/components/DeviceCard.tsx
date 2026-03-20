import type { Device } from "@/types/device";
import { Badge } from "@/components/ui/badge";
import { Shield, Package, Globe, Cpu, Activity } from "lucide-react";

interface Props {
  device: Device;
  onClick: (device: Device) => void;
}

export function DeviceCard({ device, onClick }: Props) {
  return (
    <button
      type="button"
      className="w-full text-left group relative rounded-2xl bg-card overflow-hidden transition-all duration-300 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{
        boxShadow:
          "0 1px 2px hsl(var(--border) / 0.3), 0 4px 12px -2px hsl(var(--border) / 0.15), inset 0 1px 0 hsl(0 0% 100% / 0.06)",
      }}
      onClick={() => onClick(device)}
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
              <Shield className="h-2.5 w-2.5 text-brand" />
              Estéril
            </span>
          )}
          {device.single_use && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/8 px-2 py-0.5 text-[10px] font-medium text-warning">
              <Package className="h-2.5 w-2.5 text-brand" />
              Uso único
            </span>
          )}
          {device.implantable && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand/8 px-2 py-0.5 text-[10px] font-medium text-brand">
              <Activity className="h-2.5 w-2.5 text-brand" />
              Implantável
            </span>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/60 pt-2 border-t border-border/20">
          <span className="font-mono truncate">{device.anvisa_registration}</span>
          <div className="flex items-center gap-2 shrink-0">
            {device.manufacturer_country && (
              <span className="flex items-center gap-0.5">
                <Globe className="h-2.5 w-2.5 text-brand" />
                {device.manufacturer_country}
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
    </button>
  );
}
