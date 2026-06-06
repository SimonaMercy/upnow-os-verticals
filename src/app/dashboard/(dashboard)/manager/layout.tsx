'use client';

import { ManagerPermissionsProvider } from '@/contexts/ManagerPermissionsContext';
import type { ReactNode } from 'react';

export default function ManagerLayout({ children }: { children: ReactNode }) {
  return (
    <ManagerPermissionsProvider>
      {children}
    </ManagerPermissionsProvider>
  );
}
