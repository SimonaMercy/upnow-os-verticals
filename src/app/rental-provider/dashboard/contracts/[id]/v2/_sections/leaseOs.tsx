'use client';
/**
 * Genspark OS parts for the lease detail page — the figures behind the KPI row,
 * the read-only step strip, the right-rail kit cards and the style bridge that
 * lets the reused legacy sections (payments ledger, step bodies, modals) sit
 * inside kit cards. Built locally: the kit itself (src/components/os) is not edited.
 */
import Link from 'next/link';
import { Card, KV, Bars, Pill, type Tone as KitTone } from '@/components/os/kit';
import { passFigures, collectedOf } from './record';
import { type ContractDetail, type ContractPayment, type Step, type Tone, dayCount, isoDay, fmtAed, fmtDate } from './shared';

/** Legacy step tone → kit pill tone. */
export const KIT_TONE: Record<Tone, KitTone> = { action: 'danger', waiting: 'amber', celebrate: 'primary', declined: 'neutral' };

/** Every headline figure the page states, from data it already loads (the same
 *  sums the old summary strip / pass / rail used — passFigures + collectedOf). */
export function leaseFigures(contract: ContractDetail) {
  const payments = contract.payments ?? [];
  const today = new Date();
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = isoDay(contract.startDate), end = isoDay(contract.endDate);
  const total = Math.max(1, dayCount(start, end));
  const left = dayCount(today, end);
  const upcoming = start > today;
  const ending = contract.status === 'active' && left >= 0 && left <= 120;
  const months = Math.round(total / 30.4);
  const f = passFigures(contract, payments);
  const collected = collectedOf(contract, payments);
  const collPct = f.totalPayable > 0 ? Math.min(100, (collected / f.totalPayable) * 100) : 0;
  const outstanding = Math.max(0, f.totalPayable - collected);
  const rentCheques = payments.filter(p => (p.paymentType ?? 'rental_income') === 'rental_income'
    && !['cancelled', 'replaced'].includes(String(p.effectiveStatus ?? p.chequeStatus ?? '').toLowerCase())).length
    || contract.numberOfInstallments || 0;
  const clearedCheques = payments.filter(p => (p.paymentType ?? 'rental_income') === 'rental_income'
    && String(p.effectiveStatus ?? p.chequeStatus ?? '').toLowerCase() === 'cleared').length;
  const files = (contract.documents ?? []).filter(d => !!d.fileUrl).length;
  const asks = (contract.documents ?? []).filter(d => !d.fileUrl).length;
  const open = [...payments, ...(contract.fees ?? [])]
    .filter(p => {
      const st = String(p.effectiveStatus ?? p.chequeStatus ?? 'pending').toLowerCase();
      return !!p.transactionDate && !['cleared', 'cancelled', 'replaced', 'bounced', 'deposited'].includes(st) && !st.startsWith('bounced');
    })
    .sort((a, b) => String(a.transactionDate).localeCompare(String(b.transactionDate)));
  const overdue = open.filter(p => isoDay(p.transactionDate!) < midnight);
  const overdueAmt = overdue.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const next = open.find(p => !overdue.includes(p)) ?? null;
  return { f, collected, collPct, outstanding, rentCheques, clearedCheques, files, asks, overdue, overdueAmt, next, left, upcoming, ending, months, daysToStart: dayCount(today, start) };
}

/** The pipeline as a read-only strip (kit gx-flow markup) — each step marked by
 *  its OWN done flag (steps can complete out of order, so the kit Flow's single
 *  `current` index would misreport them). */
export function StepStrip({ steps, doneArr, current }: { steps: Step[]; doneArr: boolean[]; current: number }) {
  return (
    <div className="gx-flow" role="list" aria-label="Lease pipeline">
      {steps.map((s, i) => (
        <div key={s.key} role="listitem" className={'gx-flow-step' + (doneArr[i] ? ' done' : i === current ? ' current' : '')}>
          <div className="gx-flow-n">{doneArr[i] ? '✓' : i + 1}</div>
          <div className="gx-flow-t">{s.label}</div>
          <div className="gx-flow-s">{doneArr[i] ? 'Done' : i === current ? 'Next up' : 'To do'}</div>
        </div>
      ))}
    </div>
  );
}

/** Right rail — Parties, Payment summary, Property & unit (the old RecordRail's
 *  content and links, as kit cards). */
