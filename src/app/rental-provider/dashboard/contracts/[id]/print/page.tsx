'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

interface ContractDetail {
  id: number;
  ref: string;
  contractType: string;
  status: string;
  startDate: string;
  endDate: string;
  durationYears: number | null;
  annualRent: number;
  contractValue: number | null;
  securityDepositAmount: number | null;
  numberOfInstallments: number | null;
  modeOfPayment: string | null;
  adminFeeFils: number;
  ejariFeeFils: number;
  customClauses: string[];
  notes: string | null;
  createdAt: string;
  tenant: { id: number | null; name: string | null; email: string | null; phone: string | null };
  landlord: { id: number | null; name: string | null; email: string | null; phone: string | null; companyName: string | null };
  property: { buildingName: string | null; fullAddress: string | null; community: string | null; emirate: string | null; plotNumber: string | null; makaniNumber: string | null };
  unit: { number: string | null; name: string | null; type: string | null; floor: string | null; bedrooms: number | null; bathrooms: number | null; sizeSqm: number | null };
}

interface Signature {
  role: 'landlord' | 'tenant';
  signatoryName: string;
  signatureImage: string | null;
  signedAt: string;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '';
  const dt = new Date(d);
  return `${dt.getDate().toString().padStart(2, '0')}-${(dt.getMonth() + 1).toString().padStart(2, '0')}-${dt.getFullYear()}`;
}
function fmtAed(v: number | null | undefined) {
  if (v == null) return '';
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
  if (n < 1000000) return numWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + numWords(n % 1000) : '');
  return numWords(Math.floor(n / 1000000)) + ' Million' + (n % 1000000 ? ' ' + numWords(n % 1000000) : '');
}
function instalmentLabel(n: number | null) {
  const map: Record<number, string> = { 1: '1 - (Single Payment)', 2: '2 - (Two Payments)', 3: '3 - (Three Payments)', 4: '4 - (Four Payments)', 6: '6 - (Six Payments)', 12: '12 - (Twelve Payments)' };
  return n ? (map[n] || `${n} Cheques`) : '';
}

function Field({ label, labelAr, value, half }: { label: string; labelAr: string; value?: string | null; half?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginBottom: 5, width: half ? '50%' : '100%', paddingRight: half ? 6 : 0 }}>
      <span style={{ fontSize: 8.5, color: '#222', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ flex: 1, borderBottom: '1px dashed #888', minWidth: 20, fontSize: 8.5, paddingBottom: 1, paddingLeft: 3, color: '#000' }}>{value || ''}</span>
      <span style={{ fontSize: 8, color: '#444', whiteSpace: 'nowrap', direction: 'rtl' }}>{labelAr}</span>
    </div>
  );
}

