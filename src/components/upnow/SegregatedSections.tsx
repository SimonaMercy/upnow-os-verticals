/**
 * SegregatedSections — the shared @react-pdf/renderer block that draws a contract's
 * money as the four segregated groups (Security Deposit · Rental Income · Management
 * Fee · Third Party). Rendered identically on the Payment Plan document AND the
 * payment Receipt so the two always match. Fed by lib/segregatedPlan.buildSegregatedPlan.
 *
 * Each group is a bordered card with a colour-coded left rail, a per-section total,
 * and a compact Item · Payment Ref · Due date · Amount table. A Grand Total bar
 * closes the block. Empty groups are already dropped upstream.
 */
'use client';

import React from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { paymentRefLabel, SEG_COLORS, type SegregatedPlan } from '@/lib/segregatedPlan';

const INK = '#1c1b17';
const MUTE = '#6b6860';
const FAINT = '#9b9890';
const HAIR = '#e7e2d9';
const HAIR_SOFT = '#f0ece4';
const TOTAL = '#15803d';

const aed =(v: number) => (Number.isFinite(v) ? v : 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d?: string | null) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
};

const s = StyleSheet.create({
  group: { marginTop: 8, borderWidth: 1, borderColor: HAIR, borderRadius: 6, overflow: 'hidden' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, paddingHorizontal: 9, borderLeftWidth: 3 },
  name: { fontSize: 10, fontWeight: 700, color: INK },
  count: { fontSize: 7.5, color: FAINT },
  thead: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 9, borderBottomWidth: 1, borderBottomColor: HAIR_SOFT },
  th: { fontSize: 6.5, color: FAINT, letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: 700 },
  row: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 9, borderBottomWidth: 0.5, borderBottomColor: HAIR_SOFT },
  cItem: { width: '34%', fontSize: 8.5, color: INK, fontWeight: 500 },
  cRef: { width: '30%', fontSize: 8, color: MUTE },
  cDue: { width: '20%', fontSize: 8, color: MUTE },
  cAmt: { width: '16%', fontSize: 8.5, textAlign: 'right', fontWeight: 700, color: INK },
  totalRow: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 9, borderTopWidth: 1 },
  totalLab: { fontSize: 7, letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: 700, color: MUTE },
  discTag: { marginLeft: 6, fontSize: 6.5, fontWeight: 700, letterSpacing: 0.5, color: '#b91c1c', backgroundColor: '#fdede7', borderWidth: 0.5, borderColor: '#f3cabb', borderRadius: 6, paddingVertical: 1.5, paddingHorizontal: 5 },
  grandBox: { marginTop: 12, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: '#cfdcd6', backgroundColor: '#eef2f0' },
  recRow: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 9, backgroundColor: '#fafaf8' },
  recLab: { fontSize: 8, fontWeight: 500, color: MUTE },
  grand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grandLab: { fontSize: 8.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: MUTE },
  grandVal: { fontSize: 13, fontWeight: 700, color: '#1a5a4a' },
});

const METHOD_LABEL: Record<string, string> = {
  cheque: 'Cheque', bank_transfer: 'Bank transfer', card: 'Card', cash: 'Cash', online: 'Online',
};

