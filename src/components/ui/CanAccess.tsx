"use client";

import { useAuth, type UserRole } from "@/contexts/AuthContext";
import type { ReactNode } from "react";

interface CanAccessProps {
  /** The component is rendered only if the current user has one of these roles. */
  roles: UserRole[];
  children: ReactNode;
  /** Optional fallback rendered when access is denied. Defaults to null. */
  fallback?: ReactNode;
}

/**
 * SCRUM-10 — Permission-aware wrapper component.
 *
 * Renders `children` only when the authenticated user's role is included in
 * the `roles` array. `super_admin` implicitly passes all role checks because
 * the caller must explicitly list which roles are allowed.
 *
 * Usage:
 *   <CanAccess roles={['super_admin']}>
 *     <CreateAdminButton />
 *   </CanAccess>
 *
 *   <CanAccess roles={['super_admin', 'admin']} fallback={<p>No access</p>}>
 *     <AdminPanel />
 *   </CanAccess>
 */
export function CanAccess({ roles, children, fallback = null }: CanAccessProps) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <>{fallback}</>;
  return <>{children}</>;
}
