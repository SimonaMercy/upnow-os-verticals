'use client';

/**
 * Catalogue › Listings for a non-Spaces vertical — PREVIEW (no listings backend for these verticals).
 * New page — no previous page to keep parity with. No records exist, so this explains Gate 3 and
 * offers the listing wizard. Spaces listings live at /rental-provider/dashboard/units; for Spaces
 * this page hosts the "Booking & payment" settings of the PREVIEW booking listings (short stays,
 * venues, courts, yachts — payment model per listing, instant booking) and does NOT show the
 * empty "No listings yet" table: those booking listings are listed right above it, and long-term
 * Spaces listings live under Units & listings.
 */
import Link from 'next/link';
import { Plus } from 'lucide-react';
import {
  Btn, Callout, OsPage, PageHead, Pill, PreviewBanner, PreviewPill, ScopeStrip, TableWrap,
} from '@/components/os/kit';
import { RP_BASE } from '@/lib/os/scope';
import { ListingPaymentSettings } from '@/components/os/bookings/ListingPaymentSettings';
import { Gate2Lock, useGate2, useVerticalParam } from '../../_parts';

export default function VerticalListingsPage() {
  const vertical = useVerticalParam();
  const { locked } = useGate2(vertical.id);
  const newHref = `${RP_BASE}/v/${vertical.id}/listings/new`;

  if (locked) {
    return (
      <OsPage>
        <PageHead eyebrow="Catalogue" title={`${vertical.label} listings`} />
        <Gate2Lock vertical={vertical} />
      </OsPage>
    );
  }

  if (vertical.id === 'spaces') {
    return (
      <OsPage>
        <PageHead
          eyebrow="Catalogue"
          title="Spaces booking listings"
          lede="Holiday homes, venues, courts and yachts customers book by the night, hour or slot — choose per listing how customers pay and whether they can book instantly."
          actions={<Btn href={`${RP_BASE}/units`}>Units &amp; listings</Btn>}
        />
        <PreviewBanner />
        <ScopeStrip items={[
          { label: 'Workspace', value: 'Catalogue' },
          { label: 'Vertical', value: vertical.label },
          { label: 'Authorisation', value: <Pill tone="primary">Authorised</Pill> },
          { label: 'Data', value: <PreviewPill /> },
        ]} />
        <div style={{ marginBottom: 14 }}>
          <Callout tone="info" title="Long-term Spaces listings are real.">Rentals (apartments, offices, warehouses…) are managed in <Link href={`${RP_BASE}/units`}>Catalogue › Units &amp; listings</Link>. The booking listings below run on preview data.</Callout>
        </div>
        <ListingPaymentSettings />
      </OsPage>
    );
  }

  return (
    <OsPage>
      <PageHead
        eyebrow="Catalogue"
        title={`${vertical.label} listings`}
        lede={`Every ${vertical.label.toLowerCase()} listing you publish, and where each one is in review.`}
        actions={<Btn variant="primary" href={newHref}><Plus size={14} aria-hidden /> Create listing</Btn>}
      />
      <PreviewBanner />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Catalogue' },
        { label: 'Vertical', value: vertical.label },
        { label: 'Authorisation', value: <Pill tone="primary">Authorised</Pill> },
        { label: 'Data', value: <PreviewPill /> },
      ]} />
      <div style={{ marginBottom: 14 }}>
        <Callout tone="info" title="Gate 3 · Listing approval.">
          Listing approval is separate from business verification (Gate 1) and vertical authorisation (Gate 2). Being authorised for {vertical.label} lets you
          create listings; each listing is still reviewed on its own before customers can see it, and can be approved, sent back for changes or rejected.
        </Callout>
      </div>
      <TableWrap>
        <table className="gx-tbl">
          <thead><tr><th>Listing</th><th>Subcategory</th><th>Price</th><th>Review</th><th className="act">Action</th></tr></thead>
          {/* EmptyRow has no action slot, so this uses the same gx-empty markup with a button. */}
          <tbody>
            <tr><td colSpan={5}>
              <div className="gx-empty">
                <b>No listings yet</b>
                Create your first {vertical.label.toLowerCase()} listing — it goes to review once you submit it.
                <div style={{ marginTop: 10 }}><Btn variant="primary" href={newHref}>Create listing</Btn></div>
              </div>
            </td></tr>
          </tbody>
        </table>
      </TableWrap>
    </OsPage>
  );
}
