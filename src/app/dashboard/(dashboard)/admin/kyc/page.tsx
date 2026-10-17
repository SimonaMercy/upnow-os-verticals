'use client';
/* eslint-disable react-hooks/set-state-in-effect -- fetch-on-select and reset-on-change effects, the same pattern as the page this replaces */

/**
 * Admin › Verification · Gate 1 — the KYC queue (Genspark split panel).
 *
 * Parity with previous page (all kept, same endpoints and payloads):
 *  Data
 *   - GET /admin/kyc/rental-providers?limit=10&offset=N   (paged 10, infinite scroll, total → tab count)
 *   - GET /admin/kyc/service-providers?limit=10&offset=N  (same)
 *   - GET /admin/kyc/tenants?limit=10&offset=N            (same)
 *   - GET /admin/team/managers                            (managers tab, count)
 *   - GET /admin/kyc/technicians?limit=200                (technicians tab, total)
 *   - GET /admin/kyc/rental-providers/:id  · /service-providers/:id · /tenants/:id — detail on select,
 *     each with the AbortController race-condition guard (a slower earlier response can't overwrite)
 *   - GET /admin/kyc/technicians/:id (technician detail, stale-guarded)
 *  Actions
 *   - PATCH /admin/kyc/rental-providers/:id/compliance  { complianceStatus, complianceNotes? }
 *   - PATCH /admin/kyc/service-providers/:id/compliance { complianceStatus, complianceNotes? }
 *   - PATCH /admin/kyc/technicians/:id/compliance       { complianceStatus, complianceNotes? } (not for solo self-rows)
 *     → Mark compliant (confirm over missing docs / failing checks / red flags) · Request action · Mark expired
 *   - POST /admin/kyc/documents/:id/verify { expiryDate? } (expiry required for ID/licence types)
 *   - POST /admin/kyc/documents/:id/reject { reason }  — now a modal; a reason is required (was an optional prompt)
 *   - PATCH /admin/users/:id/status { status: active|suspended } (account toggle on RP / SP / customer)
 *  UI
 *   - Tabs Rental providers / Service providers / Customers / Managers / Technicians with totals; ?tab= deep link
 *     and persistence (history.replaceState); ?status= deep link
 *   - Status filter All / Pending review / Action required / Compliant / Expired (RP, SP, technicians)
 *   - Refresh, load error, loading, empty, infinite scroll sentinel + "N records" footer
 *   - RP: missing-for-approval list, identity / trade licence / banking, Power of Attorney card (holder +
 *     docs + View all), uploaded docs with View / View all + verdicts, rejection reasons, "Full page" link
 *     → /dashboard/admin/kyc/rental-provider/:id
 *   - SP: at-a-glance counts, approval checks (gates), red flags, manual verifications with View links,
 *     business & owner, operations & coverage (zones, languages, platform agreement), services by category
 *     with prices, KYC documents with expiry warnings + verdicts + View all
 *   - Customer: overview, documents with verdicts, "View all documents" (CustomerDocsModal)
 *   - Manager: account, optional identity docs, landlords & permissions (read-only, as before)
 *   - Technician: overview, assignability, checklist, documents with verdicts, verdict bar (read-only for solo)
 *  Decision model (blueprint "three gates, one decision model") — added, nothing removed:
 *   - Request action / Mark expired / document Reject open a reason-code modal (Gate 1 codes from
 *     src/lib/os/reasonCodes.ts) with a statement-of-reasons preview. The composed text
 *     "[CODE] Explanation To fix: … — note" is sent in the SAME field (complianceNotes / reason).
 *   - Queue SLA: waiting pill from the row's real createdAt (registration — the list has no
 *     submitted-at), amber after 24h, red after 48h, for pending_review / action_required rows
 *     (customers: kycStatus pending_review). Queue order defaults to Oldest first over the loaded
 *     rows; "Newest first" and "As loaded" (the API order the page used before) stay available.
 *   - Badge copy: Compliant shows what was checked and when — technicians use complianceReviewedAt;
 *     RP / SP fall back to the latest document verifiedAt (the provider profile has no decision date);
 *     document Verified pills carry verifiedAt.
 *  Notes: the only full KYC detail page that exists is kyc/rental-provider/[id] — there is no
 *  kyc/service-provider/[id] or kyc/tenant/[id] route, so SP / customer rows link to the user record
 *  (/dashboard/admin/users/:id) instead. The new Gate 1 checklist is derived from the same detail payloads.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { apiGet, apiPatch } from '@/lib/api';
import { openDocViewer } from '@/lib/docViewer';
import { CustomerDocsModal, type CustomerDoc } from '@/components/upnow/CustomerDocsModal';
import {
  Btn, Callout, Card, Checklist, Evid, KV, OsPage, PageHead, Pill, ScopeStrip, Seg, fmtDate, humanize, initials, type Tone,
} from '@/components/os/kit';
import { SlaPill } from '@/components/upnow/GateDecision';
import { hoursSince } from '@/lib/os/reasonCodes';
import {
  COMPLIANCE, ComplianceBadge, CompliancePill, DetailHead, DocRow, UserStatusToggle, VerdictBar, daysUntil, docLabel, gap,
  isRejectedStatus, isVerifiedStatus, type ComplianceStatus, type UploadedDoc,
} from './_parts';

// ─── Types ────────────────────────────────────────────────────────────────────

type DocStatus = 'ATTACHED' | 'PROCESSED' | 'COMPLETE' | 'EXPIRED' | null;

interface ProviderUser {
  id: number; name: string; firstName: string | null; lastName: string | null; email: string;
  phone?: string; kycStatus?: string; status?: string; createdAt?: string;
}
interface RentalProvider {
  id: number; userId: number; user?: ProviderUser; entityType?: string; companyName?: string; contactAddress?: string;
  dateOfBirth?: string; nationality?: string; gender?: string; hasPoa?: boolean;
  poaPersonName?: string | null; poaPersonPhone?: string | null; poaPersonEmail?: string | null;
  bankIban?: string; bankName?: string; bankAccountName?: string; tradeLicenseNumber?: string;
  emiratesIdNumber?: string; passportNumber?: string; complianceStatus: ComplianceStatus; complianceNotes?: string; createdAt: string;
}
interface ServiceProvider {
  id: number; userId: number; user?: ProviderUser; entityType?: string; businessName?: string; ownerName?: string;
  companyName?: string; serviceCategory?: string; serviceCategories?: string; servicesOffered?: string | null;
  scopeOfWork?: string | null; certifications?: string | null; emiratesServed?: string; serviceZones?: string | null;
  serviceArea?: string | null; availability?: string | null; emergencyResponse?: boolean; isGovernment?: boolean;
  nationality?: string; gender?: string; dateOfBirth?: string; emiratesIdNumber?: string; contactAddress?: string;
  tradeLicenseNumber?: string; vatTrn?: string; teamSizeBand?: string | null; fleetSizeBand?: string | null;
  maxConcurrentJobs?: number | null; minNoticeHours?: number | null; opsContactName?: string | null;
  opsContactPhone?: string | null; opsContactWhatsapp?: boolean; opsContactLanguages?: string[] | null;
  accountTypeConfirmedAt?: string | null; jobReadyAt?: string | null; complianceStatus: ComplianceStatus;
  complianceNotes?: string; averageRating?: number; totalReviews?: number; createdAt: string;
}
interface Tenant {
  id: number; userId: number; user?: ProviderUser; entityType?: string; documentStatus?: string; activeStatus?: string; createdAt: string;
}
interface ChecklistItem {
  key: string; displayName: string; category: string; required: boolean; uploaded: boolean; status: DocStatus;
  documentId: number | null; fileUrl: string | null; description?: string;
}
interface TenantDetail {
  profile: {
    id: number; entityType?: string | null; tradeLicenseNumber?: string | null; tradeLicenseAuthority?: string | null;
    activeStatus?: string | null; documentStatus?: string | null; createdAt: string; updatedAt?: string | null;
    user?: { firstName?: string | null; lastName?: string | null; name?: string | null; email?: string | null; phone?: string | null; kycStatus?: string | null; createdAt?: string | null };
  };
  uploadedDocs: UploadedDoc[];
}
interface RpDetail { profile: RentalProvider; checklist: ChecklistItem[]; uploadedDocs: UploadedDoc[]; completionScore: number }
interface SpService {
  id: number; category: string; name: string; basePrice: number | null; priceUnit: string; pricingMode: string; currency: string;
  isFromPrice: boolean; minCalloutCharge: number | null; isEmergency: boolean; listingStatus: string; isAvailable: boolean;
}
interface SpDetail {
  profile: ServiceProvider; checklist: ChecklistItem[]; uploadedDocs: UploadedDoc[]; completionScore: number; services?: SpService[];
  /** SP-252 — standing against the CURRENT provider platform agreement (approval refuses if required && !accepted). */
  platformAgreement?: { required: boolean; accepted: boolean; version: string | null; acceptedAt: string | null } | null;
}
interface ManagerLandlord { rentalProviderId: number; rpName: string; grantedCount: number; permissions: Record<string, boolean> }
interface ManagerDoc { id: number; documentKey: string; status: string; displayName: string | null; createdAt: string }
interface ManagerRow {
  id: number; assetManagerId: number | null; name: string; email: string; status: string; createdAt: string; lastLoginAt: string | null;
  landlordCount: number; landlords: ManagerLandlord[]; uploadedDocs: ManagerDoc[];
}
/** SP-129/212 · GET /admin/kyc/technicians row — the technician half of Gate 1. */
interface TechnicianRow {
  id: number; userId: number; name: string; email: string | null; phone: string | null; status: string; isLeadCapable: boolean;
  /** SP-254 solo self-row: verdict lives on the PROVIDER — read-only here. */
  isSelf: boolean;
  complianceStatus: ComplianceStatus; compliancePausedAt: string | null; complianceNotes: string | null;
  complianceReviewedAt: string | null; complianceReviewedBy: { id: number; name: string } | null;
  assignable: boolean; documentCount: number; lastLoginAt: string | null; createdAt: string;
  provider: { id: number; name: string; entityType: string; complianceStatus: ComplianceStatus };
}
interface TechnicianDetail {
  technician: TechnicianRow; checklist: ChecklistItem[]; uploadedDocs: UploadedDoc[]; completionScore: number;
  assignability: { assignable: boolean; reason: string | null };
}

