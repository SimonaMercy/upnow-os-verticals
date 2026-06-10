/**
 * Dubai tenancy-contract generation by filling the OFFICIAL DLD Ejari PDF.
 *
 * Instead of recreating the form, we draw the contract values directly onto the
 * government's own 3-page PDF (`/public/templates/ejari-dubai.pdf`) with pdf-lib:
 * exact official layout, fonts (Roboto) and the EJARI watermark, with per-field
 * auto-shrink so long values never overflow. Output is flat page content (no
 * editable form fields) — locked/secure. Addendum pages (which may contain
 * shaped Arabic) are rendered with @react-pdf and appended.
 *
 * Dubai only — `isDubaiContract()` gates it; other emirates use the react-pdf
 * <EjariContractDoc> generator.
 */
import { PDFDocument, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { jurisdictionForEmirate } from '@/lib/tenancyJurisdiction';
import type { EjariContractData, EjariAddendum } from '@/components/contract/EjariContractPdf';

/** Dubai is the only emirate whose official artwork (DLD logos) we have. */
export function isDubaiContract(data: EjariContractData): boolean {
  return jurisdictionForEmirate(data.property.emirate).useDldLogos;
}

// ── Field coordinate map: name -> [pageIndex, x, width, labelBottom(top-down)] ──
// Same map used to build the fillable template; here it positions drawn text.
const POS: Record<string, [number, number, number, number]> = {
  date: [0, 48, 77, 119.3],
  owner_name: [0, 90, 434, 181.2], lessor_name: [0, 91, 433, 203.2], lessor_id: [0, 110, 379, 226.2],
  lessor_license: [0, 80, 174, 248.2], lessor_license_authority: [0, 376, 137, 248.2],
  lessor_email: [0, 89, 399, 273.2], lessor_phone: [0, 92, 416, 295.2],
  tenant_name: [0, 91, 426, 351.2], tenant_id: [0, 111, 372, 373.2],
  tenant_license: [0, 80, 174, 396.2], tenant_license_authority: [0, 376, 137, 396.2],
  tenant_email: [0, 90, 393, 421.2], tenant_phone: [0, 93, 408, 443.2],
  plot_no: [0, 67, 190, 523.2], makani_no: [0, 348, 177, 523.2],
  building_name: [0, 90, 163, 546.2], property_no: [0, 353, 175, 546.2],
  property_type: [0, 87, 169, 569.2], property_area: [0, 378, 112, 569.2],
  location: [0, 69, 198, 592.2], dewa_no: [0, 385, 120, 592.2],
  period_from: [0, 108, 85, 647.6], period_to: [0, 193, 57, 647.6],
  contract_value: [0, 360, 164, 649.2], annual_rent: [0, 81, 165, 674.2],
  security_deposit: [0, 396, 126, 674.2], mode_of_payment: [0, 101, 420, 696.2],
  additional_term_1: [2, 52, 498, 326], additional_term_2: [2, 52, 498, 352],
  additional_term_3: [2, 52, 498, 376], additional_term_4: [2, 52, 498, 402], additional_term_5: [2, 52, 498, 426],
};
// Property-Usage radio circles (pdf-lib coords, all y≈347).
const USAGE_X: Record<string, number> = { industrial: 152, commercial: 259.5, residential: 372.5 };
// Signature boxes: [page, tenantCx, lessorCx, sigBaseline, dateBottom]
// The official DLD form carries a Signatures block on ALL three pages:
//  • page 1 (info) and page 2 (terms) — block sits at the very bottom (same y)
//  • page 3 (additional terms) — block sits higher up, above the footer band
const SIG: [number, number, number, number, number][] = [
  [0, 118, 392, 770, 806.2],
  [1, 118, 392, 770, 806.2],
  [2, 118, 392, 740, 776],
];

const fmtDate = (d?: string | null) => {
  if (!d) return '';
  const t = new Date(d);
  if (isNaN(t.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(t.getDate())}-${p(t.getMonth() + 1)}-${t.getFullYear()}`;
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
const cap = (s?: string | null) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const aedWords = (v?: number | null) => (v && v > 0 ? `${fmtAed(v)} (${numWords(v)})` : '');

async function bytesFrom(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} ${r.status}`);
  return r.arrayBuffer();
}

/** Fill the official Dubai Ejari PDF with the contract data. Returns PDF bytes. */
export async function fillEjariPdf(data: EjariContractData, addendums: EjariAddendum[] = []): Promise<Uint8Array> {
  const [tpl, robotoB, vibesB] = await Promise.all([
    bytesFrom('/templates/ejari-dubai.pdf'),
    bytesFrom('/fonts/Roboto-Regular.ttf'),
    bytesFrom('/fonts/GreatVibes-Regular.ttf'),
  ]);
  const doc = await PDFDocument.load(tpl);
  doc.registerFontkit(fontkit);
  const roboto = await doc.embedFont(robotoB);
  const vibes = await doc.embedFont(vibesB);
  const pages = doc.getPages();
  const H = pages[0].getHeight();

  const MAX = 9;
  const put = (name: string, value?: string | null, font: PDFFont = roboto) => {
    if (value == null || value === '') return;
    const spec = POS[name]; if (!spec) return;
    const [pi, x, w, lb] = spec;
    const tw = font.widthOfTextAtSize(value, MAX);
    const size = tw > w - 4 ? Math.max(5, (MAX * (w - 4)) / tw) : MAX;
    pages[pi].drawText(value, { x, y: H - lb + 2, size, font, color: rgb(0.05, 0.05, 0.05) });
  };

  const lord = data.landlord, ten = data.tenant, prop = data.property, unit = data.unit;
  const landlordName = lord.companyName || lord.name || '';
  put('date', fmtDate(data.createdAt) || fmtDate(new Date().toISOString()));
  put('owner_name', landlordName); put('lessor_name', landlordName);
  put('lessor_id', lord.emiratesId); put('lessor_license', lord.licenseNumber); put('lessor_license_authority', lord.licenseAuthority);
  put('lessor_email', lord.email); put('lessor_phone', lord.phone);
  put('tenant_name', ten.name); put('tenant_id', ten.emiratesId); put('tenant_license', ten.licenseNumber); put('tenant_license_authority', ten.licenseAuthority);
  put('tenant_email', ten.email); put('tenant_phone', ten.phone);
  put('plot_no', prop.plotNumber); put('makani_no', prop.makaniNumber);
  put('building_name', prop.buildingName); put('property_no', unit.number || unit.name);
  put('property_type', cap(unit.type)); put('property_area', unit.sizeSqm != null ? String(unit.sizeSqm) : '');
  put('location', prop.fullAddress || prop.community || prop.emirate);
  put('dewa_no', unit.dewaPremiseNumber || prop.premisesNumber);
  put('period_from', fmtDate(data.startDate)); put('period_to', fmtDate(data.endDate));
  put('contract_value', aedWords(data.contractValue != null ? data.contractValue : data.annualRent));
  put('annual_rent', aedWords(data.annualRent));
  put('security_deposit', fmtAed(data.securityDepositAmount));
  put('mode_of_payment', data.modeOfPayment);

  // Additional terms (page 3)
  const clauses = [...(data.customClauses || []), ...(data.notes ? [data.notes] : [])].filter(Boolean).slice(0, 5);
  clauses.forEach((c, i) => put(`additional_term_${i + 1}`, c));

  // Property Usage radio
  const sc = (prop.spaceCategory || '').toLowerCase(), ut = (unit.type || '').toLowerCase();
  const kind = sc.includes('commercial') || ut.includes('commercial') ? 'commercial'
    : sc.includes('industrial') || ut.includes('industrial') ? 'industrial' : 'residential';
  pages[0].drawCircle({ x: USAGE_X[kind], y: 347, size: 3.5, color: rgb(0.1, 0.23, 0.43) });

  // Signatures (real image if present, else typed-name handwriting, else blank box)
  const tSig = (data.signatures || []).find(s => s.role === 'tenant');
  const lSig = (data.signatures || []).find(s => s.role === 'landlord');
  const embedImg = async (src?: string | null) => {
    if (!src) return null;
    try {
      const buf = await bytesFrom(src);            // fetch() handles data: and http(s):
      const u8 = new Uint8Array(buf);
      const isPng = u8[0] === 0x89 && u8[1] === 0x50; // PNG magic; else assume JPEG
      return isPng ? await doc.embedPng(buf) : await doc.embedJpg(buf);
    } catch { return null; }
  };
  const [tImg, lImg] = await Promise.all([embedImg(tSig?.signatureImage), embedImg(lSig?.signatureImage)]);
  const sign = (pi: number, cx: number, baseline: number, img: Awaited<ReturnType<typeof embedImg>>, sig?: typeof tSig, name?: string | null) => {
    if (img) {
      const maxH = 34, maxW = 150;
      const s = Math.min(maxH / img.height, maxW / img.width, 1);
      const w = img.width * s, h = img.height * s;
      pages[pi].drawImage(img, { x: cx - w / 2, y: H - baseline - h + 14, width: w, height: h });
    } else if (sig && name) {
      let size = 20;
      const w0 = vibes.widthOfTextAtSize(name, size);
      if (w0 > 150) size = Math.max(10, (20 * 150) / w0);   // shrink long names to fit the box
      const w = vibes.widthOfTextAtSize(name, size);
      pages[pi].drawText(name, { x: cx - w / 2, y: H - baseline, size, font: vibes, color: rgb(0.1, 0.13, 0.3) });
    }
  };
  for (const [pi, tCx, lCx, base, dateB] of SIG) {
    sign(pi, tCx, base, tImg, tSig, ten.name);
    sign(pi, lCx, base, lImg, lSig, landlordName);
    if (tSig?.signedAt) pages[pi].drawText(fmtDate(tSig.signedAt), { x: 200, y: H - dateB + 2, size: 8, font: roboto, color: rgb(0.05, 0.05, 0.05) });
    if (lSig?.signedAt) pages[pi].drawText(fmtDate(lSig.signedAt), { x: 473, y: H - dateB + 2, size: 8, font: roboto, color: rgb(0.05, 0.05, 0.05) });
  }

  // Append addendum pages (rendered by @react-pdf so Arabic shapes correctly)
  if (addendums.length) {
    try {
      const { renderAddendumPdf } = await import('@/components/contract/EjariContractPdf');
      const addBytes = await renderAddendumPdf(data, addendums);
      const addDoc = await PDFDocument.load(addBytes);
      const copied = await doc.copyPages(addDoc, addDoc.getPageIndices());
      copied.forEach(p => doc.addPage(p));
    } catch { /* skip addendums if rendering fails */ }
  }

  return doc.save();
}
