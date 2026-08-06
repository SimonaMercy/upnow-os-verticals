/**
 * Ajman tenancy contract — our editable rendering of the Ajman Municipality &
 * Planning Department "TENANCY CONTRACT / وثيقة عقد إيجار" form (the one issued
 * through TASDEEQ), as a real vector PDF via @react-pdf/renderer.
 *
 * WHAT IS KEPT vs the government-issued document
 *  - KEPT: the header artwork (Government of Ajman · TENANCY CONTRACT · وثيقة عقد
 *    إيجار · Municipality & Planning Department), the exact section order, the
 *    bilingual row labels, and the page-2 Terms Of The Contract (Articles 7, 9
 *    and 16 of Amiri Decree No. 2 of 2017).
 *  - REMOVED, deliberately: the barcode block ("Residential / سكني" + Issued On),
 *    the TASDEEQ logo + call-centre footer, and the red "This is an electronically
 *    certified contract issued from Ajman Municipality" line. This document is
 *    OURS — it must not assert that the municipality issued or certified it.
 *  - ADDED: a Signatures block (the government form has none because it is
 *    certified electronically instead).
 *
 * EDITABILITY — every printed value comes from ONE flat object,
 * `AjmanContractFields`. `buildAjmanFields()` derives what the contract already
 * holds and `data.ajman` overrides any slot, so mapping a field to a new source
 * (or letting a user type it) is a one-line change with no layout work.
 *
 * Client-only (@react-pdf needs the browser) — load via next/dynamic ssr:false.
 */
'use client';

import React from 'react';
import { Document, Page, View, Text, Image, Font } from '@react-pdf/renderer';
import type { EjariContractData } from './EjariContractPdf';
import { effectiveSpaceCategory } from '@/lib/unitTaxonomy';

/**
 * ONE family for Latin and Arabic, matching how the government form uses Tahoma
 * for both. Almarai is the closest freely-licensed (OFL) match to Tahoma's plain,
 * low-contrast naskh — and, unlike the alternatives, it renders correctly under
 * @react-pdf:
 *  - `NotoAr` / Noto Sans Arabic decompose every dotted letter into a base plus
 *    ZERO-ADVANCE dot glyphs; @react-pdf drops zero-advance glyphs, so Arabic
 *    prints with no dots at all (الجنسية comes out as الحسسه).
 *  - Amiri keeps its dots but stacks ج ح خ under the preceding letter, and
 *    @react-pdf mis-positions that stack (تاريخ collapsed into a blob).
 * Almarai does neither — every glyph carries its dots and a real advance, so no
 * joiner/spacing workarounds are needed.
 */
Font.register({
  family: 'Almarai',
  fonts: [
    { src: '/fonts/Almarai-Regular.ttf' },
    { src: '/fonts/Almarai-Bold.ttf', fontWeight: 700 },
  ],
});

const AR = 'Almarai';
/** Latin face — the same family, as on the government form. */
const LATIN = 'Almarai';
/** The form's section-bar blue, sampled from the official document. */
const BAR = '#376092';
const RULE = '#5b6b7d';

/** An Ajman property is anything whose emirate resolves to Ajman. */
export function isAjmanContract(data: { property: { emirate: string | null } }): boolean {
  return (data.property.emirate ?? '').toLowerCase().replace(/[^a-z]/g, '') === 'ajman';
}

// ── Field slots ──────────────────────────────────────────────────────────────
// One entry per printed box on the form, in form order. Anything we cannot
// derive from the contract stays '' and prints as an empty box (exactly what the
// paper form looks like before it is filled).
export interface AjmanContractFields {
  // First Party ( Lesser ) — بيانات الطرف الأول ( المؤجر )
  lessorName: string; lessorNameAr: string;
  lessorNationality: string; lessorNationalityAr: string;
  lessorEmiratesId: string;
  // Second Party ( Tenant ) — بيانات الطرف الثاني ( المستأجر )
  tenantName: string; tenantNameAr: string;
  tenantNationality: string; tenantNationalityAr: string;
  tenantEmiratesId: string; tenantPassport: string;
  tenantMobile: string; tenantPhone: string;
  // Leased Unit Details — بيانات العين المؤجرة
  propertyType: string; propertyTypeAr: string;
  city: string; cityAr: string;
  sector: string; sectorAr: string;
  district: string; districtAr: string;
  plot: string;
  unit: string; space: string;
  floor: string; room: string;
  building: string; buildingAr: string;
  fewaNumber: string;
  sewerageNumber: string;
  // Contract Details — بيانات العقد
  startDate: string; endDate: string;
  security: string; rentYearly: string; totalRent: string; duration: string;
  // Request Details — بيانات الطلب (municipality-issued; blank until registered)
  makkani: string; parcel: string; applicationNo: string;
  receiptNo: string; paymentDate: string; debitNote: string;
  /** Drives nothing on the page today (the usage barcode block is removed) but
   *  kept so the value is available if a usage line is ever printed. */
  usage: string;
}

