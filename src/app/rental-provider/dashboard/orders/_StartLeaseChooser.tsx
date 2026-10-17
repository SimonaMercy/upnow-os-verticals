'use client';

/**
 * "Start a lease" chooser — opened by the Leases page's "+ New contract" button,
 * by `?start=1`, and by the Leases empty state. It puts the recommended starting
 * points first and still allows a blank contract. Every path ends on the existing
 * contracts/new wizard (never creates anything itself):
 *
 *  1. From a lead (recommended) — leads whose stage resolves to the "convert"
 *     primary action in lib/leadJourney.getPrimary() (Payment confirmation
 *     collected, with a linked unit AND customer — the recovery lane when the
 *     automatic contract creation was blocked). "Start lease" builds the SAME URL
 *     the leads page's handleConvert built:
 *       contracts/new?unitId=&tenantId=&leadId=&tenantName=[&startDate=][&chequeCount=]
 *     Other open leads are listed underneath with "Open lead" (the lead journey is
 *     where they progress; approving payment converts them automatically).
 *     Data: GET /api/leads (manager: /api/manager/leads?rp=, the leads page's leadUrl()).
 *  2. For an existing customer — deriveCustomers() over the contracts the Leases
 *     page already loaded (the Customers page's derivation) → contracts/new?tenantId=&tenantName=.
 *  3. For a vacant unit — the Units page's sources: property list from
 *     GET /properties/floor-plans (manager: /manager/units?rp=), then
 *     GET /properties/:pid/units (manager: /manager/properties/:pid/units); vacant =
 *     the Units page's occBucket rule (no current lease, no held move-out) →
 *     contracts/new?unitId= (the wizard resolves the property from the unit itself).
 *  4. Blank contract — plain contracts/new.
 *  Manager mode: every URL goes to /dashboard/manager/contracts/new with ?rp= first.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { STAGE_LABELS, getPrimary, leadDisplayName, type ApiLead, type LeadStage } from '@/lib/leadJourney';
import { deriveCustomers, type DirectoryContractRow } from '@/lib/customersDirectory';
import { isResidentialUnitType } from '@/lib/unitTaxonomy';
import type { UnitRecord } from '@/lib/unitForm';
import { Btn, Callout, Modal, Pill, SearchField, Seg, fmtAed, fmtFils, initials, type Tone } from '@/components/os/kit';

export type StartPath = 'lead' | 'customer' | 'unit' | 'blank';
type Load<T> = { state: 'idle' | 'loading' | 'ok' | 'error'; rows: T[] };

const STAGE_TONE: Partial<Record<LeadStage, Tone>> = {
  viewing_scheduled: 'info', interested: 'primary', documents_collection: 'amber', payment_plan_shared: 'info',
  cheques_submitted: 'amber', cheques_collected: 'primary',
};

/** Same rule as the leads page: firm plan rent (fils) once issued, else the unit's listed price (AED). */
function leadRent(lead: ApiLead): string {
  if (lead.paymentPlan) return fmtFils(lead.paymentPlan.rentFils);
  if (lead.unit?.rentalPrice != null) return fmtAed(lead.unit.rentalPrice);
  return '—';
}
function leadUnit(lead: ApiLead): string {
  const u = lead.unit;
  if (!u) return 'No unit linked';
  const label = u.unitNumber ? `Unit ${u.unitNumber}` : (u.unitName ?? '—');
  return u.property?.buildingName ? `${label} · ${u.property.buildingName}` : label;
}

/** Units page occupancy rule (occBucket): a current lease or a held move-out is NOT vacant. */
const isVacant = (u: UnitRecord) => !(u.occupiedByLease ?? u.availability === 'occupied') && !u.moveOutPending && !u.nextLeaseStart;

function unitShape(u: UnitRecord): string {
  const type = u.unitType ? u.unitType.replace(/[_-]+/g, ' ') : 'Unit';
  if (!isResidentialUnitType(u.unitType) || u.bedrooms == null) return type;
  return `${type} · ${u.bedrooms === 0 ? 'Studio' : `${u.bedrooms} bed`}`;
}

const listBox: React.CSSProperties = { maxHeight: 340, overflowY: 'auto', border: '1px solid var(--ms-surface-3)', borderRadius: 10 };
const muted: React.CSSProperties = { fontSize: 11.5, color: 'var(--ms-ink-3)' };

