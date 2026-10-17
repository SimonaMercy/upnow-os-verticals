'use client';

/**
 * PlatformReceiptPdf — the two platform-billing receipts UpNow issues per
 * Rental-Provider month, as real vector PDFs (@react-pdf/renderer, same stack as
 * PaymentReceiptPdf). One component renders BOTH series, adapting title + party
 * framing by `receipt.series`:
 *   • rp_invoice  → "Tax Invoice"      — UpNow (seller) bills the RP (customer)
 *   • upnow_admin → "Revenue Receipt"  — UpNow's own record of the same revenue
 * Numbers/amounts come pre-computed + frozen from the backend (issued receipt),
 * so this is a pure presenter. `downloadPlatformReceipt()` renders + saves one.
 */

import React from 'react';
import { Document, Page, View, Text, StyleSheet, Font } from '@react-pdf/renderer';

Font.register({
  family: 'Roboto',
  fonts: [
    { src: '/fonts/Roboto-Regular.ttf', fontWeight: 400 },
    { src: '/fonts/Roboto-Medium.ttf', fontWeight: 500 },
  ],
});

export interface PlatformReceiptLine {
  label: string;
  qty: number;
  unitAed: number;
  amountAed: number;
}
export interface PlatformReceiptDoc {
  id: number;
  series: 'rp_invoice' | 'upnow_admin';
  docType: string;
  receiptNo: string;
  periodMonth: string;
  issuedAt: string;
  rentalProviderId: number;
  providerName: string;
  providerEmail: string | null;
  lines: PlatformReceiptLine[];
  netAed: number;
  vatRatePct: number;
  vatAed: number;
  grossAed: number;
}

// UpNow's VAT registration number — wire to config once issued by the FTA.
const UPNOW_TRN = '';

const GREEN = '#047246';
const INK = '#14201a';
const MUTE = '#5f6b63';
const LINE = '#e2ded7';

const aed = (n: number) =>
  'AED ' + Number(n || 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLong = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const dateLong = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const s = StyleSheet.create({
  page: { fontFamily: 'Roboto', fontSize: 9, color: INK, paddingTop: 40, paddingHorizontal: 44, paddingBottom: 56, lineHeight: 1.4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  brand: { fontSize: 20, fontWeight: 500, color: GREEN, letterSpacing: 0.5, lineHeight: 1 },
  brandSub: { fontSize: 8, color: MUTE, marginTop: 6 },
  docType: { fontSize: 15, fontWeight: 500, color: INK, textAlign: 'right' },
  docNo: { fontSize: 10, color: GREEN, fontWeight: 500, textAlign: 'right', marginTop: 3 },
  metaRight: { fontSize: 8, color: MUTE, textAlign: 'right', marginTop: 2 },
  rule: { borderBottomWidth: 1.5, borderBottomColor: GREEN, marginTop: 10, marginBottom: 14 },
  parties: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  partyCol: { width: '48%' },
  partyLabel: { fontSize: 7.5, color: MUTE, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 },
  partyName: { fontSize: 10, fontWeight: 500, color: INK },
  partyLine: { fontSize: 8.5, color: MUTE },
  periodBox: { backgroundColor: '#f5f8f6', borderRadius: 4, paddingVertical: 6, paddingHorizontal: 10, marginBottom: 14, flexDirection: 'row', justifyContent: 'space-between' },
  periodLabel: { fontSize: 8, color: MUTE },
  periodValue: { fontSize: 9.5, fontWeight: 500, color: INK },
  th: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 4, marginBottom: 2 },
  thText: { fontSize: 7.5, color: MUTE, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 500 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 6 },
  cDesc: { width: '52%' },
  cQty: { width: '12%', textAlign: 'right' },
  cUnit: { width: '18%', textAlign: 'right' },
  cAmt: { width: '18%', textAlign: 'right' },
  totals: { marginTop: 10, marginLeft: 'auto', width: '52%' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2.5 },
  totalLabel: { fontSize: 9, color: MUTE },
  totalValue: { fontSize: 9, color: INK, fontWeight: 500 },
  grossRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, marginTop: 4, borderTopWidth: 1, borderTopColor: INK },
  grossLabel: { fontSize: 11, fontWeight: 500, color: INK },
  grossValue: { fontSize: 11, fontWeight: 500, color: GREEN },
  footer: { position: 'absolute', bottom: 30, left: 44, right: 44, borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 8 },
  footerText: { fontSize: 7, color: MUTE, textAlign: 'center' },
});

