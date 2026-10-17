/**
 * Customer service receipt / tax invoice — /dashboard/customer/services/[id]/receipt.
 *
 * Print-friendly (window.print → Save as PDF), same approach as the contract
 * print pages: a full-screen white sheet over the dashboard shell, with print
 * CSS that hides everything else.
 *
 * It is titled "Tax invoice" ONLY when the booking payload carries the
 * provider's VAT TRN (a UAE tax invoice must show the supplier's TRN). With
 * no TRN it is a payment receipt and says so. All money fields are read
 * defensively from GET /bookings/:id (+ /quote for quote-priced jobs);
 * catalogue prices are VAT-inclusive, so when the API sends no VAT figure the
 * 5% split is derived from the inclusive total and labelled as such.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Loader2, Printer } from 'lucide-react';
import { isQuoteMode } from '@/lib/homeServices/statusView';

const VAT_RATE = 0.05;

type Num = number | string | null | undefined;
interface QuoteItem { itemName: string; quantity: number | string; unitPrice: number | string; lineTotal: number | string }
interface Quote { status: string; totalAmount: Num; items: QuoteItem[] }
interface ReceiptBooking {
  id: number;
  status?: string;
  pricingMode?: string | null;
  serviceName?: string | null;
  packageName?: string | null;
  template?: { name?: string | null } | null;
  hours?: number | null;
  quantity?: number | null;
  scheduledAt?: string | null;
  createdAt?: string | null;
  addressText?: string | null;
  totalAmount?: Num;
  vatAmount?: Num;
  vat?: Num;
  addonsAmount?: Num;
  customerName?: string | null;
  providerName?: string | null;
  provider?: { businessName?: string | null; name?: string | null; vatTrn?: string | null; trn?: string | null; address?: string | null } | null;
  serviceProvider?: { businessName?: string | null; vatTrn?: string | null; address?: string | null } | null;
  providerTrn?: string | null;
  timeline?: { key: string; at: string | null; done: boolean }[];
}

const n = (v: Num) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const aed = (v: number) => `AED ${v.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string | null | undefined) => (iso
  ? new Date(iso).toLocaleDateString('en-AE', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', year: 'numeric' })
  : '—');

export default function ServiceReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const [b, setB] = useState<ReceiptBooking | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/bookings/${id}`, { credentials: 'include' });
        if (!r.ok) throw new Error(r.status === 404 ? 'Booking not found' : `Could not load the booking (${r.status})`);
        const d = await r.json();
        const row: ReceiptBooking = { ...(d.booking ?? d), timeline: d.timeline ?? d.booking?.timeline };
        if (cancelled) return;
        setB(row);
        if (isQuoteMode(row.pricingMode)) {
          const q = await fetch(`/api/bookings/${id}/quote`, { credentials: 'include' }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
          if (!cancelled) setQuote(q);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the booking');
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const shell = (child: React.ReactNode) => (
    <div className="svc-rcpt-sheet" style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#f4f5f3', overflowY: 'auto' }}>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .svc-rcpt-sheet, .svc-rcpt-sheet * { visibility: visible !important; }
          .svc-rcpt-sheet { position: absolute !important; inset: 0 !important; background: #fff !important; overflow: visible !important; }
          .svc-rcpt-noprint { display: none !important; }
          .svc-rcpt-paper { box-shadow: none !important; border: none !important; margin: 0 !important; }
        }
      `}</style>
      {child}
    </div>
  );

  if (error) {
    return shell(
      <div style={{ maxWidth: 640, margin: '60px auto', padding: 24, textAlign: 'center', color: '#b42318', fontSize: 14 }}>
        {error}
        <div style={{ marginTop: 14 }}><Link href="/dashboard/customer/services" style={{ color: '#0B7A4E', fontWeight: 600 }}>Back to My Services</Link></div>
      </div>,
    );
  }
  if (!b) {
    return shell(<div style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}><Loader2 className="animate-spin" size={28} style={{ color: '#0B7A4E' }} /></div>);
  }

  const total = n(quote?.status === 'approved' ? quote.totalAmount : null) ?? n(b.totalAmount);
  const apiVat = n(b.vatAmount) ?? n(b.vat);
  const vat = total != null ? (apiVat ?? total - total / (1 + VAT_RATE)) : null;
  const net = total != null && vat != null ? total - vat : null;
  const vatDerived = apiVat == null;
  const providerName = b.provider?.businessName ?? b.serviceProvider?.businessName ?? b.provider?.name ?? b.providerName ?? null;
  const trn = b.provider?.vatTrn ?? b.provider?.trn ?? b.serviceProvider?.vatTrn ?? b.providerTrn ?? null;
  const providerAddress = b.provider?.address ?? b.serviceProvider?.address ?? null;
  const isTaxInvoice = Boolean(trn && /^\d{15}$/.test(trn.trim()));
  const supplyDate = b.timeline?.find((s) => s.key === 'completed' && s.done)?.at ?? b.scheduledAt ?? null;
  const service = `${b.serviceName ?? b.template?.name ?? 'Home service'}${b.packageName ? ` — ${b.packageName}` : ''}`;
  const lines: { label: string; amount: number | null }[] = quote?.status === 'approved' && quote.items?.length
    ? quote.items.map((it) => ({ label: `${it.itemName}${Number(it.quantity) > 1 ? ` × ${it.quantity}` : ''}`, amount: n(it.lineTotal) }))
    : [{ label: `${service}${b.hours ? ` · ${b.hours}h` : ''}${b.quantity && b.quantity > 1 ? ` × ${b.quantity}` : ''}`, amount: total }];

  const row = (k: string, v: React.ReactNode, strong = false) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '6px 0', fontSize: strong ? 15 : 13, fontWeight: strong ? 700 : 400, color: '#182420' }}>
      <span style={{ color: strong ? '#182420' : '#5f6b63' }}>{k}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  );

  return shell(
    <>
      <div className="svc-rcpt-noprint" style={{ maxWidth: 720, margin: '0 auto', padding: '16px 16px 0', display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
        <Link href="/dashboard/customer/services" style={{ fontSize: 13, color: '#0B7A4E', fontWeight: 600 }}>← My Services</Link>
        <button type="button" onClick={() => window.print()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0B7A4E', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>
      <div className="svc-rcpt-paper" style={{ maxWidth: 720, margin: '16px auto 40px', background: '#fff', border: '1px solid #e4e7e2', borderRadius: 14, padding: '36px 40px', boxShadow: '0 6px 24px rgba(20,32,26,.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#182420' }}>{isTaxInvoice ? 'Tax invoice' : 'Payment receipt'}</div>
            <div style={{ fontSize: 12.5, color: '#5f6b63', marginTop: 4 }}>{isTaxInvoice ? 'Invoice' : 'Receipt'} no. BK-{b.id} · Issued {fmtDate(new Date().toISOString())}</div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 12.5, color: '#5f6b63' }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#0B7A4E' }}>UpNow</div>
            <div>Home services marketplace</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginTop: 26, fontSize: 13 }}>
          <div>
            <div style={lbl}>Supplier (service provider)</div>
            <div style={{ fontWeight: 600, color: '#182420', marginTop: 4 }}>{providerName ?? 'Assigned professional'}</div>
            {providerAddress && <div style={{ color: '#5f6b63' }}>{providerAddress}</div>}
            <div style={{ color: '#5f6b63' }}>TRN: {trn ?? '—'}</div>
          </div>
          <div>
            <div style={lbl}>Customer</div>
            <div style={{ fontWeight: 600, color: '#182420', marginTop: 4 }}>{b.customerName ?? 'You'}</div>
            {b.addressText && <div style={{ color: '#5f6b63' }}>{b.addressText}</div>}
          </div>
          <div>
            <div style={lbl}>Date of supply</div>
            <div style={{ color: '#182420', marginTop: 4 }}>{fmtDate(supplyDate)}</div>
          </div>
          <div>
            <div style={lbl}>Booking</div>
            <div style={{ color: '#182420', marginTop: 4 }}>BK-{b.id} · {(b.status ?? '').replace(/_/g, ' ')}</div>
          </div>
        </div>

        <div style={{ marginTop: 26, borderTop: '1px solid #e4e7e2', paddingTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', ...lbl, padding: '4px 0 8px' }}><span>Description</span><span>Amount (incl. VAT)</span></div>
          {lines.map((l, i) => <div key={i}>{row(l.label, l.amount != null ? aed(l.amount) : '—')}</div>)}
        </div>
        <div style={{ marginTop: 10, borderTop: '1px solid #e4e7e2', paddingTop: 8 }}>
          {row('Subtotal (excl. VAT)', net != null ? aed(net) : '—')}
          {row(`VAT (${Math.round(VAT_RATE * 100)}%)`, vat != null ? aed(vat) : '—')}
          <div style={{ borderTop: '1px solid #182420', marginTop: 6 }} />
          {row('Total paid', total != null ? aed(total) : '—', true)}
        </div>

        <div style={{ marginTop: 22, fontSize: 11.5, color: '#5f6b63', lineHeight: 1.6 }}>
          {vatDerived && <p>Prices on UpNow include 5% VAT; the VAT line is the 5% share of the VAT-inclusive total.</p>}
          {!isTaxInvoice && (
            <p style={{ marginTop: 4 }}>
              This is a payment receipt, not a tax invoice: the provider&apos;s VAT registration number (TRN) isn&apos;t on this booking.
              If you need a tax invoice, ask the provider for one quoting BK-{b.id}.
            </p>
          )}
        </div>
      </div>
    </>,
  );
}

const lbl: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: '#8a968d' };