export function SegregatedSections({ plan }: { plan: SegregatedPlan }) {
  // Match the on-screen view: the Payment Ref column shows only when a real cheque/
  // transfer ref exists (contract, receipts); on proposals it's dropped and the other
  // columns widen so there's no dead "—" column.
  const showRef = plan.groups.some(g => g.lines.some(l => !!l.chequeNo));
  // "Paid by" mirrors the on-screen view: shown once the landlord has actually
  // chosen how a line is paid, so the PDF states it rather than implying cheques.
  const showMethod = plan.groups.some(g => g.lines.some(l => !!l.method));
  const wMethod = '16%';
  const wItem = showRef ? (showMethod ? '28%' : '34%') : (showMethod ? '40%' : '52%');
  const wDue = showRef ? '20%' : (showMethod ? '22%' : '26%');
  const wAmt = showRef ? '16%' : '22%';
  const wTotalLab = showRef ? (showMethod ? '84%' : '84%') : (showMethod ? '78%' : '78%');
  return (
    <View>
      {plan.groups.map((g) => {
        const c = SEG_COLORS[g.key];
        return (
          <View key={g.key} style={s.group} wrap={false}>
            <View style={[s.head, { borderLeftColor: c.accent, backgroundColor: c.tint }]}>
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={s.name}>{g.title}</Text>
                  {g.key === 'rental' && plan.rentDiscount
                    ? <Text style={s.discTag}>DISCOUNTED</Text>
                    : null}
                </View>
              </View>
              {g.key === 'rental' && g.lines.length > 1
                ? <Text style={s.count}>{g.lines.length} payments</Text>
                : null}
            </View>
            <View style={s.thead}>
              <Text style={[s.th, { width: wItem }]}>Item</Text>
              {showRef ? <Text style={[s.th, { width: '30%' }]}>Payment Ref</Text> : null}
              {showMethod ? <Text style={[s.th, { width: wMethod }]}>Paid by</Text> : null}
              <Text style={[s.th, { width: wDue }]}>Due date</Text>
              <Text style={[s.th, { width: wAmt, textAlign: 'right' }]}>Amount</Text>
            </View>
            {g.lines.map((l, i) => (
              <View key={i} style={s.row}>
                <Text style={[s.cItem, { width: wItem }]}>{l.item}</Text>
                {showRef ? <Text style={s.cRef}>{paymentRefLabel(l.chequeNo, l.method)}</Text> : null}
                {showMethod ? <Text style={[s.cDue, { width: wMethod }]}>{METHOD_LABEL[l.method ?? ''] ?? '—'}</Text> : null}
                <Text style={[s.cDue, { width: wDue }]}>{fmtDate(l.dueDate)}</Text>
                <Text style={[s.cAmt, { width: wAmt }]}>{aed(l.amount)}</Text>
              </View>
            ))}
            {/* Same reconciliation as on screen: rent as listed, less the
                discount, equals the section total the instalments add up to. */}
            {g.key === 'rental' && plan.rentDiscount ? (
              <>
                <View style={[s.recRow, { borderTopWidth: 1, borderTopColor: c.accent }]}>
                  <Text style={[s.recLab, { width: wTotalLab }]}>Rental amount</Text>
                  <Text style={[s.cAmt, { width: wAmt, color: MUTE }]}>{aed(plan.rentDiscount.listedRent)}</Text>
                </View>
                <View style={s.recRow}>
                  <Text style={[s.recLab, { width: wTotalLab, color: '#b91c1c' }]}>Discount{plan.rentDiscount.discountType === 'percent' && plan.rentDiscount.discountPercent ? ` (${plan.rentDiscount.discountPercent}%)` : ''}</Text>
                  <Text style={[s.cAmt, { width: wAmt, color: '#b91c1c' }]}>- {aed(plan.rentDiscount.discountAmount)}</Text>
                </View>
              </>
            ) : null}
            {/* Single-line groups don't repeat a total that just restates the line. */}
            {g.lines.length > 1 || (g.key === 'rental' && plan.rentDiscount) ? (
              <View style={[s.totalRow, { borderTopColor: c.accent }]}>
                <Text style={[s.totalLab, { width: wTotalLab }]}>{g.key === 'rental' && plan.rentDiscount ? 'Net rent · Total' : 'Total'}</Text>
                <Text style={[s.cAmt, { width: wAmt, color: c.accent }]}>{aed(g.total)}</Text>
              </View>
            ) : null}
          </View>
        );
      })}
      <View style={s.grandBox}>
        <View style={s.grand}>
          <Text style={s.grandLab}>Total Payable</Text>
          <Text style={s.grandVal}>AED {aed(plan.grandTotal)}</Text>
        </View>
      </View>
    </View>
  );
}