export function PlatformReceiptDocPdf({ receipt }: { receipt: PlatformReceiptDoc }) {
  const isInvoice = receipt.series === 'rp_invoice';
  const fromLabel = isInvoice ? 'From' : 'Received by';
  const toLabel = isInvoice ? 'Bill to' : 'Received from';
  const upnowBlock = (
    <View>
      <Text style={s.partyName}>UpNow Marketplace</Text>
      <Text style={s.partyLine}>Platform services — rentals</Text>
      <Text style={s.partyLine}>Dubai, United Arab Emirates</Text>
      {UPNOW_TRN ? <Text style={s.partyLine}>TRN: {UPNOW_TRN}</Text> : null}
    </View>
  );
  const rpBlock = (
    <View>
      <Text style={s.partyName}>{receipt.providerName}</Text>
      <Text style={s.partyLine}>Rental Provider #{receipt.rentalProviderId}</Text>
      {receipt.providerEmail ? <Text style={s.partyLine}>{receipt.providerEmail}</Text> : null}
    </View>
  );

  return (
    <Document title={receipt.receiptNo} author="UpNow">
      <Page size="A4" style={s.page}>
        <View style={s.headerRow}>
          <View>
            <Text style={s.brand}>UpNow</Text>
            <Text style={s.brandSub}>Rental platform billing</Text>
          </View>
          <View>
            <Text style={s.docType}>{receipt.docType}</Text>
            <Text style={s.docNo}>{receipt.receiptNo}</Text>
            <Text style={s.metaRight}>Issued {dateLong(receipt.issuedAt)}</Text>
          </View>
        </View>
        <View style={s.rule} />

        <View style={s.parties}>
          <View style={s.partyCol}>
            <Text style={s.partyLabel}>{fromLabel}</Text>
            {isInvoice ? upnowBlock : rpBlock}
          </View>
          <View style={s.partyCol}>
            <Text style={s.partyLabel}>{toLabel}</Text>
            {isInvoice ? rpBlock : upnowBlock}
          </View>
        </View>

        <View style={s.periodBox}>
          <Text style={s.periodLabel}>Billing period</Text>
          <Text style={s.periodValue}>{monthLong(receipt.periodMonth)}</Text>
        </View>

        {/* Line items */}
        <View style={s.th}>
          <Text style={[s.thText, s.cDesc]}>Description</Text>
          <Text style={[s.thText, s.cQty]}>Qty</Text>
          <Text style={[s.thText, s.cUnit]}>Unit</Text>
          <Text style={[s.thText, s.cAmt]}>Amount</Text>
        </View>
        {receipt.lines.map((l, i) => (
          <View style={s.tr} key={i}>
            <Text style={s.cDesc}>{l.label}</Text>
            <Text style={s.cQty}>{l.qty}</Text>
            <Text style={s.cUnit}>{aed(l.unitAed)}</Text>
            <Text style={[s.cAmt, { fontWeight: 500 }]}>{aed(l.amountAed)}</Text>
          </View>
        ))}

        {/* Totals */}
        <View style={s.totals}>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Subtotal (net)</Text>
            <Text style={s.totalValue}>{aed(receipt.netAed)}</Text>
          </View>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>VAT {receipt.vatRatePct}%</Text>
            <Text style={s.totalValue}>{aed(receipt.vatAed)}</Text>
          </View>
          <View style={s.grossRow}>
            <Text style={s.grossLabel}>{isInvoice ? 'Total due' : 'Total'}</Text>
            <Text style={s.grossValue}>{aed(receipt.grossAed)}</Text>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            {isInvoice
              ? 'This is a computer-generated tax invoice from UpNow for platform services. Amounts in AED, inclusive of 5% VAT where shown.'
              : 'UpNow internal revenue receipt — record of platform fees billed to the Rental Provider for the period above.'}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

/** Render one issued receipt to a PDF and trigger a browser download. */
export async function downloadPlatformReceipt(receipt: PlatformReceiptDoc): Promise<void> {
  const { pdf } = await import('@react-pdf/renderer');
  const blob = await pdf(<PlatformReceiptDocPdf receipt={receipt} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${receipt.receiptNo}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
