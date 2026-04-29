import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

interface EmptyStateProps {
  icon?: ReactNode;
  heading: string;
  subtext?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({
  icon,
  heading,
  subtext,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-[var(--color-base-200)] bg-[var(--color-base)] px-8 py-16 text-center",
        className
      )}
    >
      {icon && (
        <div className="text-[var(--color-neutral-400)] [&_svg]:size-10">
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <p className="text-base font-semibold text-[var(--color-neutral-900)]">
          {heading}
        </p>
        {subtext && (
          <p className="text-sm text-[var(--color-neutral-500)]">{subtext}</p>
        )}
      </div>
      {action && (
        <Button size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
