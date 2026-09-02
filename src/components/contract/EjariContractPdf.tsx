/**
 * UAE Unified Tenancy Contract — real vector PDF via @react-pdf/renderer.
 * Emirate-aware: the registration system (Ejari / Tawtheeq / municipal), governing
 * law, rental-dispute body, utility authority (DEWA/ADDC/SEWA/FEWA) and header
 * branding are derived from the property's emirate via lib/tenancyJurisdiction
 * (defaults to Dubai). Reliable multi-page, crisp text, Arabic (Amiri). Client-only
 * (@react-pdf needs the browser); load via next/dynamic ssr:false. The full-screen
 * viewers rasterise to <canvas> via pdf.js (EjariCanvas) — NOT an <iframe> blob,
 * which renders blank on mobile browsers / in production.
 */
'use client';

import React from 'react';
import {
  Document, Page, View, Text, Image, Font, pdf,
} from '@react-pdf/renderer';
import { jurisdictionForEmirate, type TenancyJurisdiction } from '@/lib/tenancyJurisdiction';
import { isDubaiContract } from '@/lib/ejariFill';
import { AjmanContractDoc, isAjmanContract, type AjmanContractFields } from './AjmanContractPdf';
import { effectiveSpaceCategory, deriveSpaceCategoryFromUnitType, isLandUnitType } from '@/lib/unitTaxonomy';
import { useFilledEjari } from './useFilledEjari';
import { useReactPdfDoc } from './useReactPdfDoc';
import EjariCanvas from './EjariCanvas';
import { addendumTermsToLines, type AddendumTerms } from '@/lib/addendumTerms';

Font.register({
  family: 'Amiri',
  fonts: [
    { src: '/fonts/Amiri-Regular.ttf' },
    { src: '/fonts/Amiri-Bold.ttf', fontWeight: 700 },
  ],
});
// Noto Naskh Arabic — clean modern Naskh, the closest freely-licensed (OFL)
// match to the official DLD form. Static Regular/Bold were instanced from
// Google Fonts' variable NotoNaskhArabic for reliable @react-pdf rendering.
Font.register({
  family: 'NotoAr',
  fonts: [
    { src: '/fonts/NotoNaskhArabic-Regular.ttf' },
    { src: '/fonts/NotoNaskhArabic-Bold.ttf', fontWeight: 700 },
  ],
});
// Avoid hyphenation breaking words mid-line
Font.registerHyphenationCallback((w) => [w]);

const NAVY = '#1a3c6e';
const AR = 'NotoAr';

// Detects Arabic/RTL text — Helvetica has no Arabic glyphs, must use Amiri.
// Covers Arabic (0600-06FF), Supplement (0750-077F), Extended-A (08A0-08FF),
// Presentation Forms-A (FB50-FDFF), Presentation Forms-B (FE70-FEFF).
const isArabic = (s?: string | null) =>
  /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/.test(s || '');

