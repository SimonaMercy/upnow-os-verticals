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
  grand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: '#cfdcd6', backgroundColor: '#eef2f0' },
  grandLab: { fontSize: 8.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: MUTE },
  grandVal: { fontSize: 13, fontWeight: 700, color: '#1a5a4a' },
});

export function SegregatedSections({ plan }: { plan: SegregatedPlan }) {
  return (
    <View>
      {plan.groups.map((g) => {
        const c = SEG_COLORS[g.key];
        return (
          <View key={g.key} style={s.group} wrap={false}>
            <View style={[s.head, { borderLeftColor: c.accent, backgroundColor: c.tint }]}>
              <Text style={s.name}>{g.title}</Text>
              {g.key === 'rental' && g.lines.length > 1
                ? <Text style={s.count}>{g.lines.length} cheques</Text>
                : null}
            </View>
            <View style={s.thead}>
              <Text style={[s.th, { width: '34%' }]}>Item</Text>
              <Text style={[s.th, { width: '30%' }]}>Payment Ref</Text>
              <Text style={[s.th, { width: '20%' }]}>Due date</Text>
              <Text style={[s.th, { width: '16%', textAlign: 'right' }]}>Amount</Text>
            </View>
            {g.lines.map((l, i) => (
              <View key={i} style={s.row}>
                <Text style={s.cItem}>{l.item}</Text>
                <Text style={s.cRef}>{paymentRefLabel(l.chequeNo, l.method)}</Text>
                <Text style={s.cDue}>{fmtDate(l.dueDate)}</Text>
                <Text style={s.cAmt}>{aed(l.amount)}</Text>
              </View>
            ))}
            {/* Single-line groups don't repeat a total that just restates the line. */}
            {g.lines.length > 1 ? (
              <View style={[s.totalRow, { borderTopColor: c.accent }]}>
                <Text style={[s.totalLab, { width: '84%' }]}>Total</Text>
                <Text style={[s.cAmt, { width: '16%', color: c.accent }]}>{aed(g.total)}</Text>
              </View>
            ) : null}
          </View>
        );
      })}
      <View style={s.grand}>
        <Text style={s.grandLab}>Grand Total</Text>
        <Text style={s.grandVal}>AED {aed(plan.grandTotal)}</Text>
      </View>
    </View>
  );
}
