import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft, Sun, Moon, Monitor } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { type Theme, getStoredTheme, applyTheme } from "@/lib/theme";

export { getStoredTheme, applyTheme };

const Settings = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = () => applyTheme("system");
    mq.addEventListener("change", h); return () => mq.removeEventListener("change", h);
  }, [theme]);

  const opts: { value: Theme; label: string; icon: React.ElementType }[] = [
    { value: "light", label: "Claro", icon: Sun },
    { value: "dark", label: "Escuro", icon: Moon },
    { value: "system", label: "Sistema", icon: Monitor },
  ];

  return (
    <div className="min-h-full" style={{ background: "hsl(var(--background))" }}>
      <header className="sticky top-0 z-10 border-b" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
        <div className="flex items-center gap-3 px-6 py-3.5 max-w-3xl mx-auto">
          <button onClick={() => navigate("/")} className="p-1.5 rounded-md transition-colors" style={{ color: "hsl(var(--muted-foreground))" }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "hsl(var(--muted)/0.5)"} onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}><ArrowLeft className="h-4 w-4"/></button>
          <Logo className="h-7 object-contain"/>
          <div className="h-4 w-px" style={{ background: "hsl(var(--border))" }}/>
          <h1 className="text-[14.5px] font-semibold" style={{ fontFamily: "'Syne', sans-serif" }}>Configurações</h1>
        </div>
      </header>
      <main className="px-6 py-7 max-w-3xl mx-auto space-y-4">
        <section className="rounded-xl border overflow-hidden" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
          <div className="h-[2px]" style={{ background: "linear-gradient(90deg, hsl(var(--primary)), transparent)" }}/>
          <div className="px-5 py-4 border-b" style={{ borderColor: "hsl(var(--border))" }}>
            <h2 className="text-[14px] font-semibold" style={{ fontFamily: "'Syne', sans-serif" }}>Aparência</h2>
            <p className="text-[12px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Escolha o tema da interface</p>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-3 gap-3">
              {opts.map(({ value, label, icon: Icon }) => (
                <button key={value} onClick={() => setTheme(value)} className="flex flex-col items-center gap-2.5 p-4 rounded-lg border-2 transition-all"
                  style={{ borderColor: theme === value ? "hsl(var(--primary))" : "hsl(var(--border))", background: theme === value ? "hsl(var(--primary) / 0.06)" : "transparent", color: theme === value ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}>
                  <Icon className="h-5 w-5"/><span className="text-[12.5px] font-medium">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="rounded-xl border overflow-hidden" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: "hsl(var(--border))" }}>
            <h2 className="text-[14px] font-semibold" style={{ fontFamily: "'Syne', sans-serif" }}>Conta</h2>
          </div>
          <div className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0" style={{ background: "hsl(var(--primary) / 0.12)", color: "hsl(var(--primary))" }}>{user?.email?.charAt(0).toUpperCase() ?? "U"}</div>
              <div><p className="text-[13.5px] font-medium">{user?.email ?? "—"}</p><p className="text-[11.5px]" style={{ color: "hsl(var(--muted-foreground))" }}>{(user?.user_metadata?.display_name as string) ?? ""}</p></div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};
export default Settings;
