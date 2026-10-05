/**
 * Service Provider — Settings (dashboard/service-provider/settings)
 *
 * Mirrors the Rental Provider settings page — same four tabs (Profile, Rules,
 * Team, Notifications), same ?tab= URL persistence, and the SAME design
 * vocabulary (white rounded-2xl shadow-sm cards, #1a1916/#6b6860 type,
 * var(--color-primary) actions) so both portals read as one product.
 *   - Profile:       editable business identity + customer-queries contact +
 *                    account, with the KYC documents checklist embedded
 *                    (compact rows) and an expiry/attention strip.
 *   - Rules:         the SP's operating rules & capacity — the "Get Job-Ready"
 *                    sections (coverage, team skills, vehicles, hours, job
 *                    rules), each an open sub-tab.
 *   - Team:          full roster management (SpTeamPanel) + coverage gaps.
 *   - Notifications: preference toggles (same UI-level fidelity as RP's tab).
 *
 * A landlord's own vendor (tier landlord_vendor) gets two of these, with no
 * tab strip — its nav already has "Profile" and "Technicians": Profile trimmed
 * to business details, account and how it charges; Team as it is. Rules,
 * Notifications, coverage, compliance documents and the platform agreement
 * are marketplace machinery it never uses (owner, 5 Oct 2026: "why we have
 * multiple options like notifications and rules … profile also should be
 * cleaned").
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { SpJobReady, SpTeamSkills, catLabel } from '@/components/upnow/SpJobReady';
import { SpTeamPanel } from '@/components/upnow/SpTeamPanel';
import { KycDocumentsPanel } from '@/components/dashboard/KycDocumentsPanel';
import { PlatformAgreementPanel, fetchAgreementStatus, type AgreementStatus } from '@/components/upnow/PlatformAgreementPanel';
import { apiGet, apiPatch, apiPut } from '@/lib/api';
import {
  BadgeCheck, MessageCircle, User, Percent, Users, Bell, AlertCircle, Loader2, Save,
} from 'lucide-react';

/* ── Tabs (RP parity: Profile · Rules · Team · Notifications) ─────────────── */
type MainTab = 'profile' | 'rules' | 'team' | 'notifications';
const MAIN_TABS: { key: MainTab; label: string; icon: typeof User }[] = [
  { key: 'profile', label: 'Profile', icon: User },
  { key: 'rules', label: 'Rules', icon: Percent },
  { key: 'team', label: 'Team', icon: Users },
  { key: 'notifications', label: 'Notifications', icon: Bell },
];

/* ── Server shapes ────────────────────────────────────────────────────────── */
interface SpProfile {
  businessName?: string | null;
  entityType?: string | null;
  ownerName?: string | null;
  tradeLicenseNumber?: string | null;
  vatTrn?: string | null;
  serviceCategories?: string[] | null;
  emiratesServed?: string[] | null;
  opsContactName?: string | null;
  opsContactPhone?: string | null;
  opsContactWhatsapp?: boolean | null;
  opsContactLanguages?: string[] | null;
  complianceStatus?: string | null;
  tier?: string | null;
}
interface ChecklistItem {
  key: string;
  displayName?: string;
  required?: boolean;
  uploaded?: boolean;
  status?: string | null;
  expiryDate?: string | null;
}
interface JobReadyPeek {
  jobReady: boolean;
  cards: { team: { uncoveredServices: { id: number; name: string; category: string }[] } };
}

const pretty = (code: string) =>
  code.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());

const EMIRATES: { value: string; label: string }[] = [
  { value: 'dubai', label: 'Dubai' },
  { value: 'abu_dhabi', label: 'Abu Dhabi' },
  { value: 'sharjah', label: 'Sharjah' },
  { value: 'ajman', label: 'Ajman' },
  { value: 'ras_al_khaimah', label: 'Ras Al Khaimah' },
  { value: 'fujairah', label: 'Fujairah' },
  { value: 'umm_al_quwain', label: 'Umm Al Quwain' },
];
const CONTACT_LANGUAGES = ['English', 'Arabic', 'Hindi/Urdu', 'Tagalog', 'Other'];