type Tab = 'rental' | 'service' | 'tenants' | 'managers' | 'technicians';
type StatusFilter = 'all' | 'pending_review' | 'action_required' | 'compliant' | 'expired';
type ChkItem = { l: string; sub?: string; state: 'pass' | 'fail' | 'wait' };
type QueueSort = 'oldest' | 'newest' | 'api';

const TABS: Tab[] = ['rental', 'service', 'tenants', 'managers', 'technicians'];
const FILTERS: StatusFilter[] = ['all', 'pending_review', 'action_required', 'compliant', 'expired'];
const PAGE_SIZE = 10;
const TAB_PATH: Record<'rental' | 'service' | 'tenants', string> = {
  rental: '/admin/kyc/rental-providers',
  service: '/admin/kyc/service-providers',
  tenants: '/admin/kyc/tenants',
};
const TAB_NOUN: Record<Tab, string> = {
  rental: 'rental providers', service: 'service providers', tenants: 'customers', managers: 'managers', technicians: 'technicians',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function providerName(p: RentalProvider | ServiceProvider | Tenant, fallback: string) {
  if (!p.user) return fallback;
  return p.user.name || [p.user.firstName, p.user.lastName].filter(Boolean).join(' ') || fallback;
}
const spName = (sp: ServiceProvider) => sp.businessName ?? sp.ownerName ?? providerName(sp, `SP #${sp.id}`);
const titleize = (s?: string | null) => (s ?? '').replace(/_/g, ' ');
const csv = (s?: string | null) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);
const waiting = (s: ComplianceStatus) => s === 'pending_review' || s === 'action_required';

/** Document checklist row → Gate 1 checklist state. */
function docChk(c: ChecklistItem, doc: UploadedDoc | undefined): ChkItem {
  if (!c.uploaded) return { l: c.displayName, sub: c.required ? 'Required — not uploaded' : 'Optional — not uploaded', state: c.required ? 'fail' : 'wait' };
  const days = daysUntil(doc?.expiryDate);
  if (doc && isRejectedStatus(doc.status)) return { l: c.displayName, sub: `Rejected${doc.notes ? ` — ${doc.notes}` : ''}`, state: 'fail' };
  if (days != null && days < 0) return { l: c.displayName, sub: `Expired ${fmtDate(doc?.expiryDate)}`, state: 'fail' };
  if (doc ? isVerifiedStatus(doc.status) : isVerifiedStatus(c.status)) {
    const on = doc?.verifiedAt ? `Verified ${fmtDate(doc.verifiedAt)}` : 'Verified · date not recorded';
    return { l: c.displayName, sub: doc?.expiryDate ? `${on} · expires ${fmtDate(doc.expiryDate)}` : on, state: 'pass' };
  }
  return { l: c.displayName, sub: 'Uploaded — awaiting your verdict', state: 'wait' };
}
const passCount = (items: ChkItem[]) => items.filter((i) => i.state === 'pass').length;

function KycStatusPill({ status, docs }: { status?: string | null; docs?: UploadedDoc[] | null }) {
  const v = (status ?? '').toLowerCase();
  if (!v) return <Pill tone="neutral">KYC unknown</Pill>;
  const tone: Tone = v.includes('verif') || v === 'approved' || v === 'complete' ? 'primary' : v.includes('reject') || v.includes('fail') ? 'danger' : 'amber';
  if (tone !== 'primary') return <Pill tone={tone}>{`KYC ${titleize(status)}`}</Pill>;
  // Name the check and its date — the latest document verification is the only date on the record.
  const last = (docs ?? []).filter((d) => isVerifiedStatus(d.status) && d.verifiedAt).map((d) => d.verifiedAt as string).sort().at(-1);
  return last
    ? <Pill tone="primary" title="Latest identity-document verification">KYC docs verified · last {fmtDate(last)}</Pill>
    : <Pill tone="primary" title="The API does not return when KYC was verified">KYC docs verified · date not recorded</Pill>;
}
function AccountPill({ status }: { status: string }) {
  const tone: Tone = status === 'active' ? 'primary' : status === 'suspended' || status === 'deactivated' ? 'danger' : 'amber';
  return <Pill tone={tone}>{humanize(status)}</Pill>;
}

// ─── Right panel: Rental provider ─────────────────────────────────────────────

function RpPanel({ rpId, detail, loading, error, onRetry, onStatusChange, onDocUpdate }: {
  rpId: number; detail: RpDetail | null; loading: boolean; error: string | null; onRetry: () => void;
  onStatusChange: (id: number, status: ComplianceStatus) => void;
  onDocUpdate: (docId: number, patch: Partial<UploadedDoc>) => void;
}) {
  if (loading && !detail) return <PanelSkeleton />;
  if (error) return <Callout tone="bad" title="Couldn't load this provider.">{error} <Btn size="xs" onClick={onRetry}>Try again</Btn></Callout>;
  if (!detail) return null;

  const profile = detail.profile;
  const allDocs = detail.uploadedDocs ?? [];
  // Power-of-Attorney documents (the deed + the holder's ID) stay in their own card.
  const poaDocs = allDocs.filter((d) => d.documentKey.startsWith('poa_'));
  const docs = allDocs.filter((d) => !d.documentKey.startsWith('poa_'));
  const checklist = detail.checklist ?? [];
  const requiredItems = checklist.filter((c) => c.required);
  const missingRequired = requiredItems.filter((c) => !c.uploaded);
  const docByKey = (k: string) => allDocs.find((d) => d.documentKey === k);

  const gate: ChkItem[] = [
    ...checklist.map((c) => docChk(c, docByKey(c.key))),
    { l: 'Bank details on file', sub: profile.bankIban ? `${profile.bankName ?? 'Bank'} · ${profile.bankIban}` : 'No IBAN on the profile', state: profile.bankIban ? 'pass' : 'fail' },
    { l: 'Account standing', sub: profile.user?.status === 'suspended' ? 'User account is suspended' : 'Account active', state: profile.user?.status === 'suspended' ? 'fail' : 'pass' },
  ];

  return (
    <>
      <DetailHead
        title={providerName(profile, `RP #${rpId}`)}
        pills={<><ComplianceBadge s={profile.complianceStatus} docs={allDocs} /><Pill tone="outline" dot={false}>Rental provider</Pill></>}
        right={<>
          <UserStatusToggle userId={profile.user?.id} status={profile.user?.status} />
          <Btn size="sm" href={`/dashboard/admin/kyc/rental-provider/${rpId}`}>Open full page</Btn>
        </>}
        sub={`${profile.user?.email ?? ''}${profile.user?.phone ? ` · ${profile.user.phone}` : ''} · registered ${fmtDate(profile.createdAt)}`}
      />
      {profile.complianceNotes && <Evid tone="warn"><strong>Last note: </strong>{profile.complianceNotes}</Evid>}

      <div style={gap}>
        <Card title="Gate 1 · Business verification" sub={`${passCount(gate)}/${gate.length} checks passing · KYC ${detail.completionScore}% complete`} pad>
          {missingRequired.length > 0
            ? <div style={{ marginBottom: 10 }}><Callout tone="bad" title={`Missing for approval — ${missingRequired.length} item${missingRequired.length === 1 ? '' : 's'}:`}>{missingRequired.map((c) => c.displayName).join(', ')}</Callout></div>
            : requiredItems.length > 0 && <div style={{ marginBottom: 10 }}><Evid tone="ok">All required documents are on file.</Evid></div>}
          <Checklist items={gate} />
        </Card>
      </div>

      <div style={gap} className="gx-two">
        <Card title="Identity" pad>
          <KV items={[
            { k: 'Entity type', v: titleize(profile.entityType) || '—' },
            { k: 'Company', v: profile.companyName },
            { k: 'Emirates ID', v: profile.emiratesIdNumber },
            { k: 'Passport', v: profile.passportNumber },
            { k: 'Nationality', v: profile.nationality },
            { k: 'Gender', v: profile.gender },
            { k: 'Date of birth', v: profile.dateOfBirth ? fmtDate(profile.dateOfBirth) : undefined },
            { k: 'Address', v: profile.contactAddress },
          ]} />
        </Card>
        <Card title="Trade licence & banking" pad>
          <KV items={[
            { k: 'Trade licence no.', v: profile.tradeLicenseNumber },
            { k: 'Bank', v: profile.bankName },
            { k: 'Account name', v: profile.bankAccountName },
            { k: 'IBAN', v: profile.bankIban },
          ]} />
        </Card>
      </div>

      {(profile.hasPoa || poaDocs.length > 0) && (
        <div style={gap}>
          <Card title="Power of Attorney" sub="Kept separate from the owner's own KYC"
            right={poaDocs.some((d) => d.fileUrl) && <Btn size="xs" onClick={() => openDocViewer(poaDocs.map((d) => ({ fileUrl: d.fileUrl, caption: docLabel(d.documentKey) })), 'Power of Attorney')}>View all</Btn>} pad>
            {(profile.poaPersonName || profile.poaPersonPhone || profile.poaPersonEmail) && (
              <div style={{ marginBottom: 8 }}>
                <KV items={[
                  { k: 'Holder', v: profile.poaPersonName }, { k: 'Phone', v: profile.poaPersonPhone }, { k: 'Email', v: profile.poaPersonEmail },
                ].filter((r) => r.v)} />
              </div>
            )}
            {poaDocs.length === 0
              ? <div style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>No POA documents uploaded yet.</div>
              : poaDocs.map((d) => <DocRow key={d.id} name={docLabel(d.documentKey.replace(/^poa_/, ''))} doc={d} />)}
          </Card>
        </div>
      )}

      <div style={gap}>
        <Card title={`Uploaded documents (${docs.length})`}
          right={docs.some((d) => d.fileUrl) && <Btn size="xs" onClick={() => openDocViewer(docs.map((d) => ({ fileUrl: d.fileUrl, caption: docLabel(d.documentKey) })), 'Uploaded Documents')}>View all</Btn>} pad>
          {docs.length === 0
            ? <div style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>No documents uploaded yet.</div>
            : docs.map((d) => <DocRow key={d.id} name={docLabel(d.documentKey)} required={checklist.find((c) => c.key === d.documentKey)?.required} doc={d} onUpdate={onDocUpdate} />)}
        </Card>
      </div>

      <VerdictBar who={`rp-${rpId}`}
        blockers={missingRequired.map((c) => `${c.displayName} — required, not uploaded`)}
        disabled={loading}
        onDecide={async (status, notes) => {
          await apiPatch(`/admin/kyc/rental-providers/${rpId}/compliance`, { complianceStatus: status, ...(notes ? { complianceNotes: notes } : {}) });
          onStatusChange(rpId, status);
        }} />
    </>
  );
}

