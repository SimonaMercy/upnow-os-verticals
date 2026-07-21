import type { ReactNode } from 'react';
import { PageViewTracker } from '@/components/upnow/PageViewTracker';

/** Records technician-portal page views (page_views). */
export default function TechnicianDashboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageViewTracker portal="technician" />
      {children}
    </>
  );
}