export function LeaseRail({ contract, payments, tenantHref, propertyHref, unitHref, hideContact }: {
  contract: ContractDetail; payments: ContractPayment[]; tenantHref: string | null;
  propertyHref: string | null; unitHref: string | null; hideContact: boolean;
}) {
  const f = passFigures(contract, payments);
  const collected = collectedOf(contract, payments);
  const pct = f.totalPayable > 0 ? Math.min(100, (collected / f.totalPayable) * 100) : 0;
  const outstanding = Math.max(0, f.totalPayable - collected);
  const name = contract.tenant.name ?? 'Customer';
  const landlord = contract.landlord.companyName || contract.landlord.name || '—';
  const area = [contract.property.community, contract.property.emirate].filter(Boolean).join(', ') || '—';
  const beds = contract.unit.bedrooms != null ? (contract.unit.bedrooms === 0 ? 'Studio' : `${contract.unit.bedrooms} BR`) : '—';
  const unitType = contract.unit.type ? contract.unit.type.replace(/_/g, ' ') : null;
  const parts = [
    { key: 'rent', label: f.rentVat > 0 ? 'Rent (incl. VAT)' : 'Rent', value: f.rentGross, show: true },
    { key: 'other', label: 'Other charges', value: f.otherGross, show: f.otherGross > 0 },
    { key: 'fees', label: 'Fees (incl. VAT)', value: f.feesGross, show: f.feesGross > 0 },
    { key: 'dep', label: 'Security deposit', value: f.deposit, show: !f.isRenewal },
  ].filter(x => x.show);
  const partsSum = parts.reduce((a, x) => a + Math.max(0, x.value), 0);
  const link = (href: string | null, text: string) => href ? <Link href={href} className="lz-link">{text}</Link> : text;
  return (
    <aside className="lz-rail" aria-label="Lease summary">
      <Card title={contract.contractType === 'renewal' ? 'Renewal term' : 'Lease term'} pad>
        <KV items={[
          { k: 'Start', v: fmtDate(contract.startDate) },
          { k: 'End', v: fmtDate(contract.endDate) },
          { k: 'Duration', v: contract.durationYears ? `${contract.durationYears * 12} months` : '12 months' },
          { k: 'Instalments', v: contract.numberOfInstallments ? `${contract.numberOfInstallments} payments` : '—' },
          { k: 'Mode', v: contract.modeOfPayment ? contract.modeOfPayment.charAt(0).toUpperCase() + contract.modeOfPayment.slice(1) : '—' },
        ]} />
      </Card>
      <Card title="Parties" pad>
        <KV items={[
          { k: 'Customer', v: link(tenantHref, name) },
          { k: 'Landlord', v: landlord },
          ...(!hideContact && contract.tenant.phone ? [{ k: 'Phone', v: contract.tenant.phone }] : []),
          ...(!hideContact && contract.tenant.email ? [{ k: 'Email', v: <span className="lz-break">{contract.tenant.email}</span> }] : []),
        ]} />
        {!hideContact && (contract.tenant.email || contract.tenant.phone) && (
          <div className="gx-btn-row" style={{ marginTop: 10 }}>
            {contract.tenant.email && <a className="gx-btn sm" href={`mailto:${contract.tenant.email}`}>Email {name.split(/\s+/)[0]}</a>}
            {contract.tenant.phone && <a className="gx-btn sm" href={`tel:${contract.tenant.phone.replace(/\s/g, '')}`}>Call</a>}
          </div>
        )}
      </Card>
      <Card title="Payment summary" right={<Pill tone={pct >= 100 ? 'primary' : 'amber'}>{Math.round(pct)}% collected</Pill>} pad>
        <KV items={[
          { k: 'Collected', v: f.aed(collected) },
          { k: 'Outstanding', v: <span className={outstanding > 0 ? 'lz-bad' : 'lz-ok'}>{outstanding > 0 ? f.aed(outstanding) : 'Nothing outstanding'}</span> },
        ]} />
        <div style={{ marginTop: 10 }}>
          <Bars rows={[{ l: 'Collected', pct, v: `${Math.round(pct)}%` }]} />
        </div>
        {/* Composition of the total — one row per payable bucket. */}
        <div className="lz-parts">
          {parts.map(x => (
            <div key={x.key}>
              <span>{x.label}{partsSum > 0 && x.value > 0 && <small> · {Math.round((x.value / partsSum) * 100)}%</small>}</span>
              <b>{x.value > 0 ? f.aed(x.value) : '—'}</b>
            </div>
          ))}
        </div>
        <div className="lz-total">
          <span>Total payable{f.totalVat > 0 && <small> · incl. {f.aed(f.totalVat)} VAT</small>}</span>
          <b>{f.aed(f.totalPayable)}</b>
        </div>
        {f.incurredGross > 0 && <div className="lz-note">+ {f.aed(f.incurredGross)} charges incurred — see Fees</div>}
      </Card>
      <Card title="Property & unit" pad>
        <KV items={[
          { k: 'Property', v: link(propertyHref, contract.property.buildingName ?? '—') },
          { k: 'Area', v: area },
          { k: 'Unit', v: link(unitHref, contract.unit.number ?? '—') },
          { k: 'Floor', v: contract.unit.floor ?? '—' },
          { k: 'Beds', v: beds },
          ...(unitType ? [{ k: 'Type', v: <span style={{ textTransform: 'capitalize' }}>{unitType}</span> }] : []),
        ]} />
      </Card>
    </aside>
  );
}

