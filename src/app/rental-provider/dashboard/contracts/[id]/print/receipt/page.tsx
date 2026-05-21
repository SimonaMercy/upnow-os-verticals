'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

interface Payment {
  id: number;
  amount: number;
  description: string | null;
  chequeNumber: string | null;
  transactionDate: string | null;
  chequeStatus: string | null;
}

interface ContractDetail {
  id: number; ref: string;
  annualRent: number;
  numberOfInstallments: number | null;
  modeOfPayment: string | null;
  startDate: string; endDate: string;
  tenant: { name: string | null; phone: string | null; emiratesId?: string | null };
  landlord: { name: string | null; companyName: string | null; phone: string | null; email: string | null };
  property: { buildingName: string | null; fullAddress: string | null; community: string | null; emirate: string | null };
  unit: { number: string | null; name: string | null; type: string | null };
  payments?: Payment[];
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '';
  const dt = new Date(d);
  return `${dt.getDate().toString().padStart(2, '0')}-${(dt.getMonth() + 1).toString().padStart(2, '0')}-${dt.getFullYear()}`;
}

function fmtAed(v: number) {
  return `AED ${v.toLocaleString('en-AE')}`;
}

function numWords(n: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  if (n === 0) return 'Zero';
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '');
  if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + numWords(n % 100) : '');
  if (n < 1_000_000) return numWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + numWords(n % 1000) : '');
  return numWords(Math.floor(n / 1_000_000)) + ' Million' + (n % 1_000_000 ? ' ' + numWords(n % 1_000_000) : '');
}

function Row({ label, value, half }: { label: string; value?: string | null; half?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginBottom: 6, width: half ? '50%' : '100%', paddingRight: half ? 8 : 0 }}>
      <span style={{ fontSize: 8.5, color: '#555', whiteSpace: 'nowrap' }}>{label}:</span>
      <span style={{ flex: 1, borderBottom: '1px solid #bbb', fontSize: 8.5, paddingLeft: 4, color: '#111', fontWeight: value ? 600 : 400 }}>{value ?? ''}</span>
    </div>
  );
}