// ─── Right panel: Service provider ────────────────────────────────────────────

function SpPanel({ sp, spId, detail, loading, error, onRetry, onStatusChange, onDocUpdate }: {
  sp: ServiceProvider; spId: number; detail: SpDetail | null; loading: boolean; error: string | null; onRetry: () => void;
  onStatusChange: (id: number, status: ComplianceStatus) => void;
  onDocUpdate: (docId: number, patch: Partial<UploadedDoc>) => void;
}) {
  // Freshly fetched detail profile; fall back to the list row while the detail is in flight.
  const profile = detail?.profile ?? sp;
  const docs = detail?.uploadedDocs ?? [];
  const checklist = detail?.checklist ?? [];
  const requiredItems = checklist.filter((c) => c.required);
  const missingRequired = requiredItems.filter((c) => !c.uploaded);

  const categories = profile.serviceCategories ? csv(profile.serviceCategories) : profile.serviceCategory ? [profile.serviceCategory] : [];
  const emirates = csv(profile.emiratesServed);
  const languages = Array.isArray(profile.opsContactLanguages) ? profile.opsContactLanguages : [];
  let zones: Record<string, string[]> = {};
  try { zones = profile.serviceZones ? JSON.parse(profile.serviceZones) : {}; } catch { zones = {}; }
  const zoneEntries = Object.entries(zones).filter(([, v]) => Array.isArray(v) && v.length);

  const services = detail?.services ?? [];
  const servicesByCat = services.reduce<Record<string, SpService[]>>((acc, s) => { (acc[s.category] ??= []).push(s); return acc; }, {});
  const priceLabel = (s: SpService) => {
    if (s.pricingMode === 'quote' || s.basePrice == null) return s.minCalloutCharge != null ? `Quote · callout AED ${s.minCalloutCharge}` : 'Quote after callout';
    const unit = s.priceUnit === 'per_hour' ? '/hr' : s.priceUnit === 'per_unit' ? '/unit' : '';
    return `${s.isFromPrice ? 'from ' : ''}${s.currency ?? 'AED'} ${s.basePrice}${unit}`;
  };

  // ── Approval decision engine (unchanged rules) ──
  const digitsOf = (s?: string | null) => (s ?? '').replace(/\D/g, '');
  const MS_DAY = 86_400_000;
  // eslint-disable-next-line react-hooks/purity -- expiry / age maths needs the current time
  const now = Date.now();
  const docByKey = (k: string) => docs.find((d) => d.documentKey === k);
  const expiryDays = (d?: UploadedDoc) => (d?.expiryDate ? Math.floor((new Date(d.expiryDate).getTime() - now) / MS_DAY) : null);
  const expiredDocs = docs.filter((d) => { const n = expiryDays(d); return n != null && n < 0; });
  const expiringDocs = docs.filter((d) => { const n = expiryDays(d); return n != null && n >= 0 && n <= 30; });
  const eidDigits = digitsOf(profile.emiratesIdNumber);
  const eidValid = /^784\d{12}$/.test(eidDigits);
  const trnDigits = digitsOf(profile.vatTrn);
  const age = profile.dateOfBirth ? Math.floor((now - new Date(profile.dateOfBirth).getTime()) / (365.25 * MS_DAY)) : null;
  const emailDomain = (profile.user?.email ?? '').split('@')[1]?.toLowerCase() ?? '';
  const DISPOSABLE_DOMAINS = ['mailinator.com', 'yopmail.com', 'guerrillamail.com', 'temp-mail.org', '10minutemail.com', 'tempmail.com', 'trashmail.com', 'maildrop.cc', 'getnada.com', 'dispostable.com', 'sharklasers.com'];
  const FREE_WEBMAIL = ['gmail.com', 'hotmail.com', 'yahoo.com', 'outlook.com', 'icloud.com', 'live.com'];
  const unpricedCats = categories.filter((c) => !(servicesByCat[c]?.length));

  type CheckStatus = 'pass' | 'warn' | 'fail';
  const checks: { label: string; status: CheckStatus; detail: string }[] = [];
  // Hands-on home services are company-only under UAE law (freelance permits don't cover them).
  checks.push(profile.entityType === 'company'
    ? { label: 'Licensed company', status: 'pass', detail: 'Company entity — eligible for hands-on services' }
    : { label: 'Licensed company', status: 'fail', detail: 'Individual entity — hands-on services require a licensed company' });
  checks.push(missingRequired.length === 0
    ? { label: 'Required documents', status: 'pass', detail: `All ${requiredItems.length} on file` }
    : { label: 'Required documents', status: 'fail', detail: `${missingRequired.length} missing: ${missingRequired.map((c) => c.displayName).join(', ')}` });
  checks.push(expiredDocs.length > 0
    ? { label: 'Documents in date', status: 'fail', detail: `Expired: ${expiredDocs.map((d) => titleize(d.documentKey)).join(', ')}` }
    : expiringDocs.length > 0
      ? { label: 'Documents in date', status: 'warn', detail: expiringDocs.map((d) => `${titleize(d.documentKey)} expires in ${expiryDays(d)}d`).join('; ') }
      : { label: 'Documents in date', status: 'pass', detail: 'No expired or imminently-expiring documents' });
  checks.push(!profile.emiratesIdNumber
    ? { label: 'Signatory Emirates ID', status: 'warn', detail: 'No EID number on profile — read it from the document' }
    : eidValid
      ? { label: 'Signatory Emirates ID', status: 'pass', detail: profile.emiratesIdNumber }
      : { label: 'Signatory Emirates ID', status: 'warn', detail: `"${profile.emiratesIdNumber}" — not a valid 15-digit 784… number` });
  checks.push(profile.tradeLicenseNumber
    ? { label: 'Trade licence No.', status: 'pass', detail: profile.tradeLicenseNumber }
    : { label: 'Trade licence No.', status: 'warn', detail: 'Not on profile — confirm from the licence document' });
  checks.push(!trnDigits
    ? { label: 'VAT TRN', status: 'warn', detail: 'Not provided — assumed below registration threshold' }
    : /^\d{15}$/.test(trnDigits)
      ? { label: 'VAT TRN', status: 'pass', detail: profile.vatTrn as string }
      : { label: 'VAT TRN', status: 'fail', detail: `"${profile.vatTrn}" — TRN must be exactly 15 digits` });
  checks.push((profile.user?.phone || profile.opsContactPhone)
    ? { label: 'Contactable', status: 'pass', detail: [profile.user?.phone, profile.opsContactName ? `ops: ${profile.opsContactName}` : null].filter(Boolean).join(' · ') }
    : { label: 'Contactable', status: 'fail', detail: 'No phone number on account or ops contact' });
  checks.push(profile.user?.status === 'suspended'
    ? { label: 'Account standing', status: 'fail', detail: 'User account is suspended — do not approve' }
    : { label: 'Account standing', status: 'pass', detail: 'Account active' });
  const rejectedDocs = docs.filter((d) => isRejectedStatus(d.status));
  const pendingDocs = docs.filter((d) => ['attached', 'pending'].includes(String(d.status).toLowerCase()));
  const verifiedDocs = docs.filter((d) => ['processed', 'complete'].includes(String(d.status).toLowerCase()));
  if (docs.length > 0) {
    checks.push(rejectedDocs.length > 0
      ? { label: 'Documents reviewed', status: 'fail', detail: `${rejectedDocs.length} rejected — awaiting re-upload: ${rejectedDocs.map((d) => titleize(d.documentKey)).join(', ')}` }
      : pendingDocs.length > 0
        ? { label: 'Documents reviewed', status: 'warn', detail: `${pendingDocs.length} of ${docs.length} awaiting review — approve or reject each below` }
        : { label: 'Documents reviewed', status: 'pass', detail: `All ${verifiedDocs.length} uploaded documents verified` });
  }
  const flags: string[] = [];
  if (DISPOSABLE_DOMAINS.includes(emailDomain)) flags.push(`Disposable email domain (${emailDomain})`);
  else if (profile.entityType === 'company' && FREE_WEBMAIL.includes(emailDomain)) flags.push(`Company using free webmail (${emailDomain})`);
  if (profile.teamSizeBand === '1-2' && (categories.length >= 3 || emirates.length >= 3))
    flags.push(`Solo team (1-2) promising ${categories.length} categories across ${emirates.length} emirate${emirates.length === 1 ? '' : 's'}`);
  if (profile.fleetSizeBand === '0' && emirates.length > 1) flags.push('No vehicles but multi-emirate coverage');
  if (profile.teamSizeBand === '1-2' && services.some((s) => s.isEmergency)) flags.push('Offers 24/7 emergency services with a 1-2 person team');
  if (unpricedCats.length > 0) flags.push(`No priced services in: ${unpricedCats.map(titleize).join(', ')}`);
  if (age != null && age < 18) flags.push(`Signatory is under 18 (age ${age})`);
  if ((profile.totalReviews ?? 0) > 0 && profile.complianceStatus !== 'compliant') flags.push('Has reviews before approval — possible account reuse');
  const gateFailures = checks.filter((c) => c.status === 'fail');
  const manualVerify = [
    { text: `Licence activities cover all ${categories.length} selected categories`, docKey: 'trade_license' },
    { text: `Emirates ID name & DOB match “${profile.ownerName ?? 'the owner'}”`, docKey: 'emirates_id' },
    { text: 'Bank / IBAN letter account holder matches the company name', docKey: 'bank_statement' },
    { text: 'MOA names the signatory as owner / authorised manager', docKey: 'moa' },
  ];
  const pa = detail?.platformAgreement;
  const docRows = checklist.length > 0
    ? checklist.map((c) => ({ key: c.key, name: c.displayName, required: c.required, uploaded: c.uploaded, fileUrl: c.fileUrl }))
    : docs.map((d) => ({ key: d.documentKey, name: titleize(d.documentKey), required: false, uploaded: true, fileUrl: d.fileUrl as string | null }));

  return (
    <>
      <DetailHead
        title={spName(profile)}
        pills={<><ComplianceBadge s={profile.complianceStatus} docs={docs} /><Pill tone="outline" dot={false}>Service provider</Pill></>}
        right={<>
          <UserStatusToggle userId={profile.user?.id} status={profile.user?.status} />
          {profile.user?.id && <Btn size="sm" href={`/dashboard/admin/users/${profile.user.id}`}>Open user record</Btn>}
        </>}
        sub={`${profile.user?.email ?? ''}${profile.user?.phone ? ` · ${profile.user.phone}` : ''}`}
      />
      {error && <Callout tone="bad" title="Couldn't load the full record.">{error} <Btn size="xs" onClick={onRetry}>Try again</Btn></Callout>}
      {loading && !detail && <PanelSkeleton />}
      {profile.complianceNotes && <Evid tone="warn"><strong>Note: </strong>{profile.complianceNotes}</Evid>}

      {!loading && detail && (
        <>
          <div className="gx-btn-row" style={gap}>
            <Pill tone="outline" dot={false}>{categories.length} categories</Pill>
            <Pill tone="outline" dot={false}>{services.length} services</Pill>
            <Pill tone="outline" dot={false}>{emirates.length} emirates</Pill>
            {requiredItems.length > 0 && <Pill tone={missingRequired.length ? 'danger' : 'primary'}>{requiredItems.length - missingRequired.length}/{requiredItems.length} docs</Pill>}
            <Pill tone={gateFailures.length + flags.length ? 'danger' : 'primary'}>{gateFailures.length + flags.length} issue{gateFailures.length + flags.length === 1 ? '' : 's'}</Pill>
          </div>

          <div style={gap}>
            <Card title="Gate 1 · Business verification"
              sub={`${checks.filter((c) => c.status === 'pass').length}/${checks.length} passing${gateFailures.length ? ` · ${gateFailures.length} blocking` : ''}`} pad>
              <Checklist items={checks.map((c) => ({ l: c.label, sub: c.detail, state: c.status === 'warn' ? 'wait' as const : c.status }))} />
              {flags.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <Callout tone="bad" title={`Red flags · ${flags.length}`}>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>{flags.map((f) => <li key={f}>{f}</li>)}</ul>
                  </Callout>
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <div className="gx-lb">Verify on the documents before approving</div>
                {manualVerify.map((m) => {
                  const doc = docByKey(m.docKey);
                  return (
                    <div key={m.text} className="flex items-center gap-2" style={{ padding: '5px 0', fontSize: 11.5 }}>
                      <span style={{ flex: 1 }}>☐ {m.text}</span>
                      {doc?.fileUrl
                        ? <Btn size="xs" onClick={() => openDocViewer({ fileUrl: doc.fileUrl, caption: titleize(m.docKey) })}>View {titleize(m.docKey)}</Btn>
                        : <span style={{ fontSize: 10.5, color: 'var(--ms-ink-3)' }}>not uploaded</span>}
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          <div style={gap} className="gx-two">
            <Card title="Business & owner" pad>
              <KV items={[
                { k: 'Entity type', v: titleize(profile.entityType) || '—' },
                { k: 'Business name', v: profile.businessName },
                { k: 'Owner / signatory', v: profile.ownerName },
                { k: 'Registered', v: profile.createdAt ? fmtDate(profile.createdAt) : undefined },
                { k: 'Emirates ID', v: profile.emiratesIdNumber },
                { k: 'Nationality', v: profile.nationality },
                { k: 'Date of birth', v: profile.dateOfBirth ? fmtDate(profile.dateOfBirth) : undefined },
                { k: 'Trade licence no.', v: profile.tradeLicenseNumber },
                { k: 'VAT TRN', v: profile.vatTrn },
              ]} />
            </Card>
            <Card title="Operations & coverage" pad>
              <KV items={[
                { k: 'Team size', v: profile.teamSizeBand },
                { k: 'Fleet size', v: profile.fleetSizeBand },
                { k: 'Min notice', v: profile.minNoticeHours != null ? `${profile.minNoticeHours} h` : undefined },
                { k: 'Ops contact', v: profile.opsContactName },
                { k: 'Ops phone', v: profile.opsContactPhone },
                { k: 'WhatsApp', v: profile.opsContactWhatsapp ? 'Yes' : 'No' },
                { k: 'Job-ready', v: profile.jobReadyAt ? fmtDate(profile.jobReadyAt) : 'Not yet' },
                // SP-252 — approval refuses until the current agreement is accepted (only when one is published).
                { k: 'Platform agreement', v: !pa?.required ? 'None published' : pa.accepted ? `Accepted v${pa.version} · ${fmtDate(pa.acceptedAt)}` : <span style={{ color: 'var(--ms-danger)' }}>v{pa.version} NOT accepted — approval blocked</span> },
                { k: 'Languages', v: languages.length ? languages.join(', ') : undefined },
                { k: `Emirates served (${emirates.length})`, v: emirates.length ? emirates.map(titleize).join(', ') : 'No emirates selected' },
              ]} />
              {zoneEntries.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 11.5 }}>
                  <div className="gx-lb">Zones</div>
                  {zoneEntries.map(([em, list]) => <div key={em}><strong style={{ textTransform: 'capitalize' }}>{titleize(em)}:</strong> {list.join(', ')}</div>)}
                </div>
              )}
            </Card>
          </div>

          <div style={gap}>
            <Card title="Services" sub={`${categories.length} categories · ${services.length} services`} pad>
              {categories.length === 0
                ? <div style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>No categories selected.</div>
                : categories.map((cat) => {
                  const list = servicesByCat[cat] ?? [];
                  return (
                    <div key={cat} style={{ marginBottom: 10 }}>
                      <div className="flex items-center gap-2" style={{ padding: '5px 9px', borderRadius: 7, background: 'var(--ms-tint-light)' }}>
                        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ms-primary-dark)' }}>{titleize(cat)}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--ms-primary-dark)' }}>{list.length ? `${list.length} service${list.length === 1 ? '' : 's'}` : 'none priced'}</span>
                      </div>
                      {list.length === 0
                        ? <div style={{ fontSize: 11, color: 'var(--ms-ink-3)', padding: '4px 9px' }}>No services priced in this category yet.</div>
                        : list.map((s) => (
                          <div key={s.id} className="flex items-center gap-2" style={{ padding: '6px 9px', borderBottom: '1px dashed var(--ms-surface-3)', fontSize: 12 }}>
                            <span style={{ flex: 1, minWidth: 0 }}>{s.name}</span>
                            {s.isEmergency && <Pill tone="danger" dot={false}>24/7</Pill>}
                            <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{priceLabel(s)}</span>
                          </div>
                        ))}
                    </div>
                  );
                })}
            </Card>
          </div>

          {(checklist.length > 0 || docs.length > 0) && (
            <div style={gap}>
              <Card title={`KYC documents${checklist.length ? ` · ${checklist.filter((c) => c.uploaded).length}/${checklist.length}` : ''}`}
                right={docs.some((d) => d.fileUrl) && <Btn size="xs" onClick={() => openDocViewer(docs.filter((d) => d.fileUrl).map((d) => ({ fileUrl: d.fileUrl, caption: titleize(d.documentKey) })), 'KYC Documents')}>View all</Btn>} pad>
                {docRows.map((c) => (
                  <DocRow key={c.key} name={c.name} required={c.required} missing={!c.uploaded} fileUrl={c.fileUrl}
                    doc={docs.find((d) => d.documentKey === c.key) ?? null} onUpdate={onDocUpdate} />
                ))}
              </Card>
            </div>
          )}
        </>
      )}

      <VerdictBar who={`sp-${spId}`}
        blockers={[...gateFailures.map((c) => `✗ ${c.label} — ${c.detail}`), ...flags.map((f) => `⚑ ${f}`)]}
        disabled={loading}
        onDecide={async (status, notes) => {
          await apiPatch(`/admin/kyc/service-providers/${spId}/compliance`, { complianceStatus: status, ...(notes ? { complianceNotes: notes } : {}) });
          onStatusChange(spId, status);
        }} />
    </>
  );
}