export interface EjariParty { name: string | null; email: string | null; phone: string | null; nationality?: string | null; passportNumber?: string | null; entityType?: string | null; companyName?: string | null; emiratesId?: string | null; licenseNumber?: string | null; licenseAuthority?: string | null }
export interface EjariContractData {
  ref: string;
  startDate: string; endDate: string; createdAt: string;
  annualRent: number; contractValue: number | null; securityDepositAmount: number | null;
  // Rent discount (rent line only). listedRent − discountAmount = annualRent.
  listedRent?: number | null; discountType?: 'percent' | 'fixed' | null; discountAmount?: number | null;
  modeOfPayment: string | null; numberOfInstallments?: number | null; customClauses?: string[]; notes?: string | null;
  /** The lease's utility account (DEWA / FEWA / SEWA …). DB column is still
   *  `tenancy_contracts.dewa_account_number`; the app treats it as generic. */
  utilityAccountNumber?: string | null;
  // Lessor is the landlord, OR — when the RP holds a Power of Attorney — the POA
  // representative. The official contract lists the POA holder's phone as the
  // lessor's contact (see `lessorPhone` below).
  landlord: EjariParty & { bankAccountName?: string | null; hasPoa?: boolean | null; poaPersonName?: string | null; poaPersonPhone?: string | null };
  tenant: EjariParty;
  // `city` is the emirate's own sub-division — only Ajman populates it, with the
  // municipal sector its form prints as `Sector`. `subCommunity` is the numbered
  // district ("Al Nuaimiya 2") that same form prints as `District`.
  property: { buildingName: string | null; fullAddress: string | null; community: string | null; emirate: string | null; city?: string | null; subCommunity?: string | null; plotNumber: string | null; makaniNumber: string | null; sewerageNumber?: string | null; premisesNumber?: string | null; spaceCategory?: string | null };
  unit: { number: string | null; name: string | null; type: string | null; floor?: string | null; sizeSqm: number | null; dewaPremiseNumber?: string | null; sewerageNumber?: string | null; bedrooms?: number | null };
  signatures?: { role: 'landlord' | 'tenant'; signatureImage: string | null; stampImage?: string | null; signedAt: string; method?: string }[];
  /** Ajman-form overrides. The Ajman tenancy contract prints boxes our model has
   *  no source for (Sector, Floor, Room, Sewerage No., the Request Details block,
   *  the Arabic mirrors of names/nationalities). Anything set here wins over the
   *  value derived from the contract — see `buildAjmanFields`. */
  ajman?: Partial<AjmanContractFields>;
}
export interface EjariAddendum { id: number; name: string; fileUrl?: string | null; mimeType?: string | null; tenantSig: string | null; tenantSignedAt: string | null; landlordSig: string | null; landlordSignedAt: string | null; /** Extracted text lines (DOCX), rendered inline across pages. */ lines?: string[]; /** In-app bilingual terms (the new authoring path); rendered EN then AR. */ terms?: AddendumTerms | null }