export default function RentReceiptPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const paymentIdx = parseInt(searchParams?.get('p') ?? '0', 10);

  const [contract, setContract] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    fetch(`/api/contracts/${params.id}`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(`Error ${r.status}`); return r.json(); })
      .then(setContract).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [params?.id]);

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Loader2 className="animate-spin" size={32} style={{ color: '#1a3c6e' }} /></div>;
  if (error || !contract) return <div style={{ padding: 40, color: '#c00' }}>Failed to load contract: {error}</div>;

  const payment = contract.payments?.[paymentIdx];
  const amount = payment?.amount ?? Math.round(contract.annualRent / (contract.numberOfInstallments ?? 1));
  const landlordName = contract.landlord.companyName ?? contract.landlord.name ?? '';
  const propertyDesc = [contract.property.buildingName, contract.unit.number ?? contract.unit.name, contract.property.community ?? contract.property.emirate].filter(Boolean).join(', ');
  const receiptNo = `RCP-${contract.ref}-${String(paymentIdx + 1).padStart(2, '0')}`;
  const installment = contract.numberOfInstallments ?? 1;

  const pageStyle: React.CSSProperties = { maxWidth: 794, margin: '0 auto', padding: '20px 24px', fontSize: 9, lineHeight: 1.6, fontFamily: 'Arial, sans-serif', color: '#111' };

  return (
    <>
      <style>{`@page { size: A4; margin: 12mm; } @media print { .no-print { display: none !important; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } } * { box-sizing: border-box; }`}</style>

      <div className="no-print" style={{ background: '#fff', borderBottom: '1px solid #ddd', padding: '10px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 10, boxShadow: '0 1px 4px rgba(0,0,0,.08)' }}>
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>Rent Receipt — {receiptNo}</p>
          <p style={{ margin: 0, fontSize: 12, color: '#666' }}>Instalment {paymentIdx + 1} of {installment} · {contract.ref}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {(contract.payments?.length ?? 0) > 1 && (
            <span style={{ fontSize: 12, color: '#666' }}>
              {contract.payments!.map((_, i) => (
                <a key={i} href={`?p=${i}`} style={{ margin: '0 3px', color: i === paymentIdx ? '#1a3c6e' : '#888', fontWeight: i === paymentIdx ? 700 : 400 }}>#{i + 1}</a>
              ))}
            </span>
          )}
          <button onClick={() => window.close()} style={{ padding: '6px 16px', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>✕ Close</button>
          <button onClick={() => window.print()} style={{ padding: '6px 16px', background: '#1a3c6e', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>⬇ Download PDF</button>
        </div>
      </div>

      <div style={pageStyle}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, paddingBottom: 10, borderBottom: '2px solid #1a3c6e' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, color: '#1a3c6e', letterSpacing: 1 }}>RENT RECEIPT</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3c6e', direction: 'rtl', fontFamily: 'Georgia, serif' }}>إيصال إيجار</div>
          </div>
          <div style={{ textAlign: 'right', border: '1.5px solid #1a3c6e', borderRadius: 4, padding: '6px 12px' }}>
            <div style={{ fontSize: 8, color: '#555' }}>Receipt No. / رقم الإيصال</div>
            <div style={{ fontSize: 11, fontWeight: 900, color: '#1a3c6e' }}>{receiptNo}</div>
            <div style={{ fontSize: 8, color: '#555', marginTop: 2 }}>Date / التاريخ: <strong>{fmtDate(payment?.transactionDate ?? new Date().toISOString())}</strong></div>
          </div>
        </div>

        {/* Amount block */}
        <div style={{ background: '#f0f4fa', border: '1.5px solid #1a3c6e', borderRadius: 6, padding: '12px 16px', marginBottom: 14, textAlign: 'center' }}>
          <div style={{ fontSize: 8, color: '#555', marginBottom: 2 }}>Amount Received / المبلغ المستلم</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#1a3c6e' }}>{fmtAed(amount)}</div>
          <div style={{ fontSize: 8, color: '#333', marginTop: 3, fontStyle: 'italic' }}>
            {numWords(amount)} Dirhams Only
          </div>
        </div>

        {/* Received from */}
        <div style={{ border: '1px solid #bbb', borderRadius: 4, padding: '10px 12px', marginBottom: 10 }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Payment Details / تفاصيل الدفع</div>
          <Row label="Received From" value={contract.tenant.name} />
          <Row label="Emirates ID" value={contract.tenant.emiratesId} />
          <Row label="Property" value={propertyDesc} />
          <div style={{ display: 'flex' }}>
            <Row label="Lease Period From" value={fmtDate(contract.startDate)} half />
            <Row label="To" value={fmtDate(contract.endDate)} half />
          </div>
          <div style={{ display: 'flex' }}>
            <Row label="Instalment" value={`${paymentIdx + 1} of ${installment}`} half />
            <Row label="Mode of Payment" value={payment?.chequeNumber ? 'Cheque' : (contract.modeOfPayment ?? 'Bank Transfer')} half />
          </div>
          {payment?.chequeNumber && (
            <div style={{ display: 'flex' }}>
              <Row label="Cheque Number" value={payment.chequeNumber} half />
              <Row label="Cheque Date" value={fmtDate(payment.transactionDate)} half />
            </div>
          )}
          {payment?.description && <Row label="Description" value={payment.description} />}
        </div>

        {/* Landlord / issued by */}
        <div style={{ border: '1px solid #bbb', borderRadius: 4, padding: '10px 12px', marginBottom: 16 }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Issued By / صادر من</div>
          <div style={{ display: 'flex' }}>
            <Row label="Landlord / Agent" value={landlordName} half />
            <Row label="Phone" value={contract.landlord.phone} half />
          </div>
          <Row label="Email" value={contract.landlord.email} />
        </div>

        {/* Note */}
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4, padding: '6px 10px', marginBottom: 20, fontSize: 7.5, color: '#92400e' }}>
          This receipt is issued for the payment of rent as described above. Please retain this document for your records.
          <span style={{ direction: 'rtl', display: 'block', marginTop: 2 }}>يُصدر هذا الإيصال بخصوص دفعة الإيجار الموضحة أعلاه. يُرجى الاحتفاظ بهذه الوثيقة لسجلاتكم.</span>
        </div>

        {/* Signatures */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 10 }}>
          {[
            { label: 'Landlord / Agent Signature', labelAr: 'توقيع المالك / الوكيل' },
            { label: 'Tenant Signature (Acknowledgement)', labelAr: 'توقيع المستأجر (إقرار)' },
          ].map(({ label, labelAr }) => (
            <div key={label} style={{ border: '1px solid #bbb', borderRadius: 4, padding: 10 }}>
              <div style={{ height: 52, borderBottom: '1px dashed #bbb', marginBottom: 4 }} />
              <div style={{ fontSize: 7.5, display: 'flex', justifyContent: 'space-between' }}>
                <span>{label} <span style={{ direction: 'rtl', fontSize: 7 }}>{labelAr}</span></span>
                <span>Date: <span style={{ borderBottom: '1px dashed #888', display: 'inline-block', width: 55 }} /></span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 20, borderTop: '1px solid #bbb', paddingTop: 5, textAlign: 'center', fontSize: 7, color: '#888' }}>
          UpNow Property Management · {receiptNo} · Generated: {fmtDate(new Date().toISOString())} · Contract: {contract.ref}
        </div>
      </div>
    </>
  );
}
