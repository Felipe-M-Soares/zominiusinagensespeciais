/**
 * PageSkeleton — estado de carregamento padronizado para todas as páginas.
 * Substitui tela em branco durante fetch inicial.
 */
import { cn } from "@/lib/utils";

function Bone({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-lg bg-muted/60", className)} />
  );
}

export function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="rounded-2xl border border-border/40 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Bone className="h-9 w-9 rounded-xl shrink-0" />
            <Bone className="h-3 w-24" />
          </div>
          <Bone className="h-7 w-16" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-2xl border border-border/40 overflow-hidden">
      <div className="bg-muted/30 px-4 py-3 flex gap-4">
        <Bone className="h-3 w-32" />
        <Bone className="h-3 w-20 ml-auto" />
      </div>
      <div className="divide-y divide-border/40">
        {[...Array(rows)].map((_, i) => (
          <div key={i} className="px-4 py-3 flex items-center gap-3">
            <Bone className="h-8 w-8 rounded-xl shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Bone className="h-3 w-40" />
              <Bone className="h-2.5 w-24" />
            </div>
            <Bone className="h-6 w-16 rounded-full" />
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
        <div key={i} className="rounded-2xl border border-border/40 p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div className="space-y-1.5 flex-1">
              <Bone className="h-4 w-48" />
              <Bone className="h-3 w-32" />
            </div>
            <Bone className="h-6 w-20 rounded-full" />
          </div>
          <div className="flex gap-2">
            <Bone className="h-3 w-24" />
            <Bone className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton completo de página com KPIs + tabela */
export function PageSkeleton() {
  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <Bone className="h-5 w-36" />
        <Bone className="h-8 w-24 rounded-xl" />
      </div>
      <KpiSkeleton />
      <Bone className="h-9 w-full rounded-xl" />
      <TableSkeleton />
    </div>
  );
}
