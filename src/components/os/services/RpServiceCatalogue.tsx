'use client';

/**
 * Catalogue › Service catalogue for a landlord (rental provider → Services vertical).
 * A read-only view of the public UpNow home-services catalogue (GET /api/catalog/public —
 * the same source the customer /services page reads): what can be booked, how it is priced
 * (fixed or inspect-then-quote) and the starting price. Landlords do not edit it: the
 * catalogue is run by UpNow, and service providers list against it from their own account.
 */
import { useEffect, useMemo, useState } from 'react';
import { Btn, Callout, Card, EmptyRow, ErrorRow, OsPage, PageHead, Pill, ScopeStrip, SearchField, Seg, SkeletonRows, TableWrap } from '@/components/os/kit';
import { isQuoteMode } from '@/lib/homeServices/statusView';
import { RP_BASE } from '@/lib/os/scope';

interface PubService {
  id: number; code: string; name: string; description: string | null;
  priceUnit: string; pricingMode: string; basePrice: number | null; isFromPrice: boolean;
  minCalloutCharge: number | null; isEmergency: boolean;
  estimatedDuration: number | null; estimatedDurationMax: number | null;
}
interface PubCategory { id: number; code: string; name: string; services: PubService[] }

const fmt = (n: number) => n.toLocaleString('en-AE');
function priceOf(s: PubService): string {
  if (isQuoteMode(s.pricingMode) || s.basePrice == null) {
    return s.minCalloutCharge ? `Quote · callout AED ${fmt(Number(s.minCalloutCharge))}` : 'Quote after inspection';
  }
  return `${s.isFromPrice ? 'From ' : ''}AED ${fmt(Number(s.basePrice))}${s.priceUnit === 'per_hour' ? ' / hour' : ''}`;
}
function durOf(s: PubService): string {
  const m = s.estimatedDuration;
  if (!m) return '—';
  const f = (x: number) => (x >= 60 ? `${Math.round((x / 60) * 10) / 10} h` : `${x} min`);
  return s.estimatedDurationMax && s.estimatedDurationMax !== m ? `${f(m)}–${f(s.estimatedDurationMax)}` : f(m);
}

export function RpServiceCatalogue() {
  const [cats, setCats] = useState<PubCategory[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let on = true;
    fetch('/api/catalog/public')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: unknown) => {
        if (!on) return;
        const list = Array.isArray(d) ? d : Array.isArray((d as { categories?: unknown })?.categories) ? (d as { categories: unknown[] }).categories : [];
        setCats(list as PubCategory[]);
        setFailed(false);
      })
      .catch(() => { if (on) { setCats([]); setFailed(true); } });
    return () => { on = false; };
  }, [nonce]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (cats ?? [])
      .filter((c) => cat === 'all' || c.code === cat)
      .flatMap((c) => (c.services ?? []).map((s) => ({ c, s })))
      .filter(({ c, s }) => !needle || [s.name, c.name, s.description].some((v) => (v ?? '').toLowerCase().includes(needle)));
  }, [cats, cat, q]);
  const total = (cats ?? []).reduce((n, c) => n + (c.services?.length ?? 0), 0);
  const quoteN = (cats ?? []).reduce((n, c) => n + (c.services ?? []).filter((s) => isQuoteMode(s.pricingMode) || s.basePrice == null).length, 0);

  return (
    <OsPage>
      <PageHead
        eyebrow="Catalogue"
        title="Service catalogue"
        lede="The UpNow home-services catalogue — what customers can book and how each service is priced. Read-only: UpNow runs the catalogue, and service providers list against it from their own account."
        actions={<Btn href={`${RP_BASE}/v/services`}>Services overview</Btn>}
      />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Catalogue' },
        { label: 'Vertical', value: 'Services' },
        { label: 'Services', value: cats ? total : '…' },
        { label: 'Quote-priced', value: cats ? quoteN : '…' },
        { label: 'Access', value: <Pill tone="outline" dot={false}>Read-only</Pill> },
      ]} />
      {cats && cats.length > 0 && (
        <div style={{ marginBottom: 12, overflowX: 'auto' }}>
          <Seg label="Category" value={cat} onChange={setCat}
            options={[{ v: 'all', l: 'All', n: total }, ...cats.map((c) => ({ v: c.code, l: c.name, n: c.services?.length ?? 0 }))]} />
        </div>
      )}
      <Card>
        <TableWrap toolbar={<SearchField value={q} onChange={setQ} placeholder="Search services" />}>
          <table className="gx-tbl">
            <thead><tr><th>Service</th><th>Category</th><th>Pricing</th><th>Price</th><th>Duration</th></tr></thead>
            {cats == null ? <SkeletonRows rows={6} cols={5} />
                : failed ? <ErrorRow cols={5} onRetry={() => { setCats(null); setNonce((x) => x + 1); }} />
                : rows.length === 0 ? <EmptyRow cols={5} title={total ? 'No services match' : 'The catalogue is empty'} text={total ? 'Try another search or category.' : 'UpNow has not published home services yet.'} />
                : <tbody>{rows.map(({ c, s }) => (
                  <tr key={s.id}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{s.name}{s.isEmergency && <> <Pill tone="danger" dot={false}>Emergency</Pill></>}</div>
                      {s.description && <div style={{ fontSize: 11.5, color: 'var(--ms-ink-3)', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.description}</div>}
                    </td>
                    <td>{c.name}</td>
                    <td>{isQuoteMode(s.pricingMode) || s.basePrice == null ? <Pill tone="amber" dot={false}>Inspect, then quote</Pill> : <Pill tone="primary" dot={false}>Fixed price</Pill>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{priceOf(s)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{durOf(s)}</td>
                  </tr>
                ))}</tbody>}
          </table>
        </TableWrap>
      </Card>
      <div style={{ height: 14 }} />
      <Callout tone="info" title="Need one of these on your buildings?">
        Raise a maintenance request and route it to a vendor or your own team — that is the Services overview flow. Selling these services to customers is a separate UpNow service-provider account.
      </Callout>
    </OsPage>
  );
}
