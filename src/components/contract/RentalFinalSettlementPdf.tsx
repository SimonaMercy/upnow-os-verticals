/**
 * RENTAL FINAL SETTLEMENT — react-pdf document. A vector PDF mirroring the
 * on-screen 9-section statement (RentalFinalSettlementDoc): §1 details,
 * §2 payment history, §3–§5 charge columns, §6/§7 reconciliation, §9 signatures.
 * Fed the same RFSData the screen doc uses.
 */
'use client';

import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import type { RFSData } from './RentalFinalSettlementDoc';

const money = (n: number | null | undefined) =>
  (n == null ? 0 : n).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d?: string | null) => {
  if (!d) return '—';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '—' : t.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const sumNet = (lines: RFSData['lines'], cats: string[]) =>
  r2(lines.filter(l => cats.includes(l.category)).reduce((a, l) => a + (l.net ?? l.amount ?? 0), 0));

const GREEN = '#1f6b4f';
const RED = '#b91c1c';
const s = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 36, paddingHorizontal: 28, fontSize: 8, color: '#1a1916', fontFamily: 'Helvetica' },
  // header
  landlordLabel: { fontSize: 7, color: '#6b6860', textTransform: 'uppercase', letterSpacing: 0.6 },
  landlord: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: GREEN, textTransform: 'uppercase' },
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold', textAlign: 'center', marginTop: 6 },
  subtitle: { fontSize: 8, color: '#9b9890', textAlign: 'center', marginTop: 1 },
  headRule: { borderBottomWidth: 2, borderBottomColor: GREEN, marginTop: 8, marginBottom: 10 },
  // section header bar
  secHead: { flexDirection: 'row', alignItems: 'center', backgroundColor: GREEN, borderTopLeftRadius: 3, borderTopRightRadius: 3, paddingVertical: 3, paddingHorizontal: 5 },
  secBadge: { width: 11, height: 11, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', color: '#fff', fontSize: 7, fontFamily: 'Helvetica-Bold', textAlign: 'center', paddingTop: 1.5, marginRight: 4 },
  secTitle: { color: '#fff', fontSize: 8, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.4 },
  box: { borderWidth: 1, borderColor: '#e8e6e0', borderRadius: 3, marginBottom: 8 },
  // §1 fields
  fieldWrap: { flexDirection: 'row', flexWrap: 'wrap', padding: 6 },
  field: { width: '25%', paddingHorizontal: 3, paddingVertical: 3 },
  fieldLabel: { fontSize: 6.5, color: '#9b9890', textTransform: 'uppercase', letterSpacing: 0.3 },
  fieldVal: { fontSize: 8.5, marginTop: 1.5, borderWidth: 1, borderColor: '#e8e6e0', borderRadius: 2, paddingVertical: 2.5, paddingHorizontal: 3 },
  fieldValAccent: { borderColor: '#c5e8df', backgroundColor: '#f0faf6', fontFamily: 'Helvetica-Bold' },
  // §2 table
  th: { flexDirection: 'row', backgroundColor: '#faf9f6', paddingVertical: 2.5, paddingHorizontal: 5 },
  thc: { fontSize: 6.5, color: '#6b6860', fontFamily: 'Helvetica-Bold', textTransform: 'uppercase' },
  tr: { flexDirection: 'row', paddingVertical: 2.5, paddingHorizontal: 5, borderTopWidth: 0.5, borderTopColor: '#f0ede8' },
  band: { backgroundColor: '#f4f2ee', paddingVertical: 2.5, paddingHorizontal: 5 },
  bandTxt: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#4a4842', textTransform: 'uppercase' },
  cDesc: { width: '21%' }, cDate: { width: '12%' }, cAmt: { width: '15%', textAlign: 'right' },
  cMethod: { width: '12%' }, cRef: { width: '17%' }, cStatus: { width: '12%' }, cPen: { width: '11%', textAlign: 'right' },
  // charge columns
  colRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  col: { flexGrow: 1, flexBasis: 0, borderWidth: 1, borderColor: '#e8e6e0', borderRadius: 3 },
  colBody: { padding: 5, minHeight: 54 },
  clineRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  colTotal: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#e8e6e0', backgroundColor: '#faf9f6', paddingVertical: 3, paddingHorizontal: 5 },
  totalLbl: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: GREEN, textTransform: 'uppercase' },
  // §6/§7 rows
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, paddingHorizontal: 6 },
  sumRowB: { borderTopWidth: 1, borderTopColor: '#e8e6e0' },
  // signatures
  sigRow: { flexDirection: 'row', gap: 24, padding: 8 },
  sigCol: { flexGrow: 1, flexBasis: 0 },
  sigHead: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: GREEN, textTransform: 'uppercase', marginBottom: 8 },
  sigLine: { borderBottomWidth: 1, borderBottomColor: '#c8c6be', height: 16, marginBottom: 2 },
  sigLabel: { fontSize: 6.5, color: '#9b9890' },
});

