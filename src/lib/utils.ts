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

/** Returns a human-readable display name for a user.
 *  Prefers firstName + lastName; falls back to user.name only when it is not
 *  a phone number (phone-registered accounts store the phone in user.name). */
export function buildDisplayName(
  user: { firstName?: string | null; lastName?: string | null; name?: string | null; email?: string | null } | null | undefined,
  fallback = 'You',
): string {
  if (!user) return fallback;
  const first = (user.firstName ?? '').trim();
  const last  = (user.lastName  ?? '').trim();
  if (first || last) return [first, last].filter(Boolean).join(' ');
  const name = (user.name ?? '').trim();
  if (name && !/^\+?\d[\d\s\-().]{5,}$/.test(name)) return name;
  return user.email ?? fallback;
}
