'use client';

/**
 * PaymentPlanCard — the contract's CURRENT payment plan as an on-screen card,
 * rendered as the FOUR segregated groups (Security Deposit · Rental Income ·
 * Management Fee · Third Party) so it matches the Payment Plan PDF exactly. The
 * SINGLE source of truth for the on-screen plan, shared by:
 *   • the documents binder (ContractDocsBinder → the "View all" + landlord portal)
 *   • the contract detail / Operations view (ContractV2View → "Payment Plan" popup)
 * A clean, watermark-free "Download PDF" (PaymentPlanPdf) is offered inline.
 *
 * Grouping (incl. the Ejari 172.50 split and per-section due dates) comes from
 * lib/segregatedPlan.buildSegregatedPlan — the same builder the PDF uses.
 */
import type { OfferPlan } from '@/components/upnow/OfferReceiptModal';
import { PaymentPlanDownloadLink } from '@/components/upnow/PaymentPlanPdf';
import { SegregatedPlanView } from '@/components/upnow/SegregatedPlanView';
import { buildSegregatedPlan, segRowsFromOfferPlan, type SegPaymentInput } from '@/lib/segregatedPlan';

const fmtD = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

const cardCss: React.CSSProperties = { border: '1px solid #e7e2d9', borderRadius: 14, overflow: 'hidden', marginBottom: 16, background: '#fff', color: '#1c1b17' };

/** 3-column meta grid so Tenant/Unit align in col 1, Building in col 2, and
 *  Contract period/Community align in col 3 (no more scattered flex items). */
const metaGrid = (marginTop: number): React.CSSProperties => ({ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px 20px', marginTop });

function Meta({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9b9890', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 650, color: '#1c1b17' }}>{value}</div>
    </div>
  );
}

export interface PaymentPlanCardProps {
  plan: OfferPlan;
  /** Raw payment/fee rows for the segregated view (carries cheque numbers). Falls
   *  back to deriving from `plan.items` when omitted. */
  rows?: SegPaymentInput[];
  refLabel?: string | null;
  /** Gapless RP plan reference (PP-<rp>-<year>-<nnnnn>) for bank reconciliation. */
  planRefNo?: string | null;
  /** 'renewal' → "Renewal" pill; anything else → "New Lease". */
  contractType?: string | null;
  tenantName?: string | null;
  landlordName?: string | null;
  unitNumber?: string | null;
  buildingName?: string | null;
  community?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
}

export function PaymentPlanCard({ plan, rows, refLabel, planRefNo, contractType, tenantName, landlordName, unitNumber, buildingName, community, periodStart, periodEnd }: PaymentPlanCardProps) {
  const dlRows = rows ?? segRowsFromOfferPlan(plan);
  const seg = buildSegregatedPlan(dlRows);
  const isRenewal = (contractType ?? '').toLowerCase() === 'renewal';
  const pill = contractType == null ? null
    : isRenewal ? { label: 'Renewal', bg: '#eaf2fb', fg: '#1e5fae' }
    : { label: 'New Lease', bg: '#e6f5ee', fg: '#1f6f54' };

  return (
    <div style={cardCss}>
      {/* Header */}
      <div style={{ padding: '16px 16px 14px', borderBottom: '1px solid #efece6' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-.01em', color: '#1a5a4a' }}>Payment Summary</div>
          {pill && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: pill.bg, color: pill.fg, whiteSpace: 'nowrap' }}>{pill.label}</span>}
        </div>
        <div style={{ fontSize: 12, color: '#6b6860', marginTop: 3 }}>
          {refLabel ? `Contract ${refLabel}` : 'Payment plan'}
          {planRefNo && <> · Plan ref <span style={{ fontWeight: 700, color: '#1a5a4a', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{planRefNo}</span></>}
        </div>
        {landlordName && (
          <div style={{ marginTop: 12, paddingBottom: 10, borderBottom: '1px solid #f0ece4' }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9b9890', marginBottom: 2 }}>Landlord</div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-.01em', color: '#1c1b17' }}>{landlordName}</div>
          </div>
        )}
        {(tenantName || periodStart) && (
          <div style={metaGrid(12)}>
            {tenantName && <div style={{ gridColumn: 1 }}><Meta label="Tenant" value={tenantName} /></div>}
            {periodStart && <div style={{ gridColumn: 3 }}><Meta label="Contract period" value={`${fmtD(periodStart)} – ${fmtD(periodEnd)}`} /></div>}
          </div>
        )}
        {(unitNumber || buildingName || community) && (
          <div style={metaGrid(10)}>
            {unitNumber && <div style={{ gridColumn: 1 }}><Meta label="Unit" value={unitNumber} /></div>}
            {buildingName && <div style={{ gridColumn: 2 }}><Meta label="Building" value={buildingName} /></div>}
            {community && <div style={{ gridColumn: 3 }}><Meta label="Community" value={community} /></div>}
          </div>
        )}
      </div>

      <PaymentPlanDownloadLink rows={dlRows} refLabel={refLabel} planRefNo={planRefNo} meta={{ contractType, tenantName, landlordName, buildingName, unitNumber, community, periodStart, periodEnd }} />

      <SegregatedPlanView plan={seg} style={{ padding: '6px 14px 14px' }} />
    </div>
  );
}