const S = (v: unknown) => (v == null || v === '' ? '' : String(v));
/** 06-Jun-2024 — the form's own date format. */
const fmtDate = (d?: string | null) => {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(dt.getDate()).padStart(2, '0')}-${M[dt.getMonth()]}-${dt.getFullYear()}`;
};
/** 110,000.00 — the form prints bare amounts, no AED prefix. */
const fmtAmt = (v?: number | null) =>
  v == null ? '' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "12 Months 0 Days" — the lease term is inclusive of the end date. */
function fmtDuration(start?: string | null, end?: string | null): string {
  if (!start || !end) return '';
  const a = new Date(start); const b = new Date(end);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return '';
  const to = new Date(b.getFullYear(), b.getMonth(), b.getDate() + 1); // inclusive
  let months = (to.getFullYear() - a.getFullYear()) * 12 + (to.getMonth() - a.getMonth());
  let days = to.getDate() - a.getDate();
  if (days < 0) {
    months -= 1;
    days = Math.round((to.getTime() - new Date(a.getFullYear(), a.getMonth() + months, a.getDate()).getTime()) / 86400000);
  }
  if (months < 0) return '';
  return `${months} Months ${days} Days`;
}

const prettyType = (s?: string | null) =>
  (s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Nationality is stored in English on the profile (`rental_providers.nationality`,
 * `users.nationality`); the form prints it in both languages, so the Arabic side
 * is looked up here — nobody types Arabic. Keys are matched loosely (lowercased,
 * letters only) so "UAE", "U.A.E." and "United Arab Emirates" all resolve.
 */
const NATIONALITY_AR: Record<string, string> = {
  uae: 'الامارات', unitedarabemirates: 'الامارات', emirati: 'الامارات',
  pakistan: 'جمهورية باكستان الإسلامية', islamicrepublicofpakistan: 'جمهورية باكستان الإسلامية', pakistani: 'جمهورية باكستان الإسلامية',
  india: 'الهند', indian: 'الهند',
  bangladesh: 'بنغلاديش', srilanka: 'سريلانكا', nepal: 'نيبال', philippines: 'الفلبين', filipino: 'الفلبين',
  egypt: 'مصر', egyptian: 'مصر', jordan: 'الأردن', lebanon: 'لبنان', syria: 'سوريا',
  iraq: 'العراق', palestine: 'فلسطين', yemen: 'اليمن', sudan: 'السودان', somalia: 'الصومال',
  saudiarabia: 'المملكة العربية السعودية', ksa: 'المملكة العربية السعودية',
  kuwait: 'الكويت', qatar: 'قطر', bahrain: 'البحرين', oman: 'سلطنة عمان',
  morocco: 'المغرب', algeria: 'الجزائر', tunisia: 'تونس', libya: 'ليبيا',
  iran: 'إيران', afghanistan: 'أفغانستان', turkey: 'تركيا',
  unitedkingdom: 'المملكة المتحدة', uk: 'المملكة المتحدة', british: 'المملكة المتحدة',
  unitedstates: 'الولايات المتحدة', usa: 'الولايات المتحدة', american: 'الولايات المتحدة',
  canada: 'كندا', australia: 'أستراليا', germany: 'ألمانيا', france: 'فرنسا',
  italy: 'إيطاليا', spain: 'إسبانيا', russia: 'روسيا', ukraine: 'أوكرانيا',
  china: 'الصين', japan: 'اليابان', southafrica: 'جنوب أفريقيا', nigeria: 'نيجيريا',
  kenya: 'كينيا', ethiopia: 'إثيوبيا', ghana: 'غانا', uganda: 'أوغندا',
  indonesia: 'إندونيسيا', malaysia: 'ماليزيا', thailand: 'تايلاند', vietnam: 'فيتنام',
};
const nationalityAr = (en?: string | null): string =>
  NATIONALITY_AR[(en ?? '').toLowerCase().replace(/[^a-z]/g, '')] ?? '';

/** Arabic for the unit types the form's "نوع العقار" box carries. */
const TYPE_AR: Record<string, string> = {
  villa: 'فيلا / بيت عربي',
  townhouse: 'تاون هاوس',
  apartment: 'شقة',
  studio: 'استوديو',
  penthouse: 'بنتهاوس',
  duplex: 'دوبلكس',
  room: 'غرفة',
  labour_accommodation: 'سكن عمال',
  staff_accommodation: 'سكن موظفين',
  retail_shop: 'محل تجاري',
  showroom: 'صالة عرض',
  office_fitted: 'مكتب',
  office_shell_core: 'مكتب',
  warehouse: 'مستودع',
  open_yard: 'ساحة مكشوفة',
  storage_unit: 'مخزن',
};

/**
 * Derive every slot from the contract, then apply overrides.
 *
 * Slots with no source in our data model yet — nationality (both parties),
 * passport, second phone, floor, room, sewerage number and the whole
 * Request Details block — resolve to '' unless supplied via `override`.
 * Sector now reads the property's city (Ajman's eight municipal sectors,
 * migration 0192) and is blank only for a property recorded without one.
 */
export function buildAjmanFields(
  data: EjariContractData,
  override?: Partial<AjmanContractFields>,
): AjmanContractFields {
  const lord = data.landlord;
  const ten = data.tenant;
  const p = data.property;
  const u = data.unit;
  const rent = Number(data.annualRent) || 0;
  const total = data.contractValue != null ? Number(data.contractValue) : rent;
  const typeKey = (u.type ?? '').toLowerCase();

  const derived: AjmanContractFields = {
    lessorName: S(lord.companyName || lord.name),
    lessorNameAr: '',
    lessorNationality: S(lord.nationality),
    lessorNationalityAr: nationalityAr(lord.nationality),
    // A company lessor is identified by its licence, not an Emirates ID.
    lessorEmiratesId: lord.entityType === 'company' ? '' : S(lord.emiratesId),

    tenantName: S(ten.companyName || ten.name),
    tenantNameAr: '',
    tenantNationality: S(ten.nationality),
    tenantNationalityAr: nationalityAr(ten.nationality),
    tenantEmiratesId: S(ten.emiratesId),
    tenantPassport: S(ten.passportNumber),
    tenantMobile: S(ten.phone),
    tenantPhone: '',

    propertyType: prettyType(u.type),
    propertyTypeAr: TYPE_AR[typeKey] ?? '',
    city: S(p.emirate) || 'Ajman',
    cityAr: 'عجمان',
    // Sector = the municipal sector, which is what our city tier holds for Ajman
    // (migration 0192). Blank for a property recorded before that structure.
    sector: S(p.city),
    sectorAr: '',
    // The form's District row carries the numbered sub-district where the
    // property has one ("Al Nuaimiya 2"), else the district itself.
    district: S(p.subCommunity) || S(p.community),
    districtAr: '',
    plot: S(p.plotNumber),
    unit: S(u.number || u.name),
    space: u.sizeSqm != null ? String(u.sizeSqm) : '',
    floor: S(u.floor),
    // "Room / الغرف" on the form is the room count, which for us is bedrooms.
    room: u.bedrooms != null ? String(u.bedrooms) : '',
    building: S(p.buildingName),
    buildingAr: '',
    // "Fewa Number / رقم حساب هيئه الكهرباء والماء" is literally the utility
    // AUTHORITY ACCOUNT number, so the lease's utility account is the right
    // source (FEWA in Ajman); the unit's premise number is only a fallback.
    fewaNumber: S(data.utilityAccountNumber || u.dewaPremiseNumber || p.premisesNumber),
    sewerageNumber: S(p.sewerageNumber),

    startDate: fmtDate(data.startDate),
    endDate: fmtDate(data.endDate),
    security: fmtAmt(data.securityDepositAmount),
    rentYearly: rent > 0 ? fmtAmt(rent) : '',
    totalRent: total > 0 ? fmtAmt(total) : '',
    duration: fmtDuration(data.startDate, data.endDate),

    makkani: S(p.makaniNumber),
    parcel: '',
    applicationNo: '',
    receiptNo: '',
    paymentDate: '',
    debitNote: '',

    usage: effectiveSpaceCategory(u.type, p.spaceCategory),
  };
  return { ...derived, ...(override ?? {}) };
}

// ── Table primitives — the form is one bordered grid per section ──────────────
const st = {
  page: { paddingTop: 22, paddingBottom: 20, paddingHorizontal: 24, fontSize: 8, fontFamily: LATIN, color: '#000' },
  bar: { backgroundColor: BAR, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 6 },
  barEn: { color: '#fff', fontSize: 9.5 },
  barAr: { color: '#fff', fontSize: 10, fontFamily: AR },
  table: { borderWidth: 1, borderColor: RULE, borderTopWidth: 0, marginBottom: 7 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: RULE, minHeight: 15 },
  lbl: { paddingHorizontal: 4, paddingVertical: 3, fontSize: 8 },
  val: { paddingHorizontal: 4, paddingVertical: 3, fontSize: 8, textAlign: 'center' },
  ar: { fontFamily: AR },
} as const;

/** Section title bar — English left, Arabic right. */
const Bar = ({ en, ar }: { en: string; ar: string }) => (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  <View style={st.bar as any}>
    <Text style={st.barEn}>{en}</Text>
    <Text style={st.barAr}>{ar}</Text>
  </View>
);

const Section = ({ en, ar, children }: { en: string; ar: string; children: React.ReactNode }) => (
  <View wrap={false}>
    <Bar en={en} ar={ar} />
    <View style={st.table}>{children}</View>
  </View>
);

const LBL_W = 78;   // English label column
const ARLBL_W = 90; // Arabic label column (right edge)

/**
 * A row whose value is split EN | AR across the middle (Name, Nationality,
 * Property Type…). When no Arabic is known — names and buildings, which we only
 * ever hold in English — the English value is echoed into the Arabic half rather
 * than leaving it blank; the municipality writes the official Arabic when the
 * contract is entered into their system.
 */
const RowSplit = ({ en, ar, value, valueAr, last }: { en: string; ar: string; value?: string; valueAr?: string; last?: boolean }) => (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  <View style={{ ...st.row, ...(last ? { borderBottomWidth: 0 } : {}) } as any}>
    <Text style={{ ...st.lbl, width: LBL_W, borderRightWidth: 1, borderRightColor: RULE }}>{en}</Text>
    <Text style={{ ...st.val, flex: 1, borderRightWidth: 1, borderRightColor: RULE }}>{value || ' '}</Text>
    <Text style={{ ...st.val, flex: 1, fontFamily: AR, borderRightWidth: 1, borderRightColor: RULE }}>{valueAr || value || ' '}</Text>
    <Text style={{ ...st.lbl, width: ARLBL_W, fontFamily: AR, textAlign: 'right' }}>{ar}</Text>
  </View>
);

/** A row whose single value is centred across the full width (Emirates ID, Plot…). */
const RowWide = ({ en, ar, value, arabicValue, last }: { en: string; ar: string; value?: string; arabicValue?: boolean; last?: boolean }) => (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  <View style={{ ...st.row, ...(last ? { borderBottomWidth: 0 } : {}) } as any}>
    <Text style={{ ...st.lbl, width: LBL_W, borderRightWidth: 1, borderRightColor: RULE }}>{en}</Text>
    <Text style={{ ...st.val, flex: 1, borderRightWidth: 1, borderRightColor: RULE, ...(arabicValue ? { fontFamily: AR } : {}) }}>{value || ' '}</Text>
    <Text style={{ ...st.lbl, width: ARLBL_W, fontFamily: AR, textAlign: 'right' }}>{ar}</Text>
  </View>
);

/** Two fields on one row (Unit | Space, Floor | Room, Emirates ID | Passport…). */
const RowPair = ({ en, ar, value, en2, ar2, value2, last }: {
  en: string; ar: string; value?: string; en2: string; ar2: string; value2?: string; last?: boolean;
}) => (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  <View style={{ ...st.row, ...(last ? { borderBottomWidth: 0 } : {}) } as any}>
    <Text style={{ ...st.lbl, width: LBL_W, borderRightWidth: 1, borderRightColor: RULE }}>{en}</Text>
    <Text style={{ ...st.val, flex: 1 }}>{value || ' '}</Text>
    <Text style={{ ...st.lbl, width: ARLBL_W, fontFamily: AR, textAlign: 'right', borderRightWidth: 1, borderRightColor: RULE }}>{ar}</Text>
    <Text style={{ ...st.lbl, width: LBL_W, borderRightWidth: 1, borderRightColor: RULE }}>{en2}</Text>
    <Text style={{ ...st.val, flex: 1 }}>{value2 || ' '}</Text>
    <Text style={{ ...st.lbl, width: ARLBL_W, fontFamily: AR, textAlign: 'right' }}>{ar2}</Text>
  </View>
);

/** Half-width detail table row (Contract Details / Request Details boxes). */
const RowHalf = ({ en, ar, value, last }: { en: string; ar: string; value?: string; last?: boolean }) => (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  <View style={{ ...st.row, ...(last ? { borderBottomWidth: 0 } : {}) } as any}>
    <Text style={{ ...st.lbl, width: 74, borderRightWidth: 1, borderRightColor: RULE }}>{en}</Text>
    <Text style={{ ...st.val, flex: 1, borderRightWidth: 1, borderRightColor: RULE }}>{value || ' '}</Text>
    <Text style={{ ...st.lbl, width: 84, fontFamily: AR, textAlign: 'right' }}>{ar}</Text>
  </View>
);

const SigBox = ({ en, ar, img, date }: { en: string; ar: string; img?: string | null; date?: string }) => (
  <View style={{ flex: 1, padding: 6 }}>
    <View style={{ height: 40, justifyContent: 'flex-end' }}>
      {img
        ? <Image src={img} style={{ maxHeight: 32, maxWidth: 140, objectFit: 'contain' }} />
        : <Text style={{ fontSize: 7, color: '#bbb' }}>Not yet signed</Text>}
    </View>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: RULE, paddingTop: 3 }}>
      <Text style={{ fontSize: 7.5 }}>{en} <Text style={st.ar}>{ar}</Text></Text>
      <Text style={{ fontSize: 7.5 }}>{date || '____________'} <Text style={st.ar}>التاريخ</Text></Text>
    </View>
  </View>
);

// ── Page 2 — Terms Of The Contract (Amiri Decree No. 2 of 2017) ──────────────
// Transcribed from the official Ajman form; article numbering and the article
// headings are reproduced verbatim, English left / Arabic right.
type Clause = { en: string; ar: string; heading?: boolean };
const ARTICLES: Clause[] = [
  { heading: true, en: 'Article (7) The Lessor’s Guarantees of the leased Real Estate', ar: 'المادة (7) ضمان المؤجر للعقار المؤجر' },
  {
    en: '7(2) The lessor shall do maintenance for the Real Estate, as set forth in Article (8) of this Decree, unless otherwise expressly agreed upon by both parties in the Lease Contract.',
    ar: '7(2) على المؤجر ان يقوم بصيانة العقار, على النحو المذكور في المادة (8) من هذا المرسوم , ما لم يكن الطرفان قد إتفقا في عقد الإيجار صراحة على خلاف ذلك',
  },
  {
    en: '7(3) The Lessor shall not do damage or make changes that prevent the Lessee from proper and full utilization of the Real Estate according to the provisions of the Amiri Decree.',
    ar: '7(3) لا يجوز للمؤجر أن يحدث في العقار المؤجر أي ضرر أو تغيير يمنع المستأجر من الانتفاع الكامل بالعقار المؤجر بالصورة المطلوبة وفقا لأحكام هذا المرسوم.',
  },
  {
    en: '7(4) The Lessee, in person or by others, shall not cut off the power supply, water, telephone communication or any similar services of the leased Real Estate; remove, damage or disable advantages or utilities that were available in the leased Real Estate during the lease period; or do any action that is intended to deprive the Lessee of full enjoyment of the benefits of the same, or to oblige the lessor to evacuate from such Real Estate or to accept any increase in the rental amount in violation of the provisions of this Decree and the Lease Contract.',
    ar: '7(4) لا يجوز للمؤجر , سواء بنفسه أو بواسطة غيره , قطع التيار الكهربائي أو الماء أو الهاتف أو اية خدمات أخرى مماثلة من العقار المؤجر , او إزالة أو إتلاف أو تعطيل أي من الميزات أو المنافع التي كانت متوافرة في العقار المؤجر , في وقت تأجيره, أو القيام بأي عمل آخر يقصد منه حرمان المستأجر من التمتع الكامل بمنافع العقار المؤجر , أو يقصد به إجبار المستأجر على إخلاء العقار أو قبول اية زيادة في مبلغ الإيجار , خلافاً لأحكام هذا المرسوم و أحكام عقد الإيجار .',
  },
  { heading: true, en: 'Article (9) The Lessor Preservation of the leased Real Estate', ar: 'المادة(9) محافظة المستأجر على العقار المؤجر' },
  {
    en: '9(1) The Lessee shall preserve the Leased Real Estate as one of his/her own property, especially carry out the required general cleaning works and minor maintenance to utilize the said Real Estate, in accordance with its purpose which is customary for the Lessee to do in Ajman. The Lessee shall guarantee any deficiency, damage, or loss due to his/her negligence or violation unless it is proven by reasonable data that the same has been resulting from a reason beyond his/her control. If the Lessee makes changes, decoration works or other improvements, he/she shall leave it without any indemnification at the end of the lease period, unless otherwise is accepted by the Lessor.',
    ar: '9(1) يجب على المستأجر أن يحافظ على العقار المؤجر محافظة الشخص العادي لممتلكاته , ويجب عليه , على وجه الخصوص , أن يقوم بسائر أعمال النظافة العامة والصيانة البسيطة اللازمة للإنتفاع بالعقار المؤجر , وفقاً للغرض منه , والتي جرى العرف في الإمارة بتكليف المستأجر بمثلها , ويضمن المستأجر ما يلحق العقار المؤجر من نقص أو تلف أو فقدان, ناشئ عن إهماله أو تعديه, إلا إذا ثبت ببينات معقولة أن ذلك النقص أو التلف أو الفقدان قد نشأ عن سبب خارج عن إرادة المستأجر و اذا أحدث المستأجر في العقار المؤجر غرساً أو أعمال ديكور ثابتة أو تحسينات أخرى فيلتزم بتركها وبدون تعويض عنها عند نهاية مدة الايجار ما لم يوافق المؤجر على خلاف ذلك .',
  },
  {
    en: '9(4) The Lessee shall not, fully or partially, assign, or sub-rent the Real Estate, unless the Lessor accepts with a written notice. However, if the Premises are a business place or factory, and it is necessary for the Lessee to sell the same with its material and abstract items, The present Lease Contract may then continue, without the Lessor Permission, until its period is terminated. In this case, the following is a prerequisite:',
    ar: '9(4) لا يجوز للمستأجر التنازل عن حيازة العقار , أو إيجاره من الباطن , كلياً أو جزئياً, إلا بموافقة المؤجر خطياً . وبالرغم من ذلك , إذا كان العقار المؤجر مكاناً تجارياً أو مصنعاً , وإقتضت الضرورة أن يبيع المستأجر ذلك المكان التجاري أو المصنع , مصحوباً بعناصره المادية والمعنوية , فيجوز, عندئذ, أن يستمر عقد الايجار الساري وقتذاك الى حين انتهاء مدته بدون إذن المؤجر , ولكن يشترط في هذه الحالة:',
  },
  {
    en: 'a) The Lessor shall be notified that the original Lessee assigned the Real Estate, in Full or in part, to the sublessee till the end of the effective lease contract period at that time.',
    ar: 'أ) أن يتم إخطار المؤجر بتنازل المستأجر الأصلي عن العقار المؤجر, كلياً أو جزئياً, للمستأجر من الباطن حتى نهاية مدة العقد الساري آنذاك؛',
  },
  {
    en: 'b) The Lessee to whom the premises were assigned shall, to the Lessor, adequately give guarantees to execute the original Lease Contract with its terms and conditions.',
    ar: 'ب) أن يقدم المستأجر المتنازل إليه للمؤجر ضماناً كافياً لتنفيذ عقد الإيجار الأصلي بنفس شروطه وأحكامه؛ و',
  },
  {
    en: 'c) The Lessor shall not, as a result of that assignment, do a significant damage. The lessor’s loss of the increase in the new rental amount shall not be deemed a significant damage as meant in such paragraph.',
    ar: 'ج) ألا يلحق المؤجر كنتيجة لذلك التنازل ضرراً جسمياً, ولا يعتبر فقدان المؤجر للزيادة المحتملة في مبلغ الإيجار الجديد ضرراً جسمياً بالمعنى المقصود هذه الفقرة',
  },
  { heading: true, en: 'Article (16) Jurisdiction of the Dispute Committee', ar: 'المادة(16) اختصاصات لجنة المنازعات' },
  {
    en: 'Only dispute committee shall have the authority to definitively and decisively consider and resolve all types of disputes and opposing disputes arising from, or due to, contractual relation between the Lessor and the Lessee in any of Ajman real estate the provisions of the Decree apply to.',
    ar: 'تختص لجنة المنازعات وحدها, ودون سواها, بسلطة النظر والبت , بصورة نهائية وحاسمة , في جميع أنواع المنازعات, والمنازعات المتقابلة , التي تنشأ عن, أو بسبب , العلاقة التعاقدية فيما بين مؤجر و مستأجر أي عقار إمارة عجمان',
  },
  {
    en: 'Without prejudice to the general provision herein stipulated, dispute committee shall be competent to definitively and decisively consider and resolve rental disputes with regard to the following:',
    ar: 'يخضع لأحكام هذا المرسوم. وبدون إخلال بعمومية هذا النص, تختص لجنة المنازعات بنظر والبت, بصورة نهائية و حاسمة , في منازعات الإيجارات المتعلقة بما يأتي :',
  },
  { en: 'a) The Lessee defaults on paying the agreed rental amount in the lease contract.', ar: 'ا) إخفاق المستأجر في سداد مبلغ الإيجار المتفق عليه في عقد الايجار' },
  { en: 'b) Request for increase in the rental amount by the lessor or decrease in the same by the lessee.', ar: 'ب) طلب زيادة مبلغ الإيجار من قبل المؤجر أو طلب تخفيضه من المستأجر' },
  { en: 'c) Determining the similar rental amount for the leased property', ar: 'ج) تحديد مبلغ إيجار المثل للعقار المؤجر' },
  { en: 'd) Evacuation of the premises for any of the reason herein set forth of the Article (12).', ar: 'د) إخلاء العقار المؤجر لأحد الأسباب الواردة في المادة (12) من هذا المرسوم' },
  {
    en: 'e) The Lessor failed to do maintenance of the leased Premises or give Lessor guarantee in accordance with the provisions of this Decree or the Lease Contract.',
    ar: 'ه) إخفاق المؤجر في صيانة العقار المؤجر أو في توفير ضمانات العقار المؤجر وفقاً لأحكام هذا المرسوم , أو وفقاً لشروط عقد الإيجار',
  },
  {
    en: 'f) The Lessor failed to meet his/her commitment with regard to maintenance or preservation of the leased Premises in accordance with the provisions of this Decree or the Lease Contract.',
    ar: 'و) إخفاق المستأجر في تأدية التزاماته بشأن صيانة والمحافظة على العقار المؤجر وفقاً لأحكام هذا المرسوم , أو وفقاً لشروط عقد الإيجار',
  },
  {
    en: 'g) Claim of either party for indemnification against any damage as a result of breach of any provision hereof or of the Lease Contract without a legitimate excuse.',
    ar: 'ز) مطالبة أي من طرفي عقد الايجار بتعويضه عن أي ضرر تكبده نتيجة لإخلال الطرف الآخر بأي حكم من أحكام هذا المرسوم , أو بأي شرط من شروط عقد الإيجار , بدون عذر مشروع',
  },
  {
    en: 'h) Any dispute regarding evidence of legitimacy or validity of the lease contract, or interpretation or application of any of the terms of the lease contract.',
    ar: 'ح) أي منازعة , تتعلق بإثبات مشروعية أو بسريان عقد الإيجار أو بتفسير أو بتطبيق أي شرط من شروط عقد الإيجار',
  },
  { en: 'i) Any other dispute falling within the jurisdiction of the Dispute Committee.', ar: 'ط) أي منازعة أخرى , ترى لجنة المنازعات إنها تقع ضمن إختصاصها' },
  { en: 'j) Determining in any petition to reconsider a resolution issued by the Dispute Committee', ar: 'ي) البت في أي التماس لإعادة النظر في قرار أصدرته لجنة المنازعات' },
];

/** The red line at the top of page 2 — a citation of the governing decree, not a
 *  certification claim, so it is reproduced. */
const DECREE_LINE_AR = 'حرر هذا العقد بين طرفيه وفقاً لأحكام المرسوم الأميري رقم (2) لسنة 2017 بإصدار قانون إيجار العقارات في إمارة عجمان';

const AjmanHeader = () => (
  <View style={{ marginBottom: 10 }}>
    <Image src="/templates/ajman-header.png" style={{ width: '100%', objectFit: 'contain' }} />
  </View>
);

export function AjmanContractDoc({
  data, fields, extraPages = [],
}: {
  data: EjariContractData;
  /** Pre-built slots; omit to derive from `data` (+ `data.ajman` overrides). */
  fields?: AjmanContractFields;
  /** Addendum <Page> elements appended after the contract. */
  extraPages?: React.ReactNode[];
}) {
  const f = fields ?? buildAjmanFields(data, data.ajman);
  const tSig = (data.signatures || []).find((s) => s.role === 'tenant');
  const lSig = (data.signatures || []).find((s) => s.role === 'landlord');
  const clauses = [...(data.customClauses || []), ...(data.notes ? [data.notes] : [])].filter(Boolean);

  // The government form carries no signature area (it is certified electronically);
  // ours must, and BOTH pages are signed — the terms page is as binding as the
  // details page, so neither can be swapped out after signing.
  const sigs = (
    <View wrap={false} style={{ marginTop: 6 }}>
      <Bar en="Signatures" ar="التوقيعات" />
      <View style={{ ...st.table, flexDirection: 'row' }}>
        <View style={{ flex: 1, borderRightWidth: 1, borderRightColor: RULE, flexDirection: 'row' }}>
          <SigBox en="Tenant Signature" ar="توقيع المستأجر" img={tSig?.signatureImage} date={fmtDate(tSig?.signedAt)} />
        </View>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <SigBox en="Lessor's Signature" ar="توقيع المؤجر" img={lSig?.signatureImage} date={fmtDate(lSig?.signedAt)} />
        </View>
      </View>
    </View>
  );

  return (
    <Document>
      {/* ── Page 1 — the parties, the unit and the money ─────────────────── */}
      <Page size="A4" style={st.page}>
        <AjmanHeader />

        <Section en="First Party ( Lesser )" ar="بيانات الطرف الأول ( المؤجر )">
          <RowSplit en="Name" ar="الاسم" value={f.lessorName} valueAr={f.lessorNameAr} />
          <RowSplit en="Nationality" ar="الجنسية" value={f.lessorNationality} valueAr={f.lessorNationalityAr} />
          <RowWide en="Emirates ID" ar="بطاقة الهوية" value={f.lessorEmiratesId} last />
        </Section>

        <Section en="Second Party ( Tenant )" ar="بيانات الطرف الثاني ( المستأجر )">
          <RowSplit en="Name" ar="الاسم" value={f.tenantName} valueAr={f.tenantNameAr} />
          <RowSplit en="Nationality" ar="الجنسية" value={f.tenantNationality} valueAr={f.tenantNationalityAr} />
          <RowPair en="Emirates ID" ar="بطاقة الهوية" value={f.tenantEmiratesId}
                   en2="Passport number" ar2="جواز السفر" value2={f.tenantPassport} />
          <RowPair en="Mobile number" ar="الجوال" value={f.tenantMobile}
                   en2="Phone number" ar2="الهاتف" value2={f.tenantPhone} last />
        </Section>

        <Section en="Leased Unit Details" ar="بيانات العين المؤجرة">
          <RowSplit en="Property Type" ar="نوع العقار" value={f.propertyType} valueAr={f.propertyTypeAr} />
          <RowSplit en="City" ar="المدينه" value={f.city} valueAr={f.cityAr} />
          <RowSplit en="Sector" ar="القطاع" value={f.sector} valueAr={f.sectorAr} />
          <RowSplit en="District" ar="الحي" value={f.district} valueAr={f.districtAr} />
          <RowWide en="Plot" ar="القطعه" value={f.plot} />
          <RowPair en="Unit" ar="الوحدة" value={f.unit} en2="Space" ar2="المساحه" value2={f.space} />
          <RowPair en="Floor" ar="الطابق" value={f.floor} en2="Room" ar2="الغرف" value2={f.room} />
          <RowWide en="Building" ar="المبنى" value={f.buildingAr || f.building} arabicValue={!!f.buildingAr} />
          <RowWide en="Fewa Number" ar="رقم حساب هيئه الكهرباء والماء" value={f.fewaNumber} />
          <RowWide en="Sewarage Number" ar="رقم الصرف الصحي" value={f.sewerageNumber} last />
        </Section>

        {/* Contract Details and Request Details sit side by side on the form. */}
        <View style={{ flexDirection: 'row' }} wrap={false}>
          <View style={{ flex: 1, paddingRight: 5 }}>
            <Bar en="Contract Details" ar="بيانات العقد" />
            <View style={st.table}>
              <RowHalf en="Start date" ar="تاريخ البدء" value={f.startDate} />
              <RowHalf en="End Date" ar="تاريخ الانتهاء" value={f.endDate} />
              <RowHalf en="Security" ar="مبلغ التأمين" value={f.security} />
              <RowHalf en="Rent(Yearly)" ar="مبلغ الايجار(السنوي)" value={f.rentYearly} />
              <RowHalf en="Total Rent" ar="مبلغ الايجار الإجمالي" value={f.totalRent} />
              <RowHalf en="Duration" ar="المدة بالاشهر" value={f.duration} last />
            </View>
          </View>
          <View style={{ flex: 1, paddingLeft: 5 }}>
            <Bar en="Request Details" ar="بيانات الطلب" />
            <View style={st.table}>
              <RowHalf en="Makkani" ar="رقم مكاني" value={f.makkani} />
              <RowHalf en="Parcel" ar="رقم قطعة الارض" value={f.parcel} />
              <RowHalf en="Application No" ar="رقم الطلب" value={f.applicationNo} />
              <RowHalf en="Reciept No" ar="رقم ايصال الدفع" value={f.receiptNo} />
              <RowHalf en="Payment Date" ar="تاريخ الدفع" value={f.paymentDate} />
              <RowHalf en="Debit Note" ar="رقم اذن الاستلام" value={f.debitNote} last />
            </View>
          </View>
        </View>

        <View style={{ flexGrow: 1 }} />
        {sigs}
      </Page>

      {/* ── Page 2 — Terms Of The Contract ───────────────────────────────── */}
      <Page size="A4" style={st.page}>
        <AjmanHeader />
        <Text style={{ fontSize: 8, fontFamily: AR, color: '#c00000', textAlign: 'center', marginBottom: 6 }}>
          {DECREE_LINE_AR}
        </Text>
        <Bar en="Terms Of The Contract" ar="شروط العقد" />
        <View style={{ ...st.table, flexDirection: 'row' }}>
          <View style={{ flex: 1, padding: 5, borderRightWidth: 1, borderRightColor: RULE }}>
            {ARTICLES.map((c, i) => (
              <Text key={i} style={{ fontSize: 6.4, marginBottom: 3, lineHeight: 1.3, textAlign: 'justify', ...(c.heading ? { fontWeight: 700, marginTop: i ? 3 : 0 } : {}) }}>
                {c.en}
              </Text>
            ))}
          </View>
          <View style={{ flex: 1, padding: 5 }}>
            {ARTICLES.map((c, i) => (
              <Text key={i} style={{ fontSize: 6.4, marginBottom: 3, lineHeight: 1.45, fontFamily: AR, textAlign: 'right', ...(c.heading ? { fontWeight: 700, marginTop: i ? 3 : 0 } : {}) }}>
                {c.ar}
              </Text>
            ))}
          </View>
        </View>

        {clauses.length > 0 && (
          <View wrap={false} style={{ marginTop: 4 }}>
            <Bar en="Additional Terms" ar="شروط إضافية" />
            <View style={{ ...st.table, padding: 6 }}>
              {clauses.map((c, i) => (
                <Text key={i} style={{ fontSize: 7.5, marginBottom: 3, lineHeight: 1.4 }}>{i + 1}. {c}</Text>
              ))}
            </View>
          </View>
        )}
        <View style={{ flexGrow: 1 }} />
        {sigs}
      </Page>

      {extraPages}
    </Document>
  );
}

export default AjmanContractDoc;
