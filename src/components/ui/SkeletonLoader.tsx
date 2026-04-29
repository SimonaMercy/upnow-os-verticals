import { cn } from "@/lib/utils";

interface SkeletonProps {
  variant?: "rect" | "card" | "row";
  className?: string;
  rows?: number;
}

function SkeletonRect({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-xl bg-[var(--color-base-200)]",
        className
      )}
    />
  );
}

export function SkeletonLoader({ variant = "rect", className, rows = 3 }: SkeletonProps) {
  if (variant === "card") {
    return (
      <div
        className={cn(
          "rounded-2xl border border-[var(--color-base-200)] bg-white p-5 space-y-3",
          className
        )}
      >
        <SkeletonRect className="h-40 w-full" />
        <SkeletonRect className="h-4 w-3/4" />
        <SkeletonRect className="h-4 w-1/2" />
      </div>
    );
  }

  if (variant === "row") {
    return (
      <div className={cn("space-y-3", className)}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <SkeletonRect className="h-10 w-10 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <SkeletonRect className="h-3 w-1/2" />
              <SkeletonRect className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return <SkeletonRect className={cn("h-6 w-full", className)} />;
}
