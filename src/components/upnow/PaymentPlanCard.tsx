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
import { SegregatedPlanView, type PlanAttachSlot } from '@/components/upnow/SegregatedPlanView';
import { buildSegregatedPlan, rentDiscountFromAggregatePlan, segRowsFromOfferPlan, type RentDiscount, type SegPaymentInput } from '@/lib/segregatedPlan';

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
  /** Optional when `rows` are supplied directly (a lead's proposed plan has no
   *  OfferPlan to derive from — its rows come from the lead payment plan). */
  plan?: OfferPlan;
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
  /** Landlord's account — rendered under the plan when a row is paid by transfer. */
  bankDetails?: { accountName?: string | null; bankName?: string | null; iban?: string | null } | null;
  /** Rent discount to state on the Rental Income group ("Listed rent · Discount ·
   *  Net rent"). Derived from `plan` when omitted; a rows-only card (a lead's
   *  proposed plan) passes it explicitly. */
  rentDiscount?: RentDiscount | null;
  /** Extra control for the header (e.g. the customer's "Print / Save PDF"). */
  headerAction?: React.ReactNode;
  /** Per-payment attach control rendered inside the plan — see SegregatedPlanView.
   *  Only the customer passes this; every landlord-side card stays read-only. */
  renderAttach?: (slot: PlanAttachSlot) => React.ReactNode;
}

export function PaymentPlanCard({ plan, rows, refLabel, planRefNo, contractType, tenantName, landlordName, unitNumber, buildingName, community, periodStart, periodEnd, bankDetails, rentDiscount, headerAction, renderAttach }: PaymentPlanCardProps) {
  const dlRows = rows ?? (plan ? segRowsFromOfferPlan(plan) : []);
  const seg = buildSegregatedPlan(dlRows);
  const disc = rentDiscount ?? rentDiscountFromAggregatePlan(plan);
  if (disc) seg.rentDiscount = disc;
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {headerAction}
            {pill && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: pill.bg, color: pill.fg, whiteSpace: 'nowrap' }}>{pill.label}</span>}
          </div>
        </div>
        {(refLabel || planRefNo) && (
          <div style={{ fontSize: 12, color: '#6b6860', marginTop: 3 }}>
            {refLabel ? `Contract ${refLabel}` : null}
            {planRefNo && <>{refLabel ? ' · ' : ''}Plan ref <span style={{ fontWeight: 700, color: '#1a5a4a', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{planRefNo}</span></>}
          </div>
        )}
        {landlordName && (
          <div style={{ marginTop: 12, paddingBottom: 10, borderBottom: '1px solid #f0ece4' }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9b9890', marginBottom: 2 }}>Landlord</div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-.01em', color: '#1c1b17' }}>{landlordName}</div>
          </div>
        )}
        {(tenantName || periodStart) && (
          <div style={metaGrid(12)}>
            {tenantName && <div style={{ gridColumn: 1 }}><Meta label="Tenant" value={tenantName} /></div>}
            {periodStart && (
              <div style={{ gridColumn: 3 }}>
                <Meta
                  label="Contract period"
                  value={periodEnd ? `${fmtD(periodStart)} – ${fmtD(periodEnd)}` : `From ${fmtD(periodStart)}`}
                />
              </div>
            )}
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

      <PaymentPlanDownloadLink rows={dlRows} refLabel={refLabel} planRefNo={planRefNo} meta={{ contractType, tenantName, landlordName, buildingName, unitNumber, community, periodStart, periodEnd, bankDetails, rentDiscount: disc }} />

      <SegregatedPlanView plan={seg} bankDetails={bankDetails} renderAttach={renderAttach} style={{ padding: '6px 14px 14px' }} />
    </div>
  );
}
