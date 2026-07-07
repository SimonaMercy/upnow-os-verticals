'use client';

/**
 * PaymentPlanCard — the contract's CURRENT payment plan (rent, one-off fees,
 * security deposit + the cheque/instalment schedule) as an inline card. The
 * SINGLE source of truth for the on-screen plan, shared by:
 *   • the documents binder (ContractDocsBinder → the "View all" + landlord portal)
 *   • the contract detail / Operations view (ContractV2View → "Payment Plan" popup)
 * so the two never drift. A clean, watermark-free "Download PDF" (PaymentPlanPdf)
 * is offered inline. Money is in fils.
 */
import type { OfferPlan } from '@/components/upnow/OfferReceiptModal';
import { PaymentPlanDownloadLink } from '@/components/upnow/PaymentPlanPdf';
import ds from './ContractDocsBinder.module.css';

const aed = (fils: number) => `AED ${Math.round((fils ?? 0) / 100).toLocaleString('en-AE')}`;
const fmtD = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

const cardCss: React.CSSProperties = { border: '1px solid #e3e0d9', borderRadius: 12, overflow: 'hidden', marginBottom: 16, background: '#fff' };
const capCss: React.CSSProperties = { padding: '9px 13px', fontSize: 12.5, fontWeight: 700, color: '#1a1916', background: '#faf9f7', borderBottom: '1px solid #efece6' };

const PLAN_STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  cleared:   { label: 'Cleared',   bg: '#e6f5ee', fg: '#1f6f54' },
  bounced:   { label: 'Bounced',   bg: '#fdece7', fg: '#9a3520' },
  cancelled: { label: 'Cancelled', bg: '#f0ede8', fg: '#6b6860' },
};
const planStatus = (s?: string | null) => PLAN_STATUS[(s ?? '').toLowerCase()] ?? { label: 'Pending', bg: '#fff7ed', fg: '#c2410c' };

function PlanMeta({ label, value, align = 'left' }: { label: string; value?: string | null; align?: 'left' | 'right' }) {
  if (!value) return null;
  return (
    <div style={align === 'right' ? { marginLeft: 'auto', textAlign: 'right' } : undefined}>
      <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9b9890', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#1a1916' }}>{value}</div>
    </div>
  );
}

export interface PaymentPlanCardProps {
  plan: OfferPlan;
  refLabel?: string | null;
  /** Gapless RP plan reference (PP-<rp>-<year>-<nnnnn>) for bank reconciliation.
   *  Distinct from refLabel (the CID- display label). */
  planRefNo?: string | null;
  /** 'renewal' → "Renewal" badge; anything else → "New Lease". */
  contractType?: string | null;
  tenantName?: string | null;
  landlordName?: string | null;
  unitNumber?: string | null;
  buildingName?: string | null;
  community?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
}