const statusColor = (st?: string) =>
  st === 'Cleared' ? '#1a7a5a' : st === 'Bounced' ? RED : (st === 'Not Received' || st === 'Pending') ? '#c2410c' : '#6b6860';

function SecHead({ n, title }: { n: number | string; title: string }) {
  return (
    <View style={s.secHead}>
      {n !== '' && <Text style={s.secBadge}>{n}</Text>}
      <Text style={s.secTitle}>{title}</Text>
    </View>
  );
}
function Field({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={[s.fieldVal, ...(accent ? [s.fieldValAccent] : [])]}>{value || '—'}</Text>
    </View>
  );
}
function ChargeCol({ n, title, rows, total, footer }: { n: number; title: string; rows: { label: string; amount: number }[]; total: number; footer?: string }) {
  return (
    <View style={s.col}>
      <SecHead n={n} title={title} />
      <View style={s.colBody}>
        {rows.map((r, i) => (
          <View key={i} style={s.clineRow}>
            <Text style={{ flexShrink: 1 }}>{r.label}</Text>
            <Text>{money(r.amount)}</Text>
          </View>
        ))}
        {footer ? <Text style={{ fontSize: 6.5, color: GREEN, marginTop: 2 }}>{footer}</Text> : null}
      </View>
      <View style={s.colTotal}><Text style={s.totalLbl}>Total</Text><Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold' }}>{money(total)}</Text></View>
    </View>
  );
}
function SumRow({ label, value, tone, strong, border }: { label: string; value: string; tone?: string; strong?: boolean; border?: boolean }) {
  return (
    <View style={[s.sumRow, ...(border ? [s.sumRowB] : [])]}>
      <Text style={{ fontFamily: strong ? 'Helvetica-Bold' : 'Helvetica', color: strong ? GREEN : '#4a4842' }}>{label}</Text>
      <Text style={{ fontFamily: 'Helvetica-Bold', color: tone ?? '#1a1916' }}>{value}</Text>
    </View>
  );
}

