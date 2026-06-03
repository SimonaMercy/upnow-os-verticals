/**
 * UAE Unified Tenancy Contract — real vector PDF via @react-pdf/renderer.
 * Emirate-aware: the registration system (Ejari / Tawtheeq / municipal), governing
 * law, rental-dispute body, utility authority (DEWA/ADDC/SEWA/FEWA) and header
 * branding are derived from the property's emirate via lib/tenancyJurisdiction
 * (defaults to Dubai). Reliable multi-page, crisp text, Arabic (Amiri). Client-only
 * (PDFViewer/PDFDownloadLink need the browser); load via next/dynamic ssr:false.
 */
'use client';

import React from 'react';
import {
  Document, Page, View, Text, Image, Font, PDFViewer, PDFDownloadLink,
} from '@react-pdf/renderer';
import { jurisdictionForEmirate, type TenancyJurisdiction } from '@/lib/tenancyJurisdiction';

Font.register({
  family: 'Amiri',
  fonts: [
    { src: '/fonts/Amiri-Regular.ttf' },
    { src: '/fonts/Amiri-Bold.ttf', fontWeight: 700 },
  ],
});
// Avoid hyphenation breaking words mid-line
Font.registerHyphenationCallback((w) => [w]);

const NAVY = '#1a3c6e';
const AR = 'Amiri';

export interface EjariParty { name: string | null; email: string | null; phone: string | null; companyName?: string | null; emiratesId?: string | null; licenseNumber?: string | null; licenseAuthority?: string | null }
export interface EjariContractData {
  ref: string;
  startDate: string; endDate: string; createdAt: string;
  annualRent: number; contractValue: number | null; securityDepositAmount: number | null;
  modeOfPayment: string | null; customClauses?: string[]; notes?: string | null;
  landlord: EjariParty;
  tenant: EjariParty;
  property: { buildingName: string | null; fullAddress: string | null; community: string | null; emirate: string | null; plotNumber: string | null; makaniNumber: string | null; premisesNumber?: string | null; spaceCategory?: string | null };
  unit: { number: string | null; name: string | null; type: string | null; sizeSqm: number | null; dewaPremiseNumber?: string | null };
  signatures?: { role: 'landlord' | 'tenant'; signatureImage: string | null; signedAt: string }[];
}
export interface EjariAddendum { id: number; name: string; fileUrl: string; mimeType: string; tenantSig: string | null; tenantSignedAt: string | null; landlordSig: string | null; landlordSignedAt: string | null; /** Extracted text lines (DOCX), rendered inline across pages. */ lines?: string[] }

