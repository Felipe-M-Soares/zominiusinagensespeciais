import type { Device } from "@/types/device";
import {
Dialog,
DialogContent,
DialogHeader,
DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Shield, FlaskConical, Package, Barcode, FileText, Globe, Hash, Cpu, Activity, Layers } from "lucide-react";

interface Props {
device: Device | null;
open: boolean;
onClose: () => void;
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
if (!value) return null;
return (
  <div className="flex items-start gap-3 py-2 px-2 rounded-xl hover:bg-muted/10 transition-colors group/row">
    <div className="h-7 w-7 rounded-lg bg-primary/8 flex items-center justify-center shrink-0 group-hover/row:bg-primary/15 transition-colors">
      <Icon className="h-3.5 w-3.5 text-primary/70" />
    </div>
    <div className="min-w-0 pt-0.5">
      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-widest font-medium">{label}</p>
      <p className="text-sm text-foreground break-words leading-snug">{value}</p>
    </div>
  </div>
);
}

export function DeviceDetail({ device, open, onClose }: Props) {
if (!device) return null;

return (
  <Dialog open={open} onOpenChange={onClose}>
    <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto p-0 rounded-2xl border-border/30">
      {/* Header */}
      <div className="relative p-6 pb-4">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent rounded-t-2xl" />
        <div className="relative">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold leading-tight">
              {device.model}
            </DialogTitle>
            <p className="text-xs text-muted-foreground/60 font-mono">{device.reference}</p>
          </DialogHeader>

          <div className="flex flex-wrap gap-1.5 mt-3">
            <Badge variant="outline" className="border-primary/20 text-primary/80 font-mono text-[11px] rounded-lg">
              Classe {device.classification_code}
            </Badge>
            {device.sterile ? (
              <Badge className="bg-success/10 text-success border-0 text-[11px] rounded-lg">
                <Shield className="h-3 w-3 mr-1" /> Estéril
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[11px] rounded-lg border-muted-foreground/30 text-muted-foreground bg-muted/20">Não Estéril</Badge>
            )}
            {device.single_use && (
              <Badge className="bg-orange-500/10 text-orange-500 border-0 text-[11px] rounded-lg">
                <Package className="h-3 w-3 mr-1" /> Uso Único
              </Badge>
            )}
            {device.implantable && (
              <Badge className="bg-primary/10 text-primary border-0 text-[11px] rounded-lg">
                <Activity className="h-3 w-3 mr-1" /> Implantável
              </Badge>
            )}
          </div>
        </div>
      </div>

      <Separator className="opacity-30" />

      <div className="px-5 pb-6 pt-2 space-y-0.5">
        <InfoRow icon={Barcode} label="UDI-DI" value={device.udi_di} />
        <InfoRow icon={Hash} label="Código Interno" value={device.internal_code} />
        <InfoRow icon={FileText} label="Registro ANVISA" value={device.anvisa_registration} />
        <InfoRow icon={Globe} label="País do Fabricante" value={device.manufacturer_country} />
        <InfoRow icon={FlaskConical} label="Material Principal" value={device.primary_material} />
        <InfoRow icon={Layers} label="Material Secundário" value={device.secondary_material ?? ""} />
        <InfoRow icon={Layers} label="Tratamento de Superfície" value={device.surface_treatment ?? ""} />
        <InfoRow icon={Cpu} label="Compatibilidade Exocad" value={device.exocad_compatibility} />

        {device.intended_use && (
          <>
            <Separator className="my-3 opacity-20" />
            <div className="px-2">
              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-widest font-medium mb-1">Uso Pretendido</p>
              <p className="text-sm text-foreground leading-relaxed">{device.intended_use}</p>
            </div>
          </>
        )}

        {device.brand_name && (
          <>
            <Separator className="my-3 opacity-20" />
            <div className="px-2 text-xs text-muted-foreground/60">
              Marca: <span className="text-foreground font-medium">{device.brand_name}</span>
            </div>
          </>
        )}
      </div>
    </DialogContent>
  </Dialog>
);
}
