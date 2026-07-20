import { useState, useCallback } from "react";
import { useDebounce } from "@/hooks/useDebounce";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { SearchInputWithBarcode } from "@/components/SearchInputWithBarcode";
import { supabase } from "@/integrations/supabase/client";
import { addDeviceToStock } from "@/hooks/useStock";
import type { Device } from "@/types/device";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type DbDevice = Device & { id: string };

export function AddToStockModal({ open, onClose, onSuccess }: Props) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<DbDevice[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  const doSearch = useCallback(async (q: string) => {
    const s = q.trim().slice(0, 200).replace(/[(),]/g, "").replace(/[%_\\]/g, "\\$&");
    if (!s) { setResults([]); return; }
    setSearching(true);
    const { data } = await supabase
      .from("devices")
      .select("id, udi_di, reference, model, brand_name, internal_code, anvisa_registration, manufacturer_country, classification_code, risk_class, sterile, single_use, implantable, intended_use, body_region, primary_material, secondary_material, surface_treatment, exocad_compatibility, compatible_systems, icon_url")
      .or([
        `model.ilike.%${s}%`,
        `reference.ilike.%${s}%`,
        `udi_di.ilike.%${s}%`,
        `internal_code.ilike.%${s}%`,
        `brand_name.ilike.%${s}%`,
      ].join(","))
      .limit(20);
    setResults((data as DbDevice[]) ?? []);
    setSearching(false);
  }, []);

  const debouncedFn = useDebounce(doSearch, 300);

  function handleChange(v: string) {
    setSearch(v);
    debouncedFn(v);
  }

  async function handleAdd(device: DbDevice) {
    setAdding(device.id);
    const result = await addDeviceToStock(device.id);
    setAdding(null);
    if (result.ok) {
      toast.success(t("addToStockModal.toastAdded"), { description: device.model });
      onSuccess();
    } else {
      toast.error(t("addToStockModal.toastAddError"));
    }
  }

  function handleClose() {
    setSearch("");
    setResults([]);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md p-0 rounded-2xl overflow-hidden border-border/30">
        <div className="relative px-5 pt-5 pb-3">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
          <div className="relative">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
                <Plus className="h-4 w-4 text-primary" />
                {t("addToStockModal.title")}
              </DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground mt-1">
              {t("addToStockModal.subtitle")}
            </p>
          </div>
        </div>

        <div className="px-5 pb-2">
          <SearchInputWithBarcode
            value={search}
            onChange={v => handleChange(v)}
            onSearch={v => handleChange(v)}
            placeholder={t("addToStockModal.searchPlaceholder")}
            height="h-10"
            autoFocus
            inputClass="bg-muted/20"
          />
        </div>

        {/* Resultados */}
        <div className="px-3 pb-4 max-h-[340px] overflow-y-auto space-y-1">
          {searching && (
            <div className="flex items-center justify-center py-6">
              <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          )}
          {!searching && search && results.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              {t("addToStockModal.noDeviceFound")}
            </div>
          )}
          {!searching && !search && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              {t("addToStockModal.typeToSearch")}
            </div>
          )}
          {results.map((device) => (
            <div
              key={device.id}
              className="flex items-start gap-3 p-3 rounded-xl border border-border/30 bg-card hover:bg-accent/30 transition-colors"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-[13px] font-semibold leading-snug text-foreground line-clamp-2">
                  {device.model}
                </p>
                <p className="text-[11px] text-muted-foreground font-mono">{device.reference}</p>
                <p className="text-[10px] text-muted-foreground/60 font-mono">{device.udi_di}</p>
                <div className="flex flex-wrap gap-1 pt-0.5">
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-primary/20 text-primary/80">
                    {device.classification_code}
                  </Badge>
                  {device.sterile && (
                    <Badge className="text-[9px] px-1.5 py-0 bg-success/10 text-success border-0">{t("deviceCard.sterile")}</Badge>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 w-8 p-0 rounded-xl shrink-0 border-primary/30 hover:bg-primary/10 hover:border-primary"
                onClick={() => handleAdd(device)}
                disabled={adding === device.id}
                title={t("addToStockModal.addTitle")}
              >
                {adding === device.id ? (
                  <div className="h-3.5 w-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5 text-primary" />
                )}
              </Button>
            </div>
          ))}
        </div>

        <div className="px-5 pb-5">
          <Button variant="outline" className="w-full h-10 rounded-xl" onClick={handleClose}>
            {t("addToStockModal.close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
