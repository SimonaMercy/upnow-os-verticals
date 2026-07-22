'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

interface ContractDetail {
  id: number; ref: string;
  startDate: string; endDate: string;
  tenant: { name: string | null; companyName?: string | null; phone: string | null; emiratesId?: string | null };
  landlord: { name: string | null; companyName: string | null; phone: string | null };
  property: { buildingName: string | null; fullAddress: string | null; community: string | null; emirate: string | null };
  unit: { number: string | null; name: string | null; type: string | null; floor: string | null; bedrooms: number | null; bathrooms: number | null; sizeSqm: number | null };
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '';
  const dt = new Date(d);
  return `${dt.getDate().toString().padStart(2, '0')}-${(dt.getMonth() + 1).toString().padStart(2, '0')}-${dt.getFullYear()}`;
}

function Row({ label, labelAr, cols = 1 }: { label: string; labelAr: string; cols?: number }) {
  const width = cols === 2 ? '50%' : '100%';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginBottom: 7, width, paddingRight: cols === 2 ? 8 : 0 }}>
      <span style={{ fontSize: 8, whiteSpace: 'nowrap', color: '#222' }}>{label}</span>
      <span style={{ flex: 1, borderBottom: '1px dashed #888', minWidth: 30 }} />
      <span style={{ fontSize: 7.5, color: '#444', direction: 'rtl', whiteSpace: 'nowrap' }}>{labelAr}</span>
    </div>
  );
}

function Checkbox({ label, labelAr }: { label: string; labelAr: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
      <span style={{ width: 10, height: 10, border: '1px solid #555', display: 'inline-block', flexShrink: 0 }} />
      <span style={{ fontSize: 7.5, flex: 1 }}>{label}</span>
      <span style={{ fontSize: 7.5, direction: 'rtl' }}>{labelAr}</span>
    </div>
  );
}

function ConditionRow({ label }: { label: string }) {
  const opts = ['Good', 'Fair', 'Poor', 'N/A'];
  return (
    <tr style={{ borderBottom: '1px solid #eee' }}>
      <td style={{ padding: '3px 5px', fontSize: 7.5 }}>{label}</td>
      {opts.map(o => (
        <td key={o} style={{ padding: '3px 5px', textAlign: 'center', fontSize: 7.5 }}>
          <span style={{ display: 'inline-block', width: 9, height: 9, border: '1px solid #888', borderRadius: '50%' }} />
        </td>
      ))}
      <td style={{ padding: '3px 5px', width: 80, borderLeft: '1px solid #ddd' }}>
        <span style={{ display: 'block', borderBottom: '1px dashed #aaa', height: 14 }} />
      </td>
    </tr>
  );
}

function SectionHead({ en, ar }: { en: string; ar: string }) {
  return (
    <div style={{ background: '#1a3c6e', display: 'flex', justifyContent: 'space-between', padding: '3px 8px', marginBottom: 4, marginTop: 8 }}>
      <span style={{ fontSize: 8.5, fontWeight: 700, color: '#fff' }}>{en}</span>
      <span style={{ fontSize: 8.5, fontWeight: 700, color: '#fff', direction: 'rtl' }}>{ar}</span>
    </div>
  );
}

const ROOMS = [
  'Entrance / Hall', 'Living Room', 'Dining Area', 'Kitchen',
  'Master Bedroom', 'Bedroom 2', 'Bedroom 3', 'Master Bathroom',
  'Bathroom 2', 'Bathroom 3', 'Balcony / Terrace', 'Laundry Room',
  'Storage Room', 'Parking Space',
];

const ITEMS_PER_ROOM = [
  'Walls & Paint', 'Ceiling', 'Flooring', 'Windows & Glass',
  'Doors & Handles', 'A/C Unit', 'Light Fixtures', 'Electrical Sockets',
];

