'use client';

/**
 * Business › Profile & verification — Genspark OS rebuild of RP → My Profile.
 *
 * Parity with previous page (the previous page was `<RpSettings view="profile" />`):
 *  - The whole editable business profile is REUSED UNCHANGED below the new summary,
 *    rendered outside the `.gx` scope so its own Tailwind styling is untouched:
 *      · business profile form (individual/company, company type, parent brokerage,
 *        legal name, trade licence, Emirates ID, nationality, signatory, VAT TRN,
 *        addresses, avatar) → PATCH /api/profiles/rental-provider/me
 *      · email / phone change with OTP (PATCH /auth/me + OTP request/verify)
 *      · KYC Documents (KycDocumentsPanel: presigned upload, expiry, secure viewer)
 *      · Authorised signatory & Power of Attorney (+ POA document pack)
 *      · Banking details (multiple accounts)
 *    Only its duplicate "My Profile" heading is hidden (CSS, below) — the kit PageHead replaces it.
 *  - New on top (read-only, same endpoint): GET /api/profiles/rental-provider/me
 *    → Business profile KV grid + "Gate 1 · Business verification" card
 *    (complianceStatus pill, complianceNotes, checklist of required documents and
 *    profile checks). Refetched on Refresh, on tab focus, and after edits.
 *  - "Edit business profile" scrolls to the reused editor; "Documents & licences"
 *    → /rental-provider/dashboard/documents; "Vertical authorisations" →
 *    /rental-provider/dashboard/authorisations.
 *  - /prototype/os/rp/profile re-exports this page; no manager route uses it.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { apiGet } from '@/lib/api';
import {
  Btn, Callout, Card, Checklist, Cols, Evid, KV, OsPage, PageHead, Pill, ScopeStrip, humanize, type Tone,
} from '@/components/os/kit';
import type { KycChecklistItem } from '@/components/dashboard/KycDocumentsPanel';
import { RpSettings } from '../settings/page';

interface BankAccount { accountName?: string | null; bankName?: string | null; iban?: string | null; accountNumber?: string | null }
interface RpProfile {
  entityType?: string | null; companyType?: string | null; companyName?: string | null; parentBrokerageName?: string | null;
  tradeLicenseNumber?: string | null; tradeLicenseAuthority?: string | null; vatTrn?: string | null;
  authorizedSignatoryName?: string | null; hasPoa?: boolean | null; poaPersonName?: string | null;
  poaPersonEmail?: string | null; poaPersonPhone?: string | null; poaStatus?: string | null;
  bankAccounts?: BankAccount[] | null; bankAccountStatus?: string | null; documentStatus?: string | null;
  contactAddress?: string | null; legalNoticesAddress?: string | null;
  complianceStatus?: string | null; complianceNotes?: string | null; accountTypeConfirmedAt?: string | null;
}
interface ProfileResp { profile: RpProfile; checklist?: KycChecklistItem[] }

const GATE1: Record<string, { l: string; tone: Tone }> = {
  compliant: { l: 'Verified', tone: 'primary' },
  pending_review: { l: 'In review', tone: 'amber' },
  action_required: { l: 'Action required', tone: 'amber' },
  expired: { l: 'Expired', tone: 'danger' },
  paused: { l: 'Paused', tone: 'danger' },
};
const COMPANY_TYPE: Record<string, string> = { landlord: 'Landlord company', brokerage: 'Brokerage', agents: 'Agents company' };
const DOC_STATE: Record<string, { s: 'pass' | 'fail' | 'wait'; l: string }> = {
  processed: { s: 'pass', l: 'Verified' }, complete: { s: 'pass', l: 'Verified' },
  attached: { s: 'wait', l: 'Uploaded — pending review' }, pending: { s: 'wait', l: 'Requested' },
  rejected: { s: 'fail', l: 'Rejected — re-upload required' }, expired: { s: 'fail', l: 'Expired — re-upload' },
};
const maskIban = (v?: string | null) => (v ? `${v.slice(0, 4)} •••• ${v.slice(-4)}` : null);
const statusCheck = (v?: string | null): 'pass' | 'fail' | 'wait' => (v === 'complete' ? 'pass' : v === 'missing' || v === 'incomplete' ? 'fail' : 'wait');

export default function RpProfilePage() {
  const { user } = useAuth();
  const [data, setData] = useState<ProfileResp | null>(null);
  const [err, setErr] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true); setErr(false);
    apiGet<ProfileResp>('/profiles/rental-provider/me')
      .then(setData).catch(() => setErr(true)).finally(() => setLoading(false));
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
  useEffect(() => { load(); }, [load]);
  // The editor below saves on its own; refresh the summary when the person comes back to the tab.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('focus', onVis);
    document.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('focus', onVis); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  const p = data?.profile;
  const isCompany = p?.entityType === 'company';
  const gate = GATE1[p?.complianceStatus ?? ''] ?? (p?.complianceStatus ? { l: humanize(p.complianceStatus), tone: 'neutral' as Tone } : { l: 'Not submitted', tone: 'neutral' as Tone });
  const bank = (p?.bankAccounts ?? []).find((b) => b.iban || b.accountNumber) ?? null;
  const required = (data?.checklist ?? []).filter((c) => c.required);
  const passed = required.filter((c) => DOC_STATE[c.status ?? '']?.s === 'pass').length;

  const toEditor = () => document.getElementById('rp-profile-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const checks: { l: string; sub?: string; state: 'pass' | 'fail' | 'wait' }[] = [
    ...required.map((c) => {
      const st = c.uploaded ? (DOC_STATE[c.status ?? ''] ?? { s: 'wait' as const, l: 'Uploaded' }) : { s: 'fail' as const, l: 'Not uploaded' };
      return { l: c.displayName, sub: `${humanize(c.category)} · ${st.l}${c.expiryDate ? ` · expires ${new Date(c.expiryDate).toLocaleDateString('en-GB', { timeZone: 'Asia/Dubai' })}` : ''}`, state: st.s };
    }),
    ...(p ? [
      { l: 'Account type confirmed', sub: p.accountTypeConfirmedAt ? 'Confirmed in onboarding' : 'Finish onboarding step 2', state: p.accountTypeConfirmedAt ? 'pass' as const : 'fail' as const },
      { l: 'Email verified', sub: user?.email ?? undefined, state: user?.emailVerified ? 'pass' as const : 'fail' as const },
      { l: 'Phone verified', sub: user?.phone ?? 'No phone on file', state: user?.phoneVerified ? 'pass' as const : 'fail' as const },
      { l: 'Banking details', sub: p.bankAccountStatus ? humanize(p.bankAccountStatus) : bank ? 'On file' : 'No account on file', state: p.bankAccountStatus ? statusCheck(p.bankAccountStatus) : bank ? 'pass' as const : 'fail' as const },
      ...(p.hasPoa ? [{ l: 'Power of Attorney', sub: p.poaStatus ? humanize(p.poaStatus) : 'Pending', state: statusCheck(p.poaStatus) }] : []),
    ] : []),
  ];

  return (
    <>
      <OsPage className="!pb-4">
        <PageHead
          eyebrow="Business"
          title="Profile & verification"
          lede="Who your business is on UpNow, and where it stands in business verification (Gate 1). Edit details, documents and banking below."
          actions={<>
            <Btn size="sm" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</Btn>
            <Btn size="sm" href="/rental-provider/dashboard/documents">Documents & licences</Btn>
            <Btn size="sm" variant="primary" onClick={toEditor}>Edit business profile</Btn>
          </>}
        />
        <ScopeStrip items={[
          { label: 'Workspace', value: 'Business' },
          { label: 'Gate', value: 'Gate 1 · Business verification' },
          { label: 'Status', value: <Pill tone={gate.tone}>{gate.l}</Pill> },
          { label: 'Required documents', value: required.length ? `${passed} of ${required.length} verified` : '—' },
        ]} />

        {err && (
          <div style={{ marginBottom: 14 }}>
            <Callout tone="bad" title="Couldn't load your profile summary.">
              The editor below may still work. <Btn size="xs" onClick={load}>Try again</Btn>
            </Callout>
          </div>
        )}

        <Cols kind="2">
          <Card title="Business profile" sub={isCompany ? 'Company account' : p ? 'Individual account' : undefined} right={<Btn size="xs" onClick={toEditor}>Edit details</Btn>} pad>
            {!p ? <div className="gx-skel" style={{ height: 120 }} aria-busy="true" /> : (
              <KV items={[
                { k: isCompany ? 'Legal name' : 'Name', v: (isCompany ? p.companyName : user?.name) || '—' },
                { k: 'Entity type', v: isCompany ? `Company${p.companyType ? ` · ${COMPANY_TYPE[p.companyType] ?? humanize(p.companyType)}` : ''}` : 'Individual' },
                ...(p.companyType === 'agents' ? [{ k: 'Parent brokerage', v: p.parentBrokerageName || '—' }] : []),
                ...(isCompany ? [
                  { k: 'Trade licence', v: p.tradeLicenseNumber || '—' },
                  { k: 'Licensing authority', v: p.tradeLicenseAuthority || '—' },
                  { k: 'Authorised signatory', v: p.authorizedSignatoryName || '—' },
                ] : []),
                { k: 'Power of Attorney', v: p.hasPoa ? `${p.poaPersonName || 'POA holder'}${p.poaStatus ? ` · ${humanize(p.poaStatus)}` : ''}` : 'None' },
                { k: 'VAT TRN', v: p.vatTrn || 'Not VAT-registered' },
                { k: 'Bank', v: bank ? [bank.bankName, maskIban(bank.iban) ?? bank.accountNumber].filter(Boolean).join(' · ') : '—' },
                { k: 'Account name', v: bank?.accountName || '—' },
                { k: 'Email', v: user?.email || '—' },
                { k: 'Phone', v: user?.phone || '—' },
                { k: 'Contact address', v: p.contactAddress || '—' },
                { k: 'Legal notices address', v: p.legalNoticesAddress || '—' },
              ]} />
            )}
          </Card>

          <Card title="Gate 1 · Business verification" sub="Reviewed by UpNow Admin" right={<Pill tone={gate.tone}>{gate.l}</Pill>} pad>
            {p?.complianceNotes && p.complianceStatus !== 'compliant' && (
              <div style={{ marginBottom: 10 }}><Callout tone="warn" title="Admin note:">{p.complianceNotes}</Callout></div>
            )}
            {!data ? <div className="gx-skel" style={{ height: 120 }} aria-busy="true" />
              : checks.length ? <Checklist items={checks} />
              : <Evid>No verification checks returned for this account yet.</Evid>}
            <div style={{ marginTop: 12 }}>
              <Evid tone="warn">
                <strong>Verified is not authorised.</strong> Gate 1 proves who your business is. Each vertical you operate
                still needs its own licence-based authorisation (Gate 2).{' '}
                <Btn size="xs" href="/rental-provider/dashboard/authorisations">Open Vertical authorisations</Btn>
              </Evid>
            </div>
          </Card>
        </Cols>
      </OsPage>

      {/* The existing profile editor, reused unchanged (outside .gx so its own styles apply). */}
      <section id="rp-profile-editor" className="rp-profile-editor" style={{ maxWidth: 1420, scrollMarginTop: 16 }}>
        <style>{`.rp-profile-editor > .p-6 { padding-top: 0; } .rp-profile-editor > .p-6 > .mb-6:first-child { display: none; }`}</style>
        <div className="px-[22px] pt-2 pb-1">
          <h2 className="text-[15px] font-bold text-[#14201a]">Edit profile, documents & banking</h2>
          <p className="text-xs text-[#5f6b63]">Changes save from each section. The summary above refreshes when you return to this tab, or with Refresh.</p>
        </div>
        <RpSettings view="profile" />
      </section>
    </>
  );
}
