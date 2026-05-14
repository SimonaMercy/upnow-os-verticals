"use client";

import { ReactNode } from "react";
import Link from "next/link";

/**
 * Shared chrome for auth pages.
 * Matches the UpNow Marketplace design tokens:
 * - cream background (--base-100)
 * - white card, radius 20, shadow-lg, padding 40
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: "var(--base-100)" }}
    >
      <header className="container flex items-center justify-between py-5">
        <Link
          href="/"
          className="font-bold text-2xl"
          style={{ color: "var(--primary)" }}
        >
          UpNow
        </Link>
        <Link
          href="/"
          className="text-sm font-medium"
          style={{ color: "var(--neutral-700)" }}
        >
          ← Back to home
        </Link>
      </header>

      <div className="flex-grow flex items-center justify-center px-4 pb-12">
        <div
          className="w-full"
          style={{
            maxWidth: 480,
            backgroundColor: "#ffffff",
            boxShadow: "var(--shadow-lg)",
            borderRadius: 20,
            padding: 40,
          }}
        >
          <h1
            className="font-bold"
            style={{ fontSize: 28, color: "var(--neutral-900)", letterSpacing: "-0.01em" }}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              className="mt-2"
              style={{ fontSize: 15, color: "var(--neutral-500)", lineHeight: 1.5 }}
            >
              {subtitle}
            </p>
          )}

          <div className="mt-6">{children}</div>

          {footer && <div className="mt-6">{footer}</div>}
        </div>
      </div>
    </main>
  );
}

/* ---------------------- Form primitives ---------------------- */

export const inputClass =
  "w-full rounded-xl px-4 py-3 text-[15px] outline-none transition-all duration-200 " +
  "border-[1.5px] border-[var(--base-200)] text-[var(--neutral-900)] placeholder:text-[var(--neutral-400)] " +
  "focus:border-[var(--primary)] focus:ring-[3px] focus:ring-[var(--primary-light)]";

export const labelClass =
  "block text-sm font-medium mb-1.5 text-[var(--neutral-700)]";

export function FormField({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
      {error ? (
        <span className="block text-xs mt-1" style={{ color: "var(--error)" }}>
          {error}
        </span>
      ) : (
        hint && (
          <span className="block text-xs mt-1" style={{ color: "var(--neutral-500)" }}>
            {hint}
          </span>
        )
      )}
    </label>
  );
}

export function Alert({
  kind,
  children,
}: {
  kind: "error" | "success";
  children: ReactNode;
}) {
  const styles =
    kind === "error"
      ? { bg: "#ffe0e0", border: "var(--error)", color: "var(--error)" }
      : { bg: "#d1fae5", border: "#065f46", color: "#065f46" };
  return (
    <div
      className="text-sm font-medium"
      style={{
        padding: "12px 16px",
        backgroundColor: styles.bg,
        border: `1px solid ${styles.border}`,
        borderRadius: 10,
        color: styles.color,
      }}
    >
      {children}
    </div>
  );
}

export function PrimaryButton({
  children,
  loading,
  disabled,
  type = "submit",
  onClick,
}: {
  children: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  type?: "submit" | "button";
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className="w-full rounded-full font-medium text-white text-base py-3 transition-colors disabled:opacity-50 disabled:pointer-events-none"
      style={{ backgroundColor: "var(--primary)" }}
      onMouseEnter={(e) => {
        if (!disabled && !loading)
          (e.currentTarget as HTMLButtonElement).style.backgroundColor =
            "var(--primary-dark)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--primary)";
      }}
    >
      {loading ? "Please wait…" : children}
    </button>
  );
}
