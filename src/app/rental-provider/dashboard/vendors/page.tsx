'use client';

/**
 * Business › Vendors — Genspark OS rebuild of the landlord's vendor list.
 *
 * Parity with previous page (which rendered the shared VendorsListView — left UNCHANGED for the
 * manager mirror /dashboard/manager/vendors):
 *  - GET /api/maintenance/vendors and GET /api/maintenance/categories (top-level groups for the form).
 *  - One flat list: search (name, category, email, phone, contact, trades) + one filter per vendor
 *    type with counts (All, Service, Utility, Government, Insurance, Supplier, Head landlord, Internal).
 *  - Per vendor: type, Own team, invite status (service vendors only), Default, category, payment
 *    frequency, trades / "record" note, technicians + open jobs once accepted.
 *  - Row → /rental-provider/dashboard/vendors/:spId (now a labelled "Open" button + row click).
 *  - "Add vendor" → VendorForm (REUSED unchanged, mode="add", base="/maintenance") → reload on done.
 *  - Sorted by name; loading / error (now with retry) / empty / no-match states.
 *  - /prototype/os/rp/vendors re-exports this page.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { KIND_META, type VendorKind, type VendorRow } from '@/components/vendors/VendorsListView';
import { PAY_FREQ_LABEL, VendorForm } from '@/components/vendors/VendorForm';
import {
  Btn, EmptyRow, ErrorRow, Kpi, Kpis, OsPage, PageHead, Pill, SearchField, Seg, SkeletonRows, TableWrap, Thumb, type Tone,
} from '@/components/os/kit';

interface Cat { id: number; name: string; parentId: number | null }

const KIND_TONE: Record<VendorKind, Tone> = {
  service: 'primary', utility: 'info', government: 'dark', insurance: 'amber', supplier: 'neutral', landlord: 'outline', internal: 'info',
};
const INVITE: Record<VendorRow['inviteStatus'], { l: string; tone: Tone }> = {
  accepted: { l: 'Accepted', tone: 'primary' }, invited: { l: 'Invited', tone: 'amber' }, not_invited: { l: 'Not invited', tone: 'neutral' },
};
const ALL_KINDS = Object.keys(KIND_META) as VendorKind[];
const detailHref = (spId: number) => `/rental-provider/dashboard/vendors/${spId}`;

export default function VendorsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<VendorRow[] | null>(null);
  const [groups, setGroups] = useState<Cat[]>([]);
  const [err, setErr] = useState(false);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<VendorKind | 'all'>('all');
  const [q, setQ] = useState('');

  const load = useCallback(() => {
    setErr(false);
    Promise.all([apiGet<VendorRow[]>('/maintenance/vendors'), apiGet<Cat[]>('/maintenance/categories')])
      .then(([v, c]) => {
        setRows(Array.isArray(v) ? v : []);
        setGroups((Array.isArray(c) ? c : []).filter((x) => x.parentId == null));
      })
      .catch(() => setErr(true));
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
  useEffect(() => { load(); }, [load]);

  const kindOf = (r: VendorRow) => (r.kind ?? 'service') as VendorKind;
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => (rows ?? [])
    .filter((r) => kind === 'all' || kindOf(r) === kind)
    .filter((r) => !needle || [r.name, r.category, r.email, r.phone, r.contactName, ...r.trades.map((t) => t.name)].some((x) => (x ?? '').toLowerCase().includes(needle)))
    .sort((a, b) => a.name.localeCompare(b.name)), [rows, kind, needle]);

  const all = rows ?? [];
  const service = all.filter((r) => kindOf(r) === 'service');
  const accepted = service.filter((r) => r.inviteStatus === 'accepted');
  const invited = service.filter((r) => r.inviteStatus === 'invited').length;
  const openJobs = accepted.reduce((s, r) => s + (r.openJobs || 0), 0);

  return (
    <>
      <OsPage>
        <PageHead
          eyebrow="Business"
          title="Vendors"
          lede="Everyone your buildings depend on — service vendors you invite and assign work to, and the utilities, authorities, insurers and suppliers you only keep records for."
          actions={<Btn size="sm" variant="primary" onClick={() => setAdding(true)}>Add vendor</Btn>}
        />
        <Kpis>
          <Kpi k="Vendors" v={rows ? all.length : '—'} d="all types" dark />
          <Kpi k="Service vendors on platform" v={rows ? accepted.length : '—'} d={`of ${service.length} service vendors`} />
          <Kpi k="Invites pending" v={rows ? invited : '—'} d="invited, not yet accepted" />
          <Kpi k="Open jobs" v={rows ? openJobs : '—'} d="with accepted vendors" />
        </Kpis>
        <TableWrap toolbar={<>
          <SearchField value={q} onChange={setQ} placeholder="Search vendors — name, what they're for, contact…" />
          <Seg label="Vendor type" value={kind} onChange={setKind} options={[
            { v: 'all' as const, l: 'All', n: all.length },
            ...ALL_KINDS.map((k) => ({ v: k, l: KIND_META[k].label, n: all.filter((r) => kindOf(r) === k).length })),
          ]} />
        </>}>
          <table className="gx-tbl">
            <thead><tr><th>Vendor</th><th>Type</th><th>For</th><th>Status</th><th className="num">Technicians</th><th className="num">Open jobs</th><th className="act">Action</th></tr></thead>
            {err ? <ErrorRow cols={7} onRetry={load} />
              : !rows ? <SkeletonRows rows={6} cols={7} />
              : shown.length === 0 ? (
                <EmptyRow cols={7}
                  title={rows.length === 0 ? 'No vendors yet' : needle ? `Nothing matches "${q.trim()}"` : `No ${KIND_META[kind as VendorKind]?.label.toLowerCase() ?? ''} vendors yet`}
                  text={rows.length === 0 ? 'Add your first with "Add vendor".' : undefined} />
              ) : (
                <tbody>
                  {shown.map((v) => {
                    const k = kindOf(v);
                    const participating = k === 'service';
                    const live = participating && v.inviteStatus === 'accepted';
                    const freq = v.paymentFrequency && PAY_FREQ_LABEL[v.paymentFrequency];
                    return (
                      <tr key={v.serviceProviderId} className="click" onClick={() => router.push(detailHref(v.serviceProviderId))}>
                        <td className="strong">
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <Thumb text={v.name} />
                            <span>{v.name}<div className="sub">{[v.contactName, v.email, v.phone].filter(Boolean).join(' · ') || '—'}</div></span>
                          </span>
                        </td>
                        <td>
                          <Pill tone={KIND_TONE[k] ?? 'neutral'} dot={false}>{KIND_META[k]?.label ?? 'Service'}</Pill>
                          {v.relationship === 'internal_team' && <> <Pill tone="info" dot={false}>Own team</Pill></>}
                          {v.isDefault && <> <Pill tone="neutral" dot={false}>Default</Pill></>}
                        </td>
                        <td>
                          {v.category ?? '—'}
                          <div className="sub">
                            {freq ? `Paid ${freq.toLowerCase()} · ` : ''}
                            {participating ? (v.trades.length ? v.trades.map((t) => t.name).join(' · ') : 'no trades set') : 'record — never invited, never assigned work'}
                          </div>
                        </td>
                        <td>{participating ? <Pill tone={INVITE[v.inviteStatus].tone}>{INVITE[v.inviteStatus].l}</Pill> : <span className="sub">Record</span>}</td>
                        <td className="num">{live ? v.technicians : '—'}</td>
                        <td className="num">{live ? v.openJobs : '—'}</td>
                        <td className="act" onClick={(e) => e.stopPropagation()}><Btn size="sm" href={detailHref(v.serviceProviderId)}>Open</Btn></td>
                      </tr>
                    );
                  })}
                </tbody>
              )}
          </table>
        </TableWrap>
      </OsPage>
      {/* Reused unchanged, outside .gx so its own styles apply. */}
      {adding && <VendorForm mode="add" groups={groups} base="/maintenance" onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
    </>
  );
}
