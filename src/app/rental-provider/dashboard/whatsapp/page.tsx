'use client';

/**
 * WhatsApp — every conversation on the landlord's linked numbers, read and answered from here.
 *
 * Parity with previous page: renders <WhatsAppInbox> unchanged with the same
 * props (rp={null}); adds OsPage + PageHead only.
 * Duplicate title: WhatsAppInbox renders its own "WhatsApp" h1 and has no prop
 * to hide it, so PageHead is kept minimal (eyebrow + title).
 */
import { WhatsAppInbox } from '@/components/whatsapp/WhatsAppInbox';
import { OsPage, PageHead } from '@/components/os/kit';

export default function WhatsAppPage() {
  return (
    <OsPage>
      <PageHead eyebrow="Demand" title="WhatsApp" />
      <WhatsAppInbox rp={null} />
    </OsPage>
  );
}
