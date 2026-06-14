// Validates an uploaded addendum: it must be a Word (.docx) document that still
// contains BOTH signature fields (landlord + tenant/customer). The sample keeps
// the signature block in the page FOOTER so it repeats at the end of every page
// — and mammoth's text extraction skips footers — so we unzip the .docx and scan
// the document body + headers + footers XML directly for the labels.
// PDF text-reading would need an extra library, so the gate is DOCX-only for now.
// See /public/templates/addendum-sample.docx.

export const ADDENDUM_SAMPLE_URL = '/templates/addendum-sample.docx';
export const ADDENDUM_ACCEPT = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const LANDLORD_LABEL = 'landlord signature';
const TENANT_LABELS = ['tenant signature', 'customer signature'];
const PART_RE = /word\/(document|header\d*|footer\d*)\.xml$/i;

export interface AddendumValidation { ok: boolean; error?: string }

/** Plain text of all body/header/footer parts of a .docx, whitespace-collapsed. */
async function readDocxText(arrayBuffer: ArrayBuffer): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(arrayBuffer);
  const parts: string[] = [];
  for (const path of Object.keys(zip.files)) {
    if (PART_RE.test(path)) {
      const xml = await zip.files[path].async('string');
      parts.push(xml.replace(/<[^>]+>/g, ' ')); // strip tags → text between runs
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').toLowerCase();
}

export async function validateAddendumFile(file: File): Promise<AddendumValidation> {
  if (!file.name.toLowerCase().endsWith('.docx')) {
    return { ok: false, error: 'Please upload a Word (.docx) file based on the sample template.' };
  }
  let text: string;
  try {
    text = await readDocxText(await file.arrayBuffer());
  } catch {
    return { ok: false, error: 'Could not read this Word file. Please use the sample template and upload a valid .docx.' };
  }
  const hasLandlord = text.includes(LANDLORD_LABEL);
  const hasTenant = TENANT_LABELS.some(l => text.includes(l));
  if (hasLandlord && hasTenant) return { ok: true };
  const missing = [!hasLandlord && 'Landlord Signature', !hasTenant && 'Tenant Signature'].filter(Boolean).join(' and ');
  return { ok: false, error: `This addendum is missing the ${missing} field. Download the sample, keep the signature block at the bottom of each page, and upload again.` };
}