const fmtDate = (d?: string | null) => {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}-${p(dt.getMonth() + 1)}-${dt.getFullYear()}`;
};
const fmtAed = (v?: number | null) => (v == null ? '' : `AED ${Number(v).toLocaleString('en-US')}`);
function numWords(n: number): string {
  const o = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const t = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  n = Math.round(n);
  if (n === 0) return 'Zero';
  if (n < 20) return o[n];
  if (n < 100) return t[Math.floor(n / 10)] + (n % 10 ? '-' + o[n % 10] : '');
  if (n < 1000) return o[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + numWords(n % 100) : '');
  if (n < 1e6) return numWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + numWords(n % 1000) : '');
  return numWords(Math.floor(n / 1e6)) + ' Million' + (n % 1e6 ? ' ' + numWords(n % 1e6) : '');
}

/** Treat short ALL-CAPS lines as section headings in extracted addendum text. */
const isHeading = (s: string) => s.length < 46 && s === s.toUpperCase() && /[A-Z]/.test(s);

const TERMS_EN = [
  'The tenant has inspected the premises and agreed to lease the unit on its current condition.',
  'Tenant undertakes to use the premises for designated purpose, tenant has no rights to transfer or relinquish the tenancy contract either with or without counterpart to any without landlord written approval. Also, tenant is not allowed to sublease the premises or any part thereof to third party in whole or in part unless it is legally permitted.',
  'The tenant undertakes not to make any amendments, modifications or addendums to the premises subject of the contract without obtaining the landlord written approval. Tenant shall be liable for any damages or failure due to that.',
  'The tenant shall be responsible for payment of all electricity, water, cooling and gas charges resulting of occupying leased unit unless other condition agreed in written.',
  'The tenant must pay the rent amount in the manner and dates agreed with the landlord.',
  'The tenant fully undertakes to comply with all the regulations and instructions related to the management of the property and the use of the premises and of common areas such (parking, swimming pools, gymnasium, etc…).',
  'Tenancy contract parties declare all mentioned emails addresses and phone numbers are correct, all formal and legal notifications will be sent to those addresses in case of dispute between parties.',
  'The landlord undertakes to enable the tenant of the full use of the premises including its facilities (swimming pool, gym, parking lot, etc) and do the regular maintenance as intended unless other condition agreed in written, and not to do any act that would detract from the premises benefit.',
  'By signing this agreement from the first party, the "Landlord" hereby confirms and undertakes that he is the current owner of the property or his legal representative under legal power of attorney duly entitled by the competent authorities.',
  'Any disagreement or dispute may arise from execution or interpretation of this contract shall be settled by the Rental Dispute Center.',
  'This contract is subject to all provisions of Law No (26) of 2007 regulating the relation between landlords and tenants in the emirate of Dubai as amended, and as it will be changed or amended from time to time, as long with any related legislations and regulations applied in the emirate of Dubai.',
  'Any additional condition will not be considered in case it conflicts with law.',
  'In case of discrepancy occurs between Arabic and non Arabic texts with regards to the interpretation of this agreement or the scope of its application, the Arabic text shall prevail.',
  'The landlord undertakes to register this tenancy contract on EJARI affiliated to Dubai Land Department and provide with all required documents.',
];
const TERMS_AR = [
  'عاين المستأجر الوحدة موضوع الايجار ووافق على استئجار العقار على حالته الحالية.',
  'يتعهد المستأجر باستعمال المأجور للغرض المخصص له، و لا يجوز للمستأجر تحويل أو التنازل عن عقد الايجار للغير بمقابل أو دون مقابل دون موافقة المالك خطيا، كما لا يجوز للمستأجر تأجير المأجور أو أي جزء منه من الباطن مالم يسمح بذلك قانونا.',
  'يتعهد المستأجر بعدم إجراء أي تعديلات أو إضافات على العقار موضوع العقد دون موافقة المالك الخطية، و يكون المستأجر مسؤولا عن أي أضرار أو نقص أو تلف يلحق بالعقار.',
  'يكون المستأجر مسؤولا عن سداد كافة فواتير الكهرباء و المياه و التبريد و الغاز المترتبة عن اشغاله المأجور مالم يتم الاتفاق على غير ذلك كتابيا.',
  'يتعهد المستأجر بسداد مبلغ الايجار المتفق عليه في هذا العقد في التواريخ و الطريقة المتفق عليها.',
  'يلتزم المستأجر التقيد التام بالانظمة و التعليمات المتعلقة باستخدام المأجور و المنافع المشتركة (كمواقف السيارات، أحواض السباحة، النادي الصحي، الخ).',
  'يقر أطراف التعاقد بصحة العناوين و أرقام الهواتف المذكورة أعلاه، و تكون تلك العناوين هي المعتمدة رسميا للإخطارات و الأعلانات القضائية في حال نشوء أي نزاع بين أطراف العقد.',
  'يتعهد المؤجر بتمكين المستأجر من الانتفاع التام بالعقار للغرض المؤجر لأجله و المرافق الخاصة به (حوض سباحة، نادي صحي، مواقف سيارات... الخ) كما يكون مسؤولا عن أعمال الصيانة مالم يتم الاتفاق على غير ذلك، و عدم التعرض له في منفعة العقار.',
  'يعتبر توقيع المؤجر على هذا العقد إقرار منه بأنه المالك الحالي للعقار أو الوكيل القانوني للمالك بموجب وكالة قانونية موثقة وفق الأصول لدى الجهات المختصة.',
  'أي خلاف أو نزاع قد ينشأ عن تنفيذ أو تفسير هذا العقد يعود البت فيه لمركز فض المنازعات الإيجارية.',
  'يخضع هذا العقد لكافة أحكام القانون رقم (26) لسنة 2007 بشأن تنظيم العلاقة بين مؤجري و مستأجري العقارات في إمارة دبي، و تعديلاته و أي تغيير أو تعديل يطرأ عليه من وقت لآخر.',
  'لا يعتد بأي شرط تم إضافته إلى هذا العقد في حال تعارضه مع القانون.',
  'في حال حدوث أي تعارض أو اختلاف في التفسير بين النص العربي و النص الأجنبي يعتمد النص العربي.',
  'يتعهد المؤجر بتسجيل عقد الايجار في نظام إيجاري التابع لدائرة الأراضي و الأملاك و توفير كافة المستندات اللازمة لذلك.',
];

// Terms 10 (dispute body), 11 (governing law) and 14 (registration system)
// are jurisdiction-specific — substitute them from the property's emirate so the
// contract isn't hard-wired to Dubai. The other terms are emirate-agnostic.
function buildTermsEn(j: TenancyJurisdiction): string[] {
  const t = [...TERMS_EN];
  t[9] = `Any disagreement or dispute may arise from execution or interpretation of this contract shall be settled by ${j.disputeBodyEn}.`;
  t[10] = j.governingLawEn;
  t[13] = `The landlord undertakes to register this tenancy contract on ${j.registrationEn} affiliated to ${j.authorityEn} and provide with all required documents.`;
  return t;
}
function buildTermsAr(j: TenancyJurisdiction): string[] {
  const t = [...TERMS_AR];
  t[9] = `أي خلاف أو نزاع قد ينشأ عن تنفيذ أو تفسير هذا العقد يعود البت فيه إلى ${j.disputeBodyAr}.`;
  t[10] = j.governingLawAr;
  t[13] = `يتعهد المؤجر بتسجيل عقد الايجار في ${j.registrationAr} التابع لـ${j.authorityAr} و توفير كافة المستندات اللازمة لذلك.`;
  return t;
}

const S = {
  page: { paddingTop: 22, paddingBottom: 20, paddingHorizontal: 24, fontSize: 8, fontFamily: 'Helvetica', color: '#111' },
  bar: { backgroundColor: NAVY, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3, paddingHorizontal: 6 },
  barEn: { color: '#fff', fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
  barAr: { color: '#fff', fontSize: 8.5, fontFamily: AR },
  box: { borderWidth: 1, borderColor: '#bbb', marginBottom: 5 },
  pad: { paddingHorizontal: 6, paddingTop: 4, paddingBottom: 2 },
  enLbl: { fontSize: 7.5, color: '#222' },
  arLbl: { fontSize: 7.5, color: '#444', fontFamily: AR },
  line: { flexGrow: 1, fontSize: 7.5, borderBottomWidth: 1, borderBottomColor: '#888', borderBottomStyle: 'dashed', marginHorizontal: 3, paddingBottom: 1, color: '#000' },
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Bar = ({ en, ar }: { en: string; ar: string }) => (
  <View style={S.bar as any}><Text style={S.barEn}>{en}</Text><Text style={S.barAr}>{ar}</Text></View>
);
const Field = ({ label, ar, value, half }: { label: string; ar: string; value?: string | null; half?: boolean }) => (
  <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 4, width: half ? '50%' : '100%', paddingRight: half ? 6 : 0 }}>
    <Text style={S.enLbl}>{label}</Text>
    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
    <Text style={S.line as any}>{value || ' '}</Text>
    <Text style={S.arLbl}>{ar}</Text>
  </View>
);
// Small grey "Incase of a Company / في حال كانت شركة" hint under the License row,
// mirroring the official DLD form (one half under License No., one under Authority).
const CompanyCaption = () => (
  <View style={{ flexDirection: 'row', marginTop: -3, marginBottom: 4 }}>
    {[0, 1].map((i) => (
      <View key={i} style={{ width: '50%', flexDirection: 'row', justifyContent: 'space-between', paddingRight: i === 0 ? 6 : 0 }}>
        <Text style={{ fontSize: 6, color: '#999' }}>Incase of a Company</Text>
        <Text style={{ fontSize: 6, color: '#999', fontFamily: AR }}>في حال كانت شركة</Text>
      </View>
    ))}
  </View>
);
const Section = ({ en, ar, children }: { en: string; ar: string; children: React.ReactNode }) => (
  <View style={S.box} wrap={false}><Bar en={en} ar={ar} /><View style={S.pad}>{children}</View></View>
);
const TermsBlock = ({ termsEn, termsAr, start, end, header }: { termsEn: string[]; termsAr: string[]; start: number; end: number; header?: boolean }) => (
  <View style={S.box} wrap={false}>
    {header && <Bar en="Terms and Conditions" ar="الأحكام و الشروط" />}
    <View style={{ flexDirection: 'row' }}>
      <View style={{ width: '50%', padding: 6, borderRightWidth: 1, borderRightColor: '#ddd' }}>
        {termsEn.slice(start, end).map((t, i) => (<Text key={i} style={{ fontSize: 7.5, marginBottom: 4, textAlign: 'justify' }}>{start + i + 1}. {t}</Text>))}
      </View>
      <View style={{ width: '50%', padding: 6 }}>
        {termsAr.slice(start, end).map((t, i) => (<Text key={i} style={{ fontSize: 7.5, marginBottom: 4, fontFamily: AR, textAlign: 'right' }}>{t} .{start + i + 1}</Text>))}
      </View>
    </View>
  </View>
);
const SigBox = ({ label, ar, img, date }: { label: string; ar: string; img?: string | null; date?: string }) => (
  <View style={{ width: '50%', padding: 6 }}>
    <View style={{ height: 46, alignItems: 'center', justifyContent: 'center' }}>
      {img ? <Image src={img} style={{ maxHeight: 42, objectFit: 'contain' }} /> : <Text style={{ fontSize: 7, color: '#bbb' }}>Not yet signed</Text>}
    </View>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#bbb', paddingTop: 3 }}>
      <Text style={{ fontSize: 7.5 }}>{label} <Text style={{ fontFamily: AR }}>{ar}</Text></Text>
      <Text style={{ fontSize: 7.5 }}>{date || '____________'} <Text style={{ fontFamily: AR }}>التاريخ</Text></Text>
    </View>
  </View>
);
const Signatures = ({ tenant, landlord }: { tenant?: { img?: string | null; date?: string }; landlord?: { img?: string | null; date?: string } }) => (
  <View wrap={false} style={{ marginTop: 8 }}>
    <Bar en="Signatures" ar="التوقيعات" />
    <View style={{ borderWidth: 1, borderColor: '#bbb', borderTopWidth: 0, flexDirection: 'row' }}>
      <View style={{ width: '50%', borderRightWidth: 1, borderRightColor: '#bbb' }}>
        <SigBox label="Tenant Signature" ar="توقيع المستأجر" img={tenant?.img} date={tenant?.date} />
      </View>
      <SigBox label="Lessor's Signature" ar="توقيع المؤجر" img={landlord?.img} date={landlord?.date} />
    </View>
  </View>
);
const Header = ({ date, j }: { date: string; j: TenancyJurisdiction }) => (
  <View style={{ marginBottom: 8 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      {j.useDldLogos ? (
        <Image src="/dld/government-of-dubai.png" style={{ height: 46, objectFit: 'contain' }} />
      ) : (
        // No official artwork for other emirates — render the government/authority as text.
        <View style={{ width: 150 }}>
          <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: NAVY }}>{j.governmentEn}</Text>
          <Text style={{ fontSize: 7, color: '#555' }}>{j.authorityEn}</Text>
          <Text style={{ fontSize: 8, fontFamily: AR, color: '#555' }}>{j.authorityAr}</Text>
        </View>
      )}
      <View style={{ alignItems: 'center' }}>
        <Text style={{ fontSize: 17, fontFamily: AR, color: NAVY }}>عقد إيجار</Text>
        <Text style={{ fontSize: 11, fontFamily: 'Times-Bold', color: NAVY, letterSpacing: 3, marginTop: 1 }}>TENANCY CONTRACT</Text>
      </View>
      {j.useDldLogos ? (
        <Image src="/dld/land-department.png" style={{ height: 46, objectFit: 'contain' }} />
      ) : (
        <View style={{ width: 150, alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 8, color: '#555' }}>Registration: {j.registrationEn}</Text>
        </View>
      )}
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 6 }}>
      <Text style={{ fontSize: 9 }}>Date</Text>
      <Text style={{ width: 140, fontSize: 9, borderBottomWidth: 1, borderBottomColor: '#888', borderBottomStyle: 'dashed', marginHorizontal: 4, paddingBottom: 1 }}>{date}</Text>
      <Text style={{ fontSize: 9, fontFamily: AR }}>التاريخ</Text>
    </View>
  </View>
);
const Usage = ({ kind }: { kind: string }) => {
  // Order matches the official DLD form: Industrial · Commercial · Residential.
  const opts: [string, string, string][] = [['Industrial', 'صناعي', 'industrial'], ['Commercial', 'تجاري', 'commercial'], ['Residential', 'سكني', 'residential']];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
      <Text style={{ fontSize: 7.5, marginRight: 14 }}>Property Usage <Text style={{ fontFamily: AR }}>استخدام العقار</Text></Text>
      {opts.map(([en, ar, k]) => (
        <View key={k} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 16 }}>
          <View style={{ width: 9, height: 9, borderRadius: 5, borderWidth: 1, borderColor: '#555', marginRight: 3, backgroundColor: kind === k ? NAVY : '#fff' }} />
          <Text style={{ fontSize: 7.5 }}>{en} <Text style={{ fontFamily: AR }}>{ar}</Text></Text>
        </View>
      ))}
    </View>
  );
};

export function EjariContractDoc({ data, addendums = [] }: { data: EjariContractData; addendums?: EjariAddendum[] }) {
  const rent = Number(data.annualRent) || 0;
  const cval = data.contractValue != null ? Number(data.contractValue) : rent;
  const dep = data.securityDepositAmount != null ? Number(data.securityDepositAmount) : 0;
  const landlordName = data.landlord.companyName || data.landlord.name || '';
  // Usage comes from the property's space category (residential/commercial/
  // industrial); fall back to matching the unit type string if it's absent.
  const sc = (data.property.spaceCategory || '').toLowerCase();
  const ut = (data.unit.type || '').toLowerCase();
  const kind = sc.includes('commercial') || ut.includes('commercial') ? 'commercial'
    : sc.includes('industrial') || ut.includes('industrial') ? 'industrial'
    : 'residential';
  const dewa = data.unit.dewaPremiseNumber || data.property.premisesNumber || '';
  // Emirate-aware jurisdiction (Dubai/Ejari default; Abu Dhabi/Tawtheeq; others municipal).
  const j = jurisdictionForEmirate(data.property.emirate);
  const tEn = buildTermsEn(j);
  const tAr = buildTermsAr(j);
  const date = fmtDate(data.createdAt) || fmtDate(new Date().toISOString());
  const tSig = (data.signatures || []).find((s) => s.role === 'tenant');
  const lSig = (data.signatures || []).find((s) => s.role === 'landlord');
  const clauses = [...(data.customClauses || []), ...(data.notes ? [data.notes] : [])];
  while (clauses.length < 3) clauses.push('');

  return (
    <Document>
      <Page size="A4" style={S.page}>
        <Header date={date} j={j} />
        <Section en="Owner / Lessor Information" ar="معلومات المالك / المؤجر">
          <Field label="Owner's Name" ar="اسم المالك" value={landlordName} />
          <Field label="Lessor's Name" ar="اسم المؤجر" value={landlordName} />
          <Field label="Lessor's Emirates ID" ar="الهوية الإماراتية للمؤجر" value={data.landlord.emiratesId} />
          <View style={{ flexDirection: 'row' }}>
            <Field label="License No." ar="رقم الرخصة" value={data.landlord.licenseNumber} half />
            <Field label="Licensing Authority" ar="سلطة الترخيص" value={data.landlord.licenseAuthority} half />
          </View>
          <CompanyCaption />
          <Field label="Lessor's Email" ar="البريد الإلكتروني للمؤجر" value={data.landlord.email} />
          <Field label="Lessor's Phone" ar="رقم هاتف المؤجر" value={data.landlord.phone} />
        </Section>
        <Section en="Tenant Information" ar="معلومات المستأجر">
          <Field label="Tenant's Name" ar="اسم المستأجر" value={data.tenant.name} />
          <Field label="Tenant's Emirates ID" ar="الهوية الإماراتية للمستأجر" value={data.tenant.emiratesId} />
          <View style={{ flexDirection: 'row' }}>
            <Field label="License No." ar="رقم الرخصة" value={data.tenant.licenseNumber} half />
            <Field label="Licensing Authority" ar="سلطة الترخيص" value={data.tenant.licenseAuthority} half />
          </View>
          <CompanyCaption />
          <Field label="Tenant's Email" ar="البريد الإلكتروني للمستأجر" value={data.tenant.email} />
          <Field label="Tenant's Phone" ar="رقم هاتف المستأجر" value={data.tenant.phone} />
        </Section>
        <Section en="Property Information" ar="معلومات العقار">
          <Usage kind={kind} />
          <View style={{ flexDirection: 'row' }}>
            <Field label="Plot No." ar="رقم الأرض" value={data.property.plotNumber} half />
            <Field label="Makani No." ar="رقم مكاني" value={data.property.makaniNumber} half />
          </View>
          <View style={{ flexDirection: 'row' }}>
            <Field label="Building Name" ar="اسم المبنى" value={data.property.buildingName} half />
            <Field label="Property No." ar="رقم العقار" value={data.unit.number || data.unit.name} half />
          </View>
          <View style={{ flexDirection: 'row' }}>
            <Field label="Property Type" ar="نوع الوحدة" value={data.unit.type ? data.unit.type[0].toUpperCase() + data.unit.type.slice(1) : ''} half />
            <Field label="Property Area (s.m)" ar="مساحة العقار (متر مربع)" value={data.unit.sizeSqm ? String(data.unit.sizeSqm) : ''} half />
          </View>
          <View style={{ flexDirection: 'row' }}>
            <Field label="Location" ar="الموقع" value={data.property.fullAddress || data.property.community || data.property.emirate} half />
            <Field label={`Premises No. (${j.utilityAuthority})`} ar={`رقم المبنى (${j.utilityAuthorityAr})`} value={dewa} half />
          </View>
        </Section>
        <Section en="Contract Information" ar="معلومات العقد">
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 4 }}>
            <Text style={{ fontSize: 7.5 }}>Contract Period <Text style={{ fontFamily: AR }}>فترة العقد</Text> From <Text style={{ fontFamily: AR }}>من</Text></Text>
            <Text style={{ width: 60, fontSize: 7.5, borderBottomWidth: 1, borderBottomColor: '#888', borderBottomStyle: 'dashed', marginHorizontal: 3 }}>{fmtDate(data.startDate)}</Text>
            <Text style={{ fontSize: 7.5 }}>To <Text style={{ fontFamily: AR }}>الى</Text></Text>
            <Text style={{ width: 60, fontSize: 7.5, borderBottomWidth: 1, borderBottomColor: '#888', borderBottomStyle: 'dashed', marginHorizontal: 3 }}>{fmtDate(data.endDate)}</Text>
            <Text style={{ fontSize: 7.5, marginLeft: 8 }}>Contract Value <Text style={{ fontFamily: AR }}>قيمة العقد</Text></Text>
            <Text style={{ flexGrow: 1, fontSize: 7.5, borderBottomWidth: 1, borderBottomColor: '#888', borderBottomStyle: 'dashed', marginHorizontal: 3 }}>{cval > 0 ? `${fmtAed(cval)} (${numWords(cval)})` : ''}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 4 }}>
            <Text style={{ fontSize: 7.5 }}>Annual Rent <Text style={{ fontFamily: AR }}>الإيجار السنوي</Text></Text>
            <Text style={{ flexGrow: 1, fontSize: 7.5, borderBottomWidth: 1, borderBottomColor: '#888', borderBottomStyle: 'dashed', marginHorizontal: 3 }}>{rent > 0 ? `${fmtAed(rent)} (${numWords(rent)})` : ''}</Text>
            <Text style={{ fontSize: 7.5, marginLeft: 8 }}>Security Deposit <Text style={{ fontFamily: AR }}>مبلغ التأمين</Text></Text>
            <Text style={{ width: 90, fontSize: 7.5, borderBottomWidth: 1, borderBottomColor: '#888', borderBottomStyle: 'dashed', marginHorizontal: 3 }}>{dep > 0 ? fmtAed(dep) : ''}</Text>
          </View>
          <Field label="Mode of Payment" ar="طريقة الدفع" value={data.modeOfPayment || ''} />
        </Section>
        <TermsBlock termsEn={tEn} termsAr={tAr} start={0} end={3} header />
        <Signatures tenant={tSig ? { img: tSig.signatureImage, date: fmtDate(tSig.signedAt) } : undefined} landlord={lSig ? { img: lSig.signatureImage, date: fmtDate(lSig.signedAt) } : undefined} />
      </Page>

      <Page size="A4" style={S.page}>
        <TermsBlock termsEn={tEn} termsAr={tAr} start={3} end={14} />
        <Section en="Know your Rights" ar="لمعرفة حقوق الأطراف">
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: '50%', paddingRight: 6, borderRightWidth: 1, borderRightColor: '#ddd' }}>
              {j.rightsEn.map((r, i) => (
                <Text key={i} style={{ fontSize: 7.5, marginBottom: i < j.rightsEn.length - 1 ? 3 : 0 }}>• {r}</Text>
              ))}
            </View>
            <View style={{ width: '50%', paddingLeft: 6 }}>
              {j.rightsAr.map((r, i) => (
                <Text key={i} style={{ fontSize: 7.5, marginBottom: i < j.rightsAr.length - 1 ? 3 : 0, fontFamily: AR, textAlign: 'right' }}>• {r}</Text>
              ))}
            </View>
          </View>
        </Section>
        <Section en={`Attachments for ${j.registrationEn} Registration`} ar={`مرفقات التسجيل في ${j.registrationAr}`}>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: '50%', paddingRight: 6, borderRightWidth: 1, borderRightColor: '#ddd' }}>
              <Text style={{ fontSize: 7.5, marginBottom: 2 }}>1. Original unified tenancy contract</Text>
              <Text style={{ fontSize: 7.5 }}>2. Original emirates ID of applicant</Text>
            </View>
            <View style={{ width: '50%', paddingLeft: 6 }}>
              <Text style={{ fontSize: 7.5, marginBottom: 2, fontFamily: AR, textAlign: 'right' }}>نسخة أصلية عن عقد الايجار الموحد .1</Text>
              <Text style={{ fontSize: 7.5, fontFamily: AR, textAlign: 'right' }}>الهوية الإماراتية الأصلية لمقدم الطلب .2</Text>
            </View>
          </View>
        </Section>
        <Section en="Additional Terms" ar="شروط إضافية">
          {clauses.map((c, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 7 }}>
              <Text style={{ fontSize: 8 }}>{i + 1}.</Text>
              <Text style={{ flexGrow: 1, fontSize: 8, borderBottomWidth: 1, borderBottomColor: '#888', borderBottomStyle: 'dashed', marginLeft: 4, paddingBottom: 1 }}>{c || ' '}</Text>
            </View>
          ))}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
            <Text style={{ fontSize: 7, color: '#555', width: '48%' }}>Note: You may add an addendum to this tenancy contract for additional terms; it must be signed by all parties.</Text>
            <Text style={{ fontSize: 7, color: '#555', width: '48%', fontFamily: AR, textAlign: 'right' }}>ملاحظة: يمكن إضافة ملحق إلى هذا العقد في حال وجود شروط إضافية، على أن يوقع من أطراف التعاقد.</Text>
          </View>
        </Section>
        <Signatures tenant={tSig ? { img: tSig.signatureImage, date: fmtDate(tSig.signedAt) } : undefined} landlord={lSig ? { img: lSig.signatureImage, date: fmtDate(lSig.signedAt) } : undefined} />
        <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: '#bbb', paddingTop: 4, alignItems: 'center' }}>
          {j.footer && <Text style={{ fontSize: 7, color: '#555' }}>{j.footer}</Text>}
          <Text style={{ fontSize: 6.5, color: '#888', marginTop: 1 }}>Ref: {data.ref} · Generated: {fmtDate(new Date().toISOString())}</Text>
        </View>
      </Page>

      {addendums.map((a, idx) => {
        const hasText = !!(a.lines && a.lines.length);
        const isImg = !!(a.mimeType && a.mimeType.startsWith('image/'));
        return (
          <Page key={a.id} size="A4" style={S.page}>
            <Header date={date} j={j} />
            <Bar en={`Addendum ${idx + 1} of ${addendums.length} — ${a.name}`} ar="ملحق العقد" />
            {hasText ? (
              <View style={{ borderWidth: 1, borderColor: '#bbb', borderTopWidth: 0, padding: 10 }}>
                {a.lines!.map((l, i) => (
                  isHeading(l)
                    ? <Text key={i} style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: NAVY, marginTop: 6, marginBottom: 2 }}>{l}</Text>
                    : <Text key={i} style={{ fontSize: 8, marginBottom: 3, textAlign: 'justify', lineHeight: 1.3 }}>{l}</Text>
                ))}
              </View>
            ) : (
              <View wrap={false} style={{ borderWidth: 1, borderColor: '#bbb', borderTopWidth: 0, padding: 12, minHeight: 320, alignItems: 'center' }}>
                {isImg
                  ? <Image src={a.fileUrl} style={{ maxHeight: 460, objectFit: 'contain' }} />
                  : <Text style={{ fontSize: 9, color: '#333' }}>Attached document: {a.fileUrl}</Text>}
              </View>
            )}
            <Signatures
              tenant={a.tenantSig ? { img: a.tenantSig, date: fmtDate(a.tenantSignedAt) } : undefined}
              landlord={a.landlordSig ? { img: a.landlordSig, date: fmtDate(a.landlordSignedAt) } : undefined} />
          </Page>
        );
      })}
    </Document>
  );
}

/** Full-screen viewer overlay with a real PDF preview + reliable download. */
export default function EjariContractViewer({ data, addendums = [], onClose }: { data: EjariContractData; addendums?: EjariAddendum[]; onClose?: () => void }) {
  const doc = <EjariContractDoc data={data} addendums={addendums} />;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', background: '#52555a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', background: '#fff', borderBottom: '1px solid #ddd' }}>
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>Tenancy Contract — {data.ref}</p>
          <p style={{ margin: 0, fontSize: 12, color: '#666' }}>UAE unified tenancy contract · vector PDF</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => (onClose ? onClose() : window.history.back())} style={{ padding: '6px 16px', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', fontSize: 13, background: '#fff' }}>✕ Close</button>
          <PDFDownloadLink document={doc} fileName={`tenancy-contract-${data.ref}.pdf`}
            style={{ padding: '6px 16px', background: NAVY, color: '#fff', borderRadius: 6, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
            {({ loading }) => (loading ? '⏳ Preparing…' : '⬇ Download PDF')}
          </PDFDownloadLink>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <PDFViewer width="100%" height="100%" style={{ border: 'none' }} showToolbar>{doc}</PDFViewer>
      </div>
    </div>
  );
}