function SectionHeader({ en, ar }: { en: string; ar: string }) {
  return (
    <div style={{ background: '#1a3c6e', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', marginBottom: 6 }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, color: '#fff' }}>{en}</span>
      <span style={{ fontSize: 9.5, fontWeight: 700, color: '#fff', direction: 'rtl' }}>{ar}</span>
    </div>
  );
}

function SigBox({ sig, label, labelAr }: { sig?: Signature | null; label: string; labelAr: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {sig?.signatureImage
          ? <img src={sig.signatureImage} alt="signature" style={{ maxHeight: 48, maxWidth: '90%', objectFit: 'contain' }} />
          : <span style={{ fontSize: 7, color: '#bbb', fontStyle: 'italic' }}>Not yet signed</span>
        }
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #bbb', paddingTop: 3 }}>
        <span style={{ fontSize: 8 }}>{label} <span style={{ direction: 'rtl', fontSize: 8 }}>{labelAr}</span></span>
        <span style={{ fontSize: 8 }}>
          {sig?.signedAt ? fmtDate(sig.signedAt) : <span style={{ borderBottom: '1px dashed #888', display: 'inline-block', width: 72, marginLeft: 2 }} />}
          {' '}<span style={{ direction: 'rtl', fontSize: 7 }}>التاريخ</span>
        </span>
      </div>
    </div>
  );
}

function SigRow({ tenantSig, landlordSig }: { tenantSig?: Signature | null; landlordSig?: Signature | null }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
      <div style={{ borderRight: '1px solid #bbb', padding: '4px 8px' }}>
        <SigBox sig={tenantSig} label="Tenant Signature" labelAr="توقيع المستأجر" />
      </div>
      <div style={{ padding: '4px 8px' }}>
        <SigBox sig={landlordSig} label="Lessor's Signature" labelAr="توقيع المؤجر" />
      </div>
    </div>
  );
}

function SigSection({ tenantSig, landlordSig }: { tenantSig?: Signature | null; landlordSig?: Signature | null }) {
  return (
    <>
      <div style={{ background: '#1a3c6e', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', marginTop: 10 }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: '#fff' }}>Signatures</span>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: '#fff', direction: 'rtl' }}>التوقيعات</span>
      </div>
      <div style={{ border: '1px solid #bbb', borderTop: 'none' }}>
        <SigRow tenantSig={tenantSig} landlordSig={landlordSig} />
      </div>
    </>
  );
}

function DLDHeader() {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingBottom: 6, borderBottom: '2px solid #1a3c6e' }}>
      <div style={{ border: '1px solid #1a3c6e', borderRadius: 3, padding: '3px 10px', textAlign: 'center' }}>
        <div style={{ fontSize: 8.5, fontWeight: 700, color: '#1a3c6e', direction: 'rtl' }}>حكومـة دبـي</div>
        <div style={{ fontSize: 7.5, color: '#444' }}>GOVERNMENT OF DUBAI</div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 17, fontWeight: 900, color: '#1a3c6e', letterSpacing: 5, direction: 'rtl', fontFamily: 'Georgia, serif' }}>عـقـد إيـجـار</div>
        <div style={{ fontSize: 13, fontWeight: 900, color: '#1a3c6e', letterSpacing: 3, fontFamily: 'Georgia, serif' }}>TENANCY CONTRACT</div>
      </div>
      <div style={{ textAlign: 'center', border: '1px solid #1a3c6e', borderRadius: 3, padding: '3px 10px' }}>
        <div style={{ fontSize: 8.5, fontWeight: 700, color: '#1a3c6e', direction: 'rtl' }}>دائرة الأراضي والأملاك</div>
        <div style={{ fontSize: 7.5, color: '#444' }}>Land Department</div>
      </div>
    </div>
  );
}

const TERMS_EN = [
  "The tenant has inspected the premises and agreed to lease the unit on its current condition.",
  "Tenant undertakes to use the premises for designated purpose, tenant has no rights to transfer or relinquish the tenancy contract either with or without counterpart to any without landlord written approval. Also, tenant is not allowed to sublease the premises or any part thereof to third party in whole or in part unless it is legally permitted.",
  "The tenant undertakes not to make any amendments, modifications or addendums to the premises subject of the contract without obtaining the landlord written approval. Tenant shall be liable for any damages or failure due to that.",
  "The tenant shall be responsible for payment of all electricity, water, cooling and gas charges resulting of occupying leased unit unless other condition agreed in written.",
  "The tenant must pay the rent amount in the manner and dates agreed with the landlord.",
  "The tenant fully undertakes to comply with all the regulations and instructions related to the management of the property and the use of the premises and of common areas such (parking, swimming pools, gymnasium, etc…).",
  "Tenancy contract parties declare all mentioned emails addresses and phone numbers are correct, all formal and legal notifications will be sent to those addresses in case of dispute between parties.",
  "The landlord undertakes to enable the tenant of the full use of the premises including its facilities (swimming pool, gym, parking lot, etc) and do the regular maintenance as intended unless other condition agreed in written, and not to do any act that would detract from the premises benefit.",
  "By signing this agreement from the first party, the \"Landlord\" hereby confirms and undertakes that he is the current owner of the property or his legal representative under legal power of attorney duly entitled by the competent authorities.",
  "Any disagreement or dispute may arise from execution or interpretation of this contract shall be settled by the Rental Dispute Center.",
  "This contract is subject to all provisions of Law No (26) of 2007 regulating the relation between landlords and tenants in the emirate of Dubai as amended, and as it will be changed or amended from time to time, as long with any related legislations and regulations applied in the emirate of Dubai.",
  "Any additional condition will not be considered in case it conflicts with law.",
  "In case of discrepancy occurs between Arabic and non Arabic texts with regards to the interpretation of this agreement or the scope of its application, the Arabic text shall prevail.",
  "The landlord undertakes to register this tenancy contract on EJARI affiliated to Dubai Land Department and provide with all required documents.",
];

