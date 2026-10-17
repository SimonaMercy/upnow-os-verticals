'use client';

/**
 * SegregatedPlanView — the ONE on-screen renderer for a segregated payment plan:
 * the four groups (Security Deposit · Rental Income · Management Fee · Third Party)
 * as colour-railed section tables + a Grand Total. Feed it a SegregatedPlan built
 * by lib/segregatedPlan.buildSegregatedPlan (from ANY data model via the adapters
 * there), and it renders identically everywhere — the contract card, the customer
 * proposal, the lead offer, the renewal review, the creation preview, etc.
 *
 * This is the on-screen twin of SegregatedSections (the react-pdf renderer); both
 * consume the same SegregatedPlan so screen and PDF never drift.
 */
import { paymentRefLabel, SEG_COLORS, type SegregatedPlan } from '@/lib/segregatedPlan';

const aed = (v: number) => (Number.isFinite(v) ? v : 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const METHOD_LABEL: Record<string, string> = {
  cheque: 'Cheque', bank_transfer: 'Bank transfer', card: 'Card', cash: 'Cash', online: 'Online',
};
const fmtD = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function thCss(width: number): React.CSSProperties {
  return { width: `${width}%`, fontSize: 9, letterSpacing: '.05em', textTransform: 'uppercase', color: '#8a948d', fontWeight: 700, textAlign: 'left', padding: '7px 10px 5px', borderBottom: '1px solid #f0ece4', whiteSpace: 'nowrap' };
}
const tdCss: React.CSSProperties = { padding: '6px 10px', fontSize: 12, borderBottom: '1px solid #f4f1ea', verticalAlign: 'middle' };

/** One payable thing the customer can attach a reference to. `label` is the
 *  stable identity of the slot — it is what the upload is tagged with, so it
 *  must not change shape once references exist against it. */
export interface PlanAttachSlot {
  key: string;
  label: string;
  amount: number;
  dueDate: string | null;
}

export function SegregatedPlanView({ plan, style, bankDetails, renderAttach }: {
  plan: SegregatedPlan;
  style?: React.CSSProperties;
  /** The landlord's account, as snapshotted on the plan. Rendered only when a
   *  row is actually paid by transfer — a plan of cheques has no use for it. */
  bankDetails?: { accountName?: string | null; bankName?: string | null; iban?: string | null } | null;
  /**
   * Optional attach control, rendered INSIDE the plan so the customer answers
   * each payment where they read it — instead of against a second, re-derived
   * list of the same payments printed underneath.
   *
   * Rental Income is settled instalment by instalment, so every LINE gets its
   * own control. The other groups are a single payment each, so theirs sits in
   * the group HEADING rather than repeating identically down the table.
   *
   * Omitted (landlord / manager / contract views) → the plan renders exactly as
   * before, read-only.
   */
  renderAttach?: (slot: PlanAttachSlot) => React.ReactNode;
}) {
  // The Payment Ref column only earns its place once a real cheque/transfer ref exists
  // (contract, receipts). On proposals/previews every line is blank, so it's dropped and
  // the remaining columns widen — no dead "—" column.
  const showRef = plan.groups.some(g => g.lines.some(l => !!l.chequeNo));
  // "Paid by" appears once the landlord has actually chosen how a line is paid.
  // On a plan that never set one, the column would say "Cheque" everywhere by
  // assumption — so it stays hidden rather than asserting something nobody chose.
  const showMethod = plan.groups.some(g => g.lines.some(l => !!l.method));
  const hasTransfer = plan.groups.some(g => g.lines.some(l => l.method === 'bank_transfer'));
  const bank = bankDetails?.accountName || bankDetails?.bankName || bankDetails?.iban ? bankDetails : null;
  const wItem = showRef ? (showMethod ? 28 : 34) : (showMethod ? 40 : 52);
  const wDue = showRef ? 20 : (showMethod ? 22 : 26);
  const wAmt = showRef ? 16 : 22;
  return (
    <div style={style}>
      {plan.groups.map(g => {
        const c = SEG_COLORS[g.key];
        // Rental Income is paid instalment by instalment → attach per ROW.
        // Deposit / Management Fee / Third Party are one payment each → the
        // control belongs in the heading, not repeated down an identical column.
        const perLineAttach = !!renderAttach && g.key === 'rental';
        const headAttach = renderAttach && g.key !== 'rental'
          ? renderAttach({ key: g.key, label: g.title, amount: g.total, dueDate: g.lines.map(l => l.dueDate).filter((d): d is string => !!d).sort().pop() ?? null })
          : null;
        // Squeeze the data columns to make room for the attach column, which has
        // to hold View + Replace + delete — at a narrower share the trash icon
        // was clipped off the edge of the table. PlanAttachCell wraps onto a
        // second line when even this share is tight, which is why the min-width
        // below can sit under the one-line ideal.
        const ATTACH_COL = 31;
        const k = perLineAttach ? (100 - ATTACH_COL) / 100 : 1;
        const w = (n: number) => Math.round(n * k);
        return (
          <div key={g.key} style={{ marginTop: 10, border: '1px solid #e7e2d9', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '7px 12px', borderLeft: `3px solid ${c.accent}`, background: c.tint }}>
              <div style={{ minWidth: 0 }}>
                {/* A discounted rent is flagged in the heading: a small red tag. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 750, letterSpacing: '-.01em' }}>{g.title}</span>
                  {g.key === 'rental' && plan.rentDiscount && (
                    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#b91c1c', background: '#fdede7', border: '1px solid #f3cabb', borderRadius: 999, padding: '2px 8px', lineHeight: 1.3 }}>Discounted</span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                {/* "payments", not "cheques" — a plan can mix transfers and cheques. */}
                {g.key === 'rental' && g.lines.length > 1 && <span style={{ fontSize: 10.5, fontWeight: 600, color: '#8a948d' }}>{g.lines.length} payments</span>}
                {headAttach}
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              {/* 560 overflowed the customer's ~478px card, and the overflow is
                  exactly the attach column — so the per-row control existed but
                  sat off-screen behind a scrollbar nobody notices, reading as
                  "no attach option on the rent rows". Only customer surfaces
                  pass renderAttach (landlord cards are read-only), so the lower
                  minimum applies solely where it was breaking. */}
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: perLineAttach ? 430 : 380 }}>
                <thead>
                  <tr>
                    <th style={thCss(w(wItem))}>Item</th>
                    {showRef && <th style={thCss(w(30))}>Payment Ref</th>}
                    {showMethod && <th style={thCss(w(16))}>Paid by</th>}
                    <th style={thCss(w(wDue))}>Due date</th>
                    <th style={{ ...thCss(w(wAmt)), textAlign: 'right' }}>Amount</th>
                    {perLineAttach && <th style={{ ...thCss(ATTACH_COL), textAlign: 'right' }}>Attachment</th>}
                  </tr>
                </thead>
                <tbody>
                  {g.lines.map((l, i) => (
                    <tr key={i}>
                      <td style={{ ...tdCss, fontWeight: 600 }}>{l.item}</td>
                      {showRef && <td style={{ ...tdCss, color: '#5f6b63', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 }}>{paymentRefLabel(l.chequeNo, l.method)}</td>}
                      {showMethod && <td style={{ ...tdCss, color: '#5f6b63' }}>{METHOD_LABEL[l.method ?? ''] ?? '—'}</td>}
                      <td style={{ ...tdCss, color: '#5f6b63' }}>{fmtD(l.dueDate)}</td>
                      <td style={{ ...tdCss, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{aed(l.amount)}</td>
                      {perLineAttach && (
                        <td style={{ ...tdCss, textAlign: 'right' }}>
                          {renderAttach!({ key: `rent-${i}`, label: `Rent — ${l.item}`, amount: l.amount, dueDate: l.dueDate })}
                        </td>
                      )}
                    </tr>
                  ))}
                  {/* A discounted rent reconciles inside its own section, the way a
                      proforma does: rent as listed, less the discount, equals the
                      section total the instalments add up to. Nothing is deducted
                      again at the foot, so the sections always sum to Total Payable. */}
                  {g.key === 'rental' && plan.rentDiscount && (
                    <>
                      <tr>
                        <td colSpan={2 + (showRef ? 1 : 0) + (showMethod ? 1 : 0)} style={{ ...tdCss, borderTop: `1.5px solid ${c.accent}55`, borderBottom: 0, background: '#f6f8f6', fontSize: 11.5, fontWeight: 600, color: '#5f6b63' }}>Rental amount</td>
                        <td style={{ ...tdCss, borderTop: `1.5px solid ${c.accent}55`, borderBottom: 0, background: '#f6f8f6', textAlign: 'right', fontWeight: 700, color: '#5f6b63', fontVariantNumeric: 'tabular-nums' }}>{aed(plan.rentDiscount.listedRent)}</td>
                        {perLineAttach && <td style={{ ...tdCss, borderTop: `1.5px solid ${c.accent}55`, borderBottom: 0, background: '#f6f8f6' }} />}
                      </tr>
                      <tr>
                        <td colSpan={2 + (showRef ? 1 : 0) + (showMethod ? 1 : 0)} style={{ ...tdCss, borderBottom: 0, background: '#f6f8f6', fontSize: 11.5, fontWeight: 600, color: '#b91c1c' }}>Discount{plan.rentDiscount.discountType === 'percent' && plan.rentDiscount.discountPercent ? ` (${plan.rentDiscount.discountPercent}%)` : ''}</td>
                        <td style={{ ...tdCss, borderBottom: 0, background: '#f6f8f6', textAlign: 'right', fontWeight: 700, color: '#b91c1c', fontVariantNumeric: 'tabular-nums' }}>- {aed(plan.rentDiscount.discountAmount)}</td>
                        {perLineAttach && <td style={{ ...tdCss, borderBottom: 0, background: '#f6f8f6' }} />}
                      </tr>
                    </>
                  )}
                  {(g.lines.length > 1 || (g.key === 'rental' && !!plan.rentDiscount)) && (
                    <tr>
                      {/* Span every column except Amount, whatever the optional
                          columns add up to — otherwise the total drifts left out
                          of the Amount column it is supposed to sum. */}
                      <td colSpan={2 + (showRef ? 1 : 0) + (showMethod ? 1 : 0)} style={{ ...tdCss, borderTop: `1.5px solid ${c.accent}55`, borderBottom: 0, fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#5f6b63' }}>{g.key === 'rental' && plan.rentDiscount ? 'Net rent · Total' : 'Total'}</td>
                      <td style={{ ...tdCss, borderTop: `1.5px solid ${c.accent}55`, borderBottom: 0, textAlign: 'right', fontWeight: 800, color: c.accent, fontVariantNumeric: 'tabular-nums' }}>{aed(g.total)}</td>
                      {perLineAttach && <td style={{ ...tdCss, borderTop: `1.5px solid ${c.accent}55`, borderBottom: 0 }} />}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      <div style={{ marginTop: 14, padding: '11px 14px', borderRadius: 10, background: '#eef2f0', border: '1px solid #cfdcd6' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#5f6b63' }}>Total Payable</span>
          <span style={{ fontSize: 17, fontWeight: 800, color: '#0f4f36', fontVariantNumeric: 'tabular-nums' }}>AED {aed(plan.grandTotal)}</span>
        </div>
      </div>
      {/* Where the transfers go. The cheque payee is not repeated — it is the
          landlord, already named at the top of the summary. */}
      {hasTransfer && bank && (
        <div style={{ marginTop: 10, padding: '11px 14px', borderRadius: 10, border: '1px solid #e7e2d9', background: '#f6f8f6' }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#5f6b63', marginBottom: 6 }}>
            Bank transfer to
          </div>
          {/* Two rows: account name + bank, then the IBAN on its own line so the
              long number never has to wrap inside half a column. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px', fontSize: 12 }}>
            {bank.accountName && (
              <div><div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#8a948d' }}>Account name</div><div style={{ fontWeight: 700 }}>{bank.accountName}</div></div>
            )}
            {bank.bankName && (
              <div><div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#8a948d' }}>Bank</div><div style={{ fontWeight: 700 }}>{bank.bankName}</div></div>
            )}
            {bank.iban && (
              <div style={{ gridColumn: '1 / -1' }}><div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#8a948d' }}>IBAN</div><div style={{ fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{bank.iban}</div></div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
