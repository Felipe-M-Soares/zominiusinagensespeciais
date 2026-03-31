import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Sun, Moon, Monitor } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";

type Theme = "light" | "dark" | "system";

const VALID_THEMES = new Set<Theme>(["light", "dark", "system"]);

function getStoredTheme(): Theme {
  const stored = localStorage.getItem("theme");
  // SEC: Valida que o valor lido é um dos temas permitidos.
  // Sem esta checagem, um valor arbitrário no localStorage poderia ser usado.
  if (stored && VALID_THEMES.has(stored as Theme)) {
    return stored as Theme;
  }
  return "system";
}

function applyTheme(theme: Theme) {
const root = document.documentElement;
if (theme === "system") {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.classList.toggle("dark", prefersDark);
} else {
  root.classList.toggle("dark", theme === "dark");
}
localStorage.setItem("theme", theme);
}

const Settings = () => {
const { user } = useAuth();
const navigate = useNavigate();
const [theme, setTheme] = useState<Theme>(getStoredTheme);

useEffect(() => {
  applyTheme(theme);
}, [theme]);

// Listen for system theme changes
useEffect(() => {
  if (theme !== "system") return;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => applyTheme("system");
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}, [theme]);

const themeOptions: { value: Theme; label: string; icon: React.ElementType }[] = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
];

return (
  <div className="min-h-screen bg-background">
    <header className="border-b border-border bg-card sticky top-0 z-10">
      <div className="container mx-auto px-4 py-3 flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Logo className="h-8 object-contain" />
        <h1 className="font-display text-lg font-semibold">Configurações</h1>
      </div>
    </header>

    <main className="container mx-auto px-4 py-8 max-w-xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Aparência</CardTitle>
          <CardDescription>Escolha o tema da interface</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            {themeOptions.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all ${
                  theme === value
                    ? "border-primary bg-accent"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="text-sm font-medium">{label}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div>
            <Label className="text-muted-foreground text-xs">Email</Label>
            <p className="text-sm">{user?.email}</p>
          </div>
        </CardContent>
      </Card>
    </main>
  </div>
);
};

export default Settings;