const TERMS_AR = [
  "عاين المستأجر الوحدة موضوع الايجار ووافق على استئجار العقار على حالته الحالية.",
  "يتعهد المستأجر باستعمال المأجور للغرض المخصص له، و لا يجوز للمستأجر تحويل أو التنازل عن عقد الايجار للغير بمقابل أو دون مقابل دون موافقة المالك خطيا، كما لا يجوز للمستأجر تأجير المأجور أو أي جزء منه من الباطن مالم يسمح بذلك قانونا.",
  "يتعهد المستأجر بعدم إجراء أي تعديلات أو إضافات على العقار موضوع العقد دون موافقة المالك الخطية، و يكون المستأجر مسؤولا عن أي أضرار أو نقص أو تلف يلحق بالعقار.",
  "يكون المستأجر مسؤولا عن سداد كافة فواتير الكهرباء و المياه و التبريد و الغاز المترتبة عن اشغاله المأجور مالم يتم الاتفاق على غير ذلك كتابيا.",
  "يتعهد المستأجر بسداد مبلغ الايجار المتفق عليه في هذا العقد في التواريخ و الطريقة المتفق عليها.",
  "يلتزم المستأجر التقيد التام بالانظمة و التعليمات المتعلقة باستخدام المأجور و المنافع المشتركة (كمواقف السيارات، أحواض السباحة، النادي الصحي، الخ).",
  "يقر أطراف التعاقد بصحة العناوين و أرقام الهواتف المذكورة أعلاه، و تكون تلك العناوين هي المعتمدة رسميا للإخطارات و الأعلانات القضائية في حال نشوء أي نزاع بين أطراف العقد.",
  "يتعهد المؤجر بتمكين المستأجر من الانتفاع التام بالعقار للغرض المؤجر لأجله و المرافق الخاصة به (حوض سباحة، نادي صحي، مواقف سيارات... الخ) كما يكون مسؤولا عن أعمال الصيانة مالم يتم الاتفاق على غير ذلك، و عدم التعرض له في منفعة العقار.",
  "يعتبر توقيع المؤجر على هذا العقد إقرار منه بأنه المالك الحالي للعقار أو الوكيل القانوني للمالك بموجب وكالة قانونية موثقة وفق الأصول لدى الجهات المختصة.",
  "أي خلاف أو نزاع قد ينشأ عن تنفيذ أو تفسير هذا العقد يعود البت فيه لمركز فض المنازعات الإيجارية.",
  "يخضع هذا العقد لكافة أحكام القانون رقم (26) لسنة 2007 بشأن تنظيم العلاقة بين مؤجري و مستأجري العقارات في إمارة دبي، و تعديلاته و أي تغيير أو تعديل يطرأ عليه من وقت لآخر.",
  "لا يعتد بأي شرط تم إضافته إلى هذا العقد في حال تعارضه مع القانون.",
  "في حال حدوث أي تعارض أو اختلاف في التفسير بين النص العربي و النص الأجنبي يعتمد النص العربي.",
  "يتعهد المؤجر بتسجيل عقد الايجار في نظام إيجاري التابع لدائرة الأراضي و الأملاك و توفير كافة المستندات اللازمة لذلك.",
];