const fmtDate = (d?: string | null) => {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}-${p(dt.getMonth() + 1)}-${dt.getFullYear()}`;
};
const fmtAed = (v?: number | null) => (v == null ? '' : `AED ${Number(v).toLocaleString('en-US')}`);

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
  page: { paddingTop: 20, paddingBottom: 16, paddingHorizontal: 24, fontSize: 8, fontFamily: 'Helvetica', color: '#111' },
  bar: { backgroundColor: NAVY, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 6 },
  barEn: { color: '#fff', fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
  barAr: { color: '#fff', fontSize: 9, fontFamily: AR },
  box: { borderWidth: 1, borderColor: '#bbb', marginBottom: 6 },
  pad: { paddingHorizontal: 6, paddingTop: 5, paddingBottom: 4 },
  enLbl: { fontSize: 7.5, color: '#222' },
  arLbl: { fontSize: 7.5, color: '#444', fontFamily: AR },
  line: { flexGrow: 1, fontSize: 7.5, borderBottomWidth: 1, borderBottomColor: '#888', borderBottomStyle: 'dashed', marginHorizontal: 3, paddingBottom: 1, color: '#000' },
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Bar = ({ en, ar }: { en: string; ar: string }) => (
  <View style={S.bar as any}><Text style={S.barEn}>{en}</Text><Text style={S.barAr}>{ar}</Text></View>
);
const Field = ({ label, ar, value, half }: { label: string; ar: string; value?: string | null; half?: boolean }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lineStyle: any = isArabic(value)
    ? { ...S.line, fontFamily: AR, textAlign: 'right' }
    : S.line;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 7, width: half ? '50%' : '100%', paddingRight: half ? 6 : 0 }}>
      <Text style={S.enLbl}>{label}</Text>
      <Text style={lineStyle}>{value || ' '}</Text>
      <Text style={S.arLbl}>{ar}</Text>
    </View>
  );
};
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
        {termsEn.slice(start, end).map((t, i) => (<Text key={i} style={{ fontSize: 7.5, marginBottom: 4, lineHeight: 1.4, textAlign: 'justify' }}>{start + i + 1}. {t}</Text>))}
      </View>
      <View style={{ width: '50%', padding: 6 }}>
        {termsAr.slice(start, end).map((t, i) => (<Text key={i} style={{ fontSize: 7.5, marginBottom: 4, lineHeight: 1.5, fontFamily: AR, textAlign: 'right' }}>{t} .{start + i + 1}</Text>))}
      </View>
    </View>
  </View>
);
const SigBox = ({ label, ar, img, stamp, date, onFile, hideAr }: { label: string; ar: string; img?: string | null; stamp?: string | null; date?: string; onFile?: boolean; hideAr?: boolean }) => (
  <View style={{ width: '100%', padding: 6 }}>
    <View style={{ height: 44, flexDirection: 'row', alignItems: 'flex-end' }}>
      {img
        ? <Image src={img} style={{ maxHeight: 34, maxWidth: stamp ? 105 : 150, objectFit: 'contain' }} />
        : onFile
          ? <Text style={{ fontSize: 7.5, color: '#555' }}>Signed on file — N/A</Text>
          : <Text style={{ fontSize: 7, color: '#bbb' }}>Not yet signed</Text>}
      {/* Company stamp given with the customer's signature (commercial leases, 0258). */}
      {stamp && <Image src={stamp} style={{ maxHeight: 42, maxWidth: 62, objectFit: 'contain', marginLeft: 6 }} />}
    </View>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#bbb', paddingTop: 3 }}>
      <Text style={{ fontSize: 7.5 }}>{label}{hideAr ? null : <Text style={{ fontFamily: AR }}> {ar}</Text>}</Text>
      <Text style={{ fontSize: 7.5 }}>{hideAr ? 'Date ' : ''}{date || '____________'}{hideAr ? null : <Text style={{ fontFamily: AR }}> التاريخ</Text>}</Text>
    </View>
  </View>
);
// hideAr → English-only signature box (used by the addendum; the contract stays bilingual).
// footer → rendered inside a react-pdf `fixed` absolute footer (no wrap={false},
// which breaks fixed rendering; no top margin since it's positioned).
const Signatures = ({ tenant, landlord, hideAr, footer }: { tenant?: { img?: string | null; stamp?: string | null; date?: string; onFile?: boolean }; landlord?: { img?: string | null; date?: string; onFile?: boolean }; hideAr?: boolean; footer?: boolean }) => (
  <View wrap={footer ? undefined : false} style={footer ? undefined : { marginTop: 8 }}>
    <Bar en="Signatures" ar={hideAr ? '' : 'التوقيعات'} />
    <View style={{ borderWidth: 1, borderColor: '#bbb', borderTopWidth: 0, flexDirection: 'row' }}>
      <View style={{ width: '50%', borderRightWidth: 1, borderRightColor: '#bbb' }}>
        <SigBox label="Tenant Signature" ar="توقيع المستأجر" img={tenant?.img} stamp={tenant?.stamp} date={tenant?.date} onFile={tenant?.onFile} hideAr={hideAr} />
      </View>
      <View style={{ width: '50%' }}>
        <SigBox label="Lessor's Signature" ar="توقيع المؤجر" img={landlord?.img} date={landlord?.date} onFile={landlord?.onFile} hideAr={hideAr} />
      </View>
    </View>
  </View>
);

const Header = ({ date, j }: { date: string; j: TenancyJurisdiction }) => (
  <View style={{ marginBottom: 8 }}>
    {/* Row 1 — logos only, at the edges (matches the official DLD form). */}
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: 8 }}>
      {j.useDldLogos ? (
        <Image src="/dld/government-of-dubai.png" style={{ height: 38, objectFit: 'contain' }} />
      ) : (
        // No official artwork for other emirates — render the government/authority as text.
        <View style={{ width: 150 }}>
          <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: NAVY }}>{j.governmentEn}</Text>
          <Text style={{ fontSize: 7, color: '#555' }}>{j.authorityEn}</Text>
          <Text style={{ fontSize: 8, fontFamily: AR, color: '#555' }}>{j.authorityAr}</Text>
        </View>
      )}
      {j.useDldLogos ? (
        <Image src="/dld/land-department.png" style={{ height: 38, objectFit: 'contain' }} />
      ) : (
        <View style={{ width: 150, alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 8, color: '#555' }}>Registration: {j.registrationEn}</Text>
        </View>
      )}
    </View>
    {/* Row 2 — grey band: Date on the left, title centered (3-column so the
        title is truly centred regardless of the Date width). */}
    <View style={{ backgroundColor: '#eef0f3', flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12 }}>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end' }}>
        <Text style={{ fontSize: 9 }}>Date</Text>
        <Text style={{ width: 95, fontSize: 9, borderBottomWidth: 1, borderBottomColor: '#888', borderBottomStyle: 'dashed', marginHorizontal: 4, paddingBottom: 1 }}>{date}</Text>
        <Text style={{ fontSize: 9, fontFamily: AR }}>التاريخ</Text>
      </View>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={{ fontSize: 16, fontFamily: AR, color: NAVY }}>عقد إيجار</Text>
        <Text style={{ fontSize: 10, fontFamily: 'Times-Bold', color: NAVY, letterSpacing: 3, marginTop: 1 }}>TENANCY CONTRACT</Text>
      </View>
      <View style={{ flex: 1 }} />
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
  // Rent discount — listed price + reduction, shown only when one was applied.
  const listed = data.listedRent != null ? Number(data.listedRent) : rent;
  const discount = data.discountAmount != null ? Number(data.discountAmount) : Math.max(0, listed - rent);
  const landlordName = data.landlord.companyName || data.landlord.name || '';
  // A company lessor is identified by its trade License No. + Licensing Authority
  // (shown below), not an Emirates ID — so the individual-only EID row is omitted.
  // Keyed off entityType, NOT companyName: individual RPs may also carry a
  // company/brand name, so companyName is not a reliable "is a company" signal.
  const landlordIsCompany = data.landlord.entityType === 'company';
  // Lessor's phone: when the RP acts under a Power of Attorney, the POA holder's
  // phone is the lessor's contact on the contract; otherwise the landlord's own.
  const lessorPhone = data.landlord.hasPoa && data.landlord.poaPersonPhone
    ? data.landlord.poaPersonPhone
    : data.landlord.phone;
  // Company tenants are named by their company; individuals by their person name.
  const tenantName = data.tenant.companyName || data.tenant.name || '';
  // Usage = the unit's EFFECTIVE category (the same fee/VAT chokepoint). A
  // mixed-use building resolves PER UNIT from the unit type, so a `retail_shop`
  // correctly reads Commercial — the old `type.includes('commercial')` string
  // test missed real commercial types (retail_shop / office_* / warehouse …) and
  // wrongly defaulted them to Residential.
  const kind = effectiveSpaceCategory(data.unit.type, data.property.spaceCategory);
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

  // Official Ejari shows a Signatures bar at the bottom of every page.
  const sigs = (
    <Signatures
      tenant={tSig ? { img: tSig.signatureImage, stamp: tSig.stampImage ?? null, date: fmtDate(tSig.signedAt), onFile: tSig.method === 'on_file' } : undefined}
      landlord={lSig ? { img: lSig.signatureImage, date: fmtDate(lSig.signedAt), onFile: lSig.method === 'on_file' } : undefined}
    />
  );

  return (
    <Document>
      <Page size="A4" style={S.page}>
        <Header date={date} j={j} />
        <Section en="Owner / Lessor Information" ar="معلومات المالك / المؤجر">
          <Field label="Owner's Name" ar="اسم المالك" value={landlordName} />
          <Field label="Lessor's Name" ar="اسم المؤجر" value={landlordName} />
          {!landlordIsCompany && (
            <Field label="Lessor's Emirates ID" ar="الهوية الإماراتية للمؤجر" value={data.landlord.emiratesId} />
          )}
          <View style={{ flexDirection: 'row' }}>
            <Field label="License No." ar="رقم الرخصة" value={data.landlord.licenseNumber} half />
            <Field label="Licensing Authority" ar="سلطة الترخيص" value={data.landlord.licenseAuthority} half />
          </View>
          <CompanyCaption />
          <Field label="Lessor's Email" ar="البريد الإلكتروني للمؤجر" value={data.landlord.email} />
          <Field label="Lessor's Phone" ar="رقم هاتف المؤجر" value={lessorPhone} />
        </Section>
        <Section en="Tenant Information" ar="معلومات المستأجر">
          <Field label="Tenant's Name" ar="اسم المستأجر" value={tenantName} />
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
            <Field label="Property Type" ar="نوع الوحدة" value={data.unit.type ? `${data.unit.bedrooms ? `${data.unit.bedrooms} Bedroom ` : ''}${data.unit.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}` : ''} half />
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
            <Text style={{ flexGrow: 1, fontSize: 7.5, borderBottomWidth: 1, borderBottomColor: '#888', borderBottomStyle: 'dashed', marginHorizontal: 3 }}>{cval > 0 ? `${fmtAed(cval)}/- Only` : ''}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 4 }}>
            <Text style={{ fontSize: 7.5 }}>Annual Rent <Text style={{ fontFamily: AR }}>الإيجار السنوي</Text></Text>
            <Text style={{ flexGrow: 1, fontSize: 7.5, borderBottomWidth: 1, borderBottomColor: '#888', borderBottomStyle: 'dashed', marginHorizontal: 3 }}>{listed > 0 ? `${fmtAed(listed)}/- Only` : ''}</Text>
            <Text style={{ fontSize: 7.5, marginLeft: 8 }}>Security Deposit <Text style={{ fontFamily: AR }}>مبلغ التأمين</Text></Text>
            <Text style={{ width: 130, fontSize: 7.5, borderBottomWidth: 1, borderBottomColor: '#888', borderBottomStyle: 'dashed', marginHorizontal: 3 }}>{dep > 0 ? `${fmtAed(dep)}/- Only` : ''}</Text>
          </View>
          {discount > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 4 }}>
              {/* Annual Rent above shows the listed figure; Contract Value shows the
                  net. This line states the reduction so the gap is explicit. */}
              <Text style={{ fontSize: 7.5 }}>Rent Discount <Text style={{ fontFamily: AR }}>خصم الإيجار</Text></Text>
              <Text style={{ flexGrow: 1, fontSize: 7.5, borderBottomWidth: 1, borderBottomColor: '#888', borderBottomStyle: 'dashed', marginHorizontal: 3 }}>− {fmtAed(discount)}{data.discountType === 'percent' && listed > 0 ? ` (${((discount / listed) * 100).toFixed(1)}%)` : ''} → Contract Value {fmtAed(cval)}</Text>
            </View>
          )}
          <Field label="Mode of Payment" ar="طريقة الدفع" value={data.numberOfInstallments ? `${data.numberOfInstallments} Installment${data.numberOfInstallments === 1 ? '' : 's'}` : (data.modeOfPayment || '')} />
        </Section>
        <View style={{ flexGrow: 1 }} />
        {sigs}
      </Page>

      {/* Page 2 — Terms & Conditions (all 14, like the official form) */}
      <Page size="A4" style={S.page}>
        <Header date={date} j={j} />
        <TermsBlock termsEn={tEn} termsAr={tAr} start={0} end={14} header />
        <View style={{ flexGrow: 1 }} />
        {sigs}
      </Page>

      {/* Page 3 — Rights, attachments, additional terms */}
      <Page size="A4" style={S.page}>
        <Header date={date} j={j} />
        <Section en="Know your Rights" ar="لمعرفة حقوق الأطراف">
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: '50%', paddingRight: 6, borderRightWidth: 1, borderRightColor: '#ddd' }}>
              {j.rightsEn.map((r, i) => (
                <Text key={i} style={{ fontSize: 7.5, lineHeight: 1.4, marginBottom: i < j.rightsEn.length - 1 ? 4 : 0 }}>• {r}</Text>
              ))}
            </View>
            <View style={{ width: '50%', paddingLeft: 6 }}>
              {j.rightsAr.map((r, i) => (
                <Text key={i} style={{ fontSize: 7.5, lineHeight: 1.5, marginBottom: i < j.rightsAr.length - 1 ? 4 : 0, fontFamily: AR, textAlign: 'right' }}>• {r}</Text>
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
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Text style={{ flexGrow: 1, fontSize: 8, borderBottomWidth: 1, borderBottomColor: '#888', borderBottomStyle: 'dashed', marginLeft: 4, paddingBottom: 1, ...(isArabic(c) ? { fontFamily: AR, textAlign: 'right' } : {}) } as any}>{c || ' '}</Text>
            </View>
          ))}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
            <Text style={{ fontSize: 7, color: '#555', width: '48%' }}>Note: You may add an addendum to this tenancy contract for additional terms; it must be signed by all parties.</Text>
            <Text style={{ fontSize: 7, color: '#555', width: '48%', fontFamily: AR, textAlign: 'right' }}>ملاحظة: يمكن إضافة ملحق إلى هذا العقد في حال وجود شروط إضافية، على أن يوقع من أطراف التعاقد.</Text>
          </View>
        </Section>
        <View style={{ flexGrow: 1 }} />
        {sigs}
        <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: '#bbb', paddingTop: 4, alignItems: 'center' }}>
          {j.footer && <Text style={{ fontSize: 7, color: '#555' }}>{j.footer}</Text>}
          <Text style={{ fontSize: 6.5, color: '#888', marginTop: 1 }}>Ref: {data.ref} · Generated: {fmtDate(new Date().toISOString())}</Text>
        </View>
      </Page>

      {addendumPages(addendums, data.signatures, data)}
    </Document>
  );
}

// ── Dynamic addendum preamble ────────────────────────────────────────────────
// Standard intro paragraph that opens every text addendum, interpolated from the
// contract it belongs to: lease period, the leased unit (category · type · number)
// and its location (building · emirate · country). Render-time only — never stored
// in the saved terms, so it always reflects the live contract.
const prettyType = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
/** Land is checked first — a plot is neither residential nor commercial for this
 *  wording. Everything else defers to lib/unitTaxonomy rather than the
 *  hand-copied ADDENDUM_* lists that used to live here, which had drifted out of
 *  step (they never learned accommodation lets are commercial, so the addendum
 *  called a staff-accommodation lease "residential" on a printed contract). */
function addendumCategoryWord(type?: string | null): string {
  const t = (type ?? '').toLowerCase();
  if (isLandUnitType(t)) return 'land';
  return deriveSpaceCategoryFromUnitType(t);
}
function buildAddendumPreamble(data?: EjariContractData): string | null {
  if (!data) return null;
  const from = fmtDate(data.startDate);
  const to = fmtDate(data.endDate);
  const type = data.unit?.type ?? null;
  // Skip the empty editor-preview placeholder (no real contract context yet).
  if (!from && !to && !type && !data.property?.buildingName) return null;
  const subject = [addendumCategoryWord(type), type ? prettyType(type) : 'Unit', data.unit?.number ? `no. ${data.unit.number}` : '']
    .filter(Boolean).join(' ');
  const city = data.property?.emirate ? prettyType(data.property.emirate) : (data.property?.community ?? null);
  const loc = [data.property?.buildingName, city, 'UAE'].filter(Boolean).join(', ');
  const period = (from || to) ? ` for the period from (${from || '—'}) to (${to || '—'})` : '';
  return `This addendum is part of the tenancy contract${period}. Conditions made between the Landlord and the Tenant for (${subject}) in (${loc}). Both parties have mutually agreed upon the following terms;`;
}

/** The addendum <Page> elements, shared by the full contract doc and the
 *  standalone AddendumDoc that the template-fill flow appends. Terms flow
 *  naturally (react-pdf fills each page top-to-bottom = no blank gaps); the title
 *  and the Tenant/Lessor signature block are react-pdf `fixed` elements, so they
 *  repeat at the top/bottom of EVERY page. Page padding reserves space for both
 *  so the flowing terms never run under them (no overlap). */
export function addendumPages(
  addendums: EjariAddendum[],
  contractSigs?: { role: 'landlord' | 'tenant'; signatureImage: string | null; stampImage?: string | null; signedAt: string }[],
  data?: EjariContractData,
) {
  // The addendum is part of the contract — when its own signature fields aren't
  // set, fall back to the CONTRACT's signatures so a signed contract shows the
  // tenant/lessor signatures (and dates) on the addendum too.
  const cTenant = contractSigs?.find(s => s.role === 'tenant');
  const cLandlord = contractSigs?.find(s => s.role === 'landlord');
  // Dynamic intro paragraph, interpolated from THIS contract; prepended to every
  // text addendum's body.
  const preamble = buildAddendumPreamble(data);
  return addendums.flatMap((a) => {
    const baseLines = (a.lines && a.lines.length) ? a.lines : addendumTermsToLines(a.terms);
    const lines = preamble && baseLines.length ? [preamble, ...baseLines] : baseLines;
    const isImg = !!(a.mimeType && a.mimeType.startsWith('image/'));
    const title = ((a.name && a.name.trim()) || 'Addendum to Tenancy Contract').toUpperCase();
    const titleAr = a.terms?.nameAr?.trim() || '';
    const tenantImg = a.tenantSig ?? cTenant?.signatureImage ?? null;
    // The company stamp is given once, with the CONTRACT signature (0258) — the
    // addendum is part of the same executed contract, so the seal shows here too.
    const tenantStamp = cTenant?.stampImage ?? null;
    const tenantDate = a.tenantSignedAt ? fmtDate(a.tenantSignedAt) : (cTenant?.signedAt ? fmtDate(cTenant.signedAt) : '');
    const landlordImg = a.landlordSig ?? cLandlord?.signatureImage ?? null;
    const landlordDate = a.landlordSignedAt ? fmtDate(a.landlordSignedAt) : (cLandlord?.signedAt ? fmtDate(cLandlord.signedAt) : '');

    return [(
      // paddingTop/Bottom reserve room for the fixed title + fixed signature footer.
      <Page key={a.id} size="A4"
        style={{ paddingTop: titleAr ? 58 : 46, paddingBottom: 100, paddingHorizontal: 30, fontSize: 8, fontFamily: 'Helvetica', color: '#111' }}>
        {/* Title — fixed, repeats on every page */}
        <View fixed style={{ position: 'absolute', top: 18, left: 30, right: 30 }}>
          <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: NAVY, textAlign: 'center', letterSpacing: 0.5 }}>{title}</Text>
          {titleAr ? <Text style={{ fontSize: 10, fontFamily: AR, color: NAVY, textAlign: 'center', marginTop: 1 }}>{titleAr}</Text> : null}
          <View style={{ borderBottomWidth: 1, borderBottomColor: '#ccc', marginTop: 5 }} />
        </View>

        {lines.length ? (
          <View>
            {lines.map((l, i) => (
              isHeading(l)
                ? <Text key={i} style={{ fontSize: 9.5, fontFamily: isArabic(l) ? AR : 'Helvetica-Bold', color: NAVY, marginTop: 9, marginBottom: 3, ...(isArabic(l) ? { textAlign: 'right' } : {}) }}>{l}</Text>
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                : <Text key={i} style={{ fontSize: 8.5, marginBottom: 4, lineHeight: 1.45, ...(isArabic(l) ? { fontFamily: AR, textAlign: 'right' } : { textAlign: 'justify' }) } as any}>{l}</Text>
            ))}
          </View>
        ) : (
          <View wrap={false} style={{ alignItems: 'center', paddingVertical: 14 }}>
            {isImg
              ? <Image src={a.fileUrl || ''} style={{ maxHeight: 460, objectFit: 'contain' }} />
              : <Text style={{ fontSize: 9, color: '#333' }}>Attached document: {a.fileUrl}</Text>}
          </View>
        )}

        {/* Tenant & Lessor signature block — fixed footer on EVERY page. */}
        <View fixed style={{ position: 'absolute', bottom: 14, left: 30, right: 30 }}>
          <Signatures footer hideAr
            tenant={{ img: tenantImg, stamp: tenantStamp, date: tenantDate }}
            landlord={{ img: landlordImg, date: landlordDate }} />
        </View>
      </Page>
    )];
  });
}

/** Standalone document of just the addendum pages — appended after the filled
 *  official template (Dubai). @react-pdf shapes Arabic correctly. */
export function AddendumDoc({ data, addendums }: { data?: EjariContractData; addendums: EjariAddendum[] }) {
  return <Document>{addendumPages(addendums, data?.signatures, data)}</Document>;
}

/** Render the addendum pages to raw PDF bytes (for pdf-lib to append). */
export async function renderAddendumPdf(data: EjariContractData, addendums: EjariAddendum[]): Promise<Uint8Array> {
  const blob = await pdf(<AddendumDoc data={data} addendums={addendums} />).toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}

const VIEWER_WRAP = { position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', background: '#52555a' } as const;
const VIEWER_BAR = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', background: '#fff', borderBottom: '1px solid #ddd' } as const;
const CLOSE_BTN = { padding: '6px 16px', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', fontSize: 13, background: '#fff' } as const;
const DL_BTN = { padding: '6px 16px', background: NAVY, color: '#fff', borderRadius: 6, fontWeight: 700, fontSize: 13, textDecoration: 'none' } as const;
const ViewerHeader = ({ data, onClose, children }: { data: EjariContractData; onClose?: () => void; children?: React.ReactNode }) => (
  <div style={VIEWER_BAR}>
    <div>
      <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>Tenancy Contract — {data.ref}</p>
      <p style={{ margin: 0, fontSize: 12, color: '#666' }}>{isAjmanContract(data) ? 'Ajman tenancy contract' : 'UAE unified tenancy contract'}</p>
    </div>
    <div style={{ display: 'flex', gap: 10 }}>
      <button onClick={() => (onClose ? onClose() : window.history.back())} style={CLOSE_BTN}>✕ Close</button>
      {children}
    </div>
  </div>
);

/**
 * The vector (non-Dubai) contract document for a contract.
 *  - Ajman → the Ajman Municipality & Planning Department form (`AjmanContractDoc`).
 *  - every other emirate → the unified `EjariContractDoc`.
 * Addendum pages are rendered once here and handed to whichever doc is chosen,
 * so both paths append the same addendums.
 */
export function contractDocFor(data: EjariContractData, addendums: EjariAddendum[]) {
  return isAjmanContract(data)
    ? <AjmanContractDoc data={data} extraPages={addendumPages(addendums, data.signatures, data)} />
    : <EjariContractDoc data={data} addendums={addendums} />;
}

/** Full-screen viewer. Dubai → filled official PDF in an iframe; else → react-pdf. */
export default function EjariContractViewer({ data, addendums = [], onClose }: { data: EjariContractData; addendums?: EjariAddendum[]; onClose?: () => void }) {
  return isDubaiContract(data)
    ? <DubaiFullscreen data={data} addendums={addendums} onClose={onClose} />
    : <ReactPdfFullscreen data={data} addendums={addendums} onClose={onClose} />;
}

/** Stable regeneration key for the @react-pdf contract doc — changes only when the
 *  printed content does (ref, signatures, addendum set). */
export function ejariDocKey(data: EjariContractData, addendums: EjariAddendum[]): string {
  return `${data.ref}|${(data.signatures || []).map((s) => `${s.role}:${s.signedAt}`).join(',')}|${addendums.map((a) => a.id).join(',')}`;
}

function DubaiFullscreen({ data, addendums, onClose }: { data: EjariContractData; addendums: EjariAddendum[]; onClose?: () => void }) {
  // Dubai → the official DLD template filled with pdf-lib (raw bytes + a download
  // URL). Rasterise the bytes to <canvas> (NOT an <iframe> blob → blank on mobile).
  const { url, bytes, error } = useFilledEjari(data, addendums);
  return (
    <div style={VIEWER_WRAP}>
      <ViewerHeader data={data} onClose={onClose}>
        {url && <a href={url} download={`tenancy-contract-${data.ref}.pdf`} style={DL_BTN}>⬇ Download PDF</a>}
      </ViewerHeader>
      <div style={{ flex: 1, minHeight: 0 }}>
        {error
          ? <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#fff' }}>Failed to render contract: {error}</div>
          : <EjariCanvas bytes={bytes} fill />}
      </div>
    </div>
  );
}

function ReactPdfFullscreen({ data, addendums, onClose }: { data: EjariContractData; addendums: EjariAddendum[]; onClose?: () => void }) {
  // Non-Dubai → the @react-pdf vector doc → bytes (canvas) + a download URL.
  const { bytes, url, error } = useReactPdfDoc(
    () => contractDocFor(data, addendums),
    ejariDocKey(data, addendums),
  );
  return (
    <div style={VIEWER_WRAP}>
      <ViewerHeader data={data} onClose={onClose}>
        {url
          ? <a href={url} download={`tenancy-contract-${data.ref}.pdf`} style={DL_BTN}>⬇ Download PDF</a>
          : <span style={{ ...DL_BTN, opacity: 0.6, cursor: 'default' }}>⏳ Preparing…</span>}
      </ViewerHeader>
      <div style={{ flex: 1, minHeight: 0 }}>
        {error
          ? <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#fff' }}>Failed to render contract: {error}</div>
          : <EjariCanvas bytes={bytes} fill />}
      </div>
    </div>
  );
}
