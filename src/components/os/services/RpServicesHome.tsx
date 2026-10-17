'use client';

/**
 * Services workspace for a landlord (rental provider → Services vertical).
 *
 * The service work on the landlord's OWN buildings, from the same live endpoints the
 * maintenance, vendor and AMC pages read (all read-only here):
 *   GET /maintenance/requests?scope=all   (MaintenanceRequestsIndex)
 *   GET /maintenance/vendors              (Vendors page)
 *   GET /amc/contracts                    (AmcView)
 *
 * Stage strip = the maintenance request lifecycle the backend derives
 * (maintenance-stage.util): requested → awaiting_approval → in_progress → sign_off /
 * close_out → closed. "Requested" splits three ways on what the record already holds:
 * no who-pays decision yet (Request — the landlord's triage), decided but no provider
 * (Triage done — routing), provider attached (Vendor / technician assigned).
 * No fake data: a failed load says so; empty lists show zeros.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Btn, Callout, Card, Kpi, Kpis, OsPage, PageHead, Pill, ScopeStrip, fmtDate } from '@/components/os/kit';
import { StageStrip, type StripStage } from '@/components/os/StageStrip';
import { apiGet } from '@/lib/api';
import { RP_BASE } from '@/lib/os/scope';

interface MaintRow {
  id: number; ref: string; title: string; stage: string; stageNote: string | null;
  coverage: string | null; holdReason: string | null;
  category: { id: number; name: string } | null;
  locationLabel?: string | null;
  unit: { id: number; unitNumber: string | null } | null;
  property: { id: number; buildingName: string | null } | null;
  provider: { id: number; name: string; relationship: string | null } | null;
  quote: { status: string; totalAed: number } | null;
  createdAt: string; updatedAt: string;
}
interface VendorLite { serviceProviderId: number; relationship: string; inviteStatus: string; openJobs: number }
interface AmcLite { id: number; status: string; endDate: string | null }

type StageKey = 'request' | 'triage' | 'assigned' | 'approval' | 'work' | 'completed' | 'closed';

const STAGES: { key: StageKey; label: string; hint: string; attention?: boolean }[] = [
  { key: 'request',   label: 'Request',                    hint: 'Raised — decide who pays (cover, charge or decline).', attention: true },
  { key: 'triage',    label: 'Triage',                     hint: 'Who-pays decided — being routed to a vendor or your team.' },
  { key: 'assigned',  label: 'Vendor / technician assigned', hint: 'A provider has it — diagnosing and pricing the job.' },
  { key: 'approval',  label: 'Quote approval',             hint: 'A quote is waiting to be approved (you, or the customer if chargeable).', attention: true },
  { key: 'work',      label: 'Work in progress',           hint: 'Approved — the provider is doing the work.' },
  { key: 'completed', label: 'Completed',                  hint: 'Work done — sign it off, then allocate the cost and invoice.', attention: true },
  { key: 'closed',    label: 'Closed',                     hint: 'Closed out — cost allocated, kept in the history.' },
];

function stageOf(r: MaintRow): StageKey | null {
  switch (r.stage) {
    case 'requested': return !r.coverage ? 'request' : !r.provider ? 'triage' : 'assigned';
    case 'awaiting_approval': return 'approval';
    case 'in_progress': return 'work';
    case 'sign_off': case 'close_out': return 'completed';
    case 'closed': return 'closed';
    default: return null; // declined / cancelled — counted apart
  }
}

const BOARD = `${RP_BASE}/operations?tab=maintenance`;
const REQUESTS = `${RP_BASE}/maintenance`;

export function RpServicesHome({ label }: { label: string }) {
  const [rows, setRows] = useState<MaintRow[] | null>(null);
  const [vendors, setVendors] = useState<VendorLite[] | null>(null);
  const [amc, setAmc] = useState<AmcLite[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    apiGet<MaintRow[]>('/maintenance/requests?scope=all')
      .then((d) => { if (on) setRows(Array.isArray(d) ? d : []); })
      .catch(() => { if (on) { setRows([]); setErr('Could not load maintenance requests.'); } });
    apiGet<VendorLite[]>('/maintenance/vendors')
      .then((d) => { if (on) setVendors(Array.isArray(d) ? d : []); })
      .catch(() => { if (on) setVendors([]); });
    apiGet<AmcLite[]>('/amc/contracts')
      .then((d) => { if (on) setAmc(Array.isArray(d) ? d : []); })
      .catch(() => { if (on) setAmc([]); });
    return () => { on = false; };
  }, []);

  const loading = rows == null;
  const { counts, ended, top } = useMemo(() => {
    const c: Record<StageKey, number> = { request: 0, triage: 0, assigned: 0, approval: 0, work: 0, completed: 0, closed: 0 };
    let endedN = 0;
    const open: (MaintRow & { at: StageKey })[] = [];
    for (const r of rows ?? []) {
      const at = stageOf(r);
      if (!at) { endedN += 1; continue; }
      c[at] += 1;
      if (at !== 'closed') open.push({ ...r, at });
    }
    // The landlord's moves first (triage, approval, sign-off), then oldest activity.
    const needsYou = (k: StageKey) => STAGES.find((s) => s.key === k)?.attention ? 0 : 1;
    open.sort((a, b) => needsYou(a.at) - needsYou(b.at) || new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
    return { counts: c, ended: endedN, top: open.slice(0, 6) };
  }, [rows]);

  const strip: StripStage[] = STAGES.map((s) => ({
    key: s.key, label: s.label, hint: s.hint, count: counts[s.key], attention: s.attention,
    href: s.key === 'closed' ? REQUESTS : BOARD,
  }));
  const openTotal = STAGES.filter((s) => s.key !== 'closed').reduce((n, s) => n + counts[s.key], 0);
  const waiting = counts.request + counts.approval + counts.completed;

  const vendorStats = useMemo(() => {
    const v = vendors ?? [];
    return {
      total: v.length,
      team: v.filter((x) => x.relationship === 'internal_team').length,
      contracted: v.filter((x) => x.relationship !== 'internal_team').length,
      openJobs: v.reduce((n, x) => n + (x.openJobs ?? 0), 0),
    };
  }, [vendors]);
  const amcStats = useMemo(() => {
    const a = amc ?? [];
    return {
      total: a.length,
      active: a.filter((x) => x.status === 'active').length,
      expiring: a.filter((x) => x.status === 'expiring').length,
      expired: a.filter((x) => x.status === 'expired').length,
    };
  }, [amc]);
  const stageLabel = (k: StageKey) => STAGES.find((s) => s.key === k)?.label ?? k;
  const n = (v: number, ready: boolean) => (ready ? v : '…');

  return (
    <OsPage>
      <PageHead
        eyebrow="Operations"
        title={label}
        lede="Service work on your own buildings — maintenance requests from raise to close-out, the vendors and team who do it, and your annual contracts."
        actions={<>
          <Btn href={REQUESTS}>All requests</Btn>
          <Btn variant="primary" href={BOARD}>Open maintenance board</Btn>
        </>}
      />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Operations' },
        { label: 'Vertical', value: `${label} · your properties` },
        { label: 'Data', value: <Pill tone="primary">Live</Pill> },
      ]} />
      {err && <Callout tone="bad" title="Maintenance did not load.">{err} The counts below may be incomplete — reload to try again.</Callout>}

      <Kpis>
        <Kpi k="Open requests" v={n(openTotal, !loading)} d="Raised and not yet closed" href={BOARD} dark />
        <Kpi k="Waiting on you" v={n(waiting, !loading)} d="Triage, quote approval or sign-off" href={BOARD} />
        <Kpi k="Closed" v={n(counts.closed, !loading)} d={ended ? `${ended} declined or cancelled` : 'Completed and closed out'} href={REQUESTS} />
        <Kpi k="Vendors & team" v={n(vendorStats.total, vendors != null)} d={`${vendorStats.openJobs} open job${vendorStats.openJobs === 1 ? '' : 's'} with them`} href={`${RP_BASE}/vendors`} />
        <Kpi k="AMC contracts" v={n(amcStats.total, amc != null)} d={amcStats.expiring ? `${amcStats.expiring} expiring soon` : `${amcStats.active} active`} href={`${RP_BASE}/amc`} />
      </Kpis>

      <Card title="Maintenance flow" sub="Every request moves through these stages. Open a stage to work it on the maintenance board." pad>
        <StageStrip ariaLabel="Maintenance flow" stages={strip} loading={loading} />
      </Card>

      <div style={{ height: 14 }} />
      <Card title="Open requests" sub={loading ? 'Loading…' : openTotal ? `Your moves first — ${Math.min(top.length, openTotal)} of ${openTotal}` : undefined}
        right={<Btn size="sm" href={REQUESTS}>All requests <ArrowRight size={13} aria-hidden /></Btn>}>
        {loading ? (
          <div style={{ padding: '14px 16px', fontSize: 12.5, color: 'var(--ms-ink-3)' }}>Loading maintenance requests…</div>
        ) : top.length === 0 ? (
          <div style={{ padding: '14px 16px', fontSize: 12.5, color: 'var(--ms-ink-3)' }}>
            No open maintenance requests. Customers raise them from their space; you can raise one from All requests.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {top.map((r) => {
              const mine = STAGES.find((s) => s.key === r.at)?.attention;
              return (
                <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderTop: '1px solid var(--ms-surface-3, #eef1ef)', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ms-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.ref} · {r.property?.buildingName ?? '—'}{r.unit?.unitNumber ? ` · Unit ${r.unit.unitNumber}` : r.locationLabel ? ` · ${r.locationLabel}` : ''} · {r.category?.name ?? 'Maintenance'} · updated {fmtDate(r.updatedAt)}
                    </div>
                  </div>
                  <span style={{ fontSize: 11.5, color: 'var(--ms-ink-2)', flex: '0 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.provider ? r.provider.name : 'No provider yet'}
                  </span>
                  <Pill tone={mine ? 'amber' : 'outline'}>{stageLabel(r.at)}{mine ? ' · your move' : ''}</Pill>
                  <Btn size="sm" href={`${RP_BASE}/maintenance/${r.id}`}>Open</Btn>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div style={{ height: 14 }} />
      <div className="gx-cols gx-cols-2" style={{ marginBottom: 14 }}>
        <Card title="Vendors" sub="Contractors and your own team who take the work" pad
          right={<Btn size="sm" href={`${RP_BASE}/vendors`}>Open vendors <ArrowRight size={13} aria-hidden /></Btn>}>
          <div className="gx-chips">
            <Pill tone="outline" dot={false}>Total · {n(vendorStats.total, vendors != null)}</Pill>
            <Pill tone="outline" dot={false}>Contracted vendors · {n(vendorStats.contracted, vendors != null)}</Pill>
            <Pill tone="outline" dot={false}>Own team · {n(vendorStats.team, vendors != null)}</Pill>
            <Pill tone="outline" dot={false}>Open jobs · {n(vendorStats.openJobs, vendors != null)}</Pill>
          </div>
        </Card>
        <Card title="AMC contracts" sub="Annual maintenance contracts per building" pad
          right={<Btn size="sm" href={`${RP_BASE}/amc`}>Open AMC <ArrowRight size={13} aria-hidden /></Btn>}>
          <div className="gx-chips">
            <Pill tone="outline" dot={false}>Total · {n(amcStats.total, amc != null)}</Pill>
            <Pill tone="outline" dot={false}>Active · {n(amcStats.active, amc != null)}</Pill>
            <Pill tone={amcStats.expiring ? 'amber' : 'outline'} dot={false}>Expiring · {n(amcStats.expiring, amc != null)}</Pill>
            <Pill tone={amcStats.expired ? 'danger' : 'outline'} dot={false}>Expired · {n(amcStats.expired, amc != null)}</Pill>
          </div>
        </Card>
      </div>
      <Card title="Building inspections" sub="The inspection visits worklist for your buildings" pad
        right={<Btn size="sm" href={`${RP_BASE}/building-inspections`}>Open inspections <ArrowRight size={13} aria-hidden /></Btn>}>
        <div style={{ fontSize: 12.5, color: 'var(--ms-ink-2)' }}>Upcoming and past inspection visits per building live on their own worklist.</div>
      </Card>

      <div style={{ height: 14 }} />
      <Callout tone="info" title="Selling home services to customers?">
        Taking cleaning, AC or handyman bookings from customers runs in the UpNow service-provider workspace — a separate account with its own onboarding, catalogue and payouts. This workspace covers the service work on your own properties.
      </Callout>
    </OsPage>
  );
}