export default function ContractPrintPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const autoDownload = searchParams?.get('download') === '1';
  const [contract, setContract] = useState<ContractDetail | null>(null);
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    Promise.all([
      fetch(`/api/contracts/${params.id}`, { credentials: 'include' }).then(r => {
        if (!r.ok) throw new Error(`Error ${r.status}`);
        return r.json();
      }),
      fetch(`/api/contracts/${params.id}/signatures`, { credentials: 'include' }).then(r =>
        r.ok ? r.json() : []
      ),
    ])
      .then(([data, sigs]) => {
        setContract(data);
        setSignatures(Array.isArray(sigs) ? sigs : []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [params?.id]);

  useEffect(() => {
    if (contract && autoDownload) {
      const t = setTimeout(() => window.print(), 800);
      return () => clearTimeout(t);
    }
  }, [contract, autoDownload]);

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Loader2 className="animate-spin" size={32} style={{ color: '#1a3c6e' }} />
    </div>
  );
  if (error || !contract) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c00', padding: 32 }}>
      Failed to load contract: {error}
    </div>
  );

  const rent = contract.annualRent;
  const contractValue = contract.contractValue ?? rent;
  const deposit = contract.securityDepositAmount ?? 0;
  const installments = contract.numberOfInstallments ?? 4;
  const mopText = contract.modeOfPayment || instalmentLabel(installments);
  const landlordName = contract.landlord.companyName ?? contract.landlord.name ?? '';
  const unitType = contract.unit.type ? contract.unit.type.charAt(0).toUpperCase() + contract.unit.type.slice(1) : '';
  const unitTypeLC = (contract.unit.type ?? '').toLowerCase();
  const isCommercial = unitTypeLC.includes('commercial');
  const isIndustrial = unitTypeLC.includes('industrial');
  const isResidential = !isCommercial && !isIndustrial;
  const landlordSig = signatures.find(s => s.role === 'landlord') ?? null;
  const tenantSig = signatures.find(s => s.role === 'tenant') ?? null;

  const filledClauses: string[] = [
    ...(contract.customClauses ?? []),
    ...(contract.notes ? [contract.notes] : []),
  ];
  // Always show at least 5 blank rows; expand dynamically if there are more
  const minRows = 5;
  const additionalTerms: string[] = [...filledClauses];
  while (additionalTerms.length < minRows) additionalTerms.push('');

  const pageStyle: React.CSSProperties = {
    maxWidth: 794,
    margin: '0 auto',
    padding: '18px 22px',
    fontSize: 9,
    lineHeight: 1.5,
    fontFamily: 'Arial, sans-serif',
    color: '#111',
  };

  return (
    <>
      <style>{`
        @page { size: A4; margin: 12mm 10mm; }
        @media print {
          .no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        * { box-sizing: border-box; }
      `}</style>

      {/* Screen toolbar */}
      <div className="no-print" style={{ background: '#fff', borderBottom: '1px solid #ddd', padding: '10px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 10, boxShadow: '0 1px 4px rgba(0,0,0,.08)' }}>
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>Ejari Tenancy Contract — {contract.ref}</p>
          <p style={{ margin: 0, fontSize: 12, color: '#666' }}>Official DLD format · Preview or save as PDF</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => window.close()} style={{ padding: '6px 16px', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>✕ Close</button>
          <button onClick={() => window.print()} style={{ padding: '6px 16px', background: '#1a3c6e', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
            ⬇ Download PDF
          </button>
        </div>
      </div>

      {/* ═══ PAGE 1 ═══ */}
      <div style={pageStyle}>
        <DLDHeader />

        {/* Date */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginBottom: 10 }}>
          <span style={{ fontSize: 8.5, direction: 'rtl' }}>التاريخ</span>
          <span style={{ borderBottom: '1px dashed #888', display: 'inline-block', minWidth: 130, fontSize: 8.5, paddingLeft: 4, color: '#000' }}>
            {fmtDate(new Date().toISOString())}
          </span>
          <span style={{ fontSize: 8.5 }}>Date</span>
        </div>

        {/* Owner / Lessor */}
        <div style={{ border: '1px solid #bbb', marginBottom: 5 }}>
          <SectionHeader en="Owner / Lessor Information" ar="معلومات المالك/ المؤجر" />
          <div style={{ padding: '4px 8px 2px' }}>
            <Field label="Owner's Name" labelAr="اسم المالك" value={landlordName} />
            <Field label="Lessor's Name" labelAr="اسم المؤجر" value={landlordName} />
            <Field label="Lessor's Emirates ID" labelAr="الهوية اللإماراتية للمؤجر" value="" />
            <div style={{ display: 'flex' }}>
              <Field label="License No. (Incase of a Company)" labelAr="رقم الرخصة" value="" half />
              <Field label="Licensing Authority (Incase of a Company)" labelAr="سلطة الترخيص" value="" half />
            </div>
            <Field label="Lessor's Email" labelAr="البريد اللإلكتروني للمؤجر" value={contract.landlord.email ?? ''} />
            <Field label="Lessor's Phone" labelAr="رقم هاتف المؤجر" value={contract.landlord.phone ?? ''} />
          </div>
        </div>

        {/* Tenant */}
        <div style={{ border: '1px solid #bbb', marginBottom: 5 }}>
          <SectionHeader en="Owner / Lessor Information" ar="معلومات المستأجر" />
          <div style={{ padding: '4px 8px 2px' }}>
            <Field label="Tenant's Name" labelAr="اسم المستأجر" value={contract.tenant.name ?? ''} />
            <Field label="Tenant's Emirates ID" labelAr="الهوية الإماراتية للمستأجر" value="" />
            <div style={{ display: 'flex' }}>
              <Field label="License No. (Incase of a Company)" labelAr="رقم الرخصة" value="" half />
              <Field label="Licensing Authority (Incase of a Company)" labelAr="سلطة الترخيص" value="" half />
            </div>
            <Field label="Tenant's Email" labelAr="البريد الإلكتروني للمستأجر" value={contract.tenant.email ?? ''} />
            <Field label="Tenant's Phone" labelAr="رقم هاتف المستأجر" value={contract.tenant.phone ?? ''} />
          </div>
        </div>

        {/* Property */}
        <div style={{ border: '1px solid #bbb', marginBottom: 5 }}>
          <SectionHeader en="Property Information" ar="معلومات العقار" />
          <div style={{ padding: '4px 8px 2px' }}>
            {/* Usage */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 5 }}>
              <span style={{ fontSize: 8.5 }}>Property Usage  استخدام العقار</span>
              {[
                { label: 'Residential', labelAr: 'سكني', checked: isResidential },
                { label: 'Commercial', labelAr: 'تجاري', checked: isCommercial },
                { label: 'Industrial', labelAr: 'صناعي', checked: isIndustrial },
              ].map(({ label, labelAr, checked }) => (
                <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 8.5, cursor: 'default' }}>
                  <span style={{
                    width: 11, height: 11, borderRadius: '50%', border: '1.5px solid #555',
                    display: 'inline-block', flexShrink: 0,
                    background: checked ? '#1a3c6e' : 'transparent',
                  }} />
                  <span>{label}</span>
                  <span style={{ direction: 'rtl', fontSize: 8 }}>{labelAr}</span>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex' }}>
              <Field label="Plot No." labelAr="رقم الأرض" value={contract.property.plotNumber ?? ''} half />
              <Field label="Makani No." labelAr="رقم مكاني" value={contract.property.makaniNumber ?? ''} half />
            </div>
            <div style={{ display: 'flex' }}>
              <Field label="Building Name" labelAr="اسم المبنى" value={contract.property.buildingName ?? ''} half />
              <Field label="Property No." labelAr="رقم العقار" value={contract.unit.number ?? contract.unit.name ?? ''} half />
            </div>
            <div style={{ display: 'flex' }}>
              <Field label="Property Type" labelAr="نوع الوحدة" value={unitType} half />
              <Field label="Property Area (s.m)" labelAr="مساحة العقار (متر.مربع)" value={contract.unit.sizeSqm ? String(contract.unit.sizeSqm) : ''} half />
            </div>
            <div style={{ display: 'flex' }}>
              <Field label="Location" labelAr="الموقع" value={contract.property.fullAddress ?? contract.property.community ?? contract.property.emirate ?? ''} half />
              <Field label="Premises No. (DEWA)" labelAr="رقم المبنى (ديوا)" value="" half />
            </div>
          </div>
        </div>

        {/* Contract */}
        <div style={{ border: '1px solid #bbb', marginBottom: 5 }}>
          <SectionHeader en="Contract Information" ar="معلومات العقد" />
          <div style={{ padding: '4px 8px 2px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginBottom: 5, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 8.5, whiteSpace: 'nowrap' }}>Contract Period  فترة العقد</span>
              <span style={{ fontSize: 8.5, whiteSpace: 'nowrap' }}>From من</span>
              <span style={{ borderBottom: '1px dashed #888', width: 70, fontSize: 8.5, paddingLeft: 3, color: '#000' }}>{fmtDate(contract.startDate)}</span>
              <span style={{ fontSize: 8.5, whiteSpace: 'nowrap' }}>To إلى</span>
              <span style={{ borderBottom: '1px dashed #888', width: 70, fontSize: 8.5, paddingLeft: 3, color: '#000' }}>{fmtDate(contract.endDate)}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 8.5, whiteSpace: 'nowrap' }}>Contract Value  قيمة العقد</span>
              <span style={{ borderBottom: '1px dashed #888', flex: 1, minWidth: 90, fontSize: 8.5, paddingLeft: 3, color: '#000' }}>
                {contractValue > 0 ? `${fmtAed(contractValue)} (${numWords(contractValue)})` : ''}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginBottom: 5 }}>
              <span style={{ fontSize: 8.5, whiteSpace: 'nowrap' }}>Annual Rent  الايجار السنوي</span>
              <span style={{ borderBottom: '1px dashed #888', flex: 1, fontSize: 8.5, paddingLeft: 3, color: '#000' }}>
                {rent > 0 ? `${fmtAed(rent)} (${numWords(rent)})` : ''}
              </span>
              <span style={{ fontSize: 8.5, whiteSpace: 'nowrap', marginLeft: 10 }}>Security Deposit Amount  مبلغ التأمين</span>
              <span style={{ borderBottom: '1px dashed #888', minWidth: 80, fontSize: 8.5, paddingLeft: 3, color: '#000' }}>
                {deposit > 0 ? fmtAed(deposit) : ''}
              </span>
            </div>
            <Field label="Mode of Payment" labelAr="طريقة الدفع" value={mopText} />
          </div>
        </div>

        <SigSection tenantSig={tenantSig} landlordSig={landlordSig} />
      </div>

      {/* ═══ PAGE 2 — Terms & Conditions ═══ */}
      <div style={{ ...pageStyle, pageBreakBefore: 'always' }}>
        <DLDHeader />
        <div style={{ border: '1px solid #bbb' }}>
          <SectionHeader en="Terms and Conditions" ar="الأحكام و الشروط" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid #e0e0e0' }}>
            <div style={{ padding: '6px 8px', borderRight: '1px solid #ddd' }}>
              {TERMS_EN.map((t, i) => (
                <p key={i} style={{ marginBottom: 5, fontSize: 8, textAlign: 'justify', margin: '0 0 5px 0' }}>{i + 1}. {t}</p>
              ))}
            </div>
            <div style={{ padding: '6px 8px', direction: 'rtl', textAlign: 'right' }}>
              {TERMS_AR.map((t, i) => (
                <p key={i} style={{ marginBottom: 5, fontSize: 8, textAlign: 'justify', margin: '0 0 5px 0' }}>
                  .{i + 1} {t}
                </p>
              ))}
            </div>
          </div>
        </div>
        <SigSection tenantSig={tenantSig} landlordSig={landlordSig} />
      </div>

      {/* ═══ PAGE 3 — Rights / Additional Terms ═══ */}
      <div style={{ ...pageStyle, pageBreakBefore: 'always' }}>
        <DLDHeader />

        {/* Know your Rights */}
        <div style={{ border: '1px solid #bbb', marginBottom: 5 }}>
          <SectionHeader en="Know your Rights" ar="لمعرفة حقوق الأطراف" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            <div style={{ padding: '5px 8px', borderRight: '1px solid #ddd', fontSize: 8 }}>
              <p style={{ margin: '0 0 4px' }}>• You may visit Rental Dispute Center website through <strong>www.dubailand.gov.ae</strong> in case of any rental dispute between parties.</p>
              <p style={{ margin: '0 0 4px' }}>• Law No 26 of 2007 regulating relationship between landlords and tenants.</p>
              <p style={{ margin: '0 0 4px' }}>• Law No 33 of 2008 amending law 26 of year 2007.</p>
              <p style={{ margin: 0 }}>• Law No 43 of 2013 determining rent increases for properties.</p>
            </div>
            <div style={{ padding: '5px 8px', direction: 'rtl', textAlign: 'right', fontSize: 8 }}>
              <p style={{ margin: '0 0 4px' }}>• يمكنكم زيارة موقع مركز فض المنازعات الإيجارية من خلال <strong>www.dubailand.gov.ae</strong></p>
              <p style={{ margin: '0 0 4px' }}>• الإطلاع على قانون رقم 26 لسنة 2007 بشأن تنظيم العلاقة بين المؤجرين والمستأجرين.</p>
              <p style={{ margin: '0 0 4px' }}>• الإطلاع على قانون رقم 33 لسنة 2008 الخاص بتعديل بعض أحكام قانون 26 لعام 2007.</p>
              <p style={{ margin: 0 }}>• الإطلاع على قانون رقم 43 لسنة 2013 بشأن تحديد زيادة بدل الإيجار.</p>
            </div>
          </div>
        </div>

        {/* Attachments */}
        <div style={{ border: '1px solid #bbb', marginBottom: 5 }}>
          <SectionHeader en="Attachments for Ejari Registration" ar="مرفقات التسجيل في إيجاري" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            <div style={{ padding: '5px 8px', borderRight: '1px solid #ddd', fontSize: 8 }}>
              <p style={{ margin: '0 0 3px' }}>1. Original unified tenancy contract</p>
              <p style={{ margin: 0 }}>2. Original emirates ID of applicant</p>
            </div>
            <div style={{ padding: '5px 8px', direction: 'rtl', textAlign: 'right', fontSize: 8 }}>
              <p style={{ margin: '0 0 3px' }}>.١ نسخة أصلية عن عقد الايجار الموحد</p>
              <p style={{ margin: 0 }}>.٢ الهوية الإماراتية الأصلية لمقدم الطلب</p>
            </div>
          </div>
        </div>

        {/* Additional Terms */}
        <div style={{ border: '1px solid #bbb', marginBottom: 5 }}>
          <SectionHeader en="Additional Terms" ar="شروط إضافية" />
          <div style={{ padding: '6px 10px' }}>
            {additionalTerms.map((term, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginBottom: 9 }}>
                <span style={{ fontSize: 8.5, minWidth: 14 }}>{i + 1}.</span>
                <span style={{ borderBottom: '1px dashed #888', flex: 1, fontSize: 8.5, paddingLeft: 4, paddingBottom: 1, color: '#000' }}>{term}</span>
                <span style={{ fontSize: 8.5, direction: 'rtl', minWidth: 14 }}>.{(i + 1).toLocaleString('ar-AE')}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: '0 10px 6px', display: 'flex', justifyContent: 'space-between', gap: 20 }}>
            <span style={{ fontSize: 7.5, color: '#555' }}>
              Note: You may add addendum to this tenancy contract in case you have additional terms while it needs to be signed by all parties.
            </span>
            <span style={{ fontSize: 7.5, color: '#555', direction: 'rtl', textAlign: 'right' }}>
              ملاحظة: يمكن إضافة ملحق إلى هذا العقد في حال وجود أي شروط إضافية، على أن يوقع من أطراف التعاقد.
            </span>
          </div>
        </div>

        <SigSection tenantSig={tenantSig} landlordSig={landlordSig} />

        {/* Footer */}
        <div style={{ marginTop: 18, borderTop: '1px solid #bbb', paddingTop: 5, textAlign: 'center', fontSize: 7.5, color: '#555' }}>
          Tel: 8004488 &nbsp;|&nbsp; Fax: +971 4 222 2251 &nbsp;|&nbsp; P.O.Box 1166, Dubai, U.A.E. &nbsp;|&nbsp; E-mail: support@dubailand.gov.ae &nbsp;|&nbsp; Website: www.dubailand.gov.ae
          <br />
          <span style={{ fontSize: 7, color: '#888' }}>Ref: {contract.ref} · Generated: {fmtDate(new Date().toISOString())}</span>
        </div>
      </div>
    </>
  );
}