export default function RentalFinalSettlementPdf({ data }: { data: RFSData }) {
  const c = data.contract;
  const utilities = data.lines.filter(l => l.category === 'utility');
  const restoration = data.lines.filter(l => l.category === 'restoration');
  const rentLines = data.lines.filter(l => l.category === 'rent_due');
  const otherLines = data.lines.filter(l => l.category === 'other');

  const utilBuckets = [
    { label: 'Electricity / Water', kw: ['dewa', 'sewa', 'fewa', 'electric', 'water'] },
    { label: 'Cooling / District Cooling', kw: ['cool', 'chiller', 'empower', 'emicool', 'tabreed'] },
    { label: 'Gas', kw: ['gas'] },
    { label: 'Community Fees', kw: ['community', 'service'] },
    { label: 'Telecommunications', kw: ['telecom', 'du', 'etisalat', 'internet'] },
  ];
  const utilRows = utilBuckets
    .map(b => ({ label: b.label, amount: r2(utilities.filter(l => b.kw.some(k => (l.label || '').toLowerCase().includes(k))).reduce((a, l) => a + (l.net ?? l.amount), 0)) }))
    .filter(r => Math.abs(r.amount) > 0.005);
  const utilitiesTotal = sumNet(utilities, ['utility']);

  const restorationRows = restoration.length
    ? restoration.map(l => ({ label: l.label.replace(/\s*\(move-out inspection\)\s*/i, ''), amount: l.net ?? l.amount }))
    : [{ label: 'Repairs & Maintenance', amount: 0 }, { label: 'Cleaning', amount: 0 }];
  const restorationTotal = sumNet(restoration, ['restoration']);
  const hasInspection = restoration.some(l => l.inspectionContractId != null);

  const additionalRows = [
    { label: 'Breach', amount: sumNet(data.lines, ['penalty_breach']) },
    { label: 'Overstay', amount: sumNet(data.lines, ['overstay']) },
    { label: 'Early Termination', amount: sumNet(data.lines, ['early_termination']) },
    { label: 'Dispute', amount: sumNet(data.lines, ['dispute']) },
    { label: 'Admin', amount: sumNet(data.lines, ['admin']) },
  ];
  const additionalTotal = additionalRows.reduce((a, r) => a + r.amount, 0);
  const outstandingRent = sumNet(rentLines, ['rent_due']);
  const totalDeductions = r2(utilitiesTotal + restorationTotal + additionalTotal + sumNet(otherLines, ['other']));
  const netDepositBalance = r2(data.depositHeld - totalDeductions);
  const paymentsReceivedTotal = data.paymentsReceived.reduce((a, p) => a + (p.amount || 0), 0);
  const finalBalance = r2(netDepositBalance - outstandingRent + paymentsReceivedTotal - (data.otherAdjustments ?? 0));
  const isRefund = finalBalance >= 0;

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <Text style={s.landlordLabel}>Landlord / Rental Provider</Text>
        <Text style={s.landlord}>{c.landlordName || '—'}</Text>
        <Text style={s.title}>RENTAL FINAL SETTLEMENT</Text>
        <Text style={s.subtitle}>Statement of Account &amp; Deposit Reconciliation</Text>
        <View style={s.headRule} />

        {/* §1 Customer & Contract Details */}
        <View style={s.box}>
          <SecHead n={1} title="Customer & Contract Details" />
          <View style={s.fieldWrap}>
            <Field label="Customer Name" value={c.tenantName || '—'} />
            <Field label="Contract Start Date" value={fmtDate(c.startDate)} />
            <Field label="Contract End Date" value={fmtDate(c.endDate)} />
            <Field label="Move-out Date" value={fmtDate(c.actualMoveOutDate)} accent />
            <Field label="Property Address" value={c.propertyAddress || '—'} />
            <Field label="Unit No." value={c.unit || '—'} />
            <Field label="Contract / Tenancy No." value={c.contractNo || '—'} />
            <Field label="Property Type" value={c.propertyType || '—'} />
          </View>
        </View>

        {/* §2 Payment History */}
        <View style={s.box}>
          <SecHead n={2} title="Payment History" />
          <View style={s.th}>
            <Text style={[s.thc, s.cDesc]}>Description</Text>
            <Text style={[s.thc, s.cDate]}>Date</Text>
            <Text style={[s.thc, s.cAmt]}>Amount (AED)</Text>
            <Text style={[s.thc, s.cMethod]}>Method</Text>
            <Text style={[s.thc, s.cRef]}>Reference / Cheque #</Text>
            <Text style={[s.thc, s.cStatus]}>Status</Text>
            <Text style={[s.thc, s.cPen]}>Penalty</Text>
          </View>
          {data.depositRow && (
            <View style={s.tr}>
              <Text style={s.cDesc}>{data.depositRow.description}</Text>
              <Text style={s.cDate}>{fmtDate(data.depositRow.date)}</Text>
              <Text style={s.cAmt}>{money(data.depositRow.amount)}</Text>
              <Text style={s.cMethod}>{data.depositRow.method || data.depositRow.mode || ''}</Text>
              <Text style={s.cRef}>{data.depositRow.chequeNumber || data.depositRow.mode || '—'}</Text>
              <Text style={[s.cStatus, { color: statusColor(data.depositRow.status) }]}>{data.depositRow.status}</Text>
              <Text style={s.cPen} />
            </View>
          )}
          {data.paymentHistory.map((band, bi) => (
            <View key={bi} wrap={false}>
              <View style={s.band}>
                <Text style={s.bandTxt}>{band.contractNo ? `${band.band ?? 'YEAR'}  ·  ${band.contractNo}  ·  ${fmtDate(band.startDate)} to ${fmtDate(band.endDate)}` : band.label}</Text>
              </View>
              {band.rows.map((r, ri) => (
                <View key={ri} style={s.tr}>
                  <Text style={s.cDesc}>{r.description}</Text>
                  <Text style={s.cDate}>{fmtDate(r.date)}</Text>
                  <Text style={s.cAmt}>{money(r.amount)}</Text>
                  <Text style={s.cMethod}>{(r.method || '').replace('_', ' ') || '—'}</Text>
                  <Text style={s.cRef}>{r.chequeNumber || '—'}</Text>
                  <Text style={[s.cStatus, { color: statusColor(r.status) }]}>{r.status}</Text>
                  <Text style={[s.cPen, { color: RED }]}>{r.penalty ? money(r.penalty) : ''}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>

        {/* §3 §4 §5 */}
        <View style={s.colRow}>
          <ChargeCol n={3} title="Outstanding Utility & Service Charges" rows={utilRows} total={utilitiesTotal} />
          <ChargeCol n={4} title="Property Charges" rows={restorationRows} total={restorationTotal} footer={restorationTotal > 0 ? (hasInspection ? 'From move-out inspection report' : 'From move-out inspection') : undefined} />
          <ChargeCol n={5} title="Additional Recoverable Charges" rows={additionalRows} total={additionalTotal} />
        </View>

        {/* §6 §7 */}
        <View style={{ flexDirection: 'row', gap: 8 }} wrap={false}>
          <View style={[s.col, { flexGrow: 1, flexBasis: 0 }]}>
            <SecHead n={6} title="Security Deposit Reconciliation" />
            <SumRow label="Security Deposit (Held)" value={money(data.depositHeld)} />
            <Text style={{ fontSize: 6.5, color: '#9b9890', textTransform: 'uppercase', paddingHorizontal: 6, paddingTop: 2 }}>Less: Deductions</Text>
            <SumRow label="Outstanding Utility & Service Charges" value={money(utilitiesTotal)} />
            <SumRow label="Property Charges" value={money(restorationTotal)} />
            <SumRow label="Additional Recoverable Charges" value={money(additionalTotal)} />
            <SumRow label="Total Deductions" value={money(totalDeductions)} tone={RED} strong border />
            <SumRow label="Net Deposit Balance" value={money(netDepositBalance)} tone={netDepositBalance < 0 ? RED : '#1a7a5a'} strong border />
          </View>
          <View style={[s.col, { flexGrow: 1, flexBasis: 0 }]}>
            <SecHead n={7} title="Final Settlement Summary" />
            <SumRow label="Outstanding Rent (if any)" value={money(outstandingRent)} />
            <SumRow label="Security Deposit Balance (from Section 6)" value={money(netDepositBalance)} tone={netDepositBalance < 0 ? RED : undefined} />
            {paymentsReceivedTotal > 0 && <SumRow label="Payments received from customer" value={money(paymentsReceivedTotal)} tone="#1a7a5a" />}
            <SumRow label="Other Adjustments (if any)" value={money(data.otherAdjustments ?? 0)} />
            <SumRow label={isRefund ? 'NET REFUND TO CUSTOMER' : 'AMOUNT PAYABLE BY CUSTOMER'} value={money(isRefund ? finalBalance : -finalBalance)} tone={isRefund ? '#1a7a5a' : RED} strong border />
          </View>
        </View>

        {/* §9 Signatures */}
        <View style={[s.box, { marginTop: 8 }]} wrap={false}>
          <SecHead n={9} title="Signatures" />
          <View style={s.sigRow}>
            <View style={s.sigCol}>
              <Text style={s.sigHead}>Rental Provider / Property Manager</Text>
              <Text style={{ fontSize: 8.5, marginBottom: 6 }}>{c.rpSignatoryName || c.landlordName || '—'}</Text>
              <Text style={s.sigLabel}>Signature</Text><View style={s.sigLine} />
              <Text style={s.sigLabel}>Date</Text><View style={s.sigLine} />
            </View>
            <View style={s.sigCol}>
              <Text style={s.sigHead}>Customer</Text>
              <Text style={{ fontSize: 8.5, marginBottom: 6 }}>{c.tenantName || '—'}</Text>
              <Text style={s.sigLabel}>Signature</Text><View style={s.sigLine} />
              <Text style={s.sigLabel}>Date</Text><View style={s.sigLine} />
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}
