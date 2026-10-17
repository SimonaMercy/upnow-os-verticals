'use client';

/**
 * Emails — the landlord's own mailbox, conversations with customers and leads.
 *
 * Parity with previous page: renders <EmailInbox> unchanged with the same props
 * (rp={null}); adds OsPage + PageHead only.
 * Duplicate title: EmailInbox renders its own "Emails" h1 and has no prop to
 * hide it, so PageHead is kept minimal (eyebrow + title).
 */
import { EmailInbox } from '@/components/email/EmailInbox';
import { OsPage, PageHead } from '@/components/os/kit';

export default function CommunicationsPage() {
  return (
    <OsPage>
      <PageHead eyebrow="Demand" title="Emails" />
      <EmailInbox rp={null} />
    </OsPage>
  );
}
