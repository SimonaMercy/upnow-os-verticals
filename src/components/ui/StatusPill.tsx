import { cn } from "@/lib/utils";

type Status =
  | "pending"
  | "confirmed"
  | "in-progress"
  | "completed"
  | "cancelled"
  | "refunded"
  | "on-hold"
  | "reviewing"
  | "approved"
  | "rejected"
  | "scheduled"
  | "rescheduled"
  | "awaiting-payment"
  | "paid"
  | "overdue"
  | "archived"
  | "draft"
  | "published"
  | "suspended"
  | "active"
  | "inactive"
  | "expired"
  | "dispute"
  | "resolved"
  | string;

const STATUS_STYLES: Record<string, string> = {
  pending:          "bg-amber-100 text-amber-800",
  confirmed:        "bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]",
  "in-progress":    "bg-blue-100 text-blue-800",
  completed:        "bg-emerald-100 text-emerald-800",
  cancelled:        "bg-red-100 text-red-700",
  refunded:         "bg-purple-100 text-purple-800",
  "on-hold":        "bg-orange-100 text-orange-800",
  reviewing:        "bg-sky-100 text-sky-800",
  approved:         "bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]",
  rejected:         "bg-red-100 text-red-700",
  scheduled:        "bg-indigo-100 text-indigo-800",
  rescheduled:      "bg-violet-100 text-violet-800",
  "awaiting-payment": "bg-yellow-100 text-yellow-800",
  paid:             "bg-emerald-100 text-emerald-800",
  overdue:          "bg-rose-100 text-rose-800",
  archived:         "bg-[var(--color-base-100)] text-[var(--color-neutral-500)]",
  draft:            "bg-[var(--color-base-200)] text-[var(--color-neutral-700)]",
  published:        "bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]",
  suspended:        "bg-red-100 text-red-700",
  active:           "bg-emerald-100 text-emerald-800",
  inactive:         "bg-[var(--color-base-100)] text-[var(--color-neutral-500)]",
  expired:          "bg-rose-100 text-rose-700",
  dispute:          "bg-orange-100 text-orange-800",
  resolved:         "bg-emerald-100 text-emerald-800",
};

const LABELS: Record<string, string> = {
  "in-progress":      "In Progress",
  "on-hold":          "On Hold",
  "awaiting-payment": "Awaiting Payment",
};

interface StatusPillProps {
  status: Status;
  className?: string;
}

export function StatusPill({ status, className }: StatusPillProps) {
  const styles = STATUS_STYLES[status] ?? "bg-[var(--color-base-100)] text-[var(--color-neutral-700)]";
  const label = LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-[500] leading-none",
        styles,
        className
      )}
    >
      {label}
    </span>
  );
}
