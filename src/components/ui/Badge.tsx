import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { HTMLAttributes } from "react";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-3 py-1 text-xs font-[500] leading-none",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--color-base-100)] text-[var(--color-neutral-700)]",
        success:
          "bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]",
        warning:
          "bg-amber-100 text-amber-800",
        error:
          "bg-red-100 text-red-700",
        gold:
          "bg-[var(--color-gold-light)] text-amber-900",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