/** "Deposit held" KPI wording from the contract's securityDeposit record. */
export function depositHeld(contract: ContractDetail): { v: string; d: string } {
  const dep = contract.securityDeposit;
  if (dep) {
    const st = dep.status ? dep.status.replace(/_/g, ' ') : (dep.chequeStatus ?? 'recorded').replace(/_/g, ' ');
    return {
      v: fmtAed(dep.amount),
      d: dep.isCarried ? `Carried forward${dep.sourceContractId ? ` from CID-${dep.sourceContractId}` : ''} · ${st}` : st.charAt(0).toUpperCase() + st.slice(1),
    };
  }
  if (contract.securityDepositAmount) return { v: '—', d: `Agreed ${fmtAed(contract.securityDepositAmount)} · not recorded yet` };
  return { v: '—', d: 'No deposit on this lease' };
}

/** A labelled control row inside a step panel (send-link blocks etc.). */
export function StepExtra({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="lz-extra">
      <div className="lz-extra-t">{title}</div>
      {children}
    </div>
  );
}

/** Style bridge: neutralises the legacy page chrome inside the kit layout and
 *  brings the reused sections onto kit metrics (cards r12 + soft green shadow,
 *  11.5px dense tables with 9.5px uppercase headers, 30px buttons). */
export function LeaseOsStyle() {
  return (
    <style jsx global>{`
      .lease-os .lz-legacy { background: transparent; min-height: 0; color: var(--ms-ink); font-size: 13px; }
      .lease-os .lz-link { color: var(--ms-primary-dark); font-weight: 600; text-decoration: underline; text-underline-offset: 2px; text-decoration-color: var(--ms-primary-lighter); }
      .lease-os .lz-link:hover { color: var(--ms-primary); }
      .lease-os .lz-break { overflow-wrap: anywhere; }
      .lease-os .lz-bad { color: var(--ms-danger); font-weight: 700; }
      .lease-os .lz-ok { color: var(--ms-primary-dark); font-weight: 600; }
      .lease-os .lz-warn { color: var(--ms-amber-text); }
      .lease-os .lz-lede { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
      .lease-os .lz-lede .sep { color: var(--ms-ink-3); opacity: .6; }
      .lease-os .lz-title { display: inline-flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .lease-os .lz-stack { display: grid; gap: 12px; margin-bottom: 16px; }
      .lease-os .lz-kpi-act { background: none; border: 0; padding: 0; margin-top: 4px; font-size: 10.5px; font-weight: 700; color: var(--ms-primary-dark); cursor: pointer; text-align: left; }
      .lease-os .lz-kpi-act:hover { text-decoration: underline; }
      .lease-os .lz-kpi-act.bad { color: var(--ms-danger); }
      .lease-os .lz-grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; margin-top: 16px; }
      .lease-os .lz-grid.solo { grid-template-columns: minmax(0, 1fr); }
      @media (max-width: 1150px) { .lease-os .lz-grid { grid-template-columns: minmax(0, 1fr); } }
      .lease-os .lz-rail { display: grid; gap: 12px; position: sticky; top: 84px; }
      @media (max-width: 1150px) { .lease-os .lz-rail { position: static; } }
      .lease-os .lz-parts { display: grid; gap: 5px; margin-top: 10px; font-size: 11.5px; }
      .lease-os .lz-parts > div { display: flex; justify-content: space-between; gap: 8px; }
      .lease-os .lz-parts small { color: var(--ms-ink-3); }
      .lease-os .lz-parts b { color: var(--ms-ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
      .lease-os .lz-total { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--ms-surface-3); font-size: 12px; font-weight: 700; }
      .lease-os .lz-total small { font-weight: 500; color: var(--ms-ink-3); }
      .lease-os .lz-total b { font-size: 14px; color: var(--ms-primary-dark); font-variant-numeric: tabular-nums; }
      .lease-os .lz-note { font-size: 10.5px; color: var(--ms-ink-3); margin-top: 4px; text-align: right; }
      .lease-os .lz-tabs { margin-bottom: 12px; }
      /* Pipeline (Timeline with the selected step's work inside it) */
      .lease-os .lz-stepbtn { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; background: none; border: 0; padding: 0; cursor: pointer; font-size: 12.5px; font-weight: 700; color: var(--ms-ink); text-align: left; }
      .lease-os .lz-stepbtn:hover .lb { color: var(--ms-primary-dark); text-decoration: underline; }
      .lease-os .lz-stepbtn[aria-expanded="true"] .lb { color: var(--ms-ink); }
      .lease-os .lz-phase { font-size: 9.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--ms-ink-3); margin: 6px 0 0 35px; }
      .lease-os .lz-step { margin-top: 10px; padding: 16px 18px; border: 1px solid var(--ms-border); border-radius: 12px; background: var(--ms-surface); box-shadow: var(--ms-shadow); display: flex; flex-direction: column; gap: 10px; color: var(--ms-ink-2); }
      .lease-os .lz-step-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .lease-os .lz-step-hd .ey { font-size: 9.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--ms-ink-3); }
      .lease-os .lz-step-hd h2 { font-size: 16px; font-weight: 700; color: var(--ms-ink); margin-top: 3px; letter-spacing: -.015em; }
      .lease-os .lz-step-body { font-size: 12.5px; line-height: 1.55; color: var(--ms-ink-2); margin: 0; }
      .lease-os .lz-step .action-body { display: flex; flex-direction: column; gap: 10px; }
      .lease-os .lz-extra { padding-top: 10px; border-top: 1px solid var(--ms-surface-3); }
      .lease-os .lz-extra-t { font-size: 11px; font-weight: 700; color: var(--ms-ink); margin-bottom: 6px; }
      .lease-os .lz-timing { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ms-ink-3); }
      .lease-os .lz-redo { align-self: flex-start; background: none; border: 0; padding: 0; cursor: pointer; font-size: 11.5px; font-weight: 700; color: var(--ms-danger); display: inline-flex; align-items: center; gap: 5px; }
      .lease-os .lz-redo:hover { text-decoration: underline; }
      .lease-os .gx-tl-t { font-weight: 700; }
      .lease-os .gx-tl-s { color: var(--ms-ink-3); }
      .lease-os .lz-upload { position: fixed; inset: 0; background: rgba(15,40,28,.35); display: grid; place-items: center; z-index: 9999; }
      .lease-os .lz-upload > div { background: var(--ms-surface); color: var(--ms-ink); border-radius: 12px; padding: 14px 20px; font-size: 13px; font-weight: 700; box-shadow: var(--ms-shadow-lg); }

      /* Reused legacy sections → kit metrics */
      .lease-os .lz-legacy .sec, .lease-os .lz-legacy.is-record .sec {
        background: var(--ms-surface); border: 1px solid var(--ms-border); border-radius: 12px; box-shadow: var(--ms-shadow); margin-bottom: 14px;
      }
      .lease-os .lz-legacy .sec .sech, .lease-os .lz-legacy.is-record .sec .sech { padding: 13px 18px; border-bottom: 1px solid var(--ms-surface-3); }
      .lease-os .lz-legacy .sec .sech .st, .lease-os .lz-legacy.is-record .sec .sech .st { font-size: 13.5px; font-weight: 700; color: var(--ms-ink); }
      .lease-os .lz-legacy .sec .sech .si { color: var(--ms-primary); }
      .lease-os .lz-legacy .sec .secb, .lease-os .lz-legacy.is-record .sec .secb { padding: 10px 14px 12px; }
      .lease-os .lz-legacy .ptable, .lease-os .lz-legacy.is-record .ptable { font-size: 11.5px; }
      .lease-os .lz-legacy .ptable th, .lease-os .lz-legacy.is-record .ptable th {
        font-size: 9.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--ms-ink-3);
        padding: 8px 11px; background: var(--ms-surface-2); border-bottom: 1px solid var(--ms-border);
      }
      .lease-os .lz-legacy .ptable td, .lease-os .lz-legacy.is-record .ptable td { padding: 8px 11px; border-bottom: 1px solid var(--ms-surface-3); }
      .lease-os .lz-legacy .ptable tbody tr:hover td { background: var(--ms-tint-pale); }
      .lease-os .lz-legacy .btn { height: 30px; padding: 0 12px; border-radius: 8px; font-size: 12px; font-weight: 600; gap: 6px; }
      .lease-os .lz-legacy .btn-jade { background: var(--ms-primary); color: #fff; }
      .lease-os .lz-legacy .btn-jade:hover:not(:disabled) { background: var(--ms-primary-dark); }
      .lease-os .lz-legacy .btn-ghost { border-color: var(--ms-border-strong); color: var(--ms-ink-2); }
      .lease-os .lz-legacy .btn-ghost:hover:not(:disabled) { border-color: var(--ms-primary); color: var(--ms-primary-dark); background: var(--ms-tint-pale); }
      .lease-os .lz-legacy .btn-brick { background: var(--ms-danger); }
      .lease-os .lz-legacy .pill { padding: 2.5px 8px; font-size: 10.5px; }
      .lease-os .lz-legacy .qbanner { border-radius: 12px; }
      .lease-os .lz-legacy .dbody-inline { gap: 14px; }
    `}</style>
  );
}
