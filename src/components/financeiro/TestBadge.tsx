export function TestBadge({ modoTeste }: { modoTeste: boolean }) {
  if (!modoTeste) return null; // Produção é o padrão — não precisa de badge
  return (
    <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-orange-500/40 bg-orange-500/8 text-orange-500 leading-none shrink-0 whitespace-nowrap">
      Homo
    </span>
  );
}
