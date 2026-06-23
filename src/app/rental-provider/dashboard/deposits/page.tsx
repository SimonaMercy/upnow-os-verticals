import { redirect } from 'next/navigation';

/** The Security Deposits page became the portfolio-wide Payments ledger (SCRUM-577).
 *  Kept as a redirect so old bookmarks/links to /deposits still resolve. */
export default function DepositsRedirect() {
  redirect('/rental-provider/dashboard/payments');
}
