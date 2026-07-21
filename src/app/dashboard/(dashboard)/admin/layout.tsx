import type { ReactNode } from 'react';
import { PageViewTracker } from '@/components/upnow/PageViewTracker';

/** Records admin-portal page views (page_views). */
export default function AdminDashboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageViewTracker portal="admin" />
      {children}
    </>
  );
}