export default function HandoverFormPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const type = (searchParams?.get('type') ?? 'move_in') as 'move_in' | 'move_out';
  const isMoveIn = type === 'move_in';

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

  const landlordName = contract.landlord.companyName ?? contract.landlord.name ?? '';
  const pageStyle: React.CSSProperties = { maxWidth: 794, margin: '0 auto', padding: '16px 20px', fontSize: 9, lineHeight: 1.5, fontFamily: 'Arial, sans-serif', color: '#111' };

  return (
    <>
      <style>{`@page { size: A4; margin: 10mm; } @media print { .no-print { display: none !important; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } } * { box-sizing: border-box; }`}</style>

      <div className="no-print" style={{ background: '#fff', borderBottom: '1px solid #ddd', padding: '10px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 10, boxShadow: '0 1px 4px rgba(0,0,0,.08)' }}>
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{isMoveIn ? 'Move-In' : 'Move-Out'} Handover Form — {contract.ref}</p>
          <p style={{ margin: 0, fontSize: 12, color: '#666' }}>Property condition checklist · Print or save as PDF</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => window.close()} style={{ padding: '6px 16px', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>✕ Close</button>
          <button onClick={() => window.print()} style={{ padding: '6px 16px', background: '#1a3c6e', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>⬇ Download PDF</button>
        </div>
      </div>

      <div style={pageStyle}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingBottom: 6, borderBottom: '2px solid #1a3c6e' }}>
          <div style={{ border: '1px solid #1a3c6e', borderRadius: 3, padding: '3px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 8.5, fontWeight: 700, color: '#1a3c6e', direction: 'rtl' }}>حكومـة دبـي</div>
            <div style={{ fontSize: 7.5, color: '#444' }}>GOVERNMENT OF DUBAI</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 900, color: '#1a3c6e', direction: 'rtl', fontFamily: 'Georgia, serif' }}>{isMoveIn ? 'نموذج استلام العقار' : 'نموذج تسليم العقار'}</div>
            <div style={{ fontSize: 11, fontWeight: 900, color: '#1a3c6e', letterSpacing: 1, fontFamily: 'Georgia, serif' }}>{isMoveIn ? 'MOVE-IN HANDOVER FORM' : 'MOVE-OUT HANDOVER FORM'}</div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 7.5, color: '#444' }}>
            <div style={{ fontWeight: 700, color: '#1a3c6e' }}>Contract Ref: {contract.ref}</div>
            <div>Date: {fmtDate(new Date().toISOString())}</div>
            <div>{isMoveIn ? `Move-In: ${fmtDate(contract.startDate)}` : `Move-Out: ${fmtDate(contract.endDate)}`}</div>
          </div>
        </div>

        {/* Parties */}
        <SectionHead en="Parties & Property Details" ar="تفاصيل الأطراف والعقار" />
        <div style={{ border: '1px solid #bbb', padding: '6px 8px', marginBottom: 4 }}>
          <div style={{ display: 'flex' }}>
            <Row label="Landlord / Agent" labelAr="المالك / الوكيل" cols={2} />
            <Row label="Tenant Name" labelAr="اسم المستأجر" cols={2} />
          </div>
          <div style={{ display: 'flex' }}>
            <span style={{ fontSize: 8, color: '#000', flex: 1, paddingRight: 8 }}>{landlordName}</span>
            <span style={{ fontSize: 8, color: '#000', flex: 1 }}>{contract.tenant.companyName || contract.tenant.name || ''}</span>
          </div>
          <div style={{ display: 'flex', marginTop: 4 }}>
            <Row label="Building / Property" labelAr="المبنى / العقار" cols={2} />
            <Row label="Unit No. / Floor" labelAr="رقم الوحدة / الطابق" cols={2} />
          </div>
          <div style={{ display: 'flex' }}>
            <span style={{ fontSize: 8, color: '#000', flex: 1, paddingRight: 8 }}>{contract.property.buildingName ?? contract.property.fullAddress ?? ''}</span>
            <span style={{ fontSize: 8, color: '#000', flex: 1 }}>{contract.unit.number ?? contract.unit.name ?? ''} {contract.unit.floor ? `· Floor ${contract.unit.floor}` : ''}</span>
          </div>
          <div style={{ display: 'flex', marginTop: 4 }}>
            <Row label="Unit Type" labelAr="نوع الوحدة" cols={2} />
            <Row label="Community / Emirate" labelAr="المجمع / الإمارة" cols={2} />
          </div>
          <div style={{ display: 'flex' }}>
            <span style={{ fontSize: 8, color: '#000', flex: 1, paddingRight: 8 }}>{contract.unit.type ?? ''} {contract.unit.bedrooms ? `· ${contract.unit.bedrooms} BR` : ''}</span>
            <span style={{ fontSize: 8, color: '#000', flex: 1 }}>{contract.property.community ?? contract.property.emirate ?? ''}</span>
          </div>
        </div>

        {/* Utilities */}
        <SectionHead en="Utility Meter Readings" ar="قراءات عدادات الخدمات" />
        <div style={{ border: '1px solid #bbb', padding: '6px 8px', marginBottom: 4 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            {[
              ['Utility Electricity Meter No.', 'رقم عداد الكهرباء'], ['Utility Electricity Reading', 'قراءة عداد الكهرباء'],
              ['Utility Water Meter No.', 'رقم عداد المياه'], ['Utility Water Reading', 'قراءة عداد المياه'],
              ['District Cooling / Emicool No.', 'رقم عداد التبريد المركزي'], ['Cooling Reading (TR)', 'قراءة عداد التبريد'],
              ['Gas Meter No.', 'رقم عداد الغاز'], ['Gas Reading', 'قراءة عداد الغاز'],
            ].map(([en, ar]) => <Row key={en} label={en} labelAr={ar} />)}
          </div>
        </div>

        {/* Keys */}
        <SectionHead en="Keys & Access Cards Handed Over" ar="المفاتيح وبطاقات الوصول المسلمة" />
        <div style={{ border: '1px solid #bbb', padding: '6px 8px', marginBottom: 4 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2 }}>
            {[
              ['Main Door Keys (qty)', 'مفاتيح الباب الرئيسي'],
              ['Mailbox Keys (qty)', 'مفاتيح صندوق البريد'],
              ['Parking Access Card (qty)', 'بطاقة دخول المواقف'],
              ['Building FOB / Tag (qty)', 'جهاز دخول المبنى'],
              ['Pool / Gym Access Card (qty)', 'بطاقة المسبح / الصالة'],
              ['Other Keys (describe)', 'مفاتيح أخرى'],
            ].map(([en, ar]) => <Row key={en} label={en} labelAr={ar} />)}
          </div>
        </div>
      </div>

      {/* PAGE 2 — Condition Checklist */}
      <div style={{ ...pageStyle, pageBreakBefore: 'always' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, paddingBottom: 4, borderBottom: '2px solid #1a3c6e' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: '#1a3c6e' }}>{isMoveIn ? 'MOVE-IN HANDOVER FORM' : 'MOVE-OUT HANDOVER FORM'} — Property Condition Checklist</span>
          <span style={{ fontSize: 8, color: '#666' }}>Ref: {contract.ref}</span>
        </div>

        <SectionHead en="Property Condition by Room" ar="حالة العقار حسب الغرفة" />
        <div style={{ border: '1px solid #bbb', marginBottom: 6 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f0f4fa' }}>
                <th style={{ padding: '3px 5px', fontSize: 7.5, textAlign: 'left', fontWeight: 700, borderBottom: '1px solid #ddd', width: 140 }}>Room / Area</th>
                {['Good', 'Fair', 'Poor', 'N/A'].map(h => (
                  <th key={h} style={{ padding: '3px 5px', fontSize: 7.5, textAlign: 'center', fontWeight: 700, borderBottom: '1px solid #ddd', width: 36 }}>{h}</th>
                ))}
                <th style={{ padding: '3px 5px', fontSize: 7.5, textAlign: 'left', fontWeight: 700, borderBottom: '1px solid #ddd', borderLeft: '1px solid #ddd' }}>Comments / Notes</th>
              </tr>
            </thead>
            <tbody>
              {ROOMS.map(room => <ConditionRow key={room} label={room} />)}
            </tbody>
          </table>
        </div>

        <SectionHead en="Fixtures & Fittings Condition" ar="حالة التجهيزات والمرافق" />
        <div style={{ border: '1px solid #bbb', marginBottom: 6 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f0f4fa' }}>
                <th style={{ padding: '3px 5px', fontSize: 7.5, textAlign: 'left', fontWeight: 700, borderBottom: '1px solid #ddd', width: 140 }}>Item</th>
                {['Good', 'Fair', 'Poor', 'N/A'].map(h => (
                  <th key={h} style={{ padding: '3px 5px', fontSize: 7.5, textAlign: 'center', fontWeight: 700, borderBottom: '1px solid #ddd', width: 36 }}>{h}</th>
                ))}
                <th style={{ padding: '3px 5px', fontSize: 7.5, textAlign: 'left', fontWeight: 700, borderBottom: '1px solid #ddd', borderLeft: '1px solid #ddd' }}>Comments / Notes</th>
              </tr>
            </thead>
            <tbody>
              {ITEMS_PER_ROOM.map(item => <ConditionRow key={item} label={item} />)}
            </tbody>
          </table>
        </div>

        {/* General Observations */}
        <SectionHead en="General Observations / Defects" ar="ملاحظات عامة / عيوب" />
        <div style={{ border: '1px solid #bbb', padding: '6px 8px', marginBottom: 6 }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginBottom: 7 }}>
              <span style={{ fontSize: 8, minWidth: 14 }}>{i}.</span>
              <span style={{ borderBottom: '1px dashed #888', flex: 1 }} />
            </div>
          ))}
        </div>

        {/* Signatures */}
        <SectionHead en="Acknowledgement & Signatures" ar="الإقرار والتوقيعات" />
        <div style={{ border: '1px solid #bbb', padding: '6px 8px', marginBottom: 6, fontSize: 7.5, color: '#444' }}>
          Both parties confirm that the above information is accurate and the property has been handed over in the condition stated.
          <span style={{ direction: 'rtl', display: 'block', color: '#444', marginTop: 2 }}>يقر الطرفان بأن المعلومات أعلاه دقيقة وأن العقار قد سُلّم بالحالة المذكورة.</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', border: '1px solid #bbb' }}>
          {[
            { label: isMoveIn ? 'Landlord / Agent (Handover)' : 'Tenant (Return)', labelAr: isMoveIn ? 'المالك / الوكيل' : 'المستأجر' },
            { label: isMoveIn ? 'Tenant (Receipt)' : 'Landlord / Agent (Receipt)', labelAr: isMoveIn ? 'المستأجر' : 'المالك / الوكيل' },
          ].map(({ label, labelAr }, i) => (
            <div key={i} style={{ padding: '8px', borderRight: i === 0 ? '1px solid #bbb' : 'none' }}>
              <div style={{ height: 44, borderBottom: '1px solid #ddd' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                <span style={{ fontSize: 7.5 }}>{label} <span style={{ direction: 'rtl' }}>{labelAr}</span></span>
                <span style={{ fontSize: 7.5 }}>Date التاريخ: <span style={{ borderBottom: '1px dashed #888', display: 'inline-block', width: 60 }} /></span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 12, borderTop: '1px solid #bbb', paddingTop: 4, textAlign: 'center', fontSize: 7, color: '#888' }}>
          UpNow Property Management · Ref: {contract.ref} · Generated: {fmtDate(new Date().toISOString())}
        </div>
      </div>
    </>
  );
}