// ─── Right panel: Customer ────────────────────────────────────────────────────

function TenantPanel({ tenant, detail, loading, onDocUpdate }: {
  tenant: Tenant; detail: TenantDetail | null; loading: boolean; onDocUpdate: (docId: number, patch: Partial<UploadedDoc>) => void;
}) {
  const [showDocs, setShowDocs] = useState(false);
  const name = providerName(tenant, `Customer #${tenant.id}`);
  const p = detail?.profile;
  const u = p?.user;
  const docs = detail?.uploadedDocs ?? null;
  const email = u?.email ?? tenant.user?.email;
  const customerDocs: CustomerDoc[] = (docs ?? []).map((d) => ({
    id: d.id, documentKey: d.documentKey, displayName: null, category: null, status: d.status, fileUrl: d.fileUrl, expiryDate: d.expiryDate, ownerType: 'customer',
  }));
  const gate: ChkItem[] = (docs ?? []).map((d) => docChk({ key: d.documentKey, displayName: docLabel(d.documentKey), category: '', required: false, uploaded: true, status: null, documentId: d.id, fileUrl: d.fileUrl }, d));

  return (
    <>
      <DetailHead
        title={<span className="flex items-center gap-2"><span className="gx-thumb" style={{ borderRadius: 999 }}>{initials(name)}</span>{name}</span>}
        pills={<><KycStatusPill status={u?.kycStatus} docs={docs} /><Pill tone="outline" dot={false}>Customer</Pill></>}
        right={<>
          <UserStatusToggle userId={tenant.user?.id} status={tenant.user?.status} />
          {tenant.user?.id && <Btn size="sm" href={`/dashboard/admin/users/${tenant.user.id}`}>Open user record</Btn>}
        </>}
        sub={`${email ?? ''}${u?.phone ? ` · ${u.phone}` : ''}`}
      />
      <Card title="Overview" pad>
        <KV items={[
          { k: 'Entity type', v: titleize(p?.entityType ?? tenant.entityType) || undefined },
          { k: 'Document status', v: titleize(p?.documentStatus ?? tenant.documentStatus) || undefined },
          { k: 'Active status', v: titleize(p?.activeStatus ?? tenant.activeStatus) || undefined },
          { k: 'Registered', v: fmtDate(p?.createdAt ?? tenant.createdAt) },
          { k: 'Last updated', v: p?.updatedAt ? fmtDate(p.updatedAt) : undefined },
          { k: 'Trade licence no', v: p?.tradeLicenseNumber },
          { k: 'Licence authority', v: p?.tradeLicenseAuthority },
        ].filter((r) => r.v)} />
      </Card>
      <div style={gap}>
        <Card title="Gate 1 · Identity checks" sub={docs ? `${passCount(gate)}/${gate.length} documents verified` : undefined} pad>
          {loading ? <PanelSkeleton rows={3} /> : gate.length === 0
            ? <div style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>No documents uploaded yet — nothing to verify.</div>
            : <Checklist items={gate} />}
        </Card>
      </div>
      <div style={gap}>
        <Card title={`Documents${docs ? ` (${docs.length})` : ''}`}
          right={docs && docs.length > 0 && <Btn size="xs" onClick={() => setShowDocs(true)}>View all documents</Btn>} pad>
          {loading ? <PanelSkeleton rows={3} /> : !docs || docs.length === 0
            ? <div style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>No documents uploaded yet.</div>
            : docs.map((d) => <DocRow key={d.id} name={docLabel(d.documentKey)} doc={d} onUpdate={onDocUpdate} />)}
        </Card>
      </div>
      {showDocs && <CustomerDocsModal tenantName={name} documents={customerDocs} onClose={() => setShowDocs(false)} />}
    </>
  );
}

