/**
 * Deposit Settlement — react-pdf document. Snapshotted to a stored PDF when the
 * settlement is marked paid, so the contract documents binder shows a real
 * document instead of re-rendering the live settlement page.
 */
'use client';

import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';

export interface SettlementLine { label: string; amount: number; type: 'deduction' | 'due' }
export interface SettlementPayment { amount: number; method: string; reference: string | null; receivedOn: string | null }
export interface SettlementPdfData {
  ref: string;
  property: string; unit: string; tenantName: string;
  depositHeld: number;
  lines: SettlementLine[];
  chargesTotal: number;
  refundAmount: number | null;
  payments: SettlementPayment[];
  paymentsReceivedTotal: number;
  balance: number;
  paidAt: string | null;
  rpSignature: string | null;
  tenantSignature: string | null;
  notes: string | null;
}

const aed = (n: number | null | undefined) => 'AED ' + new Intl.NumberFormat('en-AE', { maximumFractionDigits: 2 }).format(n ?? 0);
const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
// Only embed inline (data-URL) signatures — a remote private URL would 403 in the
// browser and fail the whole PDF. Drawn signatures are data-URLs.
const isImg = (s: string | null | undefined): s is string => typeof s === 'string' && s.startsWith('data:');

const NAVY = '#1a3c6e';
const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 44, paddingHorizontal: 40, fontSize: 10, color: '#1a1916', fontFamily: 'Helvetica' },
  h1: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: NAVY },
  sub: { fontSize: 9, color: '#6b6860', marginTop: 2 },
  metaRow: { flexDirection: 'row', marginTop: 14, gap: 24 },
  metaCol: { flexGrow: 1 },
  metaLabel: { fontSize: 8, color: '#9b9890', textTransform: 'uppercase', letterSpacing: 0.5 },
  metaVal: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 1 },
  sectionTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 20, marginBottom: 6, borderBottom: '1px solid #e3e0d9', paddingBottom: 3 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottom: '0.5px solid #f0ede7' },
  rowLabel: { flexGrow: 1 },
  amt: { fontFamily: 'Helvetica-Bold' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, marginTop: 4, borderTop: '1px solid #c5cdd9' },
  totalLabel: { fontFamily: 'Helvetica-Bold', color: NAVY },
  refundBox: { marginTop: 16, padding: 12, backgroundColor: '#eef7f3', borderRadius: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  refundVal: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: '#1a7a5a' },
  sigRow: { flexDirection: 'row', gap: 40, marginTop: 34 },
  sigCol: { flexGrow: 1 },
  sigImg: { height: 44, marginBottom: 4, objectFit: 'contain' },
  sigLine: { borderTop: '1px solid #1a1916', paddingTop: 3, fontSize: 9, color: '#6b6860' },
  muted: { fontSize: 9, color: '#9b9890' },
});

export default function DepositSettlementPdf({ data }: { data: SettlementPdfData }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: `2px solid ${NAVY}`, paddingBottom: 8 }}>
          <View>
            <Text style={s.h1}>Deposit Settlement</Text>
            <Text style={s.sub}>Contract {data.ref}{data.paidAt ? ` · settled ${fmt(data.paidAt)}` : ''}</Text>
          </View>
          <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#1a7a5a' }}>REFUND PAID</Text>
        </View>

        <View style={s.metaRow}>
          <View style={s.metaCol}><Text style={s.metaLabel}>Tenant</Text><Text style={s.metaVal}>{data.tenantName || '—'}</Text></View>
          <View style={s.metaCol}><Text style={s.metaLabel}>Property</Text><Text style={s.metaVal}>{data.property || '—'}</Text></View>
          <View style={s.metaCol}><Text style={s.metaLabel}>Unit</Text><Text style={s.metaVal}>{data.unit || '—'}</Text></View>
        </View>

        <Text style={s.sectionTitle}>Settlement</Text>
        <View style={s.row}><Text style={s.rowLabel}>Security deposit held</Text><Text style={s.amt}>{aed(data.depositHeld)}</Text></View>
        {data.lines.length > 0 && data.lines.map((l, i) => (
          <View key={i} style={s.row}>
            <Text style={s.rowLabel}>{l.type === 'deduction' ? 'Deduction' : 'Amount due'} — {l.label}</Text>
            <Text style={s.amt}>− {aed(l.amount)}</Text>
          </View>
        ))}
        <View style={s.totalRow}><Text style={s.totalLabel}>Total charges</Text><Text style={s.totalLabel}>− {aed(data.chargesTotal)}</Text></View>

        <View style={s.refundBox}>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>Refund to tenant</Text>
          <Text style={s.refundVal}>{aed(data.refundAmount)}</Text>
        </View>

        {data.payments.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Payments received from tenant</Text>
            {data.payments.map((p, i) => (
              <View key={i} style={s.row}>
                <Text style={s.rowLabel}>{p.method}{p.reference ? ` · ${p.reference}` : ''}{p.receivedOn ? ` · ${fmt(p.receivedOn)}` : ''}</Text>
                <Text style={s.amt}>{aed(p.amount)}</Text>
              </View>
            ))}
            <View style={s.totalRow}><Text style={s.totalLabel}>Total received</Text><Text style={s.totalLabel}>{aed(data.paymentsReceivedTotal)}</Text></View>
            <View style={s.row}><Text style={s.rowLabel}>Closing balance</Text><Text style={s.amt}>{aed(data.balance)}</Text></View>
          </>
        )}

        {data.notes ? (<><Text style={s.sectionTitle}>Notes</Text><Text style={s.muted}>{data.notes}</Text></>) : null}

        <View style={s.sigRow}>
          <View style={s.sigCol}>
            {isImg(data.rpSignature) ? <Image style={s.sigImg} src={data.rpSignature} /> : <View style={{ height: 44 }} />}
            <Text style={s.sigLine}>Rental provider</Text>
          </View>
          <View style={s.sigCol}>
            {isImg(data.tenantSignature) ? <Image style={s.sigImg} src={data.tenantSignature} /> : <View style={{ height: 44 }} />}
            <Text style={s.sigLine}>Tenant — {data.tenantName || ''}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
