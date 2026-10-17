/**
 * RP Contracts list — every contract under this RP (Genspark OS layout).
 *
 * Route: /rental-provider/dashboard/contracts
 *
 * The detail page's back arrow lands here. Also the destination of the dashboard's
 * "All contracts" link and the prototype `/prototype/os/rp/contracts` re-export.
 *
 * Parity with previous page:
 *  - [x] GET /api/contracts — company customers relabelled by company name (tenantDisplayName).
 *  - [x] Search over ref, customer, email, unit name/number, building, status, contract type.
 *  - [x] "N contracts" count, loading / error / empty states (same copy).
 *  - [x] Columns: Contract (ref link + RENEWAL chip), Customer (+ email), Unit (+ building),
 *        Period, Annual rent (AED, as the API returns it), Status (+ "↻ Renewal <status>" chip).
 *  - [x] Ref link → /rental-provider/dashboard/contracts/:id/v2 (row click + labelled "Open" too).
 *  - [x] "Back to dashboard" link (now a labelled button in the page head).
 *  - No "New contract" here, as before — this is a read surface; the Leases page carries it.
 */
'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { tenantDisplayName } from '@/lib/tenantName';
import {
  OsPage, PageHead, Pill, Btn, TableWrap, SearchField, SkeletonRows, EmptyRow, Callout, fmtAed, type Tone,
} from '@/components/os/kit';

interface RpContract {
  id: number;
  ref: string;
  contractType: string;
  startDate: string | null;
  endDate: string | null;
  annualRent: number;
  status: string;
  ejariStatus: string | null;
  contractActive: boolean;
  renewalStatus: string | null;
  createdAt: string;
  // `name` arrives as the person; a company customer is relabelled by its company on load.
  tenant: { id: number | null; name: string | null; email: string | null; entityType?: string | null; companyName?: string | null };
  unit: { id: number | null; number: string | null; name: string | null };
  property?: { id?: number | null; buildingName?: string | null };
}

const STATUS_PILL: Record<string, { tone: Tone; label: string }> = {
  active:     { tone: 'primary', label: 'Active' },
  issued:     { tone: 'amber',   label: 'Issued' },
  pending:    { tone: 'neutral', label: 'Pending' },
  terminated: { tone: 'danger',  label: 'Terminated' },
  expired:    { tone: 'neutral', label: 'Expired' },
};

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ContractsListPage() {
  const router = useRouter();
  const [contracts, setContracts] = useState<RpContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    fetch('/api/contracts', { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(`Error ${r.status}`))
      // A company customer reads as the company (never its signatory) in the list and its search.
      .then((data: RpContract[]) => setContracts(Array.isArray(data)
        ? data.map(c => ({ ...c, tenant: { ...c.tenant, name: tenantDisplayName(c.tenant) } }))
        : []))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return contracts;
    return contracts.filter(c => {
      const blob = [
        c.ref, c.tenant.name, c.tenant.email,
        c.unit.name, c.unit.number,
        c.property?.buildingName, c.status, c.contractType,
      ].filter(Boolean).join(' ').toLowerCase();
      return blob.includes(needle);
    });
  }, [contracts, q]);

  return (
    <OsPage>
      <PageHead
        eyebrow="Operations › Long-term leases"
        title="All contracts"
        lede={loading ? 'Every contract under your account — every status, every renewal cycle.' : `${filtered.length} contract${filtered.length === 1 ? '' : 's'} — every status, every renewal cycle.`}
        actions={<Btn href="/rental-provider/dashboard">Back to dashboard</Btn>}
      />

      {error && <Callout tone="bad" title="Couldn't load contracts.">{error}</Callout>}

      <TableWrap toolbar={<SearchField value={q} onChange={setQ} placeholder="Search by reference, customer, unit, building…" />}>
        <table className="gx-tbl">
          <thead>
            <tr>
              <th>Contract</th><th>Customer</th><th>Unit</th><th>Period</th>
              <th className="num">Annual rent</th><th>Status</th><th className="act">Actions</th>
            </tr>
          </thead>
          {loading ? <SkeletonRows rows={6} cols={7} /> : filtered.length === 0 ? (
            <EmptyRow cols={7} title="No contracts found" text={q ? ' Try a different search term.' : ' Create your first contract to get started.'} />
          ) : (
            <tbody>
              {filtered.map(c => {
                const status = STATUS_PILL[c.status] ?? { tone: 'neutral' as Tone, label: c.status };
                const href = `/rental-provider/dashboard/contracts/${c.id}/v2`;
                return (
                  <tr key={c.id} className="click" onClick={() => router.push(href)}>
                    <td>
                      <Link href={href} className="strong" onClick={e => e.stopPropagation()}>{c.ref}</Link>
                      {c.contractType === 'renewal' && <> <Pill tone="amber" dot={false}>Renewal</Pill></>}
                    </td>
                    <td>
                      <span className="strong">{c.tenant.name ?? '—'}</span>
                      {c.tenant.email && <span className="sub">{c.tenant.email}</span>}
                    </td>
                    <td>
                      {c.unit.number ? `Unit ${c.unit.number}` : (c.unit.name ?? '—')}
                      {c.property?.buildingName && <span className="sub">{c.property.buildingName}</span>}
                    </td>
                    <td className="nowrap">{fmtDate(c.startDate)}<span className="sub">→ {fmtDate(c.endDate)}</span></td>
                    <td className="num strong">{fmtAed(c.annualRent)}</td>
                    <td>
                      <Pill tone={status.tone}>{status.label}</Pill>
                      {c.renewalStatus && <span className="sub"><Pill tone="amber" dot={false}>↻ Renewal {c.renewalStatus}</Pill></span>}
                    </td>
                    <td className="act" onClick={e => e.stopPropagation()}>
                      <Btn size="xs" variant="primary" href={href}>Open</Btn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          )}
        </table>
      </TableWrap>
    </OsPage>
  );
}