// ─── Right panel: Manager (read-only, as before) ──────────────────────────────

const permLabel = (k: string) => k.replace('can', '').replace(/([A-Z])/g, ' $1').trim();

function ManagerPanel({ m }: { m: ManagerRow }) {
  return (
    <>
      <DetailHead title={m.name} pills={<><AccountPill status={m.status} /><Pill tone="outline" dot={false}>Asset manager</Pill></>} sub={m.email} />
      <Card title="Account details" pad>
        <KV items={[
          { k: 'Role', v: 'Asset Manager' },
          { k: 'Landlords managed', v: String(m.landlordCount) },
          { k: 'Member since', v: fmtDate(m.createdAt) },
          { k: 'Last login', v: m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString('en-AE') : 'Never' },
        ]} />
      </Card>
      <div style={gap}>
        <Card title="Identity documents" sub="Optional" pad>
          {[{ key: 'emirates_id', label: 'Emirates ID' }, { key: 'passport', label: 'Passport' }, { key: 'visa', label: 'UAE Residency Visa' }].map(({ key, label }) => {
            const doc = m.uploadedDocs.find((d) => d.documentKey === key);
            return (
              <div key={key} className="flex items-center gap-2" style={{ padding: '7px 0', borderBottom: '1px solid var(--ms-surface-3)', fontSize: 12 }}>
                <span style={{ flex: 1 }}>{label}</span>
                {doc ? <Pill tone="primary">{humanize(String(doc.status).toLowerCase())}</Pill> : <Pill tone="neutral">Not uploaded</Pill>}
              </div>
            );
          })}
        </Card>
      </div>
      <div style={gap}>
        <Card title="Landlords & permissions" pad>
          {m.landlords.length === 0 && <div style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>Not attached to any landlord yet.</div>}
          {m.landlords.map((l) => {
            const granted = Object.entries(l.permissions).filter(([, v]) => v).map(([k]) => permLabel(k));
            return (
              <div key={l.rentalProviderId} style={{ padding: '8px 0', borderBottom: '1px solid var(--ms-surface-3)' }}>
                <div className="flex items-center gap-2" style={{ fontSize: 12, fontWeight: 700 }}>
                  <span style={{ flex: 1 }}>{l.rpName}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--ms-ink-3)', fontWeight: 600 }}>{l.grantedCount} permission{l.grantedCount !== 1 ? 's' : ''}</span>
                </div>
                <div className="gx-btn-row" style={{ marginTop: 5 }}>
                  {granted.length === 0 ? <Pill tone="amber">No permissions granted</Pill> : granted.map((g) => <Pill key={g} tone="primary" dot={false}>{g}</Pill>)}
                </div>
              </div>
            );
          })}
        </Card>
      </div>
    </>
  );
}

