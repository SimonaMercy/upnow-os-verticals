/**
 * One-time: turn the flat 3-page official Ejari PDF into a fillable 3-page
 * template by overlaying AcroForm text fields (bounded boxes) at each value
 * position, plus a Property-Usage radio group. Output is reused at runtime and
 * filled with pdf-lib (auto-shrink per field), giving the 3-page layout with
 * form-grade robustness.
 *   node scripts/build-ejari-3page-editable.mjs
 */
import { PDFDocument } from 'pdf-lib';
import { readFileSync, writeFileSync } from 'fs';

const doc = await PDFDocument.load(readFileSync('public/templates/ejari-dubai.pdf'));
const form = doc.getForm();
const pages = doc.getPages();
const H = pages[0].getHeight();

// [name, pageIndex, x, width, labelBottom(top-down)]
const FIELDS = [
  ['date',0,48,77,119.3],
  ['owner_name',0,90,434,181.2],['lessor_name',0,91,433,203.2],['lessor_id',0,110,379,226.2],
  ['lessor_license',0,80,174,248.2],['lessor_license_authority',0,376,137,248.2],
  ['lessor_email',0,89,399,273.2],['lessor_phone',0,92,416,295.2],
  ['tenant_name',0,91,426,351.2],['tenant_id',0,111,372,373.2],
  ['tenant_license',0,80,174,396.2],['tenant_license_authority',0,376,137,396.2],
  ['tenant_email',0,90,393,421.2],['tenant_phone',0,93,408,443.2],
  ['plot_no',0,67,190,523.2],['makani_no',0,348,177,523.2],
  ['building_name',0,90,163,546.2],['property_no',0,353,175,546.2],
  ['property_type',0,87,169,569.2],['property_area',0,378,112,569.2],
  ['location',0,69,198,592.2],['dewa_no',0,385,120,592.2],
  ['period_from',0,149,52,657.9],['period_to',0,229,71,657.9],
  ['contract_value',0,360,164,649.2],['annual_rent',0,81,165,674.2],
  ['security_deposit',0,396,126,674.2],['mode_of_payment',0,101,420,696.2],
  ['sig_tenant_date',0,200,70,806.2],['sig_lessor_date',0,473,69,806.2],
  // page 2 — additional terms + signature dates
  ['additional_term_1',2,52,498,326],['additional_term_2',2,52,498,352],
  ['additional_term_3',2,52,498,376],['additional_term_4',2,52,498,402],['additional_term_5',2,52,498,426],
  ['sig_tenant_date_2',2,200,70,776],['sig_lessor_date_2',2,473,69,776],
];

for (const [name, pi, x, w, lb] of FIELDS) {
  const tf = form.createTextField(name);
  tf.addToPage(pages[pi], { x, y: H - lb - 2.5, width: w, height: 12.5, borderWidth: 0 });
  tf.setFontSize(9);
}

// Property Usage radio (circles already drawn in the PDF; borderless dot)
const rg = form.createRadioGroup('property_usage');
for (const [opt, x] of [['Industrial',148],['Commercial',255],['Residential',368]]) {
  rg.addOptionToPage(opt, pages[0], { x, y: H - 499.5, width: 9, height: 9, borderWidth: 0 });
}

writeFileSync('public/templates/ejari-dubai-3page-editable.pdf', await doc.save());
console.log('built ejari-dubai-3page-editable.pdf with', FIELDS.length, 'text fields + usage radio');
