import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, FileText } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useTranslation } from "react-i18next";

const GUIA_PDF_PATH = "/guia-de-uso.pdf";

export default function Guia() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-transparent flex flex-col">
      <header className="border-b border-border bg-card sticky top-0 z-10 shrink-0">
        <div className="container mx-auto px-4 py-3 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Logo className="h-8 object-contain" />
          <h1 className="font-display text-lg font-semibold flex-1">{t("guia.title")}</h1>
          <a href={GUIA_PDF_PATH} download="Guia-de-Uso.pdf">
            <Button size="sm" className="gap-1.5">
              <Download className="h-3.5 w-3.5" /> {t("guia.downloadPdf")}
            </Button>
          </a>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 flex flex-col">
        <div className="flex-1 rounded-xl border border-border overflow-hidden bg-muted/20 min-h-[70vh]">
          <object data={GUIA_PDF_PATH} type="application/pdf" className="w-full h-full min-h-[70vh]">
            {/* Fallback para navegadores/contextos sem visualizador de PDF embutido (ex: alguns webviews mobile) */}
            <div className="flex flex-col items-center justify-center h-full gap-4 py-20 text-center px-4">
              <FileText className="h-12 w-12 text-muted-foreground opacity-40" />
              <div>
                <p className="text-sm font-medium">{t("guia.cannotDisplay")}</p>
                <p className="text-xs text-muted-foreground mt-1">{t("guia.useButtonBelow")}</p>
              </div>
              <a href={GUIA_PDF_PATH} download="Guia-de-Uso.pdf">
                <Button size="sm" className="gap-1.5"><Download className="h-3.5 w-3.5" /> {t("guia.downloadPdf")}</Button>
              </a>
            </div>
          </object>
        </div>
      </main>
    </div>
  );
}