// ─── Right panel: Technician ──────────────────────────────────────────────────

function TechnicianPanel({ t, onStatusChange, onChecks }: {
  t: TechnicianRow; onStatusChange: (id: number, patch: Partial<TechnicianRow>) => void; onChecks: (c: string | null) => void;
}) {
  const [detail, setDetail] = useState<TechnicianDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true); setDetail(null);
    apiGet<TechnicianDetail>(`/admin/kyc/technicians/${t.id}`)
      .then((d) => { if (alive) setDetail(d); })
      .catch(() => { /* panel shows the row we already have */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [t.id]);

  const row = detail?.technician ?? t;
  const docs = detail?.uploadedDocs ?? null;
  const checklist = detail?.checklist ?? [];
  const requiredMissing = checklist.filter((c) => c.required && !c.uploaded);
  const docsVerified = (docs ?? []).filter((d) => isVerifiedStatus(d.status)).length;
  const gate = checklist.map((c) => docChk(c, (docs ?? []).find((d) => d.documentKey === c.key)));
  useEffect(() => { onChecks(detail ? `${passCount(gate)}/${gate.length}` : null); }, [detail, gate.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function onDocUpdate(docId: number, patch: Partial<UploadedDoc>) {
    setDetail((prev) => (prev ? { ...prev, uploadedDocs: prev.uploadedDocs.map((d) => (d.id === docId ? { ...d, ...patch } : d)) } : prev));
  }

  return (
    <>
      <DetailHead title={row.name}
        pills={<><ComplianceBadge s={row.complianceStatus} reviewedAt={row.complianceReviewedAt} />{row.isSelf && <Pill tone="info" dot={false}>Solo operator</Pill>}<Pill tone="outline" dot={false}>Technician</Pill></>}
        sub={`${row.email ?? 'No app login yet'}${row.phone ? ` · ${row.phone}` : ''}`} />
      <Evid tone={row.assignable ? 'ok' : 'warn'}>{row.assignable ? 'Cleared for dispatch' : (detail?.assignability.reason ?? 'Not assignable until verified')}</Evid>
      <div style={gap}>
        <Card title="Overview" pad>
          <KV items={[
            { k: 'Provider', v: `${row.provider.name}${row.provider.entityType === 'individual' ? ' (solo)' : ''}` },
            { k: 'Provider verdict', v: COMPLIANCE[row.provider.complianceStatus]?.label ?? titleize(row.provider.complianceStatus) },
            { k: 'Lead capable', v: row.isLeadCapable ? 'Yes' : 'No' },
            { k: 'Account', v: humanize(row.status) },
            { k: 'App login', v: row.email ? (row.lastLoginAt ? `Signed in ${fmtDate(row.lastLoginAt)}` : 'Never signed in') : 'No login (roster entry)' },
            { k: 'Member since', v: fmtDate(row.createdAt) },
            ...(row.complianceReviewedAt ? [{ k: 'Last verdict', v: `${row.complianceReviewedBy?.name ?? 'Admin'} · ${fmtDate(row.complianceReviewedAt)}` }] : []),
          ]} />
        </Card>
      </div>
      <div style={gap}>
        <Card title="Gate 1 · Technician checklist" sub={detail ? `${passCount(gate)}/${gate.length} passing · ${detail.completionScore}% complete` : undefined} pad>
          {loading && !detail ? <PanelSkeleton rows={3} /> : gate.length === 0
            ? <div style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>No checklist for this owner type.</div>
            : <Checklist items={gate} />}
        </Card>
      </div>
      <div style={gap}>
        <Card title={`Documents${docs ? ` (${docs.length}, ${docsVerified} verified)` : ''}`} pad>
          {loading && !detail ? <PanelSkeleton rows={3} /> : !docs || docs.length === 0
            ? <div style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>No documents uploaded yet — the technician (or their provider) uploads Emirates ID + visa from the app.</div>
            : docs.map((d) => <DocRow key={d.id} name={docLabel(d.documentKey)} doc={d} onUpdate={onDocUpdate} />)}
        </Card>
      </div>
      {row.isSelf ? (
        <div style={gap}>
          <Callout tone="info">Solo operator — this person is vetted as the <strong>provider</strong>; their technician verdict mirrors it. Review them under the Service providers tab.</Callout>
        </div>
      ) : (
        <VerdictBar who={`tech-${t.id}`} initialNotes={detail?.technician.complianceNotes ?? ''}
          notesHint="Optional — shown to the technician and provider on action required"
          blockers={[
            ...requiredMissing.map((c) => `✗ ${c.displayName} not uploaded`),
            ...((docs ?? []).length > 0 && docsVerified === 0 ? ['⚑ No document has been verified yet'] : []),
          ]}
          disabled={loading}
          onDecide={async (status, notes) => {
            const d = await apiPatch<TechnicianDetail>(`/admin/kyc/technicians/${t.id}/compliance`, { complianceStatus: status, ...(notes ? { complianceNotes: notes } : {}) });
            setDetail(d);
            onStatusChange(t.id, {
              complianceStatus: d.technician.complianceStatus, assignable: d.technician.assignable,
              complianceReviewedAt: d.technician.complianceReviewedAt, complianceReviewedBy: d.technician.complianceReviewedBy,
              complianceNotes: d.technician.complianceNotes,
            });
          }} />
      )}
    </>
  );
}

function PanelSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" style={{ display: 'grid', gap: 10, padding: '6px 0' }}>
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="gx-skel" style={{ height: 14, width: `${90 - (i % 3) * 18}%` }} />)}
    </div>
  );
}

// ─── Queue item ───────────────────────────────────────────────────────────────

