export function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "hsl(var(--background))" }}>
      <div className="flex flex-col items-center gap-4">
        <div className="relative w-9 h-9">
          <div className="absolute inset-0 rounded-full border-2" style={{ borderColor: "hsl(var(--border))" }}/>
          <div className="absolute inset-0 rounded-full border-2 border-transparent animate-spin" style={{ borderTopColor: "hsl(var(--primary))" }}/>
          <div className="absolute inset-[5px] rounded-full" style={{ background: "hsl(var(--primary) / 0.10)" }}/>
        </div>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em]"
          style={{ fontFamily: "'Syne', sans-serif", color: "hsl(var(--muted-foreground))" }}>Carregando</p>
      </div>
    </div>
  );
}
