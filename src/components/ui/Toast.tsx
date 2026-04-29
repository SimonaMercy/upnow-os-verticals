"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

type ToastVariant = "success" | "error" | "warning" | "info";

interface ToastProps {
  id: string;
  message: string;
  variant?: ToastVariant;
  onDismiss: (id: string) => void;
}

const STYLES: Record<ToastVariant, string> = {
  success: "border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]",
  error:   "border-[var(--color-error)] bg-red-50 text-red-800",
  warning: "border-[var(--color-warning)] bg-amber-50 text-amber-800",
  info:    "border-blue-400 bg-blue-50 text-blue-800",
};

function Toast({ id, message, variant = "info", onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), 4000);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);

  return (
    <div
      role="alert"
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-md min-w-[280px] max-w-sm",
        STYLES[variant]
      )}
    >
      <span>{message}</span>
      <button
        onClick={() => onDismiss(id)}
        className="shrink-0 opacity-70 hover:opacity-100"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ── Toast provider / hook ────────────────────────────────────────────────────
import { createContext, useContext, useCallback, ReactNode } from "react";

let _counter = 0;

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = String(++_counter);
    setToasts((prev) => [...prev, { id, message, variant }]);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Portal-like fixed container */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <Toast key={t.id} {...t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
