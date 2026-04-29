import { InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  variant?: "default" | "search";
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, variant = "default", id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-[var(--color-neutral-700)]"
          >
            {label}
          </label>
        )}

        <div className="relative">
          {variant === "search" && (
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-neutral-400)]"
              aria-hidden
            />
          )}
          <input
            id={inputId}
            ref={ref}
            className={cn(
              "w-full rounded-xl border border-[var(--color-base-200)] bg-white px-4 py-2.5 text-[var(--color-neutral-900)] placeholder:text-[var(--color-neutral-400)] transition-colors",
              "focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent",
              "disabled:cursor-not-allowed disabled:opacity-50",
              error && "border-[var(--color-error)] focus:ring-[var(--color-error)]",
              variant === "search" && "pl-9",
              className
            )}
            {...props}
          />
        </div>

        {error && (
          <p className="text-sm text-[var(--color-error)]" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";

export { Input };
