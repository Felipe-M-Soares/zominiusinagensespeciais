import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowLeft, BookOpen, FileText, ExternalLink } from "lucide-react";
import { Logo } from "@/components/Logo";
import { FeedbackButton } from "@/components/FeedbackButton";
import { APP_VERSION, APP_NAME, LICENSED_TO, BUILD_DATE } from "@/lib/appInfo";

export default function Sobre() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-transparent">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Logo className="h-8 object-contain" />
          <h1 className="font-display text-lg font-semibold">Sobre o sistema</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{APP_NAME}</CardTitle>
            <CardDescription>Sistema de gestão — estoque, comercial, financeiro, produção e qualidade</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between border-b border-border/40 pb-2">
              <span className="text-muted-foreground">Versão</span>
              <span className="font-mono font-medium">{APP_VERSION}</span>
            </div>
            <div className="flex justify-between border-b border-border/40 pb-2">
              <span className="text-muted-foreground">Build</span>
              <span className="font-mono font-medium">{BUILD_DATE}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Licenciado para</span>
              <span className="font-medium text-right">{LICENSED_TO}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ajuda e documentação</CardTitle>
            <CardDescription>Guias de uso e manuais de equipamentos</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" className="w-full justify-start gap-2" onClick={() => navigate("/guia")}>
              <BookOpen className="h-4 w-4" /> Guia de uso do sistema
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2" onClick={() => navigate("/manual")}>
              <FileText className="h-4 w-4" /> Manual (PDFs de equipamentos/qualidade)
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Encontrou um problema?</CardTitle>
            <CardDescription>Conte para a equipe responsável — ajuda a melhorar o sistema</CardDescription>
          </CardHeader>
          <CardContent>
            <FeedbackButton className="w-full" />
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground flex items-center justify-center gap-1">
          <ExternalLink className="h-3 w-3" /> Zomini Usinagens Especiais
        </p>
      </main>
    </div>
  );
}
