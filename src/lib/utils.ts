/**
 * cn() — merge Tailwind utility classes safely.
 * Uses clsx for conditional logic + tailwind-merge to resolve conflicting
 * classes (e.g. `text-red-500 text-blue-500` → `text-blue-500`).
 */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
