'use client';

/**
 * The shared contract "documents binder" — a full-page, two-pane verification +
 * sign surface used in TWO places so they stay identical:
 *   • the RP's authenticated "View all" page (/contracts/:id/documents)
 *   • the landlord's no-login magic-link page (/portal/:token/contract/:id)
 *
 * Layout: LEFT pane (fixed) = the tenant identity card + KYC (Emirates ID ·
 * Passport · UAE Visa, then each dependant, then the supporting pack); RIGHT pane (scrolls) = the rental /
 * financial documents in order (Payment plan · Payment Advice · Receipts ·
 * Agreement · Ejari, + new-lease extras). Every document renders full-preview on
 * a watermarked <canvas> (no download); the Agreement + Receipts render as
 * stacked canvas pages (no inner scroll). A sticky bar signs as the landlord.
 *
 * Each caller adapts its own data into the props below (the authenticated API vs
 * the token-scoped portal payload), then this component renders the rest.
 */
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { FileText, AlertTriangle, X } from 'lucide-react';
import type { ReceiptContract } from '@/components/upnow/PaymentReceiptPdf';
import type { EjariContractData, EjariAddendum } from '@/components/contract/EjariContractPdf';
import { SecureDocCanvas } from '@/components/upnow/SecureDocCanvas';
import { ContractSignBar } from '@/components/upnow/ContractSignBar';
import { DownloadDocButton } from '@/components/upnow/DownloadDocButton';
import { DownloadDocsButton, fetchStoredDocBytes, type MergeDocItem, type MergePart } from '@/components/upnow/DownloadDocsPopup';
import { PaymentPlanCard } from '@/components/upnow/PaymentPlanCard';
import { resolveDocSection } from '@/lib/documentCatalogue';
import { buildCurrentPlan, type PlanContract, type PlanPayment } from '@/lib/currentPlan';
import { segRowsFromContract } from '@/lib/segregatedPlan';
import ds from './ContractDocsBinder.module.css';

// Generated tenancy artifacts (NOT uploaded KYC/ID) are the counterparty's own
// documents and get a clean, watermark-free "Download PDF" — the stored snapshot.
const DOWNLOADABLE_ARTIFACT_KEYS = new Set(['move_in_report', 'move_out_report', 'deposit_settlement']);

const EjariInline = dynamic(() => import('@/components/contract/EjariInline'), {
  ssr: false,
  loading: () => <div style={{ padding: 36, textAlign: 'center', color: '#9b9890', fontSize: 13 }}>Rendering contract…</div>,
});
const ReceiptInline = dynamic(() => import('@/components/upnow/PaymentReceiptPdf').then(m => ({ default: m.ReceiptInline })), {
  ssr: false,
  loading: () => <div style={{ padding: 36, textAlign: 'center', color: '#9b9890', fontSize: 13 }}>Rendering receipts…</div>,
});
const FULL = 100000; // height so the inline canvas never hits its own scroll cap

export interface BinderDoc {
  id: number; documentKey: string; displayName: string | null; fileUrl: string;
  category?: string | null; ownerType?: string;
  /** The RP's declared home for this document (`documents.section`, migration
   *  0204). Null on every row filed before the choice existed — those fall back
   *  to the catalogue default and then to the key matchers below. */
  section?: string | null;
}