function StateBox({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="gx-empty" style={{ padding: '22px 16px' }}><b>{title}</b>{children}</div>;
}

export function StartLeaseChooser({ open, onClose, manager, contracts, contractsLoading, contractsError, onRetryContracts }: {
  open: boolean;
  onClose: () => void;
  manager?: { rp: number };
  /** The /contracts (or /manager/contracts?rp=) rows the Leases page already loaded. */
  contracts: unknown[];
  contractsLoading: boolean;
  contractsError: boolean;
  onRetryContracts: () => void;
}) {
  const [path, setPath] = useState<StartPath>('lead');
  const [q, setQ] = useState('');
  const [leads, setLeads] = useState<Load<ApiLead>>({ state: 'idle', rows: [] });
  const [units, setUnits] = useState<Load<UnitRecord & { buildingName: string | null }>>({ state: 'idle', rows: [] });

  const newBase = manager ? '/dashboard/manager/contracts/new' : '/rental-provider/dashboard/contracts/new';
  /** contracts/new URL; managers always carry ?rp= first (the wizard reads it for every call). */
  const newHref = useCallback((params: string) => {
    if (manager) return `${newBase}?rp=${manager.rp}${params ? `&${params}` : ''}`;
    return params ? `${newBase}?${params}` : newBase;
  }, [manager, newBase]);
  const leadsListHref = manager ? `/dashboard/manager/leads?rp=${manager.rp}` : '/rental-provider/dashboard/leads';
  const leadHref = (id: number) => manager ? `/dashboard/manager/leads/${id}?rp=${manager.rp}` : `/rental-provider/dashboard/leads/${id}`;
  const unitsHref = manager ? `/dashboard/manager/units?rp=${manager.rp}` : '/rental-provider/dashboard/units';
  const customersHref = manager ? `/dashboard/manager/tenants?rp=${manager.rp}` : '/rental-provider/dashboard/tenants';

  // ── Loaders (lazy: leads when the chooser opens, units when that path is picked) ──
  const loadLeads = useCallback(() => {
    setLeads({ state: 'loading', rows: [] });
    apiGet<ApiLead[]>(manager ? `/manager/leads?rp=${manager.rp}` : '/leads')
      .then(d => setLeads({ state: 'ok', rows: Array.isArray(d) ? d : [] }))
      .catch(() => setLeads({ state: 'error', rows: [] }));
  }, [manager]);
  const loadUnits = useCallback(() => {
    setUnits({ state: 'loading', rows: [] });
    apiGet<{ properties: { id: number; buildingName: string }[] }>(manager ? `/manager/units?rp=${manager.rp}` : '/properties/floor-plans')
      .then(async d => {
        const props = Array.isArray(d?.properties) ? d.properties : [];
        const lists = await Promise.all(props.map(p =>
          apiGet<UnitRecord[]>(manager ? `/manager/properties/${p.id}/units` : `/properties/${p.id}/units`)
            .then(rows => (Array.isArray(rows) ? rows : []).map(u => ({ ...u, buildingName: p.buildingName })))));
        setUnits({ state: 'ok', rows: lists.flat() });
      })
      .catch(() => setUnits({ state: 'error', rows: [] }));
  }, [manager]);

  useEffect(() => {
    // Fetch on first open of the chooser (the loader flips its own loading flag).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open && leads.state === 'idle') loadLeads();
  }, [open, leads.state, loadLeads]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open && path === 'unit' && units.state === 'idle') loadUnits();
  }, [open, path, units.state, loadUnits]);

  const switchPath = (p: StartPath) => { setPath(p); setQ(''); };
  const needle = q.trim().toLowerCase();

  // ── Path 1: leads ──
  const { ready, inProgress } = useMemo(() => {
    const live = leads.rows.filter(l => l.stage !== 'rejected' && l.stage !== 'converted');
    const match = (l: ApiLead) => !needle || [leadDisplayName(l), l.leadEmail, l.unit?.unitNumber, l.unit?.unitName, l.unit?.property?.buildingName]
      .some(s => s && String(s).toLowerCase().includes(needle));
    const isReady = (l: ApiLead) => getPrimary(l)?.kind === 'convert';
    return {
      ready: live.filter(l => isReady(l) && match(l)),
      inProgress: live.filter(l => !isReady(l) && match(l)),
    };
  }, [leads.rows, needle]);

  /** Exactly the leads page's handleConvert URL. */
  const leadStartHref = (lead: ApiLead) => {
    const name = encodeURIComponent(leadDisplayName(lead) ?? '');
    const planStart = lead.paymentPlan?.items?.find(it => it.type === 'first_bundle')?.dueDate
      ?? lead.paymentPlan?.items?.slice().sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))[0]?.dueDate;
    const startDate = planStart ?? lead.viewings?.find(v => v.desiredMoveIn)?.desiredMoveIn ?? '';
    const startParam = startDate ? `&startDate=${startDate}` : '';
    const chequeParam = lead.paymentPlan?.chequeCount ? `&chequeCount=${lead.paymentPlan.chequeCount}` : '';
    return newHref(`unitId=${lead.unit?.id}&tenantId=${lead.convertedTenant?.id}&leadId=${lead.id}&tenantName=${name}${startParam}${chequeParam}`);
  };

  // ── Path 2: customers (the Customers page's derivation) ──
  const customers = useMemo(() => deriveCustomers(contracts as DirectoryContractRow[]), [contracts]);
  const customerRows = useMemo(() => customers
    .filter(c => !needle || `${c.name} ${c.email} ${c.phone ?? ''}`.toLowerCase().includes(needle))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)),
  [customers, needle]);
  const customerHref = (id: number, name: string) => newHref(`tenantId=${id}${name ? `&tenantName=${encodeURIComponent(name)}` : ''}`);

  // ── Path 3: vacant units ──
  const vacantRows = useMemo(() => units.rows
    .filter(isVacant)
    .filter(u => !needle || [u.unitNumber, u.unitName, u.unitType, u.buildingName].some(s => s && String(s).toLowerCase().includes(needle)))
    .sort((a, b) => (a.buildingName ?? '').localeCompare(b.buildingName ?? '') || a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true })),
  [units.rows, needle]);

  const leadCount = leads.state === 'ok' ? ready.length : undefined;

  return (
    <Modal open={open} onClose={onClose} title="Start a lease" width={780}
      footer={<><span style={{ ...muted, marginRight: 'auto' }}>Nothing is created until you submit the contract form.</span><Btn onClick={onClose}>Cancel</Btn></>}>
      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--ms-ink-2)' }}>
        Pick where this lease comes from. Starting from a lead carries its customer, unit, start date and approved payment plan into the contract.
      </p>
      <div style={{ marginBottom: 12 }}>
        <Seg label="How to start the lease" value={path} onChange={switchPath} options={[
          { v: 'lead', l: 'From a lead (recommended)', n: leadCount },
          { v: 'customer', l: 'Existing customer', n: contractsLoading ? undefined : customers.length },
          { v: 'unit', l: 'Vacant unit', n: units.state === 'ok' ? units.rows.filter(isVacant).length : undefined },
          { v: 'blank', l: 'Blank contract' },
        ]} />
      </div>

      <Callout tone="info" title="Renewing?">
        A renewal starts from the expiring lease — open it and use <b>Propose renewal</b>, not this chooser.
      </Callout>
      <div style={{ height: 12 }} />

      <div role="tabpanel" aria-label={{ lead: 'From a lead', customer: 'Existing customer', unit: 'Vacant unit', blank: 'Blank contract' }[path]}>
        {path !== 'blank' && (
          <div style={{ marginBottom: 10 }}>
            <SearchField value={q} onChange={setQ}
              placeholder={path === 'lead' ? 'Search leads by name, email, unit or building…'
                : path === 'customer' ? 'Search customers by name, email or phone…'
                : 'Search units by number, name, type or building…'} />
          </div>
        )}

        {path === 'lead' && (
          leads.state === 'loading' || leads.state === 'idle' ? <div className="gx-skel" style={{ height: 120 }} aria-busy="true" />
          : leads.state === 'error' ? <StateBox title="Couldn't load your leads"><div style={{ marginTop: 8 }}><Btn size="sm" onClick={loadLeads}>Try again</Btn></div></StateBox>
          : <>
            <div style={{ ...muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', fontSize: 10, margin: '0 0 6px' }}>Ready to become a lease</div>
            {ready.length === 0 ? (
              <StateBox title={needle ? 'No ready lead matches' : 'No lead is waiting to become a lease'}>
                {!needle && <>Leases normally start from a lead: once you approve its payment confirmation, the contract is issued automatically.
                  A lead only waits here when that step was blocked (payment confirmation collected, with its unit and customer linked).{' '}
                  <Link href={leadsListHref}>Open Demand › Leads</Link></>}
              </StateBox>
            ) : (
              <div style={listBox}>
                <table className="gx-tbl">
                  <thead><tr><th>Lead</th><th>Unit</th><th>Stage</th><th className="num">Annual rent</th><th className="act">Action</th></tr></thead>
                  <tbody>
                    {ready.map(l => (
                      <tr key={l.id}>
                        <td><span className="strong">{leadDisplayName(l)}</span><span className="sub">Lead #{l.id}</span></td>
                        <td>{leadUnit(l)}</td>
                        <td><Pill tone={STAGE_TONE[l.stage] ?? 'neutral'}>{STAGE_LABELS[l.stage] ?? l.stage}</Pill></td>
                        <td className="num">{leadRent(l)}</td>
                        <td className="act"><Btn size="xs" variant="primary" href={leadStartHref(l)}>Start lease</Btn></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {inProgress.length > 0 && (
              <>
                <div style={{ ...muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', fontSize: 10, margin: '14px 0 6px' }}>
                  Still in progress — continue on the lead
                </div>
                <div style={listBox}>
                  <table className="gx-tbl">
                    <thead><tr><th>Lead</th><th>Unit</th><th>Stage</th><th className="num">Annual rent</th><th className="act">Action</th></tr></thead>
                    <tbody>
                      {inProgress.map(l => (
                        <tr key={l.id}>
                          <td><span className="strong">{leadDisplayName(l)}</span><span className="sub">Lead #{l.id}</span></td>
                          <td>{leadUnit(l)}</td>
                          <td><Pill tone={STAGE_TONE[l.stage] ?? 'neutral'}>{STAGE_LABELS[l.stage] ?? l.stage}</Pill></td>
                          <td className="num">{leadRent(l)}</td>
                          <td className="act"><Btn size="xs" href={leadHref(l.id)}>Open lead</Btn></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {path === 'customer' && (
          contractsLoading ? <div className="gx-skel" style={{ height: 120 }} aria-busy="true" />
          : contractsError ? <StateBox title="Couldn't load your customers"><div style={{ marginTop: 8 }}><Btn size="sm" onClick={onRetryContracts}>Try again</Btn></div></StateBox>
          : customerRows.length === 0 ? (
            <StateBox title={needle ? 'No customer matches' : 'No customers yet'}>
              {needle ? ' Try another name, email or phone.' : <> Customers appear once they hold a lease. To lease to someone new, start from a lead or <Link href={customersHref}>add the customer</Link> first.</>}
            </StateBox>
          ) : (
            <div style={listBox}>
              <table className="gx-tbl">
                <thead><tr><th>Customer</th><th>Contact</th><th>Leases</th><th className="act">Action</th></tr></thead>
                <tbody>
                  {customerRows.map(c => (
                    <tr key={c.id}>
                      <td>
                        <div className="gx-cell">
                          <span className="gx-thumb">{initials(c.name)}</span>
                          <span><span className="strong">{c.name}</span><span className="sub">{c.company ? 'Company' : 'Individual'}</span></span>
                        </div>
                      </td>
                      <td>{c.email || '—'}<span className="sub">{c.phone ?? ''}</span></td>
                      <td>
                        {c.active ? <Pill tone="primary">{c.activeLeaseCount} active</Pill> : <Pill tone="neutral">Ended</Pill>}
                        <span className="sub">{c.leaseCount} lease{c.leaseCount === 1 ? '' : 's'} on record</span>
                      </td>
                      <td className="act"><Btn size="xs" variant="primary" href={customerHref(c.id, c.name)}>Start lease</Btn></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {path === 'unit' && (
          units.state === 'loading' || units.state === 'idle' ? <div className="gx-skel" style={{ height: 120 }} aria-busy="true" />
          : units.state === 'error' ? <StateBox title="Couldn't load your units"><div style={{ marginTop: 8 }}><Btn size="sm" onClick={loadUnits}>Try again</Btn></div></StateBox>
          : vacantRows.length === 0 ? (
            <StateBox title={needle ? 'No vacant unit matches' : 'No vacant units'}>
              {needle ? ' Try another unit number, type or building.' : <> Every unit has a current lease or a move-out still to sign. <Link href={unitsHref}>Open Units</Link></>}
            </StateBox>
          ) : (
            <div style={listBox}>
              <table className="gx-tbl">
                <thead><tr><th>Unit</th><th>Type</th><th className="num">Asking rent</th><th>Status</th><th className="act">Action</th></tr></thead>
                <tbody>
                  {vacantRows.map(u => (
                    <tr key={u.id}>
                      <td><span className="strong">Unit {u.unitNumber}</span><span className="sub">{u.buildingName ?? '—'}</span></td>
                      <td style={{ textTransform: 'capitalize' }}>{unitShape(u)}</td>
                      <td className="num">{u.rentalPrice != null ? fmtAed(u.rentalPrice) : '—'}<span className="sub">per year</span></td>
                      <td>
                        {u.availability === 'reserved' ? <Pill tone="amber">Reserved</Pill>
                          : u.availability === 'maintenance' ? <Pill tone="amber">Maintenance</Pill>
                          : <Pill tone="primary">Ready to lease</Pill>}
                      </td>
                      <td className="act"><Btn size="xs" variant="primary" href={newHref(`unitId=${u.id}`)}>Start lease</Btn></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {path === 'blank' && (
          <div className="gx-empty" style={{ padding: '22px 16px', textAlign: 'left' }}>
            <b>Start from an empty contract form</b>
            You choose the customer (or add a new one), the property and unit, the term and the payment plan yourself.
            Use this for a lease agreed outside UpNow; otherwise starting from a lead keeps its documents and approved plan.
            <div style={{ marginTop: 12 }}><Btn variant="primary" href={newHref('')}>Open blank contract</Btn></div>
          </div>
        )}
      </div>
    </Modal>
  );
}
