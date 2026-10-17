'use client';

/**
 * Operations home for a non-Spaces vertical — PREVIEW data only (no backend for these verticals yet).
 * Gate 2 lock when the business is not authorised for the vertical.
 *
 * Spaces shows live counts from the PREVIEW booking engine (short stays, venues, courts,
 * charters) instead. Note: /v/spaces currently redirects to the lease board (page.tsx), so this
 * branch only renders if that redirect is lifted.
 */
import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import {
  Btn, Callout, Card, Kpi, Kpis, OsPage, PageHead, Pill, PreviewBanner, PreviewPill, ScopeStrip, fmtAedK,
} from '@/components/os/kit';
import { MODEL_INFO, MODELS_OF, usePreview } from '@/lib/os/preview';
import { RP_BASE } from '@/lib/os/scope';
import { BookingsPreview } from '@/components/os/bookings/DemoClock';
import { SpacesBookingSummary } from '@/components/os/bookings/SpacesBookingSummary';
import type { MsVertical } from '@/lib/catalog';
import { RpServicesHome } from '@/components/os/services/RpServicesHome';
import { Gate2Lock, amtValue, modelOffer, useGate2, useVerticalParam } from '../_parts';

export default function VerticalHome() {
  const vertical = useVerticalParam();
  if (vertical.id === 'spaces') return <SpacesHome />;
  return <OtherVerticalHome vertical={vertical} />;
}

function SpacesHome() {
  return (
    <OsPage>
      <PageHead
        eyebrow="Operations"
        title="Spaces bookings"
        lede="Short stays, venues, courts and yacht charters — live from the booking engine. Long-term leases stay on the lease board."
        actions={<>
          <Btn href={`${RP_BASE}/orders`}>Long-term leases</Btn>
          <Btn href={`${RP_BASE}/v/spaces/calendar`}>Calendar</Btn>
          <Btn variant="primary" href={`${RP_BASE}/requests`}>Booking requests</Btn>
        </>}
      />
      <BookingsPreview />
      <SpacesBookingSummary />
    </OsPage>
  );
}

function OtherVerticalHome({ vertical }: { vertical: MsVertical }) {
  const { locked } = useGate2(vertical.id);
  const { board } = usePreview();
  const models = MODELS_OF[vertical.id];
  const items = useMemo(() => board.filter((b) => models.includes(b.model)), [board, models]);

  const kpis = useMemo(() => {
    const isFirst = (b: (typeof items)[number]) => MODEL_INFO[b.model].cols[0] === b.col;
    const isLast = (b: (typeof items)[number]) => { const c = MODEL_INFO[b.model].cols; return c[c.length - 1] === b.col; };
    const open = items.filter((b) => !isLast(b));
    return {
      total: items.length,
      newReq: items.filter(isFirst).length,
      hot: items.filter((b) => b.tag === 'hot' || b.tag === 'warm').length,
      openValue: open.reduce((n, b) => n + amtValue(b.amt), 0),
      done: items.filter(isLast).length,
    };
  }, [items]);

  // Services has no preview boards (MODELS_OF.services is empty): show the landlord's
  // REAL service work (maintenance flow, vendors, AMC) — see RpServicesHome.
  if (vertical.id === 'services') return <RpServicesHome label={vertical.label} />;

  if (locked) {
    return (
      <OsPage>
        <PageHead eyebrow="Operations" title={vertical.label} />
        <Gate2Lock vertical={vertical} />
      </OsPage>
    );
  }

  return (
    <OsPage>
      <PageHead
        eyebrow="Operations"
        title={vertical.label}
        lede={`Every ${vertical.label.toLowerCase()} record, by operating model. Open a board to move records through their stages.`}
        actions={<>
          <Btn href={`${RP_BASE}/v/${vertical.id}/calendar`}>Calendar</Btn>
          <Btn variant="primary" href={`${RP_BASE}/v/${vertical.id}/listings/new`}>Create listing</Btn>
        </>}
      />
      <PreviewBanner />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Operations' },
        { label: 'Vertical', value: vertical.label },
        { label: 'Authorisation', value: <Pill tone="primary">Authorised</Pill> },
        { label: 'Data', value: <PreviewPill /> },
      ]} />
      <Kpis>
        <Kpi k="Open pipeline value" v={fmtAedK(kpis.openValue)} d="Records not yet in the final stage" dark />
        <Kpi k="Records" v={kpis.total} d={`${models.length} operating model${models.length === 1 ? '' : 's'}`} />
        <Kpi k="New requests" v={kpis.newReq} d="In the first stage" />
        <Kpi k="Hot & warm" v={kpis.hot} d="Need a fast response" />
        <Kpi k="Completed" v={kpis.done} d="In the final stage" />
      </Kpis>
      {models.length === 0 ? (
        <Callout tone="info" title="No operating boards.">This vertical has no preview operating model.</Callout>
      ) : (
        <div className="gx-cols gx-cols-2" style={{ marginBottom: 14 }}>
          {models.map((m) => {
            const info = MODEL_INFO[m];
            const mine = items.filter((b) => b.model === m);
            const offer = modelOffer(m);
            return (
              <Card key={m} title={info.name} sub={offer ? `${offer.label} · ${offer.basis ?? ''}` : undefined}
                right={<Btn size="sm" href={`${RP_BASE}/v/${vertical.id}/${m}`}>Open board <ArrowRight size={13} aria-hidden /></Btn>} pad>
                <div className="gx-chips">
                  {info.cols.map((c) => (
                    <Pill key={c} tone="outline" dot={false}>{c} · {mine.filter((b) => b.col === c).length}</Pill>
                  ))}
                </div>
                <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--ms-ink-3)' }}>
                  {mine.length} record{mine.length === 1 ? '' : 's'} · {fmtAedK(mine.reduce((n, b) => n + amtValue(b.amt), 0))} declared value
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </OsPage>
  );
}
