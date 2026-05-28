import { cn } from "@/lib/utils";
function Bone({ className }: { className?: string }) {
  return <div className={cn("rounded-md animate-pulse", className)} style={{ background: "hsl(var(--muted) / 0.65)" }}/>;
}
export function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="rounded-xl border p-4 space-y-3" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
          <div className="flex items-center gap-2"><Bone className="h-8 w-8 rounded-lg shrink-0"/><Bone className="h-3 w-20"/></div>
          <Bone className="h-6 w-14"/>
        </div>
      ))}
    </div>
  );
}
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
      <div className="px-4 py-3 border-b flex gap-4" style={{ borderColor: "hsl(var(--border))" }}>
        <Bone className="h-3 w-28"/><Bone className="h-3 w-16 ml-auto"/>
      </div>
      <div className="divide-y" style={{ borderColor: "hsl(var(--border))" }}>
        {[...Array(rows)].map((_, i) => (
          <div key={i} className="px-4 py-3 flex items-center gap-3">
            <Bone className="h-7 w-7 rounded-lg shrink-0"/>
            <div className="flex-1 space-y-1.5"><Bone className="h-3 w-36"/><Bone className="h-2.5 w-20"/></div>
            <Bone className="h-5 w-14 rounded-full"/>
          </div>
        ))}
      </div>
    </div>
  );
}
export function CardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {[...Array(count)].map((_, i) => (
        <div key={i} className="rounded-xl border p-4 space-y-3" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
          <div className="flex items-start justify-between">
            <div className="space-y-1.5 flex-1"><Bone className="h-4 w-44"/><Bone className="h-3 w-28"/></div>
            <Bone className="h-5 w-16 rounded-full"/>
          </div>
          <div className="flex gap-2"><Bone className="h-3 w-20"/><Bone className="h-3 w-16"/></div>
        </div>
      ))}
    </div>
  );
}
export function PageSkeleton() {
  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between"><Bone className="h-5 w-32"/><Bone className="h-8 w-20 rounded-lg"/></div>
      <KpiSkeleton/>
      <Bone className="h-9 w-full rounded-lg"/>
      <TableSkeleton/>
    </div>
  );
}
