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
const fmtD = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function thCss(width: number): React.CSSProperties {
  return { width: `${width}%`, fontSize: 9, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9b9890', fontWeight: 700, textAlign: 'left', padding: '7px 10px 5px', borderBottom: '1px solid #f0ece4', whiteSpace: 'nowrap' };
}
const tdCss: React.CSSProperties = { padding: '6px 10px', fontSize: 12, borderBottom: '1px solid #f4f1ea', verticalAlign: 'middle' };

export function SegregatedPlanView({ plan, style }: { plan: SegregatedPlan; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      {plan.groups.map(g => {
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
        <span style={{ fontSize: 17, fontWeight: 800, color: '#1a5a4a', fontVariantNumeric: 'tabular-nums' }}>AED {aed(plan.grandTotal)}</span>
      </div>
    </div>
  );
}
