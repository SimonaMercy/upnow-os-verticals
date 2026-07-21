import type { ReactNode } from 'react';
import { PageViewTracker } from '@/components/upnow/PageViewTracker';

/** Records customer-portal page views (page_views). */
export default function CustomerDashboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageViewTracker portal="customer" />
      {children}
    </>
  );
}
