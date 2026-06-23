import { redirect } from 'next/navigation';

// Listings is split into two sub-pages (Rental Provider / Service Provider).
// The bare /listings route lands on the Rental Provider listings.
export default function AdminListingsIndexPage() {
  redirect('/dashboard/admin/listings/rental-providers');
}