function QItem({ selected, onClick, title, sub, pills }: { selected: boolean; onClick: () => void; title: string; sub?: string; pills: ReactNode }) {
  return (
    <button type="button" role="option" className="gx-qitem" aria-selected={selected} onClick={onClick}>
      <span className="t">{title}</span>
      {sub && <span className="s">{sub}</span>}
      <span className="f">{pills}</span>
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminKycPage() {
  const [tab, setTab] = useState<Tab>('rental');
  const [rps, setRps] = useState<RentalProvider[]>([]);
  const [sps, setSps] = useState<ServiceProvider[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [managers, setManagers] = useState<ManagerRow[]>([]);
  const [technicians, setTechnicians] = useState<TechnicianRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totals, setTotals] = useState<Record<Tab, number>>({ rental: 0, service: 0, tenants: 0, managers: 0, technicians: 0 });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [queueSort, setQueueSort] = useState<QueueSort>('oldest');

  // RP / SP / customer detail — fetched on select, shared by the queue item (checks n/m) and the panel.
  const [rpDetail, setRpDetail] = useState<RpDetail | null>(null);
  const [rpDetailLoading, setRpDetailLoading] = useState(false);
  const [rpDetailError, setRpDetailError] = useState<string | null>(null);
  const [spDetail, setSpDetail] = useState<SpDetail | null>(null);
  const [spDetailLoading, setSpDetailLoading] = useState(false);
  const [spDetailError, setSpDetailError] = useState<string | null>(null);
  const [tenantDetail, setTenantDetail] = useState<TenantDetail | null>(null);
  const [tenantDocsLoading, setTenantDocsLoading] = useState(false);
  const [detailNonce, setDetailNonce] = useState(0);
  const [techChecks, setTechChecks] = useState<string | null>(null);

  const listScrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);

  // Deep link + persistence: ?tab=rental|service|tenants|managers|technicians, ?status=…
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const t = p.get('tab'); const s = p.get('status');
    if (t && (TABS as string[]).includes(t)) setTab(t as Tab);
    if (s && (FILTERS as string[]).includes(s)) setStatusFilter(s as StatusFilter);
  }, []);

  async function loadPage(t: 'rental' | 'service' | 'tenants', offset: number, reset: boolean) {
    if (!reset) setLoadingMore(true);
    try {
      const res = await apiGet<{ data?: unknown[]; total?: number }>(`${TAB_PATH[t]}?limit=${PAGE_SIZE}&offset=${offset}`);
      const batch = (res.data ?? (res as unknown as unknown[])) ?? [];
      const total = res.total ?? batch.length;
      setTotals((prev) => ({ ...prev, [t]: total }));
      if (t === 'rental') setRps((prev) => (reset ? (batch as RentalProvider[]) : [...prev, ...(batch as RentalProvider[])]));
      else if (t === 'service') setSps((prev) => (reset ? (batch as ServiceProvider[]) : [...prev, ...(batch as ServiceProvider[])]));
      else setTenants((prev) => (reset ? (batch as Tenant[]) : [...prev, ...(batch as Tenant[])]));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      if (!reset) setLoadingMore(false);
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        loadPage('rental', 0, true),
        loadPage('service', 0, true),
        loadPage('tenants', 0, true),
        apiGet<ManagerRow[]>('/admin/team/managers')
          .then((d) => { const a = Array.isArray(d) ? d : []; setManagers(a); setTotals((p) => ({ ...p, managers: a.length })); }).catch(() => {}),
        // SP-129/212: the technician review queue — pending_review first. Cap 200 (pilot-sized roster).
        apiGet<{ data: TechnicianRow[]; total: number }>('/admin/kyc/technicians?limit=200')
          .then((d) => { const a = Array.isArray(d?.data) ? d.data : []; setTechnicians(a); setTotals((p) => ({ ...p, technicians: d?.total ?? a.length })); }).catch(() => {}),
      ]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Infinite scroll — next page of the ACTIVE paged tab when the sentinel enters the queue column.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    if (tab === 'managers' || tab === 'technicians') return;
    const pagTab = tab;
    const loaded = pagTab === 'rental' ? rps.length : pagTab === 'service' ? sps.length : tenants.length;
    if (loaded >= totals[pagTab]) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting && !loadingMore && !loading) void loadPage(pagTab, loaded, false); },
      { root: listScrollRef.current, rootMargin: '120px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [tab, rps.length, sps.length, tenants.length, totals, loadingMore, loading]);

  // Detail fetches. AbortController cancels the in-flight request when the selection changes quickly,
  // so a slower earlier response can never overwrite a faster later one (race-condition fix).
  useEffect(() => {
    if (tab !== 'rental' || selectedId === null) { setRpDetail(null); return; }
    const controller = new AbortController();
    setRpDetail(null); setRpDetailLoading(true); setRpDetailError(null);
    apiGet<RpDetail>(`/admin/kyc/rental-providers/${selectedId}`, { signal: controller.signal })
      .then((d) => { if (!controller.signal.aborted) setRpDetail(d); })
      .catch((e) => { if (!controller.signal.aborted) setRpDetailError((e as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setRpDetailLoading(false); });
    return () => controller.abort();
  }, [selectedId, tab, detailNonce]);

  useEffect(() => {
    if (tab !== 'service' || selectedId === null) { setSpDetail(null); return; }
    const controller = new AbortController();
    setSpDetail(null); setSpDetailLoading(true); setSpDetailError(null);
    apiGet<SpDetail>(`/admin/kyc/service-providers/${selectedId}`, { signal: controller.signal })
      .then((d) => { if (!controller.signal.aborted) setSpDetail(d); })
      .catch((e) => { if (!controller.signal.aborted) setSpDetailError((e as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setSpDetailLoading(false); });
    return () => controller.abort();
  }, [selectedId, tab, detailNonce]);

  useEffect(() => {
    if (tab !== 'tenants' || selectedId === null) { setTenantDetail(null); return; }
    const controller = new AbortController();
    setTenantDetail(null); setTenantDocsLoading(true);
    apiGet<TenantDetail>(`/admin/kyc/tenants/${selectedId}`, { signal: controller.signal })
      .then((d) => { if (!controller.signal.aborted) setTenantDetail(d); })
      .catch(() => { if (!controller.signal.aborted) setTenantDetail(null); })
      .finally(() => { if (!controller.signal.aborted) setTenantDocsLoading(false); });
    return () => controller.abort();
  }, [selectedId, tab]);

  useEffect(() => { detailScrollRef.current?.scrollTo({ top: 0 }); setTechChecks(null); }, [selectedId, tab]);

  function handleTabChange(t: Tab) {
    setTab(t); setSelectedId(null); setStatusFilter('all');
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', t);
      window.history.replaceState({}, '', url);
    } catch { /* no-op */ }
  }
  function handleStatusFilter(s: StatusFilter) { setStatusFilter(s); setSelectedId(null); }
  function handleRpStatusChange(id: number, status: ComplianceStatus) {
    setRps((prev) => prev.map((r) => (r.id === id ? { ...r, complianceStatus: status } : r)));
    setRpDetail((prev) => (prev && prev.profile.id === id ? { ...prev, profile: { ...prev.profile, complianceStatus: status } } : prev));
  }
  function handleTechnicianChange(id: number, patch: Partial<TechnicianRow>) {
    setTechnicians((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }
  function handleSpStatusChange(id: number, status: ComplianceStatus) {
    setSps((prev) => prev.map((s) => (s.id === id ? { ...s, complianceStatus: status } : s)));
    setSpDetail((prev) => (prev && prev.profile.id === id ? { ...prev, profile: { ...prev.profile, complianceStatus: status } } : prev));
  }
  const patchDocs = <T extends { uploadedDocs: UploadedDoc[] }>(prev: T | null, docId: number, patch: Partial<UploadedDoc>): T | null =>
    (prev ? { ...prev, uploadedDocs: prev.uploadedDocs.map((d) => (d.id === docId ? { ...d, ...patch } : d)) } : prev);
  const handleSpDocUpdate = (docId: number, patch: Partial<UploadedDoc>) => setSpDetail((p) => patchDocs(p, docId, patch));
  const handleRpDocUpdate = (docId: number, patch: Partial<UploadedDoc>) => setRpDetail((p) => patchDocs(p, docId, patch));
  const handleTenantDocUpdate = (docId: number, patch: Partial<UploadedDoc>) => setTenantDetail((p) => patchDocs(p, docId, patch));

  // Queue order over the loaded rows: Oldest first (default, SLA order) · Newest first · As loaded (API order).
  const ordered = <T extends { createdAt: string }>(rows: T[]): T[] => {
    if (queueSort === 'api') return rows;
    const ts = (r: T) => new Date(r.createdAt).getTime() || 0;
    return [...rows].sort((a, b) => (queueSort === 'oldest' ? ts(a) - ts(b) : ts(b) - ts(a)));
  };
  const filteredRps = ordered(rps.filter((r) => statusFilter === 'all' || r.complianceStatus === statusFilter));
  const filteredSps = ordered(sps.filter((sp) => statusFilter === 'all' || sp.complianceStatus === statusFilter));
  const filteredTechnicians = ordered(technicians.filter((t) => statusFilter === 'all' || t.complianceStatus === statusFilter));
  const orderedTenants = ordered(tenants);
  const orderedManagers = ordered(managers);
  // eslint-disable-next-line react-hooks/purity -- SLA counts need the current time
  const nowMs = Date.now();
  const over48 = (iso: string) => (hoursSince(iso, nowMs) ?? 0) > 48;
  const slaBreaches = tab === 'rental' ? filteredRps.filter((r) => waiting(r.complianceStatus) && over48(r.createdAt)).length
    : tab === 'service' ? filteredSps.filter((r) => waiting(r.complianceStatus) && over48(r.createdAt)).length
    : tab === 'technicians' ? filteredTechnicians.filter((r) => waiting(r.complianceStatus) && over48(r.createdAt)).length
    : tab === 'tenants' ? tenants.filter((r) => r.user?.kycStatus === 'pending_review' && over48(r.createdAt)).length : 0;

  const selectedRp = selectedId !== null && tab === 'rental' ? rps.find((r) => r.id === selectedId) ?? null : null;
  const selectedSp = selectedId !== null && tab === 'service' ? sps.find((s) => s.id === selectedId) ?? null : null;
  const selectedTenant = selectedId !== null && tab === 'tenants' ? tenants.find((t) => t.id === selectedId) ?? null : null;
  const selectedManager = selectedId !== null && tab === 'managers' ? managers.find((m) => m.id === selectedId) ?? null : null;
  const selectedTechnician = selectedId !== null && tab === 'technicians' ? technicians.find((t) => t.id === selectedId) ?? null : null;
  const hasSelection = !!(selectedRp || selectedSp || selectedTenant || selectedManager || selectedTechnician);

  const visibleCount = tab === 'rental' ? filteredRps.length : tab === 'service' ? filteredSps.length
    : tab === 'tenants' ? tenants.length : tab === 'managers' ? managers.length : filteredTechnicians.length;
  const loadedCount = tab === 'rental' ? rps.length : tab === 'service' ? sps.length
    : tab === 'tenants' ? tenants.length : tab === 'managers' ? managers.length : technicians.length;
  const showFilter = tab === 'rental' || tab === 'service' || tab === 'technicians';

  // "checks n/m" for the selected record, from the same detail payload the panel draws.
  const rpChecks = rpDetail ? (() => {
    const docs = rpDetail.uploadedDocs ?? [];
    const items = rpDetail.checklist.map((c) => docChk(c, docs.find((d) => d.documentKey === c.key)));
    return `${passCount(items)}/${items.length}`;
  })() : null;
  const tenantChecks = tenantDetail ? `${tenantDetail.uploadedDocs.filter((d) => isVerifiedStatus(d.status)).length}/${tenantDetail.uploadedDocs.length}` : null;
  const spChecks = spDetail ? `${spDetail.checklist.filter((c) => c.uploaded).length}/${spDetail.checklist.length} docs` : null;

  const waitPill = (s: ComplianceStatus, since: string) =>
    waiting(s) ? <SlaPill iso={since} title="Time since the account registered (the list has no submitted-at)" /> : null;
  const checksPill = (v: string | null) => (v ? <Pill tone="outline" dot={false}>Checks {v}</Pill> : null);

  return (
    <OsPage>
      <PageHead
        eyebrow="Verification · Gate 1"
        title="Profile verification"
        lede="Check who each business, customer and team member is before anything goes live. Verify or reject each document, then record the compliance decision. Verified is not authorised — vertical access is Gate 2."
        actions={<>
          <Btn size="sm" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</Btn>
          <Btn size="sm" href="/dashboard/admin/authorisation">Authorisation queue</Btn>
        </>}
      />
      <ScopeStrip items={[
        { label: 'Gate', value: 'Gate 1 · Business verification' },
        { label: 'Queue', value: TAB_NOUN[tab] },
        { label: 'Loaded', value: `${loadedCount} of ${totals[tab]}` },
        ...(showFilter ? [{ label: 'Status', value: statusFilter === 'all' ? 'All' : COMPLIANCE[statusFilter].label }] : []),
        ...(tab !== 'managers' ? [{ label: 'Over 48h', value: slaBreaches > 0 ? <Pill tone="danger">{slaBreaches} waiting</Pill> : 'None' }] : []),
        { label: 'Data', value: 'Live' },
      ]} />

      <div className="flex items-center gap-3 flex-wrap" style={{ marginBottom: 12 }}>
        <Seg<Tab> label="Queue" value={tab} onChange={handleTabChange} options={[
          { v: 'rental', l: 'Rental providers', n: totals.rental },
          { v: 'service', l: 'Service providers', n: totals.service },
          { v: 'tenants', l: 'Customers', n: totals.tenants },
          { v: 'managers', l: 'Managers', n: totals.managers },
          { v: 'technicians', l: 'Technicians', n: totals.technicians },
        ]} />
        <Seg<QueueSort> label="Queue order" value={queueSort} onChange={setQueueSort} options={[
          { v: 'oldest', l: 'Oldest first' }, { v: 'newest', l: 'Newest first' }, { v: 'api', l: 'As loaded' },
        ]} />
        {showFilter && (
          <div className="gx-chips" role="group" aria-label="Compliance status">
            {FILTERS.map((f) => (
              <button key={f} type="button" className="gx-chip" aria-pressed={statusFilter === f} onClick={() => handleStatusFilter(f)}>
                {f === 'all' ? 'All' : COMPLIANCE[f].label}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: 12 }}>
          <Callout tone="bad" title="Couldn't load the queue.">{error} <Btn size="xs" onClick={() => void load()}>Try again</Btn></Callout>
        </div>
      )}

      <div className="gx-split">
        <div className="gx-split-l" ref={listScrollRef}>
          <div role="listbox" aria-label={`${TAB_NOUN[tab]} queue`}>
            {loading && loadedCount === 0 && (
              <div aria-busy="true" style={{ padding: 12, display: 'grid', gap: 12 }}>
                {Array.from({ length: 6 }).map((_, i) => <div key={i} className="gx-skel" style={{ height: 44 }} />)}
              </div>
            )}
            {!loading && visibleCount === 0 && (
              <div className="gx-empty"><b>No records here</b>{showFilter && statusFilter !== 'all' ? 'Nothing matches this status — choose All to see the whole queue.' : `No ${TAB_NOUN[tab]} to review yet.`}</div>
            )}

            {tab === 'rental' && filteredRps.map((rp) => (
              <QItem key={rp.id} selected={selectedId === rp.id} onClick={() => setSelectedId(rp.id)}
                title={providerName(rp, `RP #${rp.id}`)} sub={`${rp.user?.email ?? ''} · registered ${fmtDate(rp.createdAt)}`}
                pills={<><CompliancePill s={rp.complianceStatus} />{waitPill(rp.complianceStatus, rp.createdAt)}{selectedId === rp.id && checksPill(rpChecks)}</>} />
            ))}
            {tab === 'service' && filteredSps.map((sp) => (
              <QItem key={sp.id} selected={selectedId === sp.id} onClick={() => setSelectedId(sp.id)}
                title={spName(sp)} sub={`${sp.user?.email ?? ''} · registered ${fmtDate(sp.createdAt)}`}
                pills={<><CompliancePill s={sp.complianceStatus} />{waitPill(sp.complianceStatus, sp.createdAt)}{selectedId === sp.id && checksPill(spChecks)}</>} />
            ))}
            {tab === 'tenants' && orderedTenants.map((t) => (
              <QItem key={t.id} selected={selectedId === t.id} onClick={() => setSelectedId(t.id)}
                title={providerName(t, `Customer #${t.id}`)} sub={`${t.user?.email ?? ''} · registered ${fmtDate(t.createdAt)}`}
                pills={<><KycStatusPill status={t.user?.kycStatus} />{t.user?.kycStatus === 'pending_review' && <SlaPill iso={t.createdAt} title="Time since the customer registered" />}{t.documentStatus && <Pill tone="outline" dot={false}>Docs {titleize(t.documentStatus)}</Pill>}{selectedId === t.id && tenantChecks && <Pill tone="outline" dot={false}>Verified {tenantChecks}</Pill>}</>} />
            ))}
            {tab === 'managers' && orderedManagers.map((m) => (
              <QItem key={m.id} selected={selectedId === m.id} onClick={() => setSelectedId(m.id)}
                title={m.name} sub={`${m.email} · ${m.landlordCount} landlord${m.landlordCount !== 1 ? 's' : ''}`}
                pills={<><AccountPill status={m.status} /><Pill tone="outline" dot={false}>Since {fmtDate(m.createdAt)}</Pill></>} />
            ))}
            {tab === 'technicians' && filteredTechnicians.map((t) => (
              <QItem key={t.id} selected={selectedId === t.id} onClick={() => setSelectedId(t.id)}
                title={t.name} sub={`${t.provider.name}${t.isSelf ? ' · solo' : ''}${t.documentCount ? ` · ${t.documentCount} doc${t.documentCount === 1 ? '' : 's'}` : ' · no docs'}`}
                pills={<><CompliancePill s={t.complianceStatus} />{waitPill(t.complianceStatus, t.createdAt)}{selectedId === t.id && checksPill(techChecks)}</>} />
            ))}

            {loadedCount < totals[tab] && (tab === 'rental' || tab === 'service' || tab === 'tenants') && (
              <div ref={sentinelRef} className="gx-empty" style={{ padding: 12 }}>
                {loadingMore ? 'Loading more…' : <Btn size="xs" onClick={() => void loadPage(tab, loadedCount, false)}>Load more</Btn>}
              </div>
            )}
            {loadedCount < totals[tab] && tab === 'technicians' && (
              <div className="gx-empty" style={{ padding: 12, fontSize: 11 }}>Showing the first {loadedCount} of {totals[tab]} technicians</div>
            )}
            {loadedCount > 0 && loadedCount >= totals[tab] && (
              <div className="gx-empty" style={{ padding: 12, fontSize: 11 }}>{totals[tab]} {TAB_NOUN[tab]}</div>
            )}
          </div>
        </div>

        <div className="gx-split-r" ref={detailScrollRef}>
          {!hasSelection ? (
            <div className="gx-empty"><b>Nothing selected</b>Pick a record on the left to review its documents and record a decision.</div>
          ) : selectedRp ? (
            <RpPanel rpId={selectedRp.id} detail={rpDetail} loading={rpDetailLoading} error={rpDetailError}
              onRetry={() => setDetailNonce((n) => n + 1)} onStatusChange={handleRpStatusChange} onDocUpdate={handleRpDocUpdate} />
          ) : selectedSp ? (
            <SpPanel sp={selectedSp} spId={selectedSp.id} detail={spDetail} loading={spDetailLoading} error={spDetailError}
              onRetry={() => setDetailNonce((n) => n + 1)} onStatusChange={handleSpStatusChange} onDocUpdate={handleSpDocUpdate} />
          ) : selectedTenant ? (
            <TenantPanel tenant={selectedTenant} detail={tenantDetail} loading={tenantDocsLoading} onDocUpdate={handleTenantDocUpdate} />
          ) : selectedManager ? (
            <ManagerPanel m={selectedManager} />
          ) : selectedTechnician ? (
            <TechnicianPanel t={selectedTechnician} onStatusChange={handleTechnicianChange} onChecks={setTechChecks} />
          ) : null}
        </div>
      </div>
    </OsPage>
  );
}
