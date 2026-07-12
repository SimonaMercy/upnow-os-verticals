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
import { buildSegregatedPlan, paymentRefLabel, SEG_COLORS, type SegPaymentInput } from '@/lib/segregatedPlan';

const aed = (v: number) => (Number.isFinite(v) ? v : 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtD = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** Fallback rows for the segregated view when the caller can't supply the raw
 *  payment rows (e.g. the Operations popup only has the OfferPlan). Amounts/dates
 *  are exact; cheque numbers aren't available from the OfferPlan (shown as "—"). */
function rowsFromOfferItems(plan: OfferPlan): SegPaymentInput[] {
  return (plan.items ?? []).map(it => ({
    paymentType: it.paymentType ?? null,
    description: it.description ?? null,
    amount: (it.amountFils ?? 0) / 100,
    vatAmount: (it.vatFils ?? 0) / 100,
    chequeNumber: null,
    transactionDate: it.dueDate ?? null,
    chequeStatus: it.status ?? null,
  }));
}

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
  const dlRows = rows ?? rowsFromOfferItems(plan);
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

      {/* Segregated sections */}
      <div style={{ padding: '6px 14px 14px' }}>
        {seg.groups.map(g => {
          const c = SEG_COLORS[g.key];
          return (
            <div key={g.key} style={{ marginTop: 10, border: '1px solid #e7e2d9', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 12px', borderLeft: `3px solid ${c.accent}`, background: c.tint }}>
                <span style={{ fontSize: 13.5, fontWeight: 750, letterSpacing: '-.01em' }}>{g.title}</span>
                {g.key === 'rental' && g.lines.length > 1 && <span style={{ fontSize: 10.5, fontWeight: 600, color: '#9b9890' }}>{g.lines.length} cheques</span>}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 380 }}>
                  <thead>
                    <tr>
                      <th style={thCss(34)}>Item</th>
                      <th style={thCss(30)}>Payment Ref</th>
                      <th style={thCss(20)}>Due date</th>
                      <th style={{ ...thCss(16), textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.lines.map((l, i) => (
                      <tr key={i}>
                        <td style={{ ...tdCss, fontWeight: 600 }}>{l.item}</td>
                        <td style={{ ...tdCss, color: '#6b6860', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 }}>{paymentRefLabel(l.chequeNo, l.method)}</td>
                        <td style={{ ...tdCss, color: '#6b6860' }}>{fmtD(l.dueDate)}</td>
                        <td style={{ ...tdCss, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{aed(l.amount)}</td>
                      </tr>
                    ))}
                    {g.lines.length > 1 && (
                      <tr>
                        <td colSpan={3} style={{ ...tdCss, borderTop: `1.5px solid ${c.accent}55`, borderBottom: 0, fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#6b6860' }}>Total</td>
                        <td style={{ ...tdCss, borderTop: `1.5px solid ${c.accent}55`, borderBottom: 0, textAlign: 'right', fontWeight: 800, color: c.accent, fontVariantNumeric: 'tabular-nums' }}>{aed(g.total)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, padding: '11px 14px', borderRadius: 10, background: '#eef2f0', border: '1px solid #cfdcd6' }}>
          <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#6b6860' }}>Grand Total</span>
          <span style={{ fontSize: 17, fontWeight: 800, color: '#1a5a4a', fontVariantNumeric: 'tabular-nums' }}>AED {aed(seg.grandTotal)}</span>
        </div>
      </div>
    </div>
  );
}

function thCss(width: number): React.CSSProperties {
  return { width: `${width}%`, fontSize: 9, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9b9890', fontWeight: 700, textAlign: 'left', padding: '7px 10px 5px', borderBottom: '1px solid #f0ece4', whiteSpace: 'nowrap' };
}
const tdCss: React.CSSProperties = { padding: '6px 10px', fontSize: 12, borderBottom: '1px solid #f4f1ea', verticalAlign: 'middle' };
