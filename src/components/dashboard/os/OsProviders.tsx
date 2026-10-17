'use client';

import type { ReactNode } from 'react';
import { PreviewProvider } from '@/lib/os/preview';
import { OsScopeProvider } from '@/lib/os/scope';

/** Preview store + vertical scope, mounted by DashboardShell for the OS roles only. */
export function OsProviders({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  if (!enabled) return <>{children}</>;
  return <PreviewProvider><OsScopeProvider>{children}</OsScopeProvider></PreviewProvider>;
}