/* ── Small building blocks (RP settings vocabulary) ───────────────────────── */
function Card({ title, description, action, children }: {
  title: string; description?: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-2xl p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="font-semibold text-base text-[#1a1916]">{title}</h2>
          {description && <p className="text-xs text-[#9b9890] mt-0.5">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-xs text-[#9b9890]">{label}</span>
      <span className="min-w-0 truncate text-right text-sm font-medium text-[#1a1916]">{value}</span>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium mb-1 text-[#6b6860]">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-xl px-3 py-2.5 text-sm outline-none border border-[#e6ebe7] focus:border-[#2e9f82] text-[#1a1916]" />
    </label>
  );
}

function TogglePill({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer border ${
        on
          ? 'border-[#2e9f82] text-[#2e9f82] bg-[#2e9f82]/10'
          : 'border-[#e6ebe7] text-[#6b6860] bg-white hover:bg-[#f4f3ef]'
      }`}>
      {label}{on && ' ✓'}
    </button>
  );
}

/* Same toggle as RP settings */
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className={`relative inline-flex rounded-full transition-colors cursor-pointer flex-shrink-0 ${on ? 'bg-[#2e9f82]' : 'bg-[#c9c7c1]'}`}
      style={{ height: 22, width: 40 }}>
      <span className={`inline-block w-4 h-4 rounded-full bg-white shadow transition-transform absolute top-[3px] ${on ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
    </button>
  );
}

function SaveBar({ saving, saved, error, onSave }: {
  saving: boolean; saved: boolean; error: string | null; onSave: () => void;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap mt-4">
      {error && <p className="text-xs text-red-600 flex-1">{error}</p>}
      {saved && !saving && !error && <p className="text-xs text-[#2e9f82] flex-1">Saved.</p>}
      <button
        type="button" onClick={onSave} disabled={saving}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white cursor-pointer disabled:opacity-50 ml-auto"
        style={{ background: 'var(--color-primary)' }}
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Days until expiry — negative = already expired. */
const daysTo = (d: string, now: number) => Math.floor((new Date(d).getTime() - now) / DAY_MS);

/* ── Profile tab (editable + documents inline) ────────────────────────────── */
function ProfileTab() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<SpProfile | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [now] = useState(() => Date.now());

  // Business form
  const [businessName, setBusinessName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [licence, setLicence] = useState('');
  const [trn, setTrn] = useState('');
  const [emirates, setEmirates] = useState<string[]>([]);
  const [bizSaving, setBizSaving] = useState(false);
  const [bizSaved, setBizSaved] = useState(false);
  const [bizError, setBizError] = useState<string | null>(null);

  // Contact form
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState(true);
  const [languages, setLanguages] = useState<string[]>([]);
  const [ctSaving, setCtSaving] = useState(false);
  const [ctSaved, setCtSaved] = useState(false);
  const [ctError, setCtError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ profile?: SpProfile; checklist?: ChecklistItem[] }>('/profiles/service-provider/me')
      .then((d) => {
        const p = d.profile ?? null;
        setProfile(p);
        setChecklist(d.checklist ?? []);
        setBusinessName(p?.businessName ?? '');
        setOwnerName(p?.ownerName ?? '');
        setLicence(p?.tradeLicenseNumber ?? '');
        setTrn(p?.vatTrn ?? '');
        setEmirates(p?.emiratesServed ?? []);
        setContactName(p?.opsContactName ?? '');
        setContactPhone(p?.opsContactPhone ?? '');
        setWhatsapp(p?.opsContactWhatsapp ?? true);
        setLanguages(p?.opsContactLanguages ?? []);
      })
      .catch(() => {});
  }, []);

  const approved = profile?.complianceStatus === 'compliant';
  // v2 (0260): a landlord-invited light account — no marketplace compliance
  // chrome; instead, the optional door INTO the marketplace.
  const lightVendor = profile?.tier === 'landlord_vendor';

  const saveBusiness = async () => {
    if (!businessName.trim()) { setBizError('Business name is required'); return; }
    if (!lightVendor && !emirates.length) { setBizError('Pick at least one emirate'); return; }
    setBizSaving(true); setBizError(null); setBizSaved(false);
    try {
      await apiPatch('/profiles/service-provider/me', {
        businessName: businessName.trim(),
        ownerName: ownerName.trim() || null,
        tradeLicenseNumber: licence.trim() || null,
        vatTrn: trn.trim() || null,
        ...(lightVendor ? {} : { emiratesServed: emirates }),
      });
      setBizSaved(true);
    } catch (e) { setBizError(e instanceof Error ? e.message : 'Failed to save'); }
    finally { setBizSaving(false); }
  };

  const saveContact = async () => {
    const phoneDigits = contactPhone.replace(/[\s-]/g, '');
    if (contactName.trim().length < 2) { setCtError('Contact name is required'); return; }
    if (!/^\+?\d{8,16}$/.test(phoneDigits)) { setCtError('Enter a valid mobile (8–16 digits)'); return; }
    setCtSaving(true); setCtError(null); setCtSaved(false);
    try {
      await apiPatch('/profiles/service-provider/me', {
        opsContactName: contactName.trim(),
        opsContactPhone: phoneDigits,
        opsContactWhatsapp: whatsapp,
        opsContactLanguages: languages,
      });
      setCtSaved(true);
    } catch (e) { setCtError(e instanceof Error ? e.message : 'Failed to save'); }
    finally { setCtSaving(false); }
  };

  // Documents needing attention: rejected, expired, or expiring within 30 days.
  const attention = checklist
    .map((c) => {
      if (c.status === 'rejected') return { key: c.key, name: c.displayName ?? pretty(c.key), why: 'Rejected — re-upload required', level: 'red' as const };
      if (c.uploaded && c.expiryDate) {
        const d = daysTo(c.expiryDate, now);
        if (d < 0) return { key: c.key, name: c.displayName ?? pretty(c.key), why: 'Expired — upload the renewed document', level: 'red' as const };
        if (d <= 30) return { key: c.key, name: c.displayName ?? pretty(c.key), why: `Expires in ${d} day${d === 1 ? '' : 's'}`, level: 'amber' as const };
      }
      return null;
    })
    .filter(Boolean) as Array<{ key: string; name: string; why: string; level: 'red' | 'amber' }>;

  return (
    <div className="space-y-6">
      {lightVendor && <VendorRateCard />}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        {/* Business profile — editable */}
        <Card
          title={lightVendor ? 'Business details' : 'Business Profile'}
          description={lightVendor ? 'As on your trade licence.' : 'Your legal identity on UpNow — keep it matching your trade licence.'}
          action={approved ? (
            <span className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold bg-[#2e9f82]/10 text-[#2e9f82]">
              <BadgeCheck size={13} /> Verified
            </span>
          ) : undefined}
        >
          <div className="space-y-3">
            <Field label="Business name" value={businessName} onChange={setBusinessName} placeholder="Trading name" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Owner / signatory" value={ownerName} onChange={setOwnerName} placeholder="Full name" />
              <label className="block">
                <span className="block text-xs font-medium mb-1 text-[#6b6860]">Entity type</span>
                <span className="flex h-[42px] items-center rounded-xl px-3 text-sm font-medium bg-[#f6f7f4] text-[#6b6860]">
                  {profile?.entityType ? pretty(profile.entityType) : '—'}
                </span>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Trade licence no." value={licence} onChange={setLicence} placeholder="e.g. CN-1234567" />
              <Field label="VAT TRN (optional)" value={trn} onChange={setTrn} placeholder="100XXXXXXXXXXXX" />
            </div>
            {!lightVendor && <div>
              <span className="block text-xs font-medium mb-1.5 text-[#6b6860]">Emirates served</span>
              <div className="flex flex-wrap gap-1.5">
                {EMIRATES.map((em) => (
                  <TogglePill key={em.value} label={em.label} on={emirates.includes(em.value)}
                    onClick={() => setEmirates((s) => s.includes(em.value) ? s.filter((v) => v !== em.value) : [...s, em.value])} />
                ))}
              </div>
              <p className="text-xs text-[#9b9890] mt-1.5">
                Zones for each city are picked in <b>Rules → Coverage</b>.
              </p>
            </div>}
            {!lightVendor && (profile?.serviceCategories?.length ?? 0) > 0 && (
              <div>
                <span className="block text-xs font-medium mb-1.5 text-[#6b6860]">Service categories</span>
                <div className="flex flex-wrap gap-1.5">
                  {(profile!.serviceCategories!).map((c) => (
                    <span key={c} className="rounded-full px-2.5 py-1 text-xs font-medium bg-[#f6f7f4] text-[#1a1916]">{catLabel(c)}</span>
                  ))}
                </div>
                <p className="text-xs text-[#9b9890] mt-1.5">
                  Change what you offer in{' '}
                  <Link href="/dashboard/service-provider/services" className="font-medium underline text-[#2e9f82]">My Services</Link>.
                </p>
              </div>
            )}
          </div>
          <SaveBar saving={bizSaving} saved={bizSaved} error={bizError} onSave={() => void saveBusiness()} />
        </Card>

        <div className="space-y-6">
          {/* Customer queries contact — editable (marketplace bookings only) */}
          {!lightVendor && <Card
            title="Customer Queries Contact"
            description="Customers and UpNow support reach this person about bookings."
          >
            <div className="space-y-3">
              <Field label="Name" value={contactName} onChange={setContactName} placeholder="Contact name" />
              <label className="block">
                <span className="block text-xs font-medium mb-1 text-[#6b6860]">Mobile</span>
                <div className="flex gap-2">
                  <span className="flex items-center rounded-xl px-3 text-sm font-medium bg-[#f6f7f4] text-[#6b6860]">+971</span>
                  <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} inputMode="tel" placeholder="50 712 3482"
                    className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm outline-none border border-[#e6ebe7] focus:border-[#2e9f82] text-[#1a1916]" />
                </div>
              </label>
              <div className="flex items-center justify-between rounded-xl px-3 py-2.5 border border-[#e6ebe7]">
                <span className="flex items-center gap-2 text-sm font-medium text-[#1a1916]">
                  <MessageCircle size={14} className="text-[#2e9f82]" /> Available on WhatsApp
                </span>
                <Toggle on={whatsapp} onChange={setWhatsapp} />
              </div>
              <div>
                <span className="block text-xs font-medium mb-1.5 text-[#6b6860]">Languages</span>
                <div className="flex flex-wrap gap-1.5">
                  {CONTACT_LANGUAGES.map((lang) => (
                    <TogglePill key={lang} label={lang} on={languages.includes(lang)}
                      onClick={() => setLanguages((ls) => ls.includes(lang) ? ls.filter((l) => l !== lang) : [...ls, lang])} />
                  ))}
                </div>
              </div>
            </div>
            <SaveBar saving={ctSaving} saved={ctSaved} error={ctError} onSave={() => void saveContact()} />
          </Card>}

          {/* Account */}
          <Card title="Account">
            <Row label="Email" value={user?.email ?? '—'} />
            {user?.phone && <Row label="Phone" value={user.phone} />}
            <Row label="Role" value="Service Provider" />
            {!lightVendor && <Row
              label="Review status"
              value={approved
                ? <span className="text-[#2e9f82]">Approved</span>
                : pretty(profile?.complianceStatus ?? 'pending_review')}
            />}
          </Card>

          {/* SP-252 — the platform agreement: read it again, see when you accepted, the record of every version.
              A light vendor is never asked to accept it (SpOnboardingGate), so it is not shown one. */}
          {!lightVendor && <PlatformAgreementCard />}
        </div>
      </div>

      {/* Documents — same page, with expiry tracking (marketplace compliance: "pause new bookings") */}
      {!lightVendor && <div>
        {attention.length > 0 && (
          <div className="mb-4 rounded-2xl px-5 py-4 bg-red-50 border border-red-200">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-red-700">
              <AlertCircle size={15} /> {attention.length} document{attention.length === 1 ? '' : 's'} need{attention.length === 1 ? 's' : ''} attention
            </p>
            <div className="mt-1.5 space-y-1">
              {attention.map((a) => (
                <p key={a.key} className={`text-xs ${a.level === 'red' ? 'text-red-700' : 'text-amber-700'}`}>
                  <b>{a.name}</b> — {a.why}
                </p>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-[#6b6860]">
              Expired or rejected documents pause new bookings — replace them below.
            </p>
          </div>
        )}

        <Card title="Documents" description="Everything compliance needs — replace a file any time; expiring ones warn you here first.">
          {/* compact = dense one-row-per-doc (View · Upload/Replace inline);
              the full card layout stays on the dedicated /documents page. */}
          <KycDocumentsPanel
            profileApiPath="/profiles/service-provider/me"
            ownerType="service_provider"
            compact
          />
        </Card>
      </div>}
    </div>
  );
}

/* ── Team tab — roster, coverage gaps and skills all in ONE place ─────────── */
function PlatformAgreementCard() {
  const [status, setStatus] = useState<AgreementStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    fetchAgreementStatus().then(setStatus).catch(() => setStatus(null)).finally(() => setLoaded(true));
  }, []);
  if (!loaded) return null;
  return (
    <Card
      title="Platform agreement"
      description={status?.agreement
        ? 'The terms you work under on UpNow. Every acceptance is kept on record with the version you agreed to.'
        : 'No platform agreement has been published yet — you will be asked to accept it here when it is.'}
    >
      {status?.agreement ? (
        <div className="space-y-3">
          <PlatformAgreementPanel status={status} context="settings" compact onAccepted={(_a, next) => setStatus(next)} />
          {status.history.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8a8780] mb-1.5">Your acceptance record</p>
              <ul className="space-y-1">
                {status.history.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 text-xs text-[#4a4843]">
                    <span>v{h.agreementVersion} <span className="text-[#8a8780]">· {h.context}</span></span>
                    <span className="text-[#8a8780]">{new Date(h.acceptedAt).toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dubai' })}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-[#8a8780]">Nothing to accept right now.</p>
      )}
    </Card>
  );
}

function TeamTab() {
  const [peek, setPeek] = useState<JobReadyPeek | null>(null);

  useEffect(() => {
    apiGet<JobReadyPeek>('/service-provider/job-ready').then(setPeek).catch(() => {});
  }, []);

  const uncovered = peek?.cards.team.uncoveredServices ?? [];
  // Group the gaps by category — scannable, instead of a wall of chips.
  const gapGroups = uncovered.reduce<Array<{ category: string; items: string[] }>>((acc, s) => {
    const g = acc.find((x) => x.category === s.category);
    if (g) g.items.push(s.name);
    else acc.push({ category: s.category, items: [s.name] });
    return acc;
  }, []);

  return (
    <div className="max-w-4xl space-y-6">
      {/* Full roster management (formerly the /team page) */}
      <SpTeamPanel />

      {uncovered.length > 0 && (
        <section className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 px-6 py-4 bg-red-50 border-b border-red-100">
            <AlertCircle size={16} className="shrink-0 text-red-600" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-700">
                {`${uncovered.length} listed service${uncovered.length === 1 ? '' : 's'} can't receive bookings yet`}
              </p>
              <p className="text-xs text-[#6b6860] mt-0.5">
                No lead-capable technician holds these skills — assign them in the skills section below and dispatch resumes instantly.
              </p>
            </div>
          </div>
          <div className="divide-y divide-[#f0efeb]">
            {gapGroups.map((g) => (
              <div key={g.category} className="flex items-baseline gap-4 px-6 py-3">
                <span className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wide text-[#9b9890]">
                  {catLabel(g.category)}
                </span>
                <p className="text-sm text-[#1a1916] leading-relaxed">
                  {g.items.join(' · ')}
                </p>
                <span className="ml-auto shrink-0 text-xs text-[#9b9890]">{g.items.length}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Skills & dispatch readiness — the job-ready Team card, moved here from
          Rules so "Team" exists in exactly one place. */}
      <SpTeamSkills />
    </div>
  );
}

/* ── Notifications tab (same UI-level fidelity as RP's tab) ───────────────── */
type NotifKey = 'newBookingRequest' | 'jobReminder' | 'documentExpiry' | 'reviewAlert' | 'promotional';
const NOTIF_LABELS: Record<NotifKey, { title: string; description: string }> = {
  newBookingRequest: { title: 'New booking requests', description: 'Notify when a new job request lands in your pipeline' },
  jobReminder:       { title: 'Job reminders',        description: 'Remind before a scheduled job is due to start' },
  documentExpiry:    { title: 'Document expiry',      description: 'Warn before a trade licence or document expires' },
  reviewAlert:       { title: 'New reviews',          description: 'Notify when a customer leaves a rating or review' },
  promotional:       { title: 'Platform news',        description: 'Product updates and feature announcements from UpNow' },
};
const NOTIF_KEYS: NotifKey[] = ['newBookingRequest', 'jobReminder', 'documentExpiry', 'reviewAlert', 'promotional'];

function NotificationsTab() {
  const [notifs, setNotifs] = useState<Record<NotifKey, boolean>>({
    newBookingRequest: true, jobReminder: true, documentExpiry: true, reviewAlert: true, promotional: false,
  });
  return (
    <div className="max-w-3xl">
      <div className="bg-white rounded-2xl p-6 shadow-sm">
        <h2 className="font-semibold text-base text-[#1a1916] mb-1">Notification Preferences</h2>
        <p className="text-xs text-[#9b9890] mb-4">Choose which updates you want to be notified about.</p>
        <div className="space-y-4">
          {NOTIF_KEYS.map((key) => (
            <div key={key} className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm font-medium text-[#1a1916]">{NOTIF_LABELS[key].title}</p>
                <p className="text-xs text-[#9b9890]">{NOTIF_LABELS[key].description}</p>
              </div>
              <Toggle on={notifs[key]} onChange={(v) => setNotifs((prev) => ({ ...prev, [key]: v }))} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */
/** The light-tier flag SpOnboardingGate records (same source as the nav). Read
 *  after mount so server and first client render agree. */
function useLightVendor(): boolean {
  const [light, setLight] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read of the gate's tier flag after hydration
    try { setLight(sessionStorage.getItem('sp_tier') === 'landlord_vendor'); } catch { /* not light */ }
    const on = (e: Event) => setLight((e as CustomEvent<string>).detail === 'landlord_vendor');
    window.addEventListener('sp-tier', on);
    return () => window.removeEventListener('sp-tier', on);
  }, []);
  return light;
}
const LIGHT_TABS: MainTab[] = ['profile', 'team'];

export default function ServiceProviderSettingsPage() {
  const [mainTab, setMainTab] = useState<MainTab>('profile');
  const light = useLightVendor();
  // A light vendor has only Profile and Team — a stale ?tab=rules lands on Profile.
  const tab: MainTab = light && !LIGHT_TABS.includes(mainTab) ? 'profile' : mainTab;

  // Persist the active tab in the URL (?tab=) — same pattern as RP settings:
  // restore on mount, replaceState on switch (no history spam). Restoring in
  // an effect (not a lazy initializer) keeps server and first client render
  // identical, avoiding a hydration mismatch.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot ?tab= restore after hydration
    if (t && MAIN_TABS.some((m) => m.key === t)) setMainTab(t as MainTab);
  }, []);
  const selectTab = (t: MainTab) => {
    setMainTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', t);
    window.history.replaceState(null, '', url.toString());
  };

  return (
    <div className="p-6">
      {/* Header — a light vendor reaches each section from its own nav item, so the page is named for it */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1a1916]">{light ? (tab === 'team' ? 'Technicians' : 'Profile') : 'Settings'}</h1>
        <p className="text-sm text-[#6b6860] mt-0.5">
          {light
            ? (tab === 'team' ? 'The people who work your jobs.' : 'Your business details and how you charge.')
            : 'Manage your business profile, operating rules, team and preferences.'}
        </p>
      </div>

      {/* Top-level tabs — same construction as RP settings (none for a light vendor: its nav is the switch) */}
      {!light && <div className="flex gap-1 bg-white rounded-xl p-1 shadow-sm border border-[#e8e6e0] mb-6 w-fit max-w-full flex-wrap">
        {MAIN_TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => selectTab(key)}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
              tab === key ? 'bg-[#2e9f82] text-white' : 'text-[#6b6860] hover:bg-[#f4f3ef]'
            }`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>}

      {tab === 'profile' && <ProfileTab />}
      {tab === 'rules' && (
        <div className="max-w-3xl">
          <SpJobReady />
        </div>
      )}
      {tab === 'team' && <TeamTab />}
      {tab === 'notifications' && <NotificationsTab />}
    </div>
  );
}

/** The vendor's own rate card (maintenance v2, 0263): the landlord decides if
 *  and who pays; the vendor decides how much — none (at cost), hourly, or
 *  quote per job, per category. Saves per click. */
function VendorRateCard() {
  const [rows, setRows] = useState<{ categoryGroupId: number; group: string; mode: 'none' | 'hourly' | 'quote'; hourlyRateAed: number | null }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = () => { apiGet<typeof rows>('/maintenance/my-pricing').then(r => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([])); };
  useEffect(() => { load(); }, []);
  const save = async (categoryGroupId: number, mode: 'none' | 'hourly' | 'quote', rate?: number) => {
    setBusy(true); setErr(null);
    try { await apiPut('/maintenance/my-pricing', { rows: [{ categoryGroupId, mode, ...(mode === 'hourly' ? { hourlyRateAed: rate } : {}) }] }); load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ background: '#fff', border: '1px solid #E4E7E2', borderRadius: 14, padding: '16px 18px', marginBottom: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#182420' }}>How you charge</div>
      <p style={{ fontSize: 13, color: '#55645B', margin: '4px 0 10px', lineHeight: 1.5 }}>
        Per kind of work: <b>None</b> — you work at cost (own team) · <b>Hourly</b> — your time at your rate · <b>Quote</b> — you price each job after seeing it. Landlords see this on your card.
      </p>
      {err && <p style={{ fontSize: 12.5, color: '#b42318', margin: '0 0 8px' }}>{err}</p>}
      {rows == null ? <p style={{ fontSize: 13, color: '#8A968D' }}>Loading…</p> : rows.map(r => (
        <div key={r.categoryGroupId} style={{ display: 'grid', gridTemplateColumns: '1.2fr auto 1fr', gap: 12, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #EEF1EE' }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: '#182420' }}>{r.group}</span>
          <span style={{ display: 'inline-flex', border: '1px solid #E4E7E2', borderRadius: 10, overflow: 'hidden' }}>
            {(['none', 'hourly', 'quote'] as const).map((m, i) => (
              <button key={m} type="button" disabled={busy}
                onClick={() => { if (m !== 'hourly') void save(r.categoryGroupId, m); else { const v = window.prompt(`${r.group} — your hourly rate (AED/h)`, String(r.hourlyRateAed ?? 120)); if (v && Number(v) > 0) void save(r.categoryGroupId, 'hourly', Number(v)); } }}
                style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', borderLeft: i > 0 ? '1px solid #E4E7E2' : 'none', background: r.mode === m ? '#0B7A4E' : '#fff', color: r.mode === m ? '#fff' : '#55645B' }}>
                {m === 'none' ? 'None' : m === 'hourly' ? 'Hourly' : 'Quote'}
              </button>
            ))}
          </span>
          <span style={{ fontSize: 12.5, color: '#8A968D' }}>{r.mode === 'hourly' && r.hourlyRateAed ? `AED ${r.hourlyRateAed}/h` : '—'}</span>
        </div>
      ))}
    </div>
  );
}