const KEY_ALIASES: Record<string, string[]> = {
  ejari_certificate: ['ejari', 'contract_registration', 'tenancy_contract_registration', 'ejari_registration'],
  payment_advice: ['pdc', 'post_dated_cheques', 'cheque_copies_pdc', 'cheque_copies', 'cheques', 'cheque', 'rent_cheques'],
  utility_registration: ['utility_proof_of_payment', 'utility_proof', 'utility_activation'],
  utility_final_bill: ['final_bill'],
  salary_certificate: ['salary', 'salary_cert', 'salary_slip', 'payslip', 'pay_slip'],
  bank_statement: ['bank', 'bank_statements', 'bank_stmt', 'statement_of_account'],
  marriage_certificate: ['marriage', 'marriage_cert'],
};
const norm = (s?: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const isImageUrl = (url: string) => /\.(png|jpe?g|gif|webp|bmp|heic|heif|tiff?)$/.test((url || '').toLowerCase().split('?')[0]);

const isEid = (d: BinderDoc) => /emirates_?id|(^|_)eid(_|$)/.test(norm(d.documentKey));
const isPassport = (d: BinderDoc) => norm(d.documentKey).includes('passport');
const isVisa = (d: BinderDoc) => norm(d.documentKey).includes('visa');
const isLicense = (d: BinderDoc) => /trade_license|business_license|(^|_)licen[cs]e(_|$)/.test(norm(d.documentKey));
// A company can file its MOA in several parts (`moa`, `moa_2`… — amendments and
// extra pages), so each copy keeps its own card rather than collapsing into one.
const isMoa = (d: BinderDoc) => /(^|_)moa(_|$)|memorandum/.test(norm(d.documentKey));
const moaIndex = (d: BinderDoc) => { const m = norm(d.documentKey).match(/(?:^|_)moa_(\d+)/); return m ? Number(m[1]) : 1; };
const isIdentity = (d: BinderDoc) => isEid(d) || isPassport(d) || isVisa(d);
const isOccupant = (d: BinderDoc) => /occupant/.test(norm(d.documentKey)) || /occupant/i.test(d.displayName || '');
// A PARTNER on a company tenancy is a different person from the customer /
// authorised signatory, so their EID, passport and visa are their own slots —
// without this they would collapse into the signatory's identity slots below
// and one of the two would silently vanish from the binder. (A `signatory_*`
// doc needs no such split: the signatory IS the primary person, whose EID and
// passport are the plain `emirates_id` / `passport` keys.)
const isPartner = (d: BinderDoc) => /(^|_)partner(_|$)/.test(norm(d.documentKey)) || /\bpartner\b/i.test(d.displayName || '');
// A THIRD PARTY — neither the customer, nor a partner on their trade licence,
// nor the authorised signatory: a co-signer, a sponsor, the party a sub-lease
// runs through. Same reason as the partner split above: without this,
// `third_party_emirates_id` matches isEid with no person prefix and takes the
// customer's own Emirates ID slot, hiding one of the two.
const isThirdParty = (d: BinderDoc) => /(^|_)third_party(_|$)/.test(norm(d.documentKey)) || /\bthird[- ]party\b/i.test(d.displayName || '');
// Power-of-attorney papers identify the HOLDER, not the tenant — `poa_emirates_id`
// would otherwise be matched as the tenant's own EID and take the signatory's slot.
// They keep their own person prefix and render as their own small pack.
const isPoa = (d: BinderDoc) => /(^|_)poa(_|$)/.test(norm(d.documentKey)) || /power of attorney/i.test(d.displayName || '');
// Labour card / establishment card — KYC the same way the customer's own tenant
// page treats them (its KYC_KEY_RE), so they belong in this pane, not "Other".
const isLabourDoc = (d: BinderDoc) => /labour|labor|establishment/.test(norm(d.documentKey));
const isDependant = (d: BinderDoc) => /depend[ae]nt/.test(norm(d.documentKey)) || /depend[ae]nt/i.test(d.displayName || '');
/**
 * SUPPORTING documents — the customer's circumstances rather than the tenancy:
 * what they earn, what they hold, who they are married to. They were slots in the
 * rental pack, which put a payslip among the lease's own paperwork; they belong
 * with the person the pack is about, at the END of the KYC pane (landlord's call,
 * 11 Aug 2026), which is also where the RP's own tenant page files them.
 *
 * Matched off KEY_ALIASES so the wordings the old slots accepted still land here.
 */
const SUPPORTING_SLOTS = [
  { key: 'salary_certificate', label: 'Salary Certificate' },
  { key: 'bank_statement', label: 'Bank Statement' },
  { key: 'marriage_certificate', label: 'Marriage Certificate' },
] as const;
const supportingSlotOf = (d: BinderDoc): (typeof SUPPORTING_SLOTS)[number] | null => {
  const base = norm(d.documentKey).replace(/_\d{6,}$/, '');
  return SUPPORTING_SLOTS.find(s =>
    base === s.key || (KEY_ALIASES[s.key] ?? []).includes(base)
    // `employment_letter` is the journey's wording for a salary certificate.
    || (s.key === 'salary_certificate' && /employment/.test(base))) ?? null;
};
const isSupporting = (d: BinderDoc) => supportingSlotOf(d) !== null;
const isGuarantor = (d: BinderDoc) => /(^|_)guarantor(_|$)/.test(norm(d.documentKey)) || /\bguarantor\b/i.test(d.displayName || '');
const occNum = (d: BinderDoc) => { const m = norm(d.documentKey).match(/occupant_?(\d+)/); return m ? Number(m[1]) : 1; };
// Order of the identity docs that follow the ones the pane places itself (the
// Emirates ID pair, and a company's licence + MOA).
const restRank = (d: BinderDoc) => (isPassport(d) ? 0 : isVisa(d) ? 1 : isLicense(d) ? 2 : isMoa(d) ? 3 : 4);
// The same identity document gets stored twice — once in the per-customer KYC
// store and once against this lease — so a true duplicate (SAME key, two owners)
// collapses to one card. Different keys are different documents and each keeps
// its own card: `passport` and `passport_2` are two captures the customer's own
// profile shows as two files, so the binder shows two as well rather than picking
// one and silently dropping the other.
//   • Occupant docs keep their occupant number so occupants never merge together.
const idBaseKey = (d: BinderDoc) => norm(d.documentKey).replace(/_\d{10,}$/, '');
// WHICH FACE of the Emirates ID a file holds. Same rule as the customer's own
// profile page (its `slotsFor`): the bare `emirates_id` key IS the FRONT — that is
// the key every imported and legacy front sits under — and a second capture
// (`_back` or `_2`) is the BACK. There is no "combined" shape: the card is
// two-sided, the profile files it as two slots, so the binder shows the two slots
// too and a face nobody uploaded reads as missing instead of being hidden behind a
// "Front & Back" caption on a one-face scan.
// 🚨 Decided on `idBaseKey`, i.e. AFTER the upload timestamp is stripped. The
// suffix on `third_party_emirates_id_1786534389079` / `emirates_id_1781161323140`
// is when the file was uploaded, not which face it shows — reading it as a face
// captioned somebody's only scan "Back" and left an empty "Front" beside it.
const eidFace = (d: BinderDoc): 'front' | 'back' => {
  const k = idBaseKey(d);
  if (/(^|_)front(_|$)/.test(k)) return 'front';
  if (/(^|_)back(_|$)/.test(k) || /_2$/.test(k)) return 'back';
  return 'front';
};
const isEidBack = (d: BinderDoc) => isEid(d) && eidFace(d) === 'back';
const isEidFront = (d: BinderDoc) => isEid(d) && eidFace(d) === 'front';
/** Does the KEY actually name a face? `emirates_id_front` / `_back` / `_2` do; a
 *  plain `third_party_emirates_id` does not — it is filed through a picker that
 *  never asked, so captioning it "Front" would be inventing a fact. It is a front
 *  for SLOT purposes (see eidFace), captioned plainly. */
const hasNamedFace = (d: BinderDoc) => /(^|_)(front|back)(_|$)|_2$/.test(idBaseKey(d));
const personPrefix = (d: BinderDoc) =>
  isOccupant(d) ? `occ${occNum(d)}:`
  : isPoa(d) ? 'poa:'
  : isGuarantor(d) ? 'guarantor:'
  : isDependant(d) ? 'dependant:'
  : isPartner(d) ? 'partner:'
  : isThirdParty(d) ? 'thirdparty:' : '';
// The EID's two faces each keep their OWN slot, so a front and a back never
// collapse into one card. Everything else is keyed by its own document key: only
// the SAME key stored against two owners is a duplicate, so a second passport
// capture stays visible instead of being deduped away.
// A passport / visa is keyed by TYPE + copy number, so the same document filed
// under two wordings (`visa` on the lease, `uae_visa` on the customer) is still
// one card, while a genuine second capture (`passport_2`) keeps its own.
const idSlot = (d: BinderDoc) =>
  `${personPrefix(d)}${
    isEid(d) ? `eid:${eidFace(d)}`
    : isPassport(d) ? `passport:${copyIndex(d)}`
    : isVisa(d) ? `visa:${copyIndex(d)}`
    : idBaseKey(d)}`;
// Within a slot prefer the canonical customer-KYC copy, then the clean-key one
// (no upload-timestamp suffix), then the most recent upload.
const idSourceRank = (d: BinderDoc) => (d.ownerType === 'customer' ? 0 : norm(d.documentKey) === idBaseKey(d) ? 1 : 2);
const dedupeIdentity = (docs: BinderDoc[]): BinderDoc[] => {
  const best = new Map<string, BinderDoc>();
  for (const d of docs) {
    const k = idSlot(d);
    const cur = best.get(k);
    if (!cur || idSourceRank(d) < idSourceRank(cur) || (idSourceRank(d) === idSourceRank(cur) && d.id > cur.id)) best.set(k, d);
  }
  return Array.from(best.values());
};
const MOA_LABEL = 'Memorandum of Association (MOA)';
const idLabel = (d: BinderDoc) =>
  isEid(d) ? `Emirates ID${hasNamedFace(d) ? ` — ${isEidBack(d) ? 'Back' : 'Front'}` : ''}`
  : isPassport(d) ? 'Passport'
  : isVisa(d) ? 'UAE Visa / Residency'
  : isLicense(d) ? 'Trade License'
  : isMoa(d) ? `${MOA_LABEL}${moaIndex(d) > 1 ? ` — ${moaIndex(d)}` : ''}`
  : (d.displayName ?? d.documentKey.replace(/_/g, ' '));

/** `dependant_documents_3` is the third copy in the pack, not a third person —
 *  the key carries no identity, so copies are simply numbered. */
const copyIndex = (d: BinderDoc) => Number(idBaseKey(d).match(/_(\d+)$/)?.[1] ?? 1);

/** A POA paper, named for the person it identifies: `poa_id` / `poa_emirates_id`
 *  are the holder's Emirates ID, and a second copy keeps its number. */
const poaLabel = (d: BinderDoc) => {
  const base = idBaseKey(d).replace(/^poa_(holder_)?/, '').replace(/_\d+$/, '');
  const core = /emirates_id|^id$/.test(base) ? 'Emirates ID'
    : /passport/.test(base) ? 'Passport'
    : /visa/.test(base) ? 'UAE Visa / Residency'
    : (d.displayName ?? base.replace(/_/g, ' '));
  return `POA holder — ${core}${copyIndex(d) > 1 ? ` — ${copyIndex(d)}` : ''}`;
};
/** Guarantor and dependant papers: their stored display names already read well
 *  ("Undertaking from Guarantor", "Dependant Documents"), so only the copy number
 *  is added. */
const packLabel = (d: BinderDoc) =>
  `${d.displayName || idBaseKey(d).replace(/_\d+$/, '').replace(/_/g, ' ')}${copyIndex(d) > 1 ? ` — ${copyIndex(d)}` : ''}`;

/** One position in the left pane. `doc: null` = a document that belongs here but
 *  is not on file — it renders as a placeholder, never by sliding the next one up
 *  into its position. `optional` softens the placeholder for a slot the KYC
 *  checklist doesn't insist on (the MOA). */
type IdCard = { key: string; label: string; doc: BinderDoc | null; optional?: boolean };

/**
 * The KYC pack for ONE tenant, in a FIXED order.
 *
 *   individual → Emirates ID Front · Emirates ID Back · passport · visa
 *   company    → Trade License · MOA · Authorised Signatory Emirates ID Front ·
 *                … Back · then the rest of the KYC pack
 *
 * A company's own papers lead, because they identify the tenant; the Emirates ID
 * on a company lease belongs to its authorised signatory, so it follows them and
 * is captioned as theirs. An individual leads with their own Emirates ID.
 *
 * The Emirates ID is a two-sided card, so both sides always occupy their own
 * position and a side nobody uploaded shows as a placeholder pointing at the
 * customer profile (the only surface that accepts KYC uploads) — never by sliding
 * the other side up under an ambiguous caption. The exception is a COMBINED scan
 * (the ICP e-copy): it already holds both faces, so it renders as ONE card. A side
 * is only ever reported missing when no copy of that face exists anywhere, which
 * is the same rule the customer's KYC checklist uses.
 *
 * `tenantPack` marks the contract's OWN customer: every slot the KYC checklist asks
 * of them renders whether or not it is on file, so a gap is visible as a gap. The
 * required/optional split mirrors the RP tenant page's KYC_REQS exactly —
 * individual: Emirates ID + passport required, visa optional; company: trade
 * licence + signatory Emirates ID required, MOA / passport / visa optional.
 * Occupants, partners and other people get cards only for what they actually filed,
 * so an occupant with just a passport doesn't sprout empty slots.
 *
 * `coreOnly` is the RENEWAL shape (landlord's call, 1 Sep 2026): the customer's
 * core KYC and nothing else — an individual's Emirates ID · Passport · Visa; a
 * company's Trade License · MOA · Authorised Signatory Emirates ID · Passport ·
 * Visa. Every loose extra (a labour card, a licence on an individual's lease)
 * stays off the pane.
 */
const idCardsFor = (
  docs: BinderDoc[],
  { prefix, labelPrefix = '', tenantPack = false, company = false, coreOnly = false }:
    { prefix: string; labelPrefix?: string; tenantPack?: boolean; company?: boolean; coreOnly?: boolean },
): IdCard[] => {
  const cards: IdCard[] = [];
  const card = (d: BinderDoc): IdCard => ({ key: `${prefix}d${d.id}`, label: `${labelPrefix}${idLabel(d)}`, doc: d });
  /** Cards for everything filed under this requirement — or, for the tenant, the
   *  empty slot that says nobody filed it. */
  const slot = (key: string, label: string, match: (d: BinderDoc) => boolean, optional = false) => {
    const filed = docs.filter(match).sort((a, b) => copyIndex(a) - copyIndex(b) || a.id - b.id);
    // Two captures of the same document are two cards, numbered — the customer's
    // profile lists both files, so neither may go missing here.
    if (filed.length) cards.push(...filed.map((d, i) => {
      const c = card(d);
      return filed.length > 1 ? { ...c, label: `${c.label} — ${i + 1}` } : c;
    }));
    else if (tenantPack) cards.push({ key: `${prefix}${key}`, label: `${labelPrefix}${label}`, doc: null, optional });
  };
  // The company's own papers, ahead of any person's ID.
  if (company) {
    slot('license', 'Trade License', isLicense);
    slot('moa', MOA_LABEL, isMoa, true);
  }
  // Emirates ID — the signatory's, on a company lease.
  const eidName = `${labelPrefix}${company ? 'Authorised Signatory Emirates ID' : 'Emirates ID'}`;
  // Two cards, one per face — the same two slots the customer's profile uploads
  // into, so a face nobody filed reads as an empty placeholder instead of letting
  // the other face stand in for both.
  // 🚨 The EMPTY placeholder is for the contract's own customer ONLY (`tenantPack`),
  // exactly like every other slot here. A third party, a partner or an occupant is
  // shown what they actually filed: the profile offers no Front/Back upload for
  // those people, so an empty "Back" would report a gap against a slot that exists
  // on no screen and that nobody can fill.
  const eids = docs.filter(isEid);
  const front = eids.find(isEidFront) ?? null;
  const back = eids.find(isEidBack) ?? null;
  // …and a person whose only scan never named its face keeps a plain caption.
  const faceLabel = (d: BinderDoc | null, face: 'Front' | 'Back') =>
    !tenantPack && d && !hasNamedFace(d) ? eidName : `${eidName} — ${face}`;
  if (front || tenantPack) cards.push({ key: `${prefix}eid-front`, label: faceLabel(front, 'Front'), doc: front });
  if (back || tenantPack) cards.push({ key: `${prefix}eid-back`, label: faceLabel(back, 'Back'), doc: back });
  // The rest of the pack. A company's signatory need not hold a passport or visa
  // (the licence identifies the tenant), so those slots are optional there.
  slot('passport', 'Passport', isPassport, company);
  slot('visa', 'UAE Visa / Residency', isVisa, true);
  // Anything else that reached the KYC pane — e.g. a licence or MOA on an
  // individual's lease, or a labour card. Not on a renewal: its pane is the core
  // pack only (a further copy of a core document still shows, below).
  // Any FURTHER copy of the Emirates ID (a third capture of a face already shown)
  // follows as its own card — placing only the two faces here would drop it.
  const eidShown = new Set([front?.id, back?.id].filter((id): id is number => id != null));
  const placed = (d: BinderDoc) =>
    (isEid(d) ? eidShown.has(d.id) : isPassport(d) || isVisa(d) || (company && (isLicense(d) || isMoa(d))));
  const coreDoc = (d: BinderDoc) => isEid(d) || isPassport(d) || isVisa(d) || (company && (isLicense(d) || isMoa(d)));
  for (const d of docs.filter(d => !placed(d) && (!coreOnly || coreDoc(d))).sort((a, b) => restRank(a) - restRank(b) || a.id - b.id)) {
    cards.push(card(d));
  }
  return cards;
};

const cardCss: React.CSSProperties = { border: '1px solid #e3e0d9', borderRadius: 12, overflow: 'hidden', marginBottom: 16, background: '#fff' };
const capCss: React.CSSProperties = { padding: '9px 13px', fontSize: 12.5, fontWeight: 700, color: '#1a1916', background: '#faf9f7', borderBottom: '1px solid #efece6' };
const chip: React.CSSProperties = { fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 999, border: '1px solid #dcd8d0', background: '#fff', color: '#4a4742', cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto', lineHeight: 1.3 };
const JUMP_OFFSET = 88;

function SecurePreview({ url, caption, watermark, action }: { url: string; caption: string; watermark: string; action?: React.ReactNode }) {
  return (
    <div style={cardCss}>
      <div style={{ ...capCss, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ minWidth: 0, flex: 1 }}>{caption}</span>
        {action}
      </div>
      <SecureDocCanvas fileUrl={url} isImage={isImageUrl(url)} caption={caption} watermark={watermark} />
    </div>
  );
}

/**
 * Re-file this document into the other section. Shown only on the authenticated
 * RP/manager binder — the no-login landlord portal passes no handler, and the
 * lessor has no business moving the landlord's filing around.
 *
 * The wording says what will HAPPEN, not what the document is: moving to
 * Customer KYC re-owns the row to the customer, so it starts appearing on their
 * profile and on their other leases.
 */
function RefileButton({ doc, to, onSetSection }: { doc: BinderDoc; to: 'kyc' | 'tenancy'; onSetSection: (doc: BinderDoc, next: 'kyc' | 'tenancy') => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  // A refused move MUST say so. Without this the handler's rejection became an
  // unhandled promise rejection: the button flipped back from "Moving…" and
  // showed nothing, so a 400 read as a click that never registered.
  const [err, setErr] = useState<string | null>(null);
  return (
    <span style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      {err && (
        <span title={err} style={{ fontSize: 11, fontWeight: 600, color: '#b91c1c', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {err}
        </span>
      )}
      <button
        type="button" disabled={busy}
        title={to === 'kyc'
          ? "File this against the customer — it will also show on their profile and on their other leases"
          : 'File this against this lease only — it will leave the customer\'s KYC pack'}
        onClick={async () => {
          setBusy(true); setErr(null);
          try { await onSetSection(doc, to); }
          catch (e) { setErr(e instanceof Error ? e.message : 'Could not move the document'); }
          finally { setBusy(false); }
        }}
        style={{ flex: '0 0 auto', fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, border: '1px solid #dcd8d0', background: '#fff', color: busy ? '#9b9890' : '#4a4742', cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
      >
        {busy ? 'Moving…' : to === 'kyc' ? '⇄ Move to Customer KYC' : '⇄ Move to Tenancy'}
      </button>
    </span>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={cardCss}><div style={capCss}>{label}</div>{children}</div>;
}

function Missing({ label }: { label: string }) {
  return (
    <div style={{ border: '1px dashed #d8d4cc', borderRadius: 12, padding: '14px 16px', marginBottom: 16, color: '#9b9890', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
      <FileText size={14} /> {label} — not yet available
    </div>
  );
}

/** A KYC document that is not on file. A REQUIRED one is highlighted amber and
 *  flagged "required" — a gap in the pack is the thing a reviewer must notice;
 *  an optional one stays quiet. The binder is view-only, so it points at the
 *  customer profile — the one surface that uploads identity documents — rather
 *  than offering an upload it cannot perform. No link on the no-login landlord
 *  portal (`profileHref` omitted): the lessor has no profile to open. */
function MissingId({ label, href, optional }: { label: string; href?: string | null; optional?: boolean }) {
  const tone = optional
    ? { border: '#d8d4cc', bg: '#fcfbf9', icon: '#9b9890', label: '#6b6860', note: '#9b9890' }
    : { border: '#e9c48a', bg: '#fdf7ee', icon: '#b07415', label: '#8a5a10', note: '#b07415' };
  return (
    <div style={{ border: `1px dashed ${tone.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 16, fontSize: 13, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, background: tone.bg }}>
      {optional ? <FileText size={14} color={tone.icon} /> : <AlertTriangle size={14} color={tone.icon} />}
      <span style={{ color: tone.label, fontWeight: 700 }}>{label}</span>
      <span style={{ color: tone.note, fontWeight: optional ? 400 : 600 }}>— missing{optional ? ' · optional' : ' · required'}</span>
      {href && (
        <a href={href} target="_blank" rel="noreferrer"
          style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: '#2e9f82', textDecoration: 'none', whiteSpace: 'nowrap' }}>
          Upload from profile ↗
        </a>
      )}
    </div>
  );
}

function PendingLink({ label }: { label: string }) {
  return (
    <div style={{ border: '1px dashed #d8d4cc', borderRadius: 12, padding: '14px 16px', marginBottom: 16, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, background: '#fff', color: '#6b6860' }}>
      <FileText size={14} /> {label} — not completed yet
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9b9890', margin: '8px 0 12px' }}>{children}</div>;
}

/** `note` rides beside the title (the KYC pane's missing-document count); a chip
 *  marked `missing` is highlighted so a gap is visible without scrolling. */
function QuickNav({ title, note, items }: {
  title: string;
  note?: React.ReactNode;
  items: { id: string; label: string; missing?: boolean }[];
}) {
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className={ds.quickNav} style={{ position: 'sticky', top: 0, zIndex: 5, background: '#f4f3ef', padding: '14px 0 10px', borderBottom: '1px solid #e7e3dc', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: items.length ? 8 : 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9b9890' }}>{title}</span>
        {note}
      </div>
      {items.length > 0 && (
        <div className={ds.navChips}>
          {items.map(it => (
            <button key={it.id} type="button" onClick={() => go(it.id)}
              style={it.missing ? { ...chip, borderColor: '#e9c48a', background: '#fdf7ee', color: '#8a5a10' } : chip}>
              {it.missing ? '⚠ ' : ''}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const initials = (name?: string | null) =>
  (name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '—';

function TenantCard({ t, isCompany }: { t: { name?: string | null; email?: string | null; phone?: string | null; companyName?: string | null; emiratesId?: string | null; licenseNumber?: string | null }; isCompany: boolean }) {
  const fields: [string, string | null | undefined][] = [
    ['Emirates ID', t.emiratesId],
    [isCompany ? 'Trade licence' : 'Company', isCompany ? t.licenseNumber : t.companyName],
    ['Phone', t.phone],
    ['Email', t.email],
  ];
  const rows = fields.filter(([, v]) => v && String(v).trim());
  const title = t.companyName || t.name || 'Tenant';
  return (
    <div style={{ ...cardCss, borderColor: '#cfe7dd' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'linear-gradient(180deg,#f4faf7,#fff)', borderBottom: '1px solid #eef4f1' }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: '#2e9f82', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 16, flexShrink: 0 }}>{initials(title)}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: '#1a1916', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          <div style={{ fontSize: 11.5, color: '#6b6860' }}>{isCompany ? 'Corporate tenant' : 'Individual tenant'} · verify against the documents below</div>
        </div>
      </div>
      {rows.length > 0 && (
        <div style={{ padding: '10px 16px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9b9890' }}>{k}</div>
              <div style={{ fontSize: 13, color: '#1a1916', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String(v)}>{v}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const linkBtn: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, padding: '5px 11px', borderRadius: 8, border: '1px solid #2e9f82', background: '#2e9f82', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' };
const linkBtnGhost: React.CSSProperties = { ...linkBtn, background: '#fff', color: '#1f6f54' };

/** The UpNow lockup, matching the dashboard sidebar's brand (DashboardShell's
 *  .brand / .brandMark). The binder is a fixed full-viewport takeover that hides
 *  the sidebar, so the header carries the branding instead — on the landlord's
 *  no-login page it is the only thing saying whose platform this is. */
/** The wordmark. With `href` it behaves like the logo everywhere else on the
 *  platform — a way home out of this full-screen binder. The no-login landlord
 *  portal passes none: that visitor has no dashboard to be sent to. */
function BrandMark({ href }: { href?: string | null }) {
  const inner = (
    <>
      <span style={{ width: 24, height: 24, borderRadius: 8, background: 'linear-gradient(135deg, #1f8a6e 0%, #34c79f 100%)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800 }}>U</span>
      UpNow
    </>
  );
  const style: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 16, letterSpacing: '-0.02em', color: '#14201c' };
  if (!href) return <span style={style}>{inner}</span>;
  return (
    <a href={href} title="Back to dashboard" aria-label="UpNow — back to dashboard"
      style={{ ...style, textDecoration: 'none', cursor: 'pointer' }}>
      {inner}
    </a>
  );
}

/** Generates + copies the no-login landlord signing link from the binder header
 *  (authenticated RP only). */
export function LandlordLinkButton({ tenantId, contractId }: { tenantId: number; contractId: number }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const gen = async () => {
    setState('sending');
    try {
      const res = await fetch('/api/portal/generate', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, contractId, purpose: 'contract', signerRole: 'landlord' }),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setLink(d.link ?? ''); setState('done');
      if (d.link) { try { await navigator.clipboard.writeText(d.link); setCopied(true); } catch { /* ignore */ } }
    } catch { setState('error'); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ } };
  if (state === 'done' && link) {
    return (
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <input readOnly value={link} onFocus={e => e.currentTarget.select()}
          style={{ width: 230, fontSize: 11, padding: '5px 8px', border: '1px solid #e3e0d9', borderRadius: 8, background: '#fafaf8', color: '#1a1916' }} />
        <button onClick={copy} style={linkBtnGhost}>{copied ? 'Copied ✓' : 'Copy'}</button>
        <a href={link} target="_blank" rel="noreferrer" style={{ ...linkBtnGhost, textDecoration: 'none' }}>Open ↗</a>
      </span>
    );
  }
  return (
    <button onClick={gen} disabled={state === 'sending'} style={linkBtn} title="Generate a no-login link for the landlord to review every document & sign as the lessor">
      {state === 'sending' ? 'Generating…' : state === 'error' ? 'Retry' : 'Send landlord signing link'}
    </button>
  );
}

export interface ContractDocsBinderProps {
  refLabel: string;
  contractType?: string | null;
  /** Lease is ending (terminated / vacating) → show move-out artifacts. */
  ended?: boolean;
  documents: BinderDoc[];
  tenant: { name?: string | null; email?: string | null; phone?: string | null; companyName?: string | null; emiratesId?: string | null; licenseNumber?: string | null };
  ejari: EjariContractData;
  addendums?: EjariAddendum[];
  planContract: PlanContract;
  planPayments: PlanPayment[];
  /** RP reconciliation references — plan number + per-payment receipt numbers. */
  paymentRefs?: import('@/lib/paymentRefs').PaymentRefs | null;
  /** When provided, the Receipts slot renders; null/omitted hides it. */
  receipt?: ReceiptContract | null;
  watermark: string;
  /** No-login magic-link token → stored-artifact downloads use the token-scoped
   *  endpoint. Omitted (authed RP/manager) → the JWT /documents endpoint. */
  portalToken?: string | null;
  /** The customer's profile page — where KYC is uploaded. A missing Emirates ID
   *  side links here. Omitted (landlord portal) → the placeholder shows without
   *  a link. */
  profileHref?: string | null;
  /** Dashboard home for whoever is looking — makes the wordmark a way out of the
   *  full-screen binder. Omitted on the no-login landlord portal. */
  homeHref?: string | null;
  /** Certificate-of-completion data (GET /contracts/:id/signature-certificate).
   *  When provided AND signatures exist, a "Signature certificate" PDF joins the
   *  download list — the DocuSign-style evidence record for this contract. */
  signatureCertificate?: import('@/components/upnow/SignatureCertificatePdf').SignatureCertificateData | null;
  headerRight?: React.ReactNode;
  /** Closes the binder and returns to wherever the user came from. The binder
   *  covers the whole viewport (no sidebar, no page chrome), so without this
   *  there is no visible way back. Omitted on the landlord's no-login portal —
   *  that link IS the destination, there is no previous page. */
  onClose?: () => void;
  signerName: string;
  signerDefaultName: string;
  /** When the signer acts under POA, the represented landlord — shows an
   *  "on behalf of {B}" line on the sign bar. */
  signerOnBehalfOf?: string | null;
  landlordSigned: boolean;
  /** Whether the current actor may sign as landlord — needs signing rights AND
   *  power of attorney for a delegated manager. Defaults to true so the no-login
   *  portal (LandlordReview) and RP-owner paths are unaffected; the authed
   *  manager documents page passes the computed value. When false, the sign bar
   *  is hidden (the tenancy contract is landlord/POA-only). */
  canLandlordSign?: boolean;
  onSign: (p: { signatureImage: string; signatoryName: string }) => Promise<void>;
  /** Re-file a document into the other section (PATCH /documents/:id/section).
   *  Omit on the no-login landlord portal — the lessor reads the pack, they do
   *  not decide how the landlord files it. Provided → each stored document card
   *  offers "Move to Customer KYC" / "Move to Tenancy". */
  onSetSection?: (doc: BinderDoc, next: 'kyc' | 'tenancy') => Promise<void>;
}

type Slot =
  | { kind: 'plan' }
  | { kind: 'receipts' }
  | { kind: 'agreement' }
  | { kind: 'doc'; key: string; label: string; pending?: boolean; optional?: boolean };

export function ContractDocsBinder(props: ContractDocsBinderProps) {
  const { refLabel, contractType, ended, documents, tenant, ejari, addendums = [], planContract, planPayments, paymentRefs, receipt, watermark, portalToken, profileHref, homeHref, signatureCertificate, headerRight, onClose, signerName, signerDefaultName, signerOnBehalfOf, landlordSigned, canLandlordSign = true, onSign, onSetSection } = props;
  const planRefNo = paymentRefs?.planRefNo ?? null;
  // Enrich the receipt contract so per-payment receipts print their real gapless
  // number and the plan number (see PaymentReceiptPdf).
  const receiptWithRefs = receipt ? { ...receipt, paymentRefs: paymentRefs ?? null } : receipt;

  // EVERY customer-KYC document belongs in the left "Tenant & KYC" pane, never in
  // the generic "Other documents" bucket: identity papers, the company's own
  // (trade licence, MOA — the corporate equivalent of an individual's Emirates ID),
  // power-of-attorney papers and labour/establishment cards.
  //
  // The pane is the RP's OWN answer, in three steps (resolveDocSection):
  //   1. `section` stored on the row — they said so when they filed it
  //   2. the catalogue default for that document type
  //   3. neither → the key matchers below
  // Step 3 is not vestigial: ~1,200 of the 2,966 documents on file predate the
  // choice AND carry keys no picker offers (`contract_agreement`, `poa_id`,
  // `occupant_2_passport`, every `_2` second capture). Guessing a section for
  // those would misfile documents nobody touched.
  const isCompanyTenant = !!(tenant.companyName || tenant.licenseNumber);
  const isKyc = (d: BinderDoc) => {
    const declared = resolveDocSection(d);
    if (declared) return declared === 'kyc';
    // Historic rows. Same membership as the customer's own tenant page (its
    // KYC_KEY_RE), so the two surfaces agree on what "KYC" means.
    return isIdentity(d) || isLicense(d) || isMoa(d) || isPoa(d) || isLabourDoc(d) || isGuarantor(d)
      || isDependant(d) || isSupporting(d);
  };

  // "Move to the other section" on each stored card. Authenticated surfaces only.
  // Only rows PATCH /documents/:id/section can actually move. It re-owns a
  // document between a customer and a tenancy and refuses everything else — the
  // deposit receipts / slips / cheques that also reach this binder (owner_type
  // `security_deposit`) came back "A security_deposit document cannot be filed
  // as customer KYC", so offering the button on them was a guaranteed 400.
  // Negative ids are the synthetic cheque rows fabricated from `lead_cheques`:
  // they are not documents at all, so there is nothing to PATCH.
  const REFILABLE_OWNERS = ['customer', 'tenant', 'tenancy_contract'];
  const canRefile = (d: BinderDoc) => d.id > 0 && (!d.ownerType || REFILABLE_OWNERS.includes(d.ownerType));
  const refile = (d: BinderDoc, to: 'kyc' | 'tenancy') =>
    onSetSection && canRefile(d) ? <RefileButton doc={d} to={to} onSetSection={onSetSection} /> : undefined;

  const all = documents.filter(d => !!d.fileUrl);
  // A payment confirmation is ONE lease's cheques, never the customer's. The
  // customer-scoped rows travel with every contract of the tenant, and the Airtable
  // import filed a 2025 lease's overflow "Payment Advice" copies on the customer
  // (keys payment_advice_2/_3, matched here by display name) — so a renewal's card
  // was showing the old lease's cheques as extra pages. Only lease-owned rows fill
  // this slot: the uploaded `payment_advice_<chequeId>` rows and the synthetic
  // lead_cheques rows, both owner tenancy_contract. A row with no owner came from a
  // surface that doesn't send one and is kept. Anything excluded still lists under
  // "Other documents", so nothing on file disappears.
  const LEASE_ONLY_KEYS = new Set(['payment_advice']);
  const ownedByLease = (d: BinderDoc) => !d.ownerType || d.ownerType === 'tenancy_contract';
  const matchDocs = (key: string): BinderDoc[] => {
    const accepted = [key, ...(KEY_ALIASES[key] ?? [])];
    const base = (d: BinderDoc) => norm(d.documentKey).replace(/_\d{10,}$/, '');
    return all.filter(d => !isKyc(d) && !isOccupant(d)
      && (!LEASE_ONLY_KEYS.has(key) || ownedByLease(d))
      && (accepted.includes(base(d)) || accepted.includes(norm(d.displayName)))).sort((a, b) => b.id - a.id);
  };
  const isRenewal = contractType === 'renewal';
  const currentPlan = buildCurrentPlan(planContract, planPayments);
  // Raw rows for the segregated Payment Plan PDF (Security Deposit · Rental Income ·
  // Management Fee · Third Party) — shared by the download and the on-screen card.
  const planRows = segRowsFromContract(planContract, planPayments);
  const hasPlan = currentPlan.rentFils > 0 || currentPlan.items.length > 0;
  const showReceipts = receipt != null;
  const hasReceiptData = planPayments.length > 0 || (planContract.fees?.length ?? 0) > 0;

  // RIGHT column order.
  const seq: Slot[] = [
    { kind: 'plan' },
    { kind: 'doc', key: 'payment_advice', label: 'Payment Confirmation' },
    ...(showReceipts ? [{ kind: 'receipts' } as Slot] : []),
    { kind: 'agreement' },
    { kind: 'doc', key: 'ejari_certificate', label: 'Contract Registration Certificate' },
  ];
  if (!isRenewal) {
    // Salary certificate, bank statement and marriage certificate were slots here
    // and are now at the end of the KYC pane — they describe the customer, not
    // the tenancy. Utility proof stays: that IS the lease's paperwork.
    seq.push({ kind: 'doc', key: 'utility_registration', label: 'Utility Proof of Payment' });
  }
  if (ended) {
    seq.push({ kind: 'doc', key: 'move_out_report', label: 'Move-out', pending: true });
    seq.push({ kind: 'doc', key: 'utility_final_bill', label: 'Utility Final Bill' });
    seq.push({ kind: 'doc', key: 'deposit_settlement', label: 'Final Settlement', pending: true });
  }

  // LEFT column — primary tenant identity first, then occupants. Dedupe across
  // owner scopes so the same EID/passport/visa stored on both the customer KYC
  // record and this lease's contract record renders once (see dedupeIdentity).
  // Partner identity docs sort AFTER the customer's own set, so the pane reads
  // as one person's pack then the next rather than interleaving the two.
  const primaryPool = all.filter(d => isKyc(d) && !isOccupant(d));
  const primaryId = dedupeIdentity(primaryPool);
  // The tenant's own pack first, then each other person's: a partner on a company
  // tenancy, whoever holds the power of attorney, a guarantor, and the dependants.
  // Those last three have no fixed two-sided shape to enforce, so they render as
  // plain cards in upload order rather than through the slot model.
  const isOtherPerson = (d: BinderDoc) => isPoa(d) || isGuarantor(d) || isDependant(d);
  const pack = (docs: BinderDoc[], prefix: string, label: (d: BinderDoc) => string): IdCard[] =>
    [...docs].sort((a, b) => copyIndex(a) - copyIndex(b) || a.id - b.id)
      .map(d => ({ key: `${prefix}${d.id}`, label: label(d), doc: d }));
  // Identity only — the supporting pack is KYC too, but it closes the pane under
  // its own heading rather than joining anybody's ID cards.
  const identity = primaryId.filter(d => !isSupporting(d));
  // THE CUSTOMER'S OWN PACK comes first and comes whole: their identity, then the
  // papers backing it. Everything belonging to the person the lease is with is
  // read before the pane moves on to anybody else (landlord's call, 11 Aug 2026).
  // A RENEWAL shows the customer's OWN KYC and nothing more on the left
  // (landlord's call, 1 Sep 2026): an individual's Emirates ID · Passport · Visa,
  // a company's Trade License · MOA · Authorised Signatory Emirates ID · Passport
  // · Visa — plus, for a COMPANY, the third party's papers when on file (their EID /
  // passport / visa: the person the company acts through is part of who the
  // tenant is, on a renewal as much as on the first lease). The supporting
  // papers, the partner / POA holder / guarantor, the dependants and any loose
  // extras were all read on the ORIGINAL lease — repeating them here made a
  // renewal's pack longer than the lease it renews. Everything still exists on
  // the profile and the parent lease.
  const tenantCards: IdCard[] = idCardsFor(
    identity.filter(d => !isPartner(d) && !isThirdParty(d) && !isOtherPerson(d)),
    { prefix: '', tenantPack: true, company: isCompanyTenant, coreOnly: isRenewal },
  );
  // Then the other parties to the tenancy — a partner on a company lease, the
  // third party, the power-of-attorney holder, a guarantor, and any loose
  // dependant papers. Cards only for what they filed — never a placeholder.
  const thirdPartyCards: IdCard[] =
    idCardsFor(identity.filter(d => isThirdParty(d) && !isOtherPerson(d)), { prefix: 'tp-', labelPrefix: 'Third party — ' });
  const otherPeopleCards: IdCard[] = isRenewal ? (isCompanyTenant ? thirdPartyCards : []) : [
    ...idCardsFor(identity.filter(d => isPartner(d) && !isOtherPerson(d)), { prefix: 'p-', labelPrefix: 'Partner — ' }),
    ...thirdPartyCards,
    ...pack(identity.filter(isPoa), 'poa-', poaLabel),
    ...pack(identity.filter(isGuarantor), 'gua-', packLabel),
    ...pack(identity.filter(isDependant), 'dep-', packLabel),
  ];
  const primaryCards: IdCard[] = [...tenantCards, ...otherPeopleCards];
  // The supporting pack, in the order the rental sequence used to list it, and
  // last in the pane: identity says WHO the customer is, these say what backs
  // them. A renewal shows none of it — the customer was vetted on the original
  // lease and the renewal pane is their core KYC only.
  const supportingCards: IdCard[] = isRenewal ? [] : SUPPORTING_SLOTS.flatMap(slot => {
    const docs = primaryId
      .filter(d => supportingSlotOf(d)?.key === slot.key)
      .sort((a, b) => a.id - b.id);
    return docs.map((d, i) => ({
      key: `sup-${d.id}`,
      label: `${slot.label}${docs.length > 1 ? ` — ${i + 1}` : ''}`,
      doc: d,
    }));
  });

  // Copies no card took (e.g. a combined e-copy alongside the two faces, or a
  // second capture of the same passport). They stay out of the pane — that
  // duplication is exactly the mess this fixes — but remain downloadable,
  // unticked, so nothing on file becomes unreachable. On a renewal only spare
  // copies of the CORE pack are offered — the download list mirrors the pane,
  // so the papers the pane deliberately leaves out do not creep back in here.
  const usedIds = new Set([...primaryCards, ...supportingCards].map(c => c.doc?.id).filter((id): id is number => id != null));
  const isCoreKyc = (d: BinderDoc) =>
    (!personPrefix(d) && (isEid(d) || isPassport(d) || isVisa(d) || (isCompanyTenant && (isLicense(d) || isMoa(d)))))
    || (isCompanyTenant && isThirdParty(d));
  const idExtras = primaryPool.filter(d => !usedIds.has(d.id) && (!isRenewal || isCoreKyc(d)));
  // Everyone on the lease besides the customer. The keys call them occupants and
  // start at `occupant_2` — occupant 1 IS the customer, whose pack is above — so
  // the pane numbers them 1..N in order and calls them DEPENDANTS, which is what
  // they are to the tenancy and what the landlord asked for (11 Aug 2026). The
  // anchor ids keep the real key number; only the wording is sequential.
  // A renewal lists no dependants (see tenantCards).
  const occDocs = isRenewal ? [] : dedupeIdentity(all.filter(d => isIdentity(d) && isOccupant(d)));
  const occGroups = Array.from(new Set(occDocs.map(occNum))).sort((a, b) => a - b)
    .map((n, i) => ({
      n,
      label: `Dependant ${i + 1}`,
      cards: idCardsFor(occDocs.filter(d => occNum(d) === n), { prefix: `occ${n}-` }),
    }));

  const seqIds = new Set(seq.flatMap(s => (s.kind === 'doc' ? matchDocs(s.key).map(d => d.id) : [])));
  // Renewals drop the salary-certificate slot (income re-verification lives on the
  // original lease) — also drop any uploaded salary cert so it doesn't resurface
  // under "Other documents". Same for move-in docs: the move-in happened on the
  // ORIGINAL lease (customer-scoped `move_in_form` rows travel with every contract
  // of the tenant), so a renewal never shows one.
  const isSalaryDoc = (d: BinderDoc) => /salary/.test(norm(d.documentKey)) || /salary/i.test(d.displayName || '');
  const isMoveInDoc = (d: BinderDoc) => /move_?in/.test(norm(d.documentKey)) || /move[ -]?in/i.test(d.displayName || '');
  const leftover = all.filter(d => !isKyc(d) && !isOccupant(d) && !seqIds.has(d.id) && !(isRenewal && (isSalaryDoc(d) || isMoveInDoc(d))));
  // "Other documents" is anything filed against this lease that has no named slot
  // — an NOC, an undertaking, a letter. It used to be hidden on the no-login
  // landlord view as an internal-review convenience, on the reasoning that the
  // lessor should see only the canonical set; but the bin holds real contract
  // paperwork, and hiding it meant a document uploaded ONTO the lease was
  // invisible to the one party being asked to sign it (landlord's call, 11 Aug
  // 2026). Both views now show the same binder.
  const showLeftover = leftover.length > 0;

  const rightLabel = (s: Slot) => s.kind === 'plan' ? 'Payment plan' : s.kind === 'receipts' ? 'Receipts' : s.kind === 'agreement' ? 'Agreement' : s.label;
  const slotId = (s: Slot) => s.kind === 'doc' ? `r-${s.key}` : `r-${s.kind}`;
  const leftNav = [
    ...tenantCards.map(c => ({ id: `l-${c.key}`, label: c.label, missing: !c.doc && !c.optional })),
    ...supportingCards.map(c => ({ id: `l-${c.key}`, label: c.label })),
    ...otherPeopleCards.map(c => ({ id: `l-${c.key}`, label: c.label, missing: !c.doc && !c.optional })),
    ...occGroups.map(g => ({ id: `l-occ-${g.n}`, label: occGroups.length > 1 ? g.label : 'Dependant' })),
  ];
  // Required KYC the customer has not filed — called out at the top of the pane so
  // the gap is the first thing read, not something found by scrolling.
  const missingRequired = primaryCards.filter(c => !c.doc && !c.optional).length;
  const rightNav = [
    ...seq.filter(s => !(s.kind === 'doc' && s.optional && matchDocs(s.key).length === 0)).map(s => ({ id: slotId(s), label: rightLabel(s) })),
    ...(showLeftover ? [{ id: 'r-other', label: 'Other documents' }] : []),
  ];

  // ── "Download documents" popup — everything AVAILABLE on this page, in page
  // order, so the user can tick a selection and save it as ONE combined PDF.
  // Generated documents (plan / receipts / agreement) build their bytes with the
  // same generators the inline previews use; stored uploads stream through the
  // same-origin /documents/:id/file proxy. Authenticated surfaces only — the
  // magic-link portal has no JWT for the byte proxy.
  const reactPdfBytes = async (blob: Blob): Promise<MergePart[]> =>
    [{ bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'application/pdf' }];
  const storedItem = (label: string, group: string, docs: BinderDoc[]): MergeDocItem => ({
    id: `s-${docs.map(d => d.id).join('-')}`,
    label,
    group,
    count: docs.length,
    make: () => Promise.all(docs.map(d => fetchStoredDocBytes(d.id))),
  });
  const downloadItems: MergeDocItem[] = [];
  for (const s of seq) {
    if (s.kind === 'plan') {
      if (!hasPlan) continue;
      downloadItems.push({
        id: 'g-plan', label: 'Payment plan', group: 'Rental documents',
        make: async () => {
          const [{ pdf }, { PaymentPlanDoc }] = await Promise.all([import('@react-pdf/renderer'), import('@/components/upnow/PaymentPlanPdf')]);
          return reactPdfBytes(await pdf(
            <PaymentPlanDoc rows={planRows} refLabel={refLabel} planRefNo={planRefNo} meta={{
              contractType, tenantName: tenant.companyName || tenant.name,
              landlordName: ejari.landlord?.bankAccountName || ejari.landlord?.companyName || ejari.landlord?.name,
              unitNumber: ejari.unit?.number, buildingName: ejari.property?.buildingName,
              community: ejari.property?.community || ejari.property?.emirate,
              periodStart: ejari.startDate, periodEnd: ejari.endDate,
            }} />,
          ).toBlob());
        },
      });
    } else if (s.kind === 'receipts') {
      if (!hasReceiptData || !receipt) continue;
      downloadItems.push({
        id: 'g-receipts', label: 'Receipts', group: 'Rental documents',
        make: async () => {
          const [{ pdf }, { PaymentReceiptDoc }] = await Promise.all([import('@react-pdf/renderer'), import('@/components/upnow/PaymentReceiptPdf')]);
          return reactPdfBytes(await pdf(<PaymentReceiptDoc contract={receiptWithRefs as ReceiptContract} kind="all" selectedId={null} selectedIdx={0} />).toBlob());
        },
      });
    } else if (s.kind === 'agreement') {
      downloadItems.push({
        id: 'g-agreement', label: 'Agreement (tenancy contract)', group: 'Rental documents',
        make: async () => {
          const { isDubaiContract, fillEjariPdf } = await import('@/lib/ejariFill');
          if (isDubaiContract(ejari)) return [{ bytes: await fillEjariPdf(ejari, addendums), mime: 'application/pdf' }];
          const [{ pdf }, { EjariContractDoc }] = await Promise.all([import('@react-pdf/renderer'), import('@/components/contract/EjariContractPdf')]);
          return reactPdfBytes(await pdf(<EjariContractDoc data={ejari} addendums={addendums} />).toBlob());
        },
      });
    } else {
      const docs = matchDocs(s.key);
      if (docs.length) downloadItems.push(storedItem(s.label, 'Rental documents', docs));
    }
  }
  // Signature certificate — the contract's certificate of completion (who signed,
  // from where, on what device, with what consent + the envelope event trail).
  if (signatureCertificate && signatureCertificate.signatures.length > 0) {
    const certData = signatureCertificate;
    downloadItems.push({
      id: 'g-signature-cert', label: 'Signature certificate (audit trail)', group: 'Rental documents',
      make: async () => {
        const [{ pdf }, { SignatureCertificateDoc }] = await Promise.all([import('@react-pdf/renderer'), import('@/components/upnow/SignatureCertificatePdf')]);
        return reactPdfBytes(await pdf(<SignatureCertificateDoc data={certData} refLabel={refLabel} />).toBlob());
      },
    });
  }
  // Loose uploaded extras are offered under their own group (mirroring the page's
  // "Other documents" section) but arrive UNTICKED — the default selection is the
  // canonical binder set; the extras are one click away when wanted. Their own
  // group also keeps an uploaded scan named "Agreement" from sitting confusingly
  // next to the GENERATED "Agreement (tenancy contract)".
  for (const d of leftover) downloadItems.push({ ...storedItem(d.displayName ?? d.documentKey.replace(/_/g, ' '), 'Other documents (uploaded)', [d]), preselected: false });
  for (const c of primaryCards) if (c.doc) downloadItems.push(storedItem(c.label, 'Tenant & KYC', [c.doc]));
  for (const g of occGroups) for (const c of g.cards) if (c.doc) downloadItems.push(storedItem(`${g.label} — ${c.label}`, 'Tenant & KYC', [c.doc]));
  for (const c of supportingCards) if (c.doc) downloadItems.push(storedItem(c.label, 'Tenant & KYC', [c.doc]));
  for (const d of idExtras) {
    downloadItems.push({ ...storedItem(`${isPartner(d) ? 'Partner — ' : ''}${idLabel(d)} · extra copy`, 'Tenant & KYC', [d]), preselected: false });
  }

  return (
    // A full-screen takeover, so it has to sit above the shell it replaces — the
    // manager portal's "Acting for" scope bar is sticky at z-index 40, and with no
    // z-index here it painted straight over the binder, hiding the first row of
    // jump chips in BOTH panes (the sidebar was already covered, so only that bar
    // showed through). 45 clears it while staying under this binder's own layers:
    // the document reader (70) and the download / sign popups (1000+).
    <div style={{ position: 'fixed', inset: 0, zIndex: 45, background: '#f4f3ef', display: 'flex', flexDirection: 'column' }}>
      <header style={{ flexShrink: 0, padding: '12px 20px', background: '#fff', borderBottom: '1px solid #e3e0d9', display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 6, gap: 10 }}>
        <BrandMark href={homeHref} />
        <span aria-hidden style={{ width: 1, alignSelf: 'stretch', minHeight: 20, background: '#e7e3dc' }} />
        <span style={{ fontSize: 16, fontWeight: 800, color: '#1a1916' }}>All documents</span>
        <span style={{ fontSize: 12.5, color: '#9b9890' }}>{refLabel}</span>
        <span style={{ fontSize: 11, color: '#9b9890' }}>· View only</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {!portalToken && downloadItems.length > 0 && (
            <DownloadDocsButton items={downloadItems} fileName={`Documents-${(refLabel || 'contract').replace(/[^\w.-]+/g, '-')}.pdf`} style={linkBtnGhost} />
          )}
          {headerRight}
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close and go back"
              title="Close"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px 6px 8px', borderRadius: 8, border: '1px solid #e3e0d9', background: '#fff', color: '#4b4840', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
            >
              <X size={15} /> Close
            </button>
          )}
        </div>
      </header>

      <div className={ds.body}>
        {/* LEFT — tenant identity + KYC. On desktop a fixed scrolling pane; on
            mobile the first block of the single top-to-bottom scroll. */}
        <section className={`${ds.pane} ${ds.paneLeft}`}>
          <QuickNav title="Tenant &amp; KYC" items={leftNav}
            note={missingRequired > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: '#fdf7ee', border: '1px solid #e9c48a', color: '#8a5a10' }}>
                <AlertTriangle size={11} /> {missingRequired} document{missingRequired !== 1 ? 's' : ''} missing
              </span>
            )} />
          <TenantCard t={tenant} isCompany={!!(tenant.companyName || tenant.licenseNumber)} />
          {/* The customer's own pack, whole: identity, then the papers backing it. */}
          {tenantCards.map(c => (
            <div key={c.key} id={`l-${c.key}`} style={{ scrollMarginTop: JUMP_OFFSET }}>
              {c.doc
                ? <SecurePreview url={c.doc.fileUrl} caption={c.label} watermark={watermark} action={refile(c.doc, 'tenancy')} />
                : <MissingId label={c.label} href={profileHref} optional={c.optional} />}
            </div>
          ))}
          {/* Supporting documents close the CUSTOMER's pack — what they earn, what
              they hold, who they are married to. Only what is on file: unlike the
              identity slots above, nothing here is asked of every customer, so an
              empty position would read as a gap where there is none. */}
          {supportingCards.length > 0 && (
            <>
              <SectionTitle>Supporting documents</SectionTitle>
              {supportingCards.map(c => (
                <div key={c.key} id={`l-${c.key}`} style={{ scrollMarginTop: JUMP_OFFSET }}>
                  <SecurePreview url={c.doc!.fileUrl} caption={c.label} watermark={watermark} action={refile(c.doc!, 'tenancy')} />
                </div>
              ))}
            </>
          )}
          {/* Then the other parties: partner, POA holder, guarantor, loose
              dependant papers — and after them, each dependant's own pack. */}
          {otherPeopleCards.map(c => (
            <div key={c.key} id={`l-${c.key}`} style={{ scrollMarginTop: JUMP_OFFSET }}>
              {c.doc
                ? <SecurePreview url={c.doc.fileUrl} caption={c.label} watermark={watermark} action={refile(c.doc, 'tenancy')} />
                : <MissingId label={c.label} href={profileHref} optional={c.optional} />}
            </div>
          ))}
          {occGroups.map(g => (
            <div key={'occ' + g.n} id={`l-occ-${g.n}`} style={{ scrollMarginTop: JUMP_OFFSET }}>
              <SectionTitle>{occGroups.length > 1 ? g.label : 'Dependant'}</SectionTitle>
              {g.cards.map(c => (c.doc
                ? <SecurePreview key={c.key} url={c.doc.fileUrl} caption={c.label} watermark={watermark} action={refile(c.doc, 'tenancy')} />
                : <MissingId key={c.key} label={c.label} href={profileHref} optional={c.optional} />))}
            </div>
          ))}
        </section>

        {/* RIGHT — rental / financial documents. Desktop: its own scrolling
            pane; mobile: continues the single scroll below Tenant & KYC. */}
        <section className={`${ds.pane} ${ds.paneRight}`}>
          <QuickNav title="Rental documents · in order" items={rightNav} />
          {seq.map(s => {
            let inner: React.ReactNode;
            if (s.kind === 'plan') inner = hasPlan ? <PaymentPlanCard plan={currentPlan} rows={planRows} refLabel={refLabel} planRefNo={planRefNo} contractType={contractType} tenantName={tenant.companyName || tenant.name} landlordName={ejari.landlord?.bankAccountName || ejari.landlord?.companyName || ejari.landlord?.name} unitNumber={ejari.unit?.number} buildingName={ejari.property?.buildingName} community={ejari.property?.community || ejari.property?.emirate} periodStart={ejari.startDate} periodEnd={ejari.endDate} /> : <Missing label="Payment plan" />;
            else if (s.kind === 'receipts') inner = hasReceiptData
              ? <Block label="Receipts"><ReceiptInline contract={receiptWithRefs as ReceiptContract} height={FULL} showDownload /></Block>
              : <Missing label="Receipts" />;
            else if (s.kind === 'agreement') inner = <Block label="Agreement"><EjariInline data={ejari} addendums={addendums} height={FULL} showDownload /></Block>;
            else {
              const docs = matchDocs(s.key);
              if (!docs.length) {
                if (s.optional) return null;
                inner = s.pending ? <PendingLink label={s.label} /> : <Missing label={s.label} />;
              } else {
                // Generated artifacts (move-in/out report, settlement) → clean download
                // of the stored snapshot; uploaded KYC/other docs stay view-only.
                const previews = docs.map((d, i) => <SecurePreview key={s.key + d.id} url={d.fileUrl} caption={`${s.label}${docs.length > 1 ? ` · ${i + 1} of ${docs.length}` : ''}`} watermark={watermark} />);
                inner = DOWNLOADABLE_ARTIFACT_KEYS.has(s.key)
                  ? <>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                        <DownloadDocButton documentId={docs[0].id} portalToken={portalToken} style={{ ...linkBtnGhost, textDecoration: 'none' }} />
                      </div>
                      {previews}
                    </>
                  : previews;
              }
            }
            return <div key={slotId(s)} id={slotId(s)} style={{ scrollMarginTop: JUMP_OFFSET }}>{inner}</div>;
          })}
          {showLeftover && (
            <div id="r-other" style={{ scrollMarginTop: JUMP_OFFSET }}>
              {leftover.map(d => (
                <SecurePreview key={'x' + d.id} url={d.fileUrl} caption={d.displayName ?? d.documentKey.replace(/_/g, ' ')} watermark={watermark} action={refile(d, 'kyc')} />
              ))}
            </div>
          )}
        </section>
      </div>

      {canLandlordSign && (
        <ContractSignBar
          signerRole="Landlord"
          signerName={signerName}
          onBehalfOf={signerOnBehalfOf}
          defaultName={signerDefaultName}
          alreadySigned={landlordSigned}
          onSign={onSign}
          reviewNote="You've reviewed every document above."
        />
      )}
    </div>
  );
}
