/**
 * PrintButton — botão que aciona window.print() com area específica.
 * Usa data-no-print nos outros elementos para ocultar na impressão.
 */

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PrintButtonProps {
  label?: string;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "default" | "outline" | "ghost";
  className?: string;
}

export function PrintButton({
  label = "Imprimir",
  size = "sm",
  variant = "outline",
  className,
}: PrintButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={() => window.print()}
      data-print-show
      title="Imprimir (Ctrl+P)"
    >
      <Printer className="h-3.5 w-3.5 mr-1.5" />
      {size !== "icon" && label}
    </Button>
  );
}
