/**
 * Customer maintenance tracking lives on My Services → Maintenance (owner,
 * 31 Aug). This route stays so older notification deep-links and bookmarks
 * land in the right place.
 */
import { redirect } from 'next/navigation';

export default function CustomerMaintenanceRedirect() {
  redirect('/dashboard/customer/services?tab=maintenance');
}
