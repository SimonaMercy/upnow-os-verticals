/**
 * Layout for all Rental Provider dashboard routes (/rental-provider/dashboard/*).
 * Uses the same DashboardShell as the main dashboard — sidebar nav adapts to
 * the user's role, so RP users see RP-specific nav items.
 */
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { ReactNode } from 'react';

export default function RentalProviderDashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