export function PaymentPlanCard({ plan, refLabel, planRefNo, contractType, tenantName, landlordName, unitNumber, buildingName, community, periodStart, periodEnd }: PaymentPlanCardProps) {
  const typeBadge = contractType == null ? null
    : contractType === 'renewal'
      ? { label: 'Renewal', bg: '#eaf2fb', fg: '#1e5fae' }
      : { label: 'New Lease', bg: '#e6f5ee', fg: '#1f6f54' };
  const lines: { label: string; fils: number }[] = [
    { label: `Annual rent${(plan.rentVatFils ?? 0) > 0 ? ' (incl. VAT)' : ''}`, fils: plan.rentFils + (plan.rentVatFils ?? 0) },
  ];
  if (plan.adminFeeFils > 0) lines.push({ label: 'Admin fee', fils: plan.adminFeeFils + (plan.adminFeeVatFils ?? 0) });
  if (plan.ejariFils > 0) lines.push({ label: 'Ejari fee', fils: plan.ejariFils + (plan.ejariVatFils ?? 0) });
  if (plan.commissionFils > 0) lines.push({ label: 'Commission', fils: plan.commissionFils + (plan.commissionVatFils ?? 0) });
  (plan.customFees ?? []).forEach(f => lines.push({ label: f.label, fils: f.netFils + f.vatFils }));
  if (plan.securityDepositFils > 0) lines.push({ label: 'Security deposit', fils: plan.securityDepositFils });
  // By due date; on a same-date tie the security deposit sorts before the rent
  // installments (deposit is collected first, then the plan).
  const items = [...(plan.items ?? [])].sort((a, b) =>
    (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
    || (a.type === 'security_deposit' ? -1 : b.type === 'security_deposit' ? 1 : 0));
  return (
    <div style={cardCss}>
      <div style={{ ...capCss, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div>Payment plan</div>
          <div style={{ fontSize: 11, fontWeight: 500, color: '#6b6860', marginTop: 2 }}>current rent, fees &amp; deposit</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {planRefNo && (
            <span title="Payment plan reference — for bank reconciliation" style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6, background: '#eef4f2', color: '#1a5a4a', border: '1px solid #cfe3dc', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'nowrap' }}>{planRefNo}</span>
          )}
          {typeBadge && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: typeBadge.bg, color: typeBadge.fg, whiteSpace: 'nowrap' }}>{typeBadge.label}</span>
          )}
        </div>
      </div>
      <PaymentPlanDownloadLink plan={plan} refLabel={refLabel} planRefNo={planRefNo} meta={{ contractType, tenantName, landlordName, buildingName, unitNumber, community, periodStart, periodEnd }} />
      {(tenantName || landlordName || unitNumber || buildingName || community || periodStart) && (
        <div style={{ padding: '11px 14px 2px', display: 'grid', gap: 10 }}>
          {(tenantName || landlordName) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 28px', alignItems: 'flex-start' }}>
              <PlanMeta label="Tenant" value={tenantName} />
              <PlanMeta label="Landlord" align="right" value={landlordName} />
            </div>
          )}
          {(unitNumber || buildingName || community || periodStart) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 28px', alignItems: 'flex-start' }}>
              <PlanMeta label="Unit" value={unitNumber} />
              <PlanMeta label="Building" value={buildingName} />
              <PlanMeta label="Community" value={community} />
              <PlanMeta label="Contract period" align="right" value={periodStart ? `${fmtD(periodStart)} – ${fmtD(periodEnd)}` : null} />
            </div>
          )}
        </div>
      )}
      <div style={{ padding: '12px 14px', display: 'grid', gap: 5 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#334155' }}><span>{l.label}</span><span style={{ fontWeight: 600 }}>{aed(l.fils)}</span></div>
        ))}
        <div style={{ borderTop: '2px solid #c5e8df', margin: '4px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 800, color: '#15803d' }}><span>Total</span><span>{aed(plan.totalAmountFils)}</span></div>
      </div>
      {items.length > 0 && (
        <div style={{ borderTop: '1px solid #efece6', padding: '10px 14px 12px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9b9890', margin: '2px 0 8px' }}>Schedule · {plan.installmentCount} installment{plan.installmentCount === 1 ? '' : 's'}</div>
          {/* Grid (not a <table>): a row per installment on desktop, a two-line
              card per installment on mobile — see ContractDocsBinder.module.css. */}
          <div className={ds.sched}>
            <div className={`${ds.schedRow} ${ds.schedHead}`}>
              <span className={ds.cNum}>#</span>
              <span className={ds.cDesc}>Description</span>
              <span className={ds.cDue}>Due date</span>
              <span className={ds.cStatus}>Status</span>
              <span className={ds.cAmt}>Amount</span>
            </div>
            {items.map((it, i) => {
              const st = planStatus(it.status);
              return (
                <div key={it.index ?? i} className={ds.schedRow} style={{ background: i % 2 ? '#faf9f6' : '#fff' }}>
                  <span className={ds.cNum}><span className={ds.schedBadge}>{i + 1}</span></span>
                  <span className={ds.cDesc} style={{ color: '#1a1916' }}>{it.description ?? `Payment ${i + 1}`}</span>
                  <span className={ds.cDue} style={{ color: '#6b6860' }}>{fmtD(it.dueDate)}</span>
                  <span className={ds.cStatus}><span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: st.bg, color: st.fg, whiteSpace: 'nowrap' }}>{st.label}</span></span>
                  <span className={ds.cAmt} style={{ fontWeight: 700, color: '#1a1916' }}>{aed(it.amountFils)}</span>
                </div>
              );
            })}
            <div className={ds.schedTotal}>
              <span>Schedule total</span>
              <span className={ds.schedTotalAmt}>{aed(items.reduce((s, it) => s + (it.amountFils ?? 0), 0))}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
