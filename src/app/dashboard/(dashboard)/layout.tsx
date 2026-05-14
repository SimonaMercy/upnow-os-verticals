/**
 * Shared layout for all customer/admin/SP/technician/manager dashboard routes.
 * Wraps children in DashboardShell which provides the sidebar nav and topbar.
 * Auth guard is inside DashboardShell — unauthenticated users are redirected to /login.
 */
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { ReactNode } from 'react';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
