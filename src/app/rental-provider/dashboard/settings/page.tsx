'use client';

/**
 * Settings — Genspark OS rebuild of the landlord's Settings workspace
 * (/rental-provider/dashboard/settings) and, through the same component, My Profile
 * (/rental-provider/dashboard/profile renders <RpSettings view="profile"/>).
 *
 * Parity with previous page (every item kept, same endpoints and payloads):
 *  Section menu + deep links
 *  - Left section list (now a kit Card), grouped Leasing / Maintenance / Buildings /
 *    Contracts / Legal / Account; same labels (Rules, Coverage, Items, Restoration list,
 *    Building inspections, AMC categories, Periods & fees, Team, Email, WhatsApp,
 *    Notifications). WhatsApp entry hidden unless useWhatsappEnabled().
 *  - ?tab=<fee_rules|maintenance|maintenance_list|restoration|building_inspections|
 *    categories|legal|team|email|whatsapp|notifications> restored on mount; switching
 *    writes ?tab= with history.replaceState. Every link into settings found in the repo
 *    (tab=team / maintenance / categories / building_inspections / fee_rules / email /
 *    whatsapp / notifications, and the bare /settings) still lands on the same section.
 *    New: #hash deep links scroll to a card (e.g. ?tab=fee_rules#rules-market-review).
 *  - view="profile" (My Profile page): no menu, the business profile alone.
 *  Rules (fee_rules)
 *  - GET /api/fee-rules (on entering the tab) → per category map over UAE_DEFAULTS
 *    (residential, commercial, industrial, land, mixed_use kept for back-compat).
 *  - PUT /api/fee-rules { spaceCategory, rules: FEE_ORDER.map(rule) } — "Save changes"
 *    and the preview's "Save <Category> · <New|Renewal>" button.
 *  - Property type switch (Residential / Commercial / Industrial / Land — no Mixed-use tab)
 *    + the mixed-use explainer; New / Renewal contract switch, renewal banner; security
 *    deposit not applied on renewals. Fee rows: on/off, AED vs % of rent, value, No VAT
 *    vs +5% VAT; VAT on Rent row (Exempt / rate → vatApplicable + vatRate, value 0).
 *    Fee maths unchanged (base, VAT, total; rent VAT excluded from upfront total and
 *    shown as a recurring note). "Reset/Load UAE defaults". Live preview with annual rent.
 *  - Renewal: Annual rent increment — PATCH /api/profiles/rental-provider/me
 *    { renewalRentIncrementPct } (0–100 or null) with preview.
 *  - Contract Start Days { preferredStartDays }, Cheque Due Days { preferredChequeDays }
 *    (1–28 chips, Clear all, Save).
 *  - Penalty & charge rules (9 rules): toggle + mode (Fixed / % / Months / Daily) + value,
 *    same validation messages, same _Enabled/_Fee/_Pct/_Months/_Daily payload, one Save each.
 *  - Payment Installment Plans { allowedInstallments | null }, Clear all, Save Plans.
 *  - Rent VAT collection { rentVatMode } saved on click.
 *  - Market Rate Review { marketRateReviewPeriod, marketRateReviewDueDay } (1–28) + schedule line.
 *  - Bills from Email { billsEmailCheckEveryHours }.
 *  - WhatsApp Reminders: GET /api/whatsapp/chats?kind=group&pageSize=100, GET
 *    /api/amc/reminders/preview, PATCH { remindersWhatsappChatId, remindersSendAt },
 *    POST /api/amc/reminders/send ("Send now"), last-post line, both message previews.
 *  Embedded sections (child components REUSED unchanged, same props)
 *  - MaintenanceCoveragePanel, MaintenanceListWorkspace embedded, RestorationListWorkspace
 *    embedded, BuildingInspectionsSettings embedded, AmcCategoriesView (base /amc,
 *    listHref /rental-provider/dashboard/amc, embedded), JurisdictionSettingsForm
 *    (legalApi.config('/legal') / updateRpConfig / resetRpConfig) + FeeBookEditor,
 *    TeamPanel, EmailSettingsPanel, WhatsAppSettingsPanel (only when WhatsApp is on),
 *    BrowserAlertsCard, KycDocumentsPanel (×2). They are Tailwind components, so they are
 *    rendered OUTSIDE the .gx reset scope (whose unlayered element resets would override
 *    their utilities); kit-built cards each carry their own .gx scope.
 *  Notifications
 *  - Customer Correspondence CC list (max 5, validation, Enter/comma adds, "Add my account
 *    email", Save → PATCH { ccEmails | null }, same saved / cleared / none copy).
 *  - Notification Preferences: GET /api/notifications/preferences, PUT
 *    { eventCode, inAppEnabled, emailEnabled } on toggle with revert on failure; only
 *    WIRED_NOTIF_KEYS rendered.
 *  Profile (view="profile")
 *  - GET /api/profiles/rental-provider/me seeds everything above + profile fields.
 *  - Save Profile → PATCH profile { entityType, contactAddress, company/individual fields,
 *    companyType, parentBrokerageName, legalNoticesAddress, vatTrn } then PATCH /api/auth/me
 *    { phone } when changed, then refresh() and KYC panel reload.
 *  - KYC Documents (excludes POA keys, downloadable); Authorized Signatory & POA card
 *    (toggle persists hasPoa at once; Save Signatory & POA; inline POA documents);
 *    "Invite as manager" → modal with editable PERM_GROUPS permissions (POA defaults,
 *    reset) → POST /api/invitations { email, firstName, lastName, phone, role: 'manager',
 *    metadata }; Banking Details (multiple accounts, Primary = first, add / remove,
 *    blank rows dropped) → PATCH { bankAccounts }.
 *  - Avatar, Website and About were local-only before (never in any payload); they stay
 *    local-only and now say so in a hint instead of looking saved.
 *  Dropped
 *  - The "Invite Team Member" modal: nothing ever opened it (no setShowInvite(true)) and
 *    its submit was a 600 ms timeout that saved nothing. Team invites live in TeamPanel.
 *  Manager portal: /dashboard/manager/settings is its own page and imports nothing from
 *  this file. /prototype/os/rp/settings re-exports the default export; the profile page
 *  imports RpSettings — both exports are kept.
 */

import { useState, useEffect, useRef, useCallback, type ReactNode, type CSSProperties } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  MessageCircle, Save, Send, X, Loader2, Plus, Percent, RotateCcw, Camera, Mail, Building2, User, Users, Lock,
  Bell, Wrench, ClipboardList, ClipboardCheck, Receipt, FileSignature, Scale,
} from 'lucide-react';
import { TeamPanel, PERM_GROUPS, metaDefaults } from '@/components/dashboard/rp/TeamPanel';
import { EmailSettingsPanel } from '@/components/email/EmailSettingsPanel';
import { WhatsAppSettingsPanel } from '@/components/whatsapp/WhatsAppSettingsPanel';
import { useWhatsappEnabled } from '@/lib/useWhatsappEnabled';
import { BrowserAlertsCard } from '@/components/dashboard/BrowserAlertsCard';
import { MaintenanceCoveragePanel } from '@/components/dashboard/rp/MaintenanceCoveragePanel';
import { JurisdictionSettingsForm } from '@/components/legal/JurisdictionSettingsForm';
import { FeeBookEditor } from '@/components/legal/FeeBookEditor';
import { legalApi } from '@/lib/legal';
import { MaintenanceListWorkspace } from '../maintenance-list/page';
import { RestorationListWorkspace } from '../restoration-list/page';
import { BuildingInspectionsSettings } from '@/components/upnow/BuildingInspectionsSettings';
import { AmcCategoriesView } from '@/components/amc/AmcCategoriesView';
import { KycDocumentsPanel } from '@/components/dashboard/KycDocumentsPanel';
import { INSTALLMENT_PLANS, installmentLabel } from '@/lib/installmentPlans';
import { categoryDisplayLabel } from '@/components/upnow/PropertyFormModal';
import { PageHead, ScopeStrip, Card, Pill, Btn, Callout, Evid, KV, Modal, Field } from '@/components/os/kit';

/* ─────────────────────────────────────────────────────────────
   General settings types
───────────────────────────────────────────────────────────── */
type NotifKey = 'newInquiry' | 'chequeReminder' | 'renewalAlert' | 'maintenanceUpdate' | 'promotional';

const NOTIF_LABELS: Record<NotifKey, { title: string; description: string }> = {
  newInquiry:        { title: 'New Inquiries',       description: 'Notify when a new lead or inquiry is received' },
  chequeReminder:    { title: 'Cheque Reminders',    description: 'Remind 3 days before a cheque payment is due' },
  renewalAlert:      { title: 'Renewal Alerts',      description: 'Alert when a lease is within 90 days of expiry' },
  maintenanceUpdate: { title: 'Maintenance Updates', description: 'Notify on maintenance request status changes' },
  promotional:       { title: 'Platform News',       description: 'Product updates and feature announcements from UpNow' },
};
const NOTIF_KEYS: NotifKey[] = ['newInquiry', 'chequeReminder', 'renewalAlert', 'maintenanceUpdate', 'promotional'];

/**
 * "Notification Preferences" card — shows ONLY the toggles that are wired.
 *
 * Hidden entirely from 3 Aug 2026: the five toggles were local state with
 * hardcoded defaults, nothing persisted them and no sender read them, so the
 * card promised control it did not have. Since 31 Aug (maintenance Phase B)
 * a toggle persists to `notification_preferences` (GET/PUT
 * /notifications/preferences, event_code per key) and the maintenance module
 * honours it for every landlord-side notice (in-app + email). Only the keys in
 * WIRED_NOTIF_KEYS are rendered; add a key here the day its senders read it —
 * never before, or the same broken promise comes back.
 */
const SHOW_NOTIF_PREFS: boolean = true;
const WIRED_NOTIF_KEYS: NotifKey[] = ['maintenanceUpdate'];
const NOTIF_EVENT_CODE: Record<NotifKey, string> = {
  newInquiry: 'new_inquiry', chequeReminder: 'cheque_reminder', renewalAlert: 'renewal_alert',
  maintenanceUpdate: 'maintenance_update', promotional: 'promotional',
};
const NOTIF_KEY_OF_CODE = Object.fromEntries(Object.entries(NOTIF_EVENT_CODE).map(([k, v]) => [v, k])) as Record<string, NotifKey>;
interface NotifPrefRow { eventCode: string; emailEnabled: boolean; inAppEnabled: boolean }

/* ─────────────────────────────────────────────────────────────
   Fee rules types
───────────────────────────────────────────────────────────── */
type FeeType = 'ejari_fee' | 'admin_fee' | 'commission' | 'security_deposit' | 'rent_vat';
type FeeValueType = 'fixed_aed' | 'percentage';
type ContractType = 'new' | 'renewal';

interface FeeRuleDto {
  feeType: FeeType;
  valueType: FeeValueType;
  value: number;
  vatApplicable: boolean;
  vatRate: number;
  isActive: boolean;
}

type CategoryMap = Record<FeeType, FeeRuleDto>;
const FEE_CATEGORIES = ['residential', 'commercial', 'industrial', 'land', 'mixed_use'] as const;
type FeeCategory = (typeof FEE_CATEGORIES)[number];
// A mixed-use building holds BOTH residential and commercial units, so it has no
// single fee/VAT rate — each unit is priced PER UNIT against the Residential or
// Commercial rules below (resolved server-side from the unit type). There is no
// separate "Mixed-use" rate to configure, so it is not shown as its own tab. The
// type + defaults are kept only for back-compat with any rules saved before this.
const FEE_TAB_CATEGORIES = FEE_CATEGORIES.filter((c) => c !== 'mixed_use');
const FEE_ORDER: FeeType[] = ['ejari_fee', 'admin_fee', 'commission', 'security_deposit', 'rent_vat'];

const FEE_META: Record<FeeType, { title: string; description: string; tag: string; tagStyle: 'default' | 'green'; refundable?: boolean; newOnly?: boolean }> = {
  ejari_fee:        { title: 'Contract Registration Fee',        description: 'Government Contract Registration charge',          tag: 'UAE default',  tagStyle: 'green' },
  admin_fee:        { title: 'Admin Fee',         description: 'Processing fee charged by your company',        tag: 'Customisable', tagStyle: 'default' },
  commission:       { title: 'Commission',        description: 'Brokerage commission on annual contract value',  tag: 'Customisable', tagStyle: 'default' },
  security_deposit: { title: 'Security Deposit',  description: 'Refundable deposit held for contract duration',  tag: 'Refundable',   tagStyle: 'green', refundable: true, newOnly: true },
  rent_vat:         { title: 'VAT on Rent',       description: 'UAE 5% VAT on rent — exempt for residential, applies to commercial & industrial. Added to each rent cheque and tracked separately.', tag: 'Tax', tagStyle: 'default' },
};

const UAE_DEFAULTS: Record<FeeCategory, CategoryMap> = {
  residential: {
    ejari_fee:        { feeType: 'ejari_fee',        valueType: 'fixed_aed',  value: 250,  vatApplicable: false, vatRate: 0, isActive: true },
    admin_fee:        { feeType: 'admin_fee',         valueType: 'fixed_aed',  value: 1000, vatApplicable: true,  vatRate: 5, isActive: true },
    commission:       { feeType: 'commission',        valueType: 'percentage', value: 5,    vatApplicable: true,  vatRate: 5, isActive: true },
    security_deposit: { feeType: 'security_deposit',  valueType: 'percentage', value: 5,    vatApplicable: false, vatRate: 0, isActive: true },
    rent_vat:         { feeType: 'rent_vat',          valueType: 'percentage', value: 0,    vatApplicable: false, vatRate: 0, isActive: true },
  },
  commercial: {
    ejari_fee:        { feeType: 'ejari_fee',        valueType: 'fixed_aed',  value: 500,  vatApplicable: false, vatRate: 0, isActive: true },
    admin_fee:        { feeType: 'admin_fee',         valueType: 'fixed_aed',  value: 2000, vatApplicable: true,  vatRate: 5, isActive: true },
    commission:       { feeType: 'commission',        valueType: 'percentage', value: 5,    vatApplicable: true,  vatRate: 5, isActive: true },
    security_deposit: { feeType: 'security_deposit',  valueType: 'percentage', value: 10,   vatApplicable: false, vatRate: 0, isActive: true },
    rent_vat:         { feeType: 'rent_vat',          valueType: 'percentage', value: 0,    vatApplicable: true,  vatRate: 5, isActive: true },
  },
  industrial: {
    ejari_fee:        { feeType: 'ejari_fee',        valueType: 'fixed_aed',  value: 500,  vatApplicable: false, vatRate: 0, isActive: true },
    admin_fee:        { feeType: 'admin_fee',         valueType: 'fixed_aed',  value: 2500, vatApplicable: true,  vatRate: 5, isActive: true },
    commission:       { feeType: 'commission',        valueType: 'percentage', value: 5,    vatApplicable: true,  vatRate: 5, isActive: true },
    security_deposit: { feeType: 'security_deposit',  valueType: 'percentage', value: 10,   vatApplicable: false, vatRate: 0, isActive: true },
    rent_vat:         { feeType: 'rent_vat',          valueType: 'percentage', value: 0,    vatApplicable: true,  vatRate: 5, isActive: true },
  },
  // Bare land lease — no rent VAT (treated like residential for VAT). Fees mirror commercial.
  land: {
    ejari_fee:        { feeType: 'ejari_fee',        valueType: 'fixed_aed',  value: 500,  vatApplicable: false, vatRate: 0, isActive: true },
    admin_fee:        { feeType: 'admin_fee',         valueType: 'fixed_aed',  value: 2000, vatApplicable: true,  vatRate: 5, isActive: true },
    commission:       { feeType: 'commission',        valueType: 'percentage', value: 5,    vatApplicable: true,  vatRate: 5, isActive: true },
    security_deposit: { feeType: 'security_deposit',  valueType: 'percentage', value: 10,   vatApplicable: false, vatRate: 0, isActive: true },
    rent_vat:         { feeType: 'rent_vat',          valueType: 'percentage', value: 0,    vatApplicable: false, vatRate: 0, isActive: true },
  },
  // Mixed-use — mirrors commercial, incl. 5% rent VAT applicable.
  mixed_use: {
    ejari_fee:        { feeType: 'ejari_fee',        valueType: 'fixed_aed',  value: 500,  vatApplicable: false, vatRate: 0, isActive: true },
    admin_fee:        { feeType: 'admin_fee',         valueType: 'fixed_aed',  value: 2000, vatApplicable: true,  vatRate: 5, isActive: true },
    commission:       { feeType: 'commission',        valueType: 'percentage', value: 5,    vatApplicable: true,  vatRate: 5, isActive: true },
    security_deposit: { feeType: 'security_deposit',  valueType: 'percentage', value: 10,   vatApplicable: false, vatRate: 0, isActive: true },
    rent_vat:         { feeType: 'rent_vat',          valueType: 'percentage', value: 0,    vatApplicable: true,  vatRate: 5, isActive: true },
  },
};

function rowsToMap(rows: FeeRuleDto[], category: FeeCategory): CategoryMap {
  const m: CategoryMap = { ...UAE_DEFAULTS[category] };
  for (const r of rows) m[r.feeType] = { ...r };
  return m;
}

function fmtN(n: number) {
  return Number(Math.round(n)).toLocaleString('en-AE');
}

/* ─────────────────────────────────────────────────────────────
   Local primitives (kit-styled; the kit itself is not edited)
───────────────────────────────────────────────────────────── */

/** On/off switch — a real switch for assistive tech. */
function Toggle({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!value)}
      style={{
        position: 'relative', display: 'inline-flex', flexShrink: 0, width: 40, height: 22, padding: 0, border: 0,
        borderRadius: 999, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
        background: value ? 'var(--ms-primary)' : 'var(--ms-border-strong)', transition: 'background .15s',
      }}
    >
      <span aria-hidden style={{
        position: 'absolute', top: 3, left: value ? 21 : 3, width: 16, height: 16, borderRadius: '50%',
        background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.25)', transition: 'left .15s',
      }} />
    </button>
  );
}

/** Labelled primary Save button with its own busy state. */
function SaveBtn({ saving, label, onClick, type = 'button', disabled }: {
  saving: boolean; label: string; onClick?: () => void; type?: 'button' | 'submit'; disabled?: boolean;
}) {
  return (
    <Btn variant="primary" size="sm" type={type} onClick={onClick} disabled={saving || disabled}>
      {saving ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Save size={13} aria-hidden />}
      {saving ? 'Saving…' : label}
    </Btn>
  );
}

/** Inline success / error line next to a Save button. */
function SaveNote({ error, saved, savedText = 'Saved.' }: { error?: string | null; saved?: boolean; savedText?: ReactNode }) {
  if (error) return <span role="alert" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ms-danger)' }}>{error}</span>;
  if (saved) return <span role="status" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ms-primary)' }}><span aria-hidden>✓ </span>{savedText}</span>;
  return null;
}

/** Card footer row: status on the left, buttons on the right. */
function CardFoot({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>{note}</div>
      <div className="gx-btn-row">{children}</div>
    </div>
  );
}

/** Segmented control made of pressed/unpressed buttons (a choice, not tabs). */
function PressSeg<T extends string>({ value, options, onChange, label, disabled }: {
  value: T; options: { v: T; l: ReactNode }[]; onChange: (v: T) => void; label: string; disabled?: boolean;
}) {
  return (
    <div className="gx-seg" role="group" aria-label={label} style={{ flexWrap: 'nowrap' }}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button key={o.v} type="button" aria-pressed={on} disabled={disabled} onClick={() => onChange(o.v)}
            style={{
              ...(on ? { background: 'var(--ms-surface)', color: 'var(--ms-primary-dark)', fontWeight: 700, boxShadow: 'var(--ms-shadow)' } : null),
              ...(disabled ? { cursor: 'not-allowed', opacity: 0.55 } : null),
            }}>
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

/** Input with a prefix / suffix unit ("AED", "%", "months"). */
function Affix({ pre, post, children, block }: { pre?: ReactNode; post?: ReactNode; children: ReactNode; block?: boolean }) {
  const aff: CSSProperties = {
    padding: '0 9px', display: 'flex', alignItems: 'center', background: 'var(--ms-surface-2)',
    color: 'var(--ms-ink-3)', fontSize: 11, fontWeight: 700, letterSpacing: '.03em', whiteSpace: 'nowrap',
  };
  return (
    <span style={{
      display: block ? 'flex' : 'inline-flex', alignItems: 'stretch', height: 32, border: '1px solid var(--ms-border-strong)',
      borderRadius: 8, overflow: 'hidden', background: 'var(--ms-surface)', width: block ? '100%' : undefined,
    }}>
      {pre != null && <span style={aff}>{pre}</span>}
      {children}
      {post != null && <span style={aff}>{post}</span>}
    </span>
  );
}
const affixInput: CSSProperties = {
  border: 0, outline: 0, padding: '0 9px', width: 80, textAlign: 'right', fontWeight: 700, fontSize: 13,
  background: 'transparent', color: 'var(--ms-ink)', fontVariantNumeric: 'tabular-nums', minWidth: 0,
};

/** Grey body copy inside kit cards. */
const Lede = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <p style={{ fontSize: 12, color: 'var(--ms-ink-3)', lineHeight: 1.55, ...style }}>{children}</p>
);

/** A heading for a section whose body is an embedded (non-kit) panel. */
function SectionTitle({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="gx">
      <h3 style={{ fontSize: 14 }}>{title}</h3>
      {sub && <Lede style={{ marginTop: 3 }}>{sub}</Lede>}
    </div>
  );
}

/** Day-of-month chips 1–28. */
function DayChips({ days, onToggle, label }: { days: number[]; onToggle: (d: number) => void; label: string }) {
  return (
    <div className="gx-chips" role="group" aria-label={label}>
      {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
        <button key={day} type="button" className="gx-chip" aria-pressed={days.includes(day)} onClick={() => onToggle(day)}
          style={{ width: 36, padding: '5px 0', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
          {day}
        </button>
      ))}
    </div>
  );
}

const ordinal = (d: number) => {
  const t = d % 100;
  const s = t >= 11 && t <= 13 ? 'th' : (['st', 'nd', 'rd'][(d % 10) - 1] ?? 'th');
  return `${d}${s}`;
};

/* ─────────────────────────────────────────────────────────────
   Fee row — one table row per fee type (maths unchanged)
───────────────────────────────────────────────────────────── */
function FeeName({ toggle, title, muted, tags, desc }: { toggle: ReactNode; title: string; muted: boolean; tags: ReactNode; desc: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 250 }}>
      {toggle}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 12.5, color: muted ? 'var(--ms-ink-3)' : 'var(--ms-ink)' }}>{title}</span>
          {tags}
        </div>
        <span className="sub" style={{ whiteSpace: 'normal', maxWidth: 360 }}>{desc}</span>
      </div>
    </div>
  );
}

function FeeRow({ rule, rent, onChange, isRenewal }: {
  rule: FeeRuleDto;
  rent: number;
  onChange: (r: FeeRuleDto) => void;
  isRenewal: boolean;
}) {
  const meta     = FEE_META[rule.feeType];
  const disabled = !!meta.newOnly && isRenewal;

  // Rent VAT is special: it is the VAT itself (a % charged ON the rent), not a
  // fee that carries its own VAT. Render a focused Exempt / rate control that
  // maps to vatApplicable + vatRate (what computeFees reads on the backend).
  if (rule.feeType === 'rent_vat') {
    const on = rule.isActive && rule.vatApplicable;
    const vatOnRent = on ? Math.round((rent * rule.vatRate) / 100) : 0;
    const setOn = (v: boolean) => onChange({
      ...rule, isActive: true, valueType: 'percentage', value: 0,
      vatApplicable: v, vatRate: v ? (rule.vatRate || 5) : 0,
    });
    return (
      <tr style={on ? undefined : { opacity: 0.82 }}>
        <td>
          <FeeName
            toggle={<Toggle value={on} onChange={setOn} label={`Charge ${meta.title}`} />}
            title={meta.title} muted={!on}
            tags={<Pill tone="outline" dot={false}>{meta.tag}</Pill>}
            desc={meta.description}
          />
        </td>
        <td><span className="strong">Rate on rent</span><span className="sub">Added to each rent cheque</span></td>
        <td>
          <Affix post="% of rent">
            <input
              type="text" inputMode="decimal" aria-label="VAT rate on rent" disabled={!on}
              value={rule.vatRate}
              onChange={e => onChange({ ...rule, isActive: true, valueType: 'percentage', value: 0, vatApplicable: true, vatRate: parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0 })}
              style={{ ...affixInput, width: 56 }}
            />
          </Affix>
        </td>
        <td><span className="sub" style={{ marginTop: 6 }}>It is the VAT</span></td>
        <td className="num">
          <span className="strong" style={{ fontSize: 13.5 }}>{on ? `AED ${fmtN(vatOnRent)}` : 'Exempt'}</span>
          <span className="sub">{on ? `${rule.vatRate}% × AED ${fmtN(rent)}` : 'No VAT on rent'}</span>
        </td>
      </tr>
    );
  }

  const off      = !rule.isActive || disabled;

  const base   = rule.valueType === 'fixed_aed' ? rule.value : Math.round((rent * rule.value) / 100);
  const vatAmt = rule.vatApplicable ? Math.round((base * rule.vatRate) / 100) : 0;
  const total  = base + vatAmt;

  return (
    <tr style={off ? { opacity: 0.82 } : undefined}>
      <td>
        <FeeName
          toggle={<Toggle value={rule.isActive && !disabled} disabled={disabled} onChange={v => !disabled && onChange({ ...rule, isActive: v })} label={`Charge ${meta.title}`} />}
          title={meta.title} muted={off}
          tags={<>
            {meta.refundable && !disabled && <Pill tone="primary" dot={false}>Refundable</Pill>}
            {!meta.refundable && <Pill tone={meta.tagStyle === 'green' ? 'primary' : 'outline'} dot={false}>{meta.tag}</Pill>}
            {disabled && <Pill tone="amber" dot={false}>Not applied to renewals</Pill>}
          </>}
          desc={disabled ? 'Not collected on renewals — the original deposit carries forward.' : meta.description}
        />
      </td>
      <td>
        <PressSeg<FeeValueType>
          label={`${meta.title} charged as`} disabled={disabled} value={rule.valueType}
          options={[{ v: 'fixed_aed', l: 'AED' }, { v: 'percentage', l: '% of rent' }]}
          onChange={vt => onChange({ ...rule, valueType: vt })}
        />
      </td>
      <td>
        <Affix pre={rule.valueType === 'fixed_aed' ? 'AED' : undefined} post={rule.valueType === 'percentage' ? '%' : undefined}>
          <input
            type="text" inputMode="decimal" aria-label={`${meta.title} value`} disabled={disabled}
            value={rule.value}
            onChange={e => onChange({ ...rule, value: parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0 })}
            style={affixInput}
          />
        </Affix>
      </td>
      <td>
        <PressSeg<'none' | 'vat'>
          label={`${meta.title} VAT`} disabled={disabled} value={rule.vatApplicable ? 'vat' : 'none'}
          options={[{ v: 'none', l: 'No VAT' }, { v: 'vat', l: '+5% VAT' }]}
          onChange={v => onChange(v === 'vat' ? { ...rule, vatApplicable: true, vatRate: 5 } : { ...rule, vatApplicable: false, vatRate: 0 })}
        />
      </td>
      <td className="num">
        <span className="strong" style={{ fontSize: 13.5 }}>{off ? '—' : `AED ${fmtN(total)}`}</span>
        <span className="sub">
          {off ? '—' : rule.valueType === 'fixed_aed'
            ? `AED ${fmtN(base)}${rule.vatApplicable ? ` + AED ${fmtN(vatAmt)} VAT` : ''}`
            : `${rule.value}% × AED ${fmtN(rent)}${rule.vatApplicable ? ` + ${rule.vatRate}% VAT` : ''}`}
        </span>
      </td>
    </tr>
  );
}

/* ─────────────────────────────────────────────────────────────
   Fee preview panel (sticky right column) — maths unchanged
───────────────────────────────────────────────────────────── */
function FeePreviewPanel({ rules, rent, setRent, contractType, propertyType, onSave, onLoadDefaults, saving, saved, error }: {
  rules: CategoryMap;
  rent: number;
  setRent: (v: number) => void;
  contractType: ContractType;
  propertyType: FeeCategory;
  onSave: () => void;
  onLoadDefaults: () => void;
  saving: boolean;
  saved: boolean;
  error: string | null;
}) {
  // Rent VAT is recurring on each rent cheque (not a one-off upfront fee), so it
  // is configured in its own row but excluded from this upfront-cost breakdown.
  const lines = FEE_ORDER.filter(ft => ft !== 'rent_vat').map(ft => {
    const rule = rules[ft];
    const meta = FEE_META[ft];
    const renewalDeposit = contractType === 'renewal' && !!meta.newOnly;
    const base   = renewalDeposit || !rule.isActive ? 0 : (rule.valueType === 'fixed_aed' ? rule.value : Math.round((rent * rule.value) / 100));
    const vatAmt = (!renewalDeposit && rule.isActive && rule.vatApplicable) ? Math.round((base * rule.vatRate) / 100) : 0;
    return { ft, rule, meta, renewalDeposit, base, vatAmt, total: base + vatAmt };
  });

  const dueNow    = lines.reduce((s, l) => !l.renewalDeposit && l.rule.isActive && !l.meta.refundable ? s + l.total : s, 0);
  const refundable = lines.reduce((s, l) => !l.renewalDeposit && l.rule.isActive && !!l.meta.refundable ? s + l.total : s, 0);
  const total     = dueNow + refundable;

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card title="Live preview" sub="What the customer is billed up front" right={<Pill tone="primary">Updates as you type</Pill>}>
        <div className="gx-pad">
          <Field label="Annual rent" htmlFor="fee-preview-rent" hint="Of the lease being signed — used for this preview only.">
            <Affix pre="AED" block>
              <input
                id="fee-preview-rent"
                type="text"
                inputMode="numeric"
                value={rent.toLocaleString('en-US')}
                onChange={e => setRent(parseInt(e.target.value.replace(/\D/g, '')) || 0)}
                style={{ ...affixInput, width: '100%', flex: 1, textAlign: 'left', fontSize: 16 }}
              />
            </Affix>
          </Field>

          <KV items={[
            { k: 'Contract', v: <Pill tone={contractType === 'new' ? 'primary' : 'dark'} dot={false}>{contractType === 'new' ? 'New contract' : 'Renewal'}</Pill> },
            { k: 'Property type', v: <Pill tone="outline" dot={false}>{cap(propertyType)}</Pill> },
          ]} />

          <table className="gx-tbl" style={{ marginTop: 12 }}>
            <tbody>
              {lines.map(l => {
                const green = l.meta.refundable && !l.renewalDeposit && l.rule.isActive;
                return (
                  <tr key={l.ft} style={l.renewalDeposit ? { opacity: 0.45 } : undefined}>
                    <td style={{ paddingLeft: 0 }}>
                      <span className="strong" style={green ? { color: 'var(--ms-primary-dark)' } : undefined}>{l.meta.title}</span>
                      {l.meta.refundable && !l.renewalDeposit && <span className="sub">Refundable at end of contract</span>}
                      {l.renewalDeposit && <span className="sub">Not charged on renewal</span>}
                      {!l.renewalDeposit && !l.rule.isActive && <span className="sub">Disabled</span>}
                      {!l.renewalDeposit && l.rule.isActive && l.rule.vatApplicable && <span className="sub">incl. {l.rule.vatRate}% VAT</span>}
                    </td>
                    <td className="num strong" style={{ paddingRight: 0, ...(green ? { color: 'var(--ms-primary-dark)' } : null), ...(l.renewalDeposit ? { textDecoration: 'line-through' } : null) }}>
                      {l.renewalDeposit || !l.rule.isActive ? '—' : `AED ${fmtN(l.total)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="gx-kpi dark" style={{ marginTop: 10 }}>
            <div className="k">Total billed to customer</div>
            <div className="v">AED {fmtN(total)}</div>
            <div className="d">{refundable > 0 ? `Incl. AED ${fmtN(refundable)} refundable deposit` : 'No refundable amount'}</div>
          </div>

          {/* Recurring rent VAT note (charged on each rent cheque, not upfront) */}
          {rules.rent_vat?.isActive && rules.rent_vat?.vatApplicable && rules.rent_vat?.vatRate > 0 && (
            <div style={{ marginTop: 8 }}>
              <Evid>
                <strong>+ {rules.rent_vat.vatRate}% VAT on rent — AED {fmtN(Math.round((rent * rules.rent_vat.vatRate) / 100))}/yr.</strong> Added to each rent cheque.
              </Evid>
            </div>
          )}

          <div style={{ display: 'grid', gap: 7, marginTop: 12 }}>
            <SaveBtn saving={saving} onClick={onSave} label={`Save ${cap(propertyType)} · ${contractType === 'new' ? 'New' : 'Renewal'}`} />
            <Btn size="sm" onClick={onLoadDefaults}><RotateCcw size={13} aria-hidden /> Load UAE defaults</Btn>
            <div style={{ textAlign: 'center' }}><SaveNote error={error} saved={saved && !saving} /></div>
          </div>
        </div>
      </Card>

      <Callout tone="info" title="Need help?">
        These defaults reflect typical UAE practice (Contract Registration, agency commission, 5% VAT on services). Always verify with your accountant for jurisdiction-specific rules.
      </Callout>
    </div>
  );
}

type MainTab = 'general' | 'fee_rules' | 'maintenance' | 'maintenance_list' | 'restoration' | 'building_inspections' | 'categories' | 'legal' | 'team' | 'email' | 'whatsapp' | 'notifications';

// POA document keys — surfaced inline in the POA card and excluded from the
// general KYC Documents card so they aren't shown twice.
const POA_DOC_KEYS = ['poa_document', 'poa_holder_emirates_id', 'poa_holder_passport', 'poa_holder_visa'];

// Default permissions pre-selected when inviting a POA holder as a manager.
// The landlord can edit every flag inline before sending.
const POA_INVITE_DEFAULTS: Record<string, boolean> = {
  ...metaDefaults,
  can_act_as_poa: true,
  can_sign_documents: true,
  can_manage_documents: true,
  can_manage_agreements: true,
};

type BankAccount = { id: string; accountName: string; bankName: string; iban: string; accountNumber: string };
const newBankAccount = (): BankAccount => ({
  id: (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `bank_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  accountName: '', bankName: '', iban: '', accountNumber: '',
});

const EMIRATES_LIST = ['Dubai','Abu Dhabi','Sharjah','Ajman','Ras Al Khaimah','Fujairah','Umm Al Quwain'] as const;

// ── Penalty Rules engine (SCRUM-578) ────────────────────────────────────────
// Five RP-configurable penalties (alongside the bounced-cheque rule) surfaced as
// suggested settlement deductions + cross-verify flags. Each mirrors the
// bounced-cheque rule: a toggle plus a flat AED fee and/or a % — the seeded line
// is the greater of the two. Amounts are applied literally; the % resolves
// against the contract's annual rent.
type PenaltyRuleKey =
  | 'bouncedChequePenalty'
  | 'chequeHoldPenalty'
  | 'lateRenewalPenalty'
  | 'earlyTerminationPenalty'
  | 'lateMoveoutPenalty'
  | 'unauthorizedSharingPenalty'
  | 'accessCardReplacement'
  | 'contractNameChange'
  | 'unitTransfer';

// How a rule's amount is expressed. 'aed'/'pct' map to the backend _fee/_pct
// columns; 'months' (Early Termination) and 'daily' (Late Move-out) are the
// purpose-built modes that map to _months / _daily and override _fee/_pct.
type PenaltyValueType = 'aed' | 'pct' | 'months' | 'daily';

// pctLabel = what a % is taken of (annual rent for most; the cheque's face value
// for the bounced-cheque rule). modes = the allowed value types (first is the
// default).
type PenaltyRuleCfg = {
  key: PenaltyRuleKey;
  title: string;
  description: string;
  pctLabel?: string;
  modes?: PenaltyValueType[];
};

const PENALTY_RULES: PenaltyRuleCfg[] = [
  { key: 'bouncedChequePenalty', title: 'Bounced Cheque Penalty', description: 'Charge for each bounced rent cheque. Auto-added as an editable deduction at move-out settlement.', pctLabel: '% of cheque' },
  { key: 'chequeHoldPenalty', title: 'Cheque Hold / Replacement', description: 'Charge when a rent cheque is held or replaced. Auto-fills the "Cheque replacement" fee on a contract; also an editable deduction at move-out settlement.' },
  { key: 'lateRenewalPenalty', title: 'Late Renewal', description: 'Charge when the tenant renews after the renewal window.' },
  { key: 'earlyTerminationPenalty', title: 'Early Termination', description: 'Charge when the tenant ends the lease early — typically a number of months of annual rent. Auto-added as an editable deduction at settlement.', modes: ['months', 'pct', 'aed'] },
  { key: 'lateMoveoutPenalty', title: 'Late Move-out', description: 'Charge when the tenant overstays past the lease end date — typically pro-rated per day of delay. Auto-added as an editable deduction at settlement.', modes: ['daily', 'aed', 'pct'] },
  { key: 'unauthorizedSharingPenalty', title: 'Sharing without notice / NOC', description: 'Charge when the unit is shared without notice or an NOC.' },
  { key: 'accessCardReplacement', title: 'Access Card / Remote Replacement', description: 'Charge to replace a lost or damaged access card and/or remote.' },
  { key: 'contractNameChange', title: 'Contract Name Change', description: 'Charge to change the tenant name on an existing contract.' },
  { key: 'unitTransfer', title: 'Unit Transfer', description: 'Charge to transfer a tenant to a different unit.' },
];

// A rule carries a single value + its type. The backend keeps separate
// _fee / _pct / _months / _daily columns; we map the active one and null the rest
// on save. 'daily' needs no value (computed from the overstay at settlement).
type PenaltyState = { enabled: boolean; valueType: PenaltyValueType; value: string };
const EMPTY_PENALTY: PenaltyState = { enabled: false, valueType: 'aed', value: '' };

// Pill label per mode ('pct' is overridden by cfg.pctLabel where set).
const PENALTY_MODE_LABEL: Record<PenaltyValueType, string> = {
  aed: 'Fixed',
  pct: '% of rent',
  months: 'Months of rent',
  daily: 'Daily prorate',
};
const penaltyModes = (cfg: PenaltyRuleCfg): PenaltyValueType[] => cfg.modes ?? ['aed', 'pct'];

/** One penalty rule as a table row — toggle, mode, value and its own Save. */
function PenaltyRow({ cfg, state, saving, saved, error, onChange, onSave }: {
  cfg: PenaltyRuleCfg;
  state: PenaltyState;
  saving: boolean;
  saved: boolean;
  error: string | null;
  onChange: (s: PenaltyState) => void;
  onSave: () => void;
}) {
  const { enabled, valueType, value } = state;
  const modes = penaltyModes(cfg);
  const modeLabel = (m: PenaltyValueType) => (m === 'pct' ? (cfg.pctLabel ?? '% of rent') : PENALTY_MODE_LABEL[m]);
  const setVal = (patch: Partial<PenaltyState>) => onChange({ ...state, ...patch });
  return (
    <tr>
      <td style={{ minWidth: 260 }}>
        <span className="strong">{cfg.title}</span>
        <span className="sub" style={{ whiteSpace: 'normal', maxWidth: 420 }}>{cfg.description}</span>
      </td>
      <td><Toggle value={enabled} onChange={(v) => setVal({ enabled: v })} label={`Enable ${cfg.title}`} /></td>
      <td>
        {!enabled ? <span className="sub" style={{ marginTop: 4 }}>Off</span>
          : modes.length > 1
            ? <PressSeg<PenaltyValueType> label={`${cfg.title} charged as`} value={valueType} options={modes.map(m => ({ v: m, l: modeLabel(m) }))} onChange={(m) => setVal({ valueType: m })} />
            : <span className="sub" style={{ marginTop: 4 }}>{modeLabel(modes[0])}</span>}
      </td>
      <td style={{ minWidth: 150 }}>
        {!enabled ? <span className="sub" style={{ marginTop: 4 }}>—</span>
          : valueType === 'daily'
            /* 'daily' is computed at settlement, so it shows a note instead */
            ? <span className="sub" style={{ whiteSpace: 'normal', maxWidth: 220 }}>Annual rent ÷ 365 × days overstayed, billed at move-out settlement.</span>
            : (
              <Affix pre={valueType === 'aed' ? 'AED' : undefined} post={valueType === 'pct' ? '%' : valueType === 'months' ? 'months' : undefined}>
                <input type="text" inputMode="decimal" value={value} aria-label={`${cfg.title} amount`}
                  onChange={(e) => setVal({ value: e.target.value.replace(/[^0-9.]/g, '') })}
                  placeholder="0" style={affixInput} />
              </Affix>
            )}
      </td>
      <td className="act">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <SaveBtn saving={saving} onClick={onSave} label="Save" />
          <span style={{ whiteSpace: 'normal', maxWidth: 200, textAlign: 'right' }}><SaveNote error={error} saved={saved && !saving} /></span>
        </div>
      </td>
    </tr>
  );
}

// Settings tabs (owner, 12 Sep: the profile moved OUT to its own page; the
// Maintenance List, Restoration List and AMC categories moved IN).
const MAIN_TABS: MainTab[] = ['fee_rules', 'maintenance', 'maintenance_list', 'restoration', 'building_inspections', 'categories', 'legal', 'team', 'email', 'whatsapp', 'notifications'];
/** The left-hand settings menu, grouped by what the landlord is doing. */
const SETTINGS_MENU: { title: string; tabs: MainTab[] }[] = [
  { title: 'Leasing', tabs: ['fee_rules'] },
  { title: 'Maintenance', tabs: ['maintenance', 'maintenance_list', 'restoration'] },
  // Building inspections (0383): the walk-through checklists, each building's frequency and inspector.
  { title: 'Buildings', tabs: ['building_inspections'] },
  { title: 'Contracts', tabs: ['categories'] },
  // The landlord's own notice periods, appeal window and filing-fee rule (0286) — the platform default applies until saved.
  { title: 'Legal', tabs: ['legal'] },
  // Email = the landlord's own mailbox, used to write to customers and leads (17 Sep).
  // WhatsApp = the landlord's own numbers, next to their own mailbox: both are connected once, here.
  { title: 'Account', tabs: ['team', 'email', 'whatsapp', 'notifications'] },
];
const TAB_META: Record<MainTab, { label: string; Icon: React.ComponentType<{ size?: number }>; desc: string }> = {
  // Two maintenance tabs read as one thing to the owner (12 Sep) — say what each is:
  // coverage = what is offered per property type and who does it; items = what a customer can raise.
  general:              { label: 'Profile', Icon: User, desc: 'Your business details and KYC documents.' },
  fee_rules:            { label: 'Rules', Icon: Percent, desc: 'Fees, VAT, penalties, payment plans and schedules applied to new leases and renewals.' },
  maintenance:          { label: 'Coverage', Icon: Wrench, desc: 'What maintenance is offered per property type, and who does it.' },
  maintenance_list:     { label: 'Items', Icon: ClipboardList, desc: 'The maintenance items a customer can raise.' },
  restoration:          { label: 'Restoration list', Icon: Receipt, desc: 'Restoration items and their charges, used at move-out.' },
  building_inspections: { label: 'Building inspections', Icon: ClipboardCheck, desc: "The walk-through checklists, each building's frequency and inspector." },
  categories:           { label: 'AMC categories', Icon: FileSignature, desc: 'The categories your AMC and vendor contracts are filed under.' },
  legal:                { label: 'Periods & fees', Icon: Scale, desc: 'Notice periods, appeal windows and filing fees for breaches and legal cases.' },
  team:                 { label: 'Team', Icon: Users, desc: 'Who works on your account and what each person can do.' },
  email:                { label: 'Email', Icon: Mail, desc: 'Your own mailbox, used to write to customers and leads.' },
  whatsapp:             { label: 'WhatsApp', Icon: MessageCircle, desc: 'Your own WhatsApp numbers, connected once here.' },
  notifications:        { label: 'Notifications', Icon: Bell, desc: 'Who is copied on customer email, the updates you receive, and browser alerts.' },
};

/** Jump links inside Rules — each card has a stable id, so ?tab=fee_rules#<id> deep-links too. */
const RULES_ANCHORS: { id: string; label: string }[] = [
  { id: 'rules-fees', label: 'Fees & VAT' },
  { id: 'rules-start-days', label: 'Start days' },
  { id: 'rules-cheque-days', label: 'Cheque days' },
  { id: 'rules-penalties', label: 'Penalties' },
  { id: 'rules-installments', label: 'Installment plans' },
  { id: 'rules-rent-vat', label: 'Rent VAT collection' },
  { id: 'rules-market-review', label: 'Market rate review' },
  { id: 'rules-bills', label: 'Bills from email' },
  { id: 'rules-reminders', label: 'WhatsApp reminders' },
];

const CONTRACT_OPTS: { value: ContractType; label: string; tag: string; desc: string }[] = [
  { value: 'new',     label: 'New contract',     tag: 'All fees',   desc: 'First-time lease for a unit. Includes the refundable security deposit.' },
  { value: 'renewal', label: 'Renewal contract', tag: 'No deposit', desc: 'Renewing an existing lease. Security deposit carries over — only fees apply.' },
];

/** One component, two pages: /settings (tabs) and /profile (the business profile alone). */
export function RpSettings({ view = 'settings' }: { view?: 'settings' | 'profile' }) {
  const { user, refresh } = useAuth();
  const [mainTab, setMainTab] = useState<MainTab>(view === 'profile' ? 'general' : 'fee_rules');
  // No WhatsApp tab where the environment has no WhatsApp.
  const waOn = useWhatsappEnabled();

  // Persist the active tab in the URL (?tab=) so it survives a page refresh and
  // stays shareable. Restore from the query param on mount.
  useEffect(() => {
    if (view === 'profile') return;
    const t = new URLSearchParams(window.location.search).get('tab');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot ?tab= restore after hydration (window is client-only)
    if (t && (MAIN_TABS as string[]).includes(t)) setMainTab(t as MainTab);
  }, [view]);

  // Switch tab + reflect it in the URL (replaceState — no history spam / no back-
  // button tab cycling; a refresh lands back on the same tab).
  const selectTab = (t: MainTab) => {
    setMainTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', t);
    window.history.replaceState(null, '', url.toString());
  };

  // ── Business profile state ──────────────────────────────────
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileType, setProfileType]       = useState<'individual' | 'company'>('company');
  const [avatarPreview, setAvatarPreview]   = useState<string | null>(null);
  const avatarInputRef                      = useRef<HTMLInputElement>(null);
  // Shared editable (RP entity fields — phone/email are read-only from auth)
  const [bizEmirate, setBizEmirate]         = useState('');
  const [bizAddress, setBizAddress]         = useState('');
  const [bizDesc, setBizDesc]               = useState('');
  // Individual only
  const [ownerName, setOwnerName]           = useState('');
  const [emiratesId, setEmiratesId]         = useState('');
  const [nationality, setNationality]       = useState('');
  // Company only
  const [bizName, setBizName]               = useState('');
  const [tradeLicense, setTradeLicense]     = useState('');
  const [bizWebsite, setBizWebsite]         = useState('');
  // Company sub-type (locked in from onboarding) + agents-specific parent
  const [companyType, setCompanyType]       = useState<'landlord' | 'brokerage' | 'agents' | null>(null);
  const [parentBrokerageName, setParentBrokerageName] = useState('');
  const [savingBiz, setSavingBiz]           = useState(false);
  const [bizSaved, setBizSaved]             = useState(false);
  const [bizError, setBizError]             = useState<string | null>(null);
  // Bumped after a successful profile save so the KYC documents panel re-fetches
  // its checklist — picks up POA documents the moment "POA assigned" is saved.
  const [docsReloadKey, setDocsReloadKey]   = useState(0);
  // Additional landlord-profile fields (merged from the standalone Profile page)
  const [authorizedSignatoryName, setAuthorizedSignatoryName] = useState('');
  const [legalNoticesAddress, setLegalNoticesAddress] = useState('');
  const [vatTrn, setVatTrn] = useState('');
  const [hasPoa, setHasPoa]                 = useState(false);
  const [poaPersonPhone, setPoaPersonPhone] = useState('');
  const [poaPersonEmail, setPoaPersonEmail] = useState('');
  // Authorized Signatory & POA — own card, own save
  const [savingPoa, setSavingPoa]           = useState(false);
  const [poaSaved, setPoaSaved]             = useState(false);
  const [poaError, setPoaError]             = useState<string | null>(null);
  const [poaInviteOpen, setPoaInviteOpen]   = useState(false);
  const [sendingPoaInvite, setSendingPoaInvite] = useState(false);
  const [poaPerms, setPoaPerms]             = useState<Record<string, boolean>>(POA_INVITE_DEFAULTS);
  const [inviteMsg, setInviteMsg]           = useState<string | null>(null);
  // Banking — own card, own save, supports multiple accounts
  const [bankAccounts, setBankAccounts]     = useState<BankAccount[]>([]);
  const [savingBank, setSavingBank]         = useState(false);
  const [bankSaved, setBankSaved]           = useState(false);
  const [bankError, setBankError]           = useState<string | null>(null);

  // ── Contract date config ─────────────────────────────────────
  const [preferredDays,    setPreferredDays]    = useState<number[]>([]);
  const [daysSaving,       setDaysSaving]       = useState(false);
  const [daysSaved,        setDaysSaved]        = useState(false);
  const [daysError,        setDaysError]        = useState<string | null>(null);
  const [chequeDays,       setChequeDays]       = useState<number[]>([]);
  const [chequeSaving,     setChequeSaving]     = useState(false);
  const [chequeSaved,      setChequeSaved]      = useState(false);
  const [chequeError,      setChequeError]      = useState<string | null>(null);

  // ── Renewal defaults (Phase 6) ──────────────────────────────
  // Default % bump applied to the previous annual rent when proposing a
  // renewal. Pre-fills the "New Annual Rent" field on the renewal modal.
  const [renewalIncPct,    setRenewalIncPct]    = useState<string>('');
  const [renewalIncSaving, setRenewalIncSaving] = useState(false);
  const [renewalIncSaved,  setRenewalIncSaved]  = useState(false);
  const [renewalIncError,  setRenewalIncError]  = useState<string | null>(null);

  // ── Market rate review schedule (owner, 7 Oct 2026) ─────────
  // How often the market rates are reviewed and the unit-mix asking rents
  // updated before renewal offers go out, and the day of the period's first
  // month by which it must be done. Whether a period is reviewed is read off
  // the system (the rates actually set) — shown on Units and the Operation Plan.
  const [reviewPeriod,     setReviewPeriod]     = useState<'monthly' | 'quarterly' | 'half_yearly' | 'yearly'>('quarterly');
  const [reviewDueDay,     setReviewDueDay]     = useState<string>('15');
  // Bills from email (0385): how often the mailbox is checked for bills to file on AMC contracts.
  const [billsEvery,       setBillsEvery]       = useState<string>('24');
  const [billsSaving,      setBillsSaving]      = useState(false);
  const [billsSaved,       setBillsSaved]       = useState(false);
  const [billsError,       setBillsError]       = useState<string | null>(null);
  // Reminders to WhatsApp (0386): the group, the time, and the AMC bills reminder as it would be posted today.
  const [remGroups,        setRemGroups]        = useState<Array<{ id: number; name: string }>>([]);
  const [remChat,          setRemChat]          = useState<string>('');
  const [remTime,          setRemTime]          = useState<string>('08:00');
  const [remSaving,        setRemSaving]        = useState(false);
  const [remSaved,         setRemSaved]         = useState(false);
  const [remError,         setRemError]         = useState<string | null>(null);
  const [remPreview,       setRemPreview]       = useState<{ message: string; bills: number; overdue: number; signatures: { message: string; count: number } | null; chat: { id: number; name: string | null } | null; sendAt: string; last: { at: string; status: string; error: string | null; chatName: string | null } | null } | null>(null);
  const [remSending,       setRemSending]       = useState(false);
  const [remSendNote,      setRemSendNote]      = useState<string | null>(null);
  const [reviewSaving,     setReviewSaving]     = useState(false);
  const [reviewSaved,      setReviewSaved]      = useState(false);
  const [reviewError,      setReviewError]      = useState<string | null>(null);

  // ── Penalty Rules engine (Rules, SCRUM-578) ─────────────────
  // Six configurable penalties (Bounced Cheque + five more). One save at a time
  // (savingKey/savedKey/errorKey track which card is active).
  const [penalties, setPenalties] = useState<Record<PenaltyRuleKey, PenaltyState>>(
    () => Object.fromEntries(
      PENALTY_RULES.map(cfg => [cfg.key, { ...EMPTY_PENALTY, valueType: penaltyModes(cfg)[0] }]),
    ) as Record<PenaltyRuleKey, PenaltyState>,
  );
  const [penaltySavingKey, setPenaltySavingKey] = useState<PenaltyRuleKey | null>(null);
  const [penaltySavedKey,  setPenaltySavedKey]  = useState<PenaltyRuleKey | null>(null);
  const [penaltyErrorKey,  setPenaltyErrorKey]  = useState<PenaltyRuleKey | null>(null);
  const [penaltyErrorMsg,  setPenaltyErrorMsg]  = useState<string | null>(null);

  // ── Allowed installment plans (Rules) ───────────────────────
  // Subset of [1,2,3,4,6,12] cheque counts this RP offers. Empty = all allowed.
  const [allowedInst,    setAllowedInst]    = useState<number[]>([]);
  // Rent VAT collection mode (per-RP): 'installment' (one VAT cheque per rent
  // cheque — quarterly filing) or 'annual' (one VAT cheque for the year).
  const [vatMode,   setVatMode]   = useState<'annual' | 'installment'>('installment');
  const [vatSaving, setVatSaving] = useState(false);
  const [vatSaved,  setVatSaved]  = useState(false);
  const [instSaving,     setInstSaving]     = useState(false);
  const [instSaved,      setInstSaved]      = useState(false);
  const [instError,      setInstError]      = useState<string | null>(null);

  const [notifs, setNotifs] = useState<Record<NotifKey, boolean>>({
    newInquiry: true, chequeReminder: true, renewalAlert: true,
    maintenanceUpdate: true, promotional: false,
  });
  const [notifErr, setNotifErr] = useState<string | null>(null);
  // A preference row exists only once the landlord has flipped the toggle; no
  // row = enabled, which is what the default state above already says.
  useEffect(() => {
    fetch('/api/notifications/preferences', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { items?: NotifPrefRow[] } | null) => {
        if (!d?.items) return;
        setNotifs(prev => {
          const next = { ...prev };
          for (const row of d.items!) {
            const key = NOTIF_KEY_OF_CODE[row.eventCode];
            if (key) next[key] = row.inAppEnabled || row.emailEnabled;
          }
          return next;
        });
      })
      .catch(() => {});
  }, []);
  // One toggle = in-app AND email for that event; saved the moment it flips,
  // reverted if the save fails.
  const setNotif = (key: NotifKey, v: boolean) => {
    setNotifs(prev => ({ ...prev, [key]: v }));
    setNotifErr(null);
    fetch('/api/notifications/preferences', {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventCode: NOTIF_EVENT_CODE[key], inAppEnabled: v, emailEnabled: v }),
    }).then(r => { if (!r.ok) throw new Error(); })
      .catch(() => { setNotifs(prev => ({ ...prev, [key]: !v })); setNotifErr('Could not save that preference — try again.'); });
  };

  // ── Correspondence (CC) ──────────────────────────────────────
  // Addresses copied on every customer-facing email, so the RP holds the same
  // email — same payment plan, same renewal terms — the customer received.
  // `ccDraft` is the not-yet-added text in the input.
  const [ccEmails,   setCcEmails]   = useState<string[]>([]);
  const [ccDraft,    setCcDraft]    = useState('');
  const [ccSaving,   setCcSaving]   = useState(false);
  const [ccSaved,    setCcSaved]    = useState(false);
  const [ccError,    setCcError]    = useState<string | null>(null);

  // ── Fee rules state ─────────────────────────────────────────
  const [feesLoading, setFeesLoading]   = useState(false);
  const [feeTab, setFeeTab]             = useState<FeeCategory>('residential');
  const [contractType, setContractType] = useState<ContractType>('new');
  const [allRules, setAllRules]         = useState<Record<FeeCategory, CategoryMap>>({
    residential: { ...UAE_DEFAULTS.residential },
    commercial:  { ...UAE_DEFAULTS.commercial },
    industrial:  { ...UAE_DEFAULTS.industrial },
    land:        { ...UAE_DEFAULTS.land },
    mixed_use:   { ...UAE_DEFAULTS.mixed_use },
  });
  const [previewRent, setPreviewRent]   = useState(120_000);
  const [feesSaving, setFeesSaving]     = useState(false);
  const [feesSaved, setFeesSaved]       = useState(false);
  const [feesError, setFeesError]       = useState<string | null>(null);

  // Phone lives on the auth/user record (editable here, saved via /auth/me)
  const [phone, setPhone] = useState('');

  // Load KYC profile on mount
  useEffect(() => {
    fetch('/api/profiles/rental-provider/me', { credentials: 'include' })
      .then(r => r.json())
      .then((data: { profile: Record<string, unknown> }) => {
        const p = data.profile;
        setProfileType((p.entityType as string) === 'company' ? 'company' : 'individual');
        setBizName((p.companyName as string) ?? '');
        setTradeLicense((p.tradeLicenseNumber as string) ?? '');
        setEmiratesId((p.emiratesIdNumber as string) ?? '');
        setNationality((p.nationality as string) ?? '');
        setOwnerName(user?.name ?? '');
        const ct = p.companyType as 'landlord' | 'brokerage' | 'agents' | null | undefined;
        if (ct) setCompanyType(ct);
        if (p.parentBrokerageName) setParentBrokerageName(p.parentBrokerageName as string);
        setAuthorizedSignatoryName((p.authorizedSignatoryName as string) ?? '');
        setLegalNoticesAddress((p.legalNoticesAddress as string) ?? '');
        setVatTrn((p.vatTrn as string) ?? '');
        setHasPoa(Boolean(p.hasPoa));
        setPoaPersonPhone((p.poaPersonPhone as string) ?? '');
        setPoaPersonEmail((p.poaPersonEmail as string) ?? '');
        // Banking — backend returns bankAccounts (synthesised from legacy single
        // columns when needed). Fall back to an empty starter row if none.
        const accts = Array.isArray(p.bankAccounts) ? (p.bankAccounts as Array<Record<string, unknown>>) : [];
        setBankAccounts(
          accts.length
            ? accts.map(a => ({
                id: (a.id as string) || newBankAccount().id,
                accountName: (a.accountName as string) ?? '',
                bankName: (a.bankName as string) ?? '',
                iban: (a.iban as string) ?? '',
                accountNumber: (a.accountNumber as string) ?? '',
              }))
            : [],
        );
        if (Array.isArray(p.preferredStartDays)) setPreferredDays(p.preferredStartDays as number[]);
        if (Array.isArray(p.preferredChequeDays)) setChequeDays(p.preferredChequeDays as number[]);
        if (p.renewalRentIncrementPct != null) setRenewalIncPct(String(p.renewalRentIncrementPct));
        if (typeof p.marketRateReviewPeriod === 'string') setReviewPeriod(p.marketRateReviewPeriod as 'monthly' | 'quarterly' | 'half_yearly' | 'yearly');
        if (p.marketRateReviewDueDay != null) setReviewDueDay(String(p.marketRateReviewDueDay));
        if (p.billsEmailCheckEveryHours != null) setBillsEvery(String(p.billsEmailCheckEveryHours));
        if (p.remindersWhatsappChatId != null) setRemChat(String(p.remindersWhatsappChatId));
        if (typeof p.remindersSendAt === 'string') setRemTime(p.remindersSendAt);
        if (Array.isArray(p.ccEmails)) setCcEmails(p.ccEmails as string[]);
        // Penalty Rules engine — round-trip each rule to its stored mode. Months
        // (Early Termination) and Daily (Late Move-out) take precedence when set;
        // then % → 'pct', flat fee → 'aed'; nothing yet → the rule's default mode.
        const seedPenalty = (cfg: PenaltyRuleCfg): PenaltyState => {
          const key = cfg.key;
          const modes = penaltyModes(cfg);
          const fee = p[`${key}Fee`];
          const pct = p[`${key}Pct`];
          const months = p[`${key}Months`];
          const daily = p[`${key}Daily`];
          const enabled = Boolean(p[`${key}Enabled`]);
          if (modes.includes('months') && months != null && Number(months) > 0) {
            return { enabled, valueType: 'months', value: String(months) };
          }
          if (modes.includes('daily') && Boolean(daily)) {
            return { enabled, valueType: 'daily', value: '' };
          }
          if (pct != null && (fee == null || Number(fee) <= 0)) {
            return { enabled, valueType: 'pct', value: String(pct) };
          }
          if (fee != null) {
            return { enabled, valueType: 'aed', value: String(fee) };
          }
          return { enabled, valueType: modes[0], value: '' };
        };
        setPenalties(
          Object.fromEntries(PENALTY_RULES.map(cfg => [cfg.key, seedPenalty(cfg)])) as Record<PenaltyRuleKey, PenaltyState>,
        );
        if (Array.isArray(p.allowedInstallments)) setAllowedInst(p.allowedInstallments as number[]);
        if (p.rentVatMode === 'annual' || p.rentVatMode === 'installment') setVatMode(p.rentVatMode);
        // Parse contactAddress into emirate + street
        const addr = (p.contactAddress as string) ?? '';
        const matched = EMIRATES_LIST.find(e => addr.endsWith(`, ${e}`) || addr === e);
        if (matched) {
          setBizEmirate(matched);
          setBizAddress(addr.slice(0, addr.lastIndexOf(`, ${matched}`)).trim());
        } else {
          setBizAddress(addr);
        }
      })
      .catch(() => undefined)
      .finally(() => setProfileLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the editable phone field in sync with the auth session
  // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the auth session into the editable field
  useEffect(() => { setPhone(user?.phone ?? ''); }, [user?.phone]);

  useEffect(() => {
    if (mainTab !== 'fee_rules' || feesLoading) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for the fetch started here
    setFeesLoading(true);
    fetch('/api/fee-rules', { credentials: 'include' })
      .then(r => r.json())
      .then((data: Record<string, FeeRuleDto[]>) => {
        setAllRules({
          residential: rowsToMap(data.residential ?? [], 'residential'),
          commercial:  rowsToMap(data.commercial  ?? [], 'commercial'),
          industrial:  rowsToMap(data.industrial  ?? [], 'industrial'),
          land:        rowsToMap(data.land         ?? [], 'land'),
          mixed_use:   rowsToMap(data.mixed_use    ?? [], 'mixed_use'),
        });
      })
      .catch(() => undefined)
      .finally(() => setFeesLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab]);

  const feeRules = allRules[feeTab];

  const setRule = (feeType: FeeType, r: FeeRuleDto) => {
    setAllRules(prev => ({ ...prev, [feeTab]: { ...prev[feeTab], [feeType]: r } }));
    setFeesSaved(false);
  };

  const loadDefaults = () => {
    setAllRules(prev => ({ ...prev, [feeTab]: { ...UAE_DEFAULTS[feeTab] } }));
    setFeesSaved(false);
  };

  const handleSaveFees = async () => {
    setFeesSaving(true);
    setFeesError(null);
    try {
      const res = await fetch('/api/fee-rules', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceCategory: feeTab, rules: FEE_ORDER.map(ft => feeRules[ft]) }),
      });
      if (!res.ok) throw new Error(await res.text());
      setFeesSaved(true);
    } catch {
      setFeesError('Failed to save. Please try again.');
    } finally {
      setFeesSaving(false);
    }
  };

  // ── General handlers ────────────────────────────────────────
  const handleSaveBiz = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBiz(true);
    setBizError(null);
    setBizSaved(false);
    try {
      const contactAddress = [bizAddress, bizEmirate].filter(Boolean).join(', ') || null;
      const payload: Record<string, unknown> = { entityType: profileType, contactAddress };
      if (profileType === 'company') {
        payload.companyName = bizName || null;
        payload.tradeLicenseNumber = tradeLicense || null;
        // Preserve the company sub-type + parent brokerage chosen during onboarding
        if (companyType) payload.companyType = companyType;
        if (companyType === 'agents') payload.parentBrokerageName = parentBrokerageName || null;
      } else {
        payload.emiratesIdNumber = emiratesId || null;
        payload.nationality = nationality || null;
      }
      // Legal notices address stays on the profile form.
      payload.legalNoticesAddress = legalNoticesAddress || null;
      // TRN applies to either account type (printed on receipts when set).
      payload.vatTrn = vatTrn.trim() || null;
      // Authorized Signatory & POA are saved from their own card (handleSavePoa).
      // Banking is saved from its own card (handleSaveBank) — not here.
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      // Phone is an auth/user field (not on the RP entity) — persist it
      // separately when changed. Backend validates uniqueness and resets phone
      // verification (phoneVerified = false) on change.
      if (phone.trim() !== (user?.phone ?? '').trim()) {
        const pRes = await fetch('/api/auth/me', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phone.trim() }),
        });
        if (!pRes.ok) {
          const body = await pRes.json().catch(() => ({}));
          setBizError(typeof body.message === 'string' ? body.message : 'Failed to update phone number');
          setSavingBiz(false);
          return;
        }
      }
      // Re-fetch auth session so sidebar + header reflect any name changes
      await refresh();
      setBizSaved(true);
      // Refresh the documents checklist so a POA toggle change is reflected
      setDocsReloadKey(k => k + 1);
    } catch {
      setBizError('Failed to save. Please try again.');
    } finally {
      setSavingBiz(false);
    }
  };

  const handleSaveBank = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBank(true);
    setBankError(null);
    setBankSaved(false);
    try {
      // Drop fully-empty rows so a blank starter doesn't get persisted.
      const clean = bankAccounts
        .map(b => ({
          id: b.id,
          accountName: b.accountName.trim(),
          bankName: b.bankName.trim(),
          iban: b.iban.trim(),
          accountNumber: b.accountNumber.trim() || undefined,
        }))
        .filter(b => b.accountName || b.bankName || b.iban);
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankAccounts: clean }),
      });
      if (!res.ok) throw new Error(await res.text());
      setBankSaved(true);
    } catch {
      setBankError('Failed to save. Please try again.');
    } finally {
      setSavingBank(false);
    }
  };

  const handleSavePoa = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPoa(true);
    setPoaError(null);
    setPoaSaved(false);
    try {
      const payload: Record<string, unknown> = {
        hasPoa,
        authorizedSignatoryName: authorizedSignatoryName || null,
        poaPersonName: authorizedSignatoryName || null,
        poaPersonPhone: hasPoa ? (poaPersonPhone || null) : null,
        poaPersonEmail: hasPoa ? (poaPersonEmail || null) : null,
      };
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      setPoaSaved(true);
      // Refresh the inline POA documents (they're server-gated on hasPoa).
      setDocsReloadKey(k => k + 1);
    } catch {
      setPoaError('Failed to save. Please try again.');
    } finally {
      setSavingPoa(false);
    }
  };

  // Toggling POA persists the flag immediately so the documents checklist
  // (which the backend gates on hasPoa) populates right away — no need to hit
  // "Save" first just to see the required documents.
  const toggleHasPoa = async (v: boolean) => {
    setHasPoa(v);
    setPoaSaved(false);
    setInviteMsg(null);
    try {
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hasPoa: v }),
      });
      if (!res.ok) throw new Error(await res.text());
      // Refresh the inline documents panel now that the server knows hasPoa.
      setDocsReloadKey(k => k + 1);
    } catch {
      setPoaError('Could not update the Power of Attorney setting. Please try again.');
    }
  };

  // Send the POA-holder manager invite with whatever permissions the landlord
  // selected in the inline editor. Reuses the name / phone / email above.
  const handleSendPoaInvite = async () => {
    const email = poaPersonEmail.trim();
    if (!email) { setInviteMsg('Enter the POA holder’s email above first.'); return; }
    if (!Object.values(poaPerms).some(Boolean)) { setInviteMsg('Select at least one permission.'); return; }
    setSendingPoaInvite(true);
    setInviteMsg(null);
    try {
      const full = (authorizedSignatoryName.trim() || email.split('@')[0]).trim();
      const [firstName, ...rest] = full.split(/\s+/).filter(Boolean);
      const res = await fetch('/api/invitations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          firstName: firstName || 'POA',
          lastName: rest.join(' ') || undefined,
          phone: poaPersonPhone.trim() || undefined,
          role: 'manager',
          metadata: poaPerms,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setInviteMsg('Invitation sent. Once they accept, their Emirates ID, Passport & Visa appear here and on their own account — shared.');
      setPoaInviteOpen(false);
    } catch {
      setInviteMsg('Could not send the invitation. Please try again.');
    } finally {
      setSendingPoaInvite(false);
    }
  };

  const handleSaveDays = async (e: React.FormEvent) => {
    e.preventDefault();
    setDaysSaving(true);
    setDaysError(null);
    setDaysSaved(false);
    try {
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredStartDays: preferredDays }),
      });
      if (!res.ok) throw new Error(await res.text());
      setDaysSaved(true);
    } catch {
      setDaysError('Failed to save. Please try again.');
    } finally {
      setDaysSaving(false);
    }
  }

  const handleSaveChequeDays = async (e: React.FormEvent) => {
    e.preventDefault();
    setChequeSaving(true);
    setChequeError(null);
    setChequeSaved(false);
    try {
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredChequeDays: chequeDays }),
      });
      if (!res.ok) throw new Error(await res.text());
      setChequeSaved(true);
    } catch {
      setChequeError('Failed to save. Please try again.');
    } finally {
      setChequeSaving(false);
    }
  }

  async function saveRenewalIncrement() {
    setRenewalIncSaving(true);
    setRenewalIncError(null);
    setRenewalIncSaved(false);
    try {
      const raw = renewalIncPct.trim();
      const parsed = raw === '' ? null : Number(raw);
      if (parsed !== null && (Number.isNaN(parsed) || parsed < 0 || parsed > 100)) {
        setRenewalIncError('Enter a percentage between 0 and 100.');
        return;
      }
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ renewalRentIncrementPct: parsed }),
      });
      if (!res.ok) throw new Error(await res.text());
      setRenewalIncSaved(true);
    } catch {
      setRenewalIncError('Failed to save. Please try again.');
    } finally {
      setRenewalIncSaving(false);
    }
  };

  async function saveMarketRateReview() {
    setReviewSaving(true);
    setReviewError(null);
    setReviewSaved(false);
    try {
      const day = Number(reviewDueDay);
      if (!Number.isInteger(day) || day < 1 || day > 28) {
        setReviewError('Enter a day between 1 and 28.');
        return;
      }
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketRateReviewPeriod: reviewPeriod, marketRateReviewDueDay: day }),
      });
      if (!res.ok) throw new Error(await res.text());
      setReviewSaved(true);
    } catch {
      setReviewError('Failed to save. Please try again.');
    } finally {
      setReviewSaving(false);
    }
  }

  const loadReminderPreview = useCallback(() => {
    fetch('/api/amc/reminders/preview', { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).then(j => setRemPreview(j && typeof j.message === 'string' ? j : null)).catch(() => setRemPreview(null));
  }, []);
  useEffect(() => {
    fetch('/api/whatsapp/chats?kind=group&pageSize=100', { credentials: 'include' }).then(r => (r.ok ? r.json() : null))
      .then(j => { const items = Array.isArray(j?.items) ? j.items : Array.isArray(j) ? j : []; setRemGroups(items.map((c: { id: number; savedName?: string | null; personName?: string | null; name?: string | null }) => ({ id: c.id, name: c.savedName || c.personName || c.name || `Group ${c.id}` }))); })
      .catch(() => setRemGroups([]));
    loadReminderPreview();
  }, [loadReminderPreview]);

  async function saveReminders() {
    setRemSaving(true);
    setRemError(null);
    setRemSaved(false);
    try {
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remindersWhatsappChatId: remChat ? Number(remChat) : null, remindersSendAt: remTime }),
      });
      if (!res.ok) throw new Error(await res.text());
      setRemSaved(true);
      loadReminderPreview();
    } catch {
      setRemError('Failed to save. Please try again.');
    } finally {
      setRemSaving(false);
    }
  }

  async function sendReminderNow() {
    setRemSending(true);
    setRemSendNote(null);
    try {
      const res = await fetch('/api/amc/reminders/send', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.message || 'failed');
      setRemSendNote(j?.status === 'sent' ? 'Posted to the group.' : `Not sent: ${j?.error || 'WhatsApp did not accept it'}`);
      if (j && typeof j.message === 'string') setRemPreview(j);
    } catch (e) {
      setRemSendNote(`Not sent: ${(e as Error).message}`);
    } finally {
      setRemSending(false);
    }
  }

  async function saveBillsFromEmail() {
    setBillsSaving(true);
    setBillsError(null);
    setBillsSaved(false);
    try {
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billsEmailCheckEveryHours: Number(billsEvery) }),
      });
      if (!res.ok) throw new Error(await res.text());
      setBillsSaved(true);
    } catch {
      setBillsError('Failed to save. Please try again.');
    } finally {
      setBillsSaving(false);
    }
  }

  const updatePenalty = (key: PenaltyRuleKey, s: PenaltyState) => {
    setPenalties(prev => ({ ...prev, [key]: s }));
    setPenaltySavedKey(k => (k === key ? null : k));
    setPenaltyErrorKey(k => (k === key ? null : k));
  };

  async function savePenaltyRule(key: PenaltyRuleKey) {
    const st = penalties[key];
    const cfg = PENALTY_RULES.find(r => r.key === key)!;
    const modes = penaltyModes(cfg);
    setPenaltyErrorKey(null);
    setPenaltyErrorMsg(null);
    setPenaltySavedKey(null);
    const isDaily = st.valueType === 'daily';
    const num = st.value.trim() === '' ? null : Number(st.value);
    // 'daily' is computed at settlement and carries no configured value, so it
    // skips the amount checks and can be enabled with no number.
    if (!isDaily) {
      if (num !== null && (Number.isNaN(num) || num < 0)) {
        setPenaltyErrorKey(key); setPenaltyErrorMsg('Enter a valid amount (0 or more).'); return;
      }
      if (st.valueType === 'pct' && num !== null && num > 100) {
        setPenaltyErrorKey(key); setPenaltyErrorMsg('Enter a percentage between 0 and 100.'); return;
      }
      if (st.valueType === 'months' && num !== null && num > 12) {
        setPenaltyErrorKey(key); setPenaltyErrorMsg('Enter a number of months between 0 and 12.'); return;
      }
      if (st.enabled && (num == null || num <= 0)) {
        setPenaltyErrorKey(key); setPenaltyErrorMsg('Set an amount before enabling.'); return;
      }
    }
    // Map the single value onto the backend's _fee / _pct / _months / _daily
    // columns, nulling the inactive ones. Only send _months / _daily for rules
    // that support them (the API rejects unknown properties).
    const body: Record<string, unknown> = {
      [`${key}Enabled`]: st.enabled,
      [`${key}Fee`]: st.valueType === 'aed' ? num : null,
      [`${key}Pct`]: st.valueType === 'pct' ? num : null,
    };
    if (modes.includes('months')) body[`${key}Months`] = st.valueType === 'months' ? num : null;
    if (modes.includes('daily')) body[`${key}Daily`] = isDaily;
    setPenaltySavingKey(key);
    try {
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      setPenaltySavedKey(key);
    } catch {
      setPenaltyErrorKey(key); setPenaltyErrorMsg('Failed to save. Please try again.');
    } finally {
      setPenaltySavingKey(null);
    }
  }

  async function saveAllowedInstallments() {
    setInstSaving(true);
    setInstError(null);
    setInstSaved(false);
    try {
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // Empty selection ⇒ null ⇒ "no restriction" on the backend.
        body: JSON.stringify({ allowedInstallments: allowedInst.length ? [...allowedInst].sort((a, b) => a - b) : null }),
      });
      if (!res.ok) throw new Error(await res.text());
      setInstSaved(true);
    } catch {
      setInstError('Failed to save. Please try again.');
    } finally {
      setInstSaving(false);
    }
  }

  async function saveVatMode(next: 'annual' | 'installment') {
    setVatMode(next);
    setVatSaved(false);
    setVatSaving(true);
    try {
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rentVatMode: next }),
      });
      if (!res.ok) throw new Error(await res.text());
      setVatSaved(true);
    } catch {
      /* keep the UI selection; a transient failure just won't persist */
    } finally {
      setVatSaving(false);
    }
  }

  const CC_MAX = 5;

  /** Add the drafted address as a chip. Returns the resulting list, or null if
   *  the draft was rejected (invalid, duplicate, or over the cap). */
  function addCcDraft(): string[] | null {
    const value = ccDraft.trim().toLowerCase();
    if (!value) return ccEmails;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setCcError('Enter a valid email address.');
      return null;
    }
    if (ccEmails.includes(value)) {
      setCcError('That address is already on the list.');
      return null;
    }
    if (ccEmails.length >= CC_MAX) {
      setCcError(`You can copy at most ${CC_MAX} addresses.`);
      return null;
    }
    const next = [...ccEmails, value];
    setCcEmails(next);
    setCcDraft('');
    setCcError(null);
    setCcSaved(false);
    return next;
  }

  async function saveCcEmails() {
    // Save whatever is typed but not yet added as a chip, so a half-finished
    // entry isn't silently dropped by clicking Save.
    const list = addCcDraft();
    if (list === null) return;
    setCcSaving(true);
    setCcError(null);
    setCcSaved(false);
    try {
      const res = await fetch('/api/profiles/rental-provider/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ccEmails: list.length ? list : null }),
      });
      if (!res.ok) throw new Error(await res.text());
      setCcSaved(true);
    } catch {
      setCcError('Failed to save. Please try again.');
    } finally {
      setCcSaving(false);
    }
  }

  // Deep links to a card inside a section: ?tab=fee_rules#rules-market-review.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const t = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80);
    return () => window.clearTimeout(t);
  }, [mainTab]);

  // Stable close handler — the kit Modal re-runs its focus effect when onClose changes.
  const closePoaInvite = useCallback(() => setPoaInviteOpen(false), []);

  const tabMeta = TAB_META[mainTab];
  const tabGroup = SETTINGS_MENU.find(g => g.tabs.includes(mainTab))?.title;
  const contractOpt = CONTRACT_OPTS.find(o => o.value === contractType)!;
  const togglePreferredDay = (day: number) => {
    setPreferredDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort((a, b) => a - b));
    setDaysSaved(false);
  };
  const toggleChequeDay = (day: number) => {
    setChequeDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort((a, b) => a - b));
    setChequeSaved(false);
  };
  const accountTypeLabel =
    profileType === 'individual' ? 'Individual Landlord' :
    companyType === 'brokerage'  ? 'Property Management'       :
    companyType === 'agents'     ? 'Property Management Agent' :
                                   'Landlord Company';

  return (
    // The page is NOT one .gx scope: embedded Tailwind panels (Team, Email, KYC…) must sit
    // outside the kit's unlayered element resets. Each kit-built block carries its own .gx.
    // view="profile" is embedded by the Business › Profile & verification page, which
    // carries its own page head and padding — so no second head here.
    <div className={view === 'settings' ? 'gx-body' : undefined}>
      {view === 'settings' && (
        <div className="gx">
          <PageHead
            eyebrow="Settings"
            title="Settings"
            lede="How your business runs on UpNow. Each card saves on its own."
            actions={<>
              <Btn href="/rental-provider/dashboard/templates">Addendum templates</Btn>
              <Btn href="/rental-provider/dashboard/profile">My profile</Btn>
            </>}
          />
          <ScopeStrip items={[
            { label: 'Workspace', value: 'Settings' },
            { label: 'Section', value: <b>{tabGroup ? `${tabGroup} › ` : ''}{tabMeta.label}</b> },
            { label: 'Sets', value: tabMeta.desc },
          ]} />
        </div>
      )}

      {/* Settings menu on the left, grouped (owner, 12 Sep: seven pills in a row looked cluttered);
          the profile has its own page, so no Profile entry here. */}
      <div className={view === 'settings' ? 'lg:grid lg:grid-cols-[220px_minmax(0,1fr)] gap-[14px] items-start' : ''}>
      {view === 'settings' && (
        <nav aria-label="Settings sections" className="gx lg:sticky lg:top-4 mb-[14px] lg:mb-0">
          <Card>
            {SETTINGS_MENU.map(group => (
              <div key={group.title}>
                <div className="gx-lb" style={{ padding: '10px 13px 4px', margin: 0 }}>{group.title}</div>
                {group.tabs.filter(t => t !== 'whatsapp' || waOn).map(t => {
                  const { label, Icon } = TAB_META[t];
                  const on = mainTab === t;
                  return (
                    <button key={t} type="button" onClick={() => selectTab(t)} className="gx-qitem"
                      aria-current={on ? 'page' : undefined}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 13px', fontSize: 12.5,
                        fontWeight: on ? 700 : 500, color: on ? 'var(--ms-primary-dark)' : 'var(--ms-ink-2)',
                        ...(on ? { background: 'var(--ms-tint-pale)', borderLeftColor: 'var(--ms-primary)' } : null),
                      }}>
                      <Icon size={14} /> {label}
                    </button>
                  );
                })}
              </div>
            ))}
          </Card>
        </nav>
      )}
      <div className="min-w-0" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14, alignContent: 'start' }}>

      {/* ── Lists that moved in from the sidebar (owner, 12 Sep) — reused unchanged ── */}
      {mainTab === 'maintenance_list' && <MaintenanceListWorkspace embedded />}
      {mainTab === 'restoration' && <RestorationListWorkspace embedded />}
      {mainTab === 'building_inspections' && <BuildingInspectionsSettings embedded />}
      {mainTab === 'categories' && <AmcCategoriesView base="/amc" listHref="/rental-provider/dashboard/amc" embedded />}

      {/* ── Maintenance coverage — what's offered, per property type, and who does it ── */}
      {mainTab === 'maintenance' && <MaintenanceCoveragePanel />}

      {/* ── Legal — the landlord's own notice periods, appeal window and filing-fee rule ── */}
      {mainTab === 'legal' && (
        <>
          <SectionTitle
            title="Periods & fees for breaches and legal cases"
            sub="Every warning deadline, notice deadline, appeal window and pre-filled filing fee on your cases comes from here. Nothing is fixed in code."
          />
          <JurisdictionSettingsForm scope="landlord" load={() => legalApi.config('/legal')} save={(b) => legalApi.updateRpConfig(b)} reset={() => legalApi.resetRpConfig()} />
          <SectionTitle
            title="Legal fee book"
            sub="What each step costs and who is paid. Lines marked recoverable are charged to the customer once paid."
          />
          <FeeBookEditor />
        </>
      )}

      {mainTab === 'team' && <TeamPanel />}

      {/* ── Email — the landlord's own mailbox ── */}
      {mainTab === 'email' && <EmailSettingsPanel />}

      {/* ── WhatsApp — the landlord's own numbers (only where WhatsApp is switched on) ── */}
      {mainTab === 'whatsapp' && waOn && <WhatsAppSettingsPanel />}

      {/* ── Notifications ── */}
      {mainTab === 'notifications' && (
        <>
          {/* Correspondence — who gets copied on customer email */}
          <div className="gx" id="notif-cc">
            <Card title="Customer Correspondence" sub="Copies of every email your customers receive">
              <div className="gx-pad">
                <Lede>
                  Emails to your customers are sent by UpNow from <strong>noreply@upnow.ae</strong>. Add
                  addresses here and they are copied on every email your customers receive — payment
                  plans, renewal offers, contracts, settlements — so you hold exactly what they hold.
                  Customers can see the CC line and reply to all.
                </Lede>

                <label className="gx-lb" htmlFor="cc-draft" style={{ marginTop: 12 }}>
                  CC on customer emails <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>(up to {CC_MAX})</span>
                </label>

                {ccEmails.length > 0 && (
                  <div className="gx-chips" style={{ marginBottom: 8 }}>
                    {ccEmails.map(addr => (
                      <span key={addr} className="gx-pill primary" style={{ paddingRight: 4, fontSize: 11.5 }}>
                        {addr}
                        <button
                          type="button"
                          aria-label={`Remove ${addr}`}
                          title={`Remove ${addr}`}
                          onClick={() => { setCcEmails(ccEmails.filter(a => a !== addr)); setCcSaved(false); setCcError(null); }}
                          style={{ display: 'inline-flex', border: 0, background: 'transparent', padding: 2, borderRadius: 999, cursor: 'pointer' }}
                        >
                          <X size={12} aria-hidden />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="gx-btn-row">
                  <label className="gx-field" style={{ flex: 1, minWidth: 240 }}>
                    <Mail size={14} aria-hidden />
                    <input
                      id="cc-draft"
                      type="email"
                      value={ccDraft}
                      onChange={e => { setCcDraft(e.target.value); setCcSaved(false); setCcError(null); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCcDraft(); }
                      }}
                      disabled={ccEmails.length >= CC_MAX}
                      placeholder={ccEmails.length >= CC_MAX ? `Limit of ${CC_MAX} reached` : 'leasing@yourcompany.ae — press Enter to add'}
                    />
                  </label>
                  {user?.email && !ccEmails.includes(user.email.toLowerCase()) && ccEmails.length < CC_MAX && (
                    <Btn size="sm" onClick={() => { setCcEmails([...ccEmails, user.email!.toLowerCase()]); setCcSaved(false); setCcError(null); }}>
                      Add my account email
                    </Btn>
                  )}
                  <SaveBtn saving={ccSaving} onClick={saveCcEmails} label="Save" />
                </div>

                <div style={{ minHeight: 18, marginTop: 8 }}>
                  {ccError && <SaveNote error={ccError} />}
                  {ccSaved && !ccError && (
                    <SaveNote saved savedText={ccEmails.length
                      ? `Saved. ${ccEmails.length === 1 ? 'This address' : 'These addresses'} will be copied on every customer email.`
                      : 'Cleared. You will no longer receive a copy of customer emails.'} />
                  )}
                  {!ccSaved && !ccError && !ccEmails.length && !profileLoading && (
                    <Lede>No copies — you currently do not receive the emails your customers are sent.</Lede>
                  )}
                </div>
              </div>
            </Card>
          </div>

          {/* Only the wired toggles — see SHOW_NOTIF_PREFS / WIRED_NOTIF_KEYS. */}
          {SHOW_NOTIF_PREFS && (
            <div className="gx" id="notif-prefs">
              <Card title="Notification Preferences" sub="In the app and by email — saved as you switch">
                <div className="gx-pad">
                  {notifErr && <div style={{ marginBottom: 10 }}><SaveNote error={notifErr} /></div>}
                  <div style={{ display: 'grid', gap: 12 }}>
                    {WIRED_NOTIF_KEYS.map(key => (
                      <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <div>
                          <p style={{ fontSize: 12.5, fontWeight: 600 }}>{NOTIF_LABELS[key].title}</p>
                          <p style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>{NOTIF_LABELS[key].description}</p>
                        </div>
                        <Toggle value={notifs[key]} onChange={v => setNotif(key, v)} label={NOTIF_LABELS[key].title} />
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* Browser alerts — WhatsApp / email notifications from this browser while a portal tab is open. */}
          <BrowserAlertsCard showWhatsapp={waOn} />
        </>
      )}

      {/* ── Profile (My Profile page) ── */}
      {mainTab === 'general' && (
        <>
          <form onSubmit={handleSaveBiz} className="gx" id="profile-business">
            <Card
              title={profileLoading ? 'Business profile' : (profileType === 'company' ? (bizName || 'Your Company') : (ownerName || 'Your Name'))}
              sub={profileLoading ? 'Loading…' : (bizEmirate || 'UAE')}
              right={!profileLoading && (
                <Pill tone="primary" dot={false} title="Account type is locked in during onboarding">
                  {profileType === 'individual' ? <User size={11} aria-hidden /> : <Building2 size={11} aria-hidden />}
                  {accountTypeLabel}
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: 500, opacity: 0.75, marginLeft: 4 }}>
                    <Lock size={9} aria-hidden /> Set during onboarding
                  </span>
                </Pill>
              )}
            >
              {profileLoading ? (
                <div className="gx-pad" aria-busy="true" style={{ display: 'grid', gap: 10 }}>
                  {[0, 1, 2, 3].map(i => <div key={i} className="gx-skel" style={{ height: 30, width: i % 2 ? '60%' : '100%' }} />)}
                </div>
              ) : (
                <div className="gx-pad">
                  {/* Avatar — a local preview only (never uploaded, as before) */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                    <span style={{
                      width: 56, height: 56, borderRadius: 12, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: avatarPreview ? 'transparent' : 'var(--ms-primary)', color: '#fff', flexShrink: 0,
                    }}>
                      {avatarPreview
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={avatarPreview} alt="Profile picture preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : profileType === 'company' ? <Building2 size={24} aria-hidden /> : <User size={24} aria-hidden />}
                    </span>
                    <div>
                      <Btn size="sm" onClick={() => avatarInputRef.current?.click()}><Camera size={13} aria-hidden /> Choose picture</Btn>
                      <div className="gx-hint">Preview only — the picture is not saved to your profile yet.</div>
                    </div>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      aria-label="Choose profile picture"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) setAvatarPreview(URL.createObjectURL(file));
                      }}
                    />
                  </div>

                  {/* ── Individual fields ── */}
                  {profileType === 'individual' && (
                    <>
                      <div className="gx-two">
                        <Field label="Full Name" htmlFor="pf-name" hint={<><Lock size={9} aria-hidden /> From your account</>}>
                          <input id="pf-name" className="gx-inp" readOnly value={user?.name ?? ''} style={{ background: 'var(--ms-surface-2)', color: 'var(--ms-ink-3)', cursor: 'not-allowed' }} />
                        </Field>
                        <Field label="Emirates ID No." htmlFor="pf-eid">
                          <input id="pf-eid" className="gx-inp" value={emiratesId} onChange={e => setEmiratesId(e.target.value)} placeholder="784-XXXX-XXXXXXX-X" style={{ fontFamily: 'ui-monospace, Menlo, monospace' }} />
                        </Field>
                      </div>
                      <div className="gx-two">
                        <Field label="Phone" htmlFor="pf-phone">
                          <input id="pf-phone" className="gx-inp" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+971 50 123 4567" />
                        </Field>
                        <Field label="Email" htmlFor="pf-email" hint={<><Lock size={9} aria-hidden /> From your account</>}>
                          <input id="pf-email" className="gx-inp" readOnly value={user?.email ?? ''} style={{ background: 'var(--ms-surface-2)', color: 'var(--ms-ink-3)', cursor: 'not-allowed' }} />
                        </Field>
                      </div>
                      <div className="gx-two">
                        <Field label="Nationality" htmlFor="pf-nat">
                          <input id="pf-nat" className="gx-inp" value={nationality} onChange={e => setNationality(e.target.value)} placeholder="Emirati" />
                        </Field>
                        <Field label="Emirate" htmlFor="pf-emirate">
                          <select id="pf-emirate" className="gx-sel" value={bizEmirate} onChange={e => setBizEmirate(e.target.value)}>
                            <option value="">Select emirate…</option>
                            {EMIRATES_LIST.map(e => <option key={e}>{e}</option>)}
                          </select>
                        </Field>
                      </div>
                      <Field label="Address" htmlFor="pf-addr">
                        <input id="pf-addr" className="gx-inp" value={bizAddress} onChange={e => setBizAddress(e.target.value)} placeholder="Building, Street, Area" />
                      </Field>
                      <Field label="About" htmlFor="pf-about" hint={`${bizDesc.length}/500 · Shown here only — not saved to your profile yet.`}>
                        <textarea id="pf-about" className="gx-ta" value={bizDesc} onChange={e => setBizDesc(e.target.value)} rows={3} maxLength={500} placeholder="Brief note about your portfolio, areas you manage, etc." />
                      </Field>
                    </>
                  )}

                  {/* ── Company fields ── */}
                  {profileType === 'company' && (
                    <>
                      <div className="gx-two">
                        <Field label="Company Name" htmlFor="pf-company">
                          <input id="pf-company" className="gx-inp" value={bizName} onChange={e => setBizName(e.target.value)} placeholder="UpNow Real Estate LLC" />
                        </Field>
                        <Field label="Trade License No." htmlFor="pf-tl">
                          <input id="pf-tl" className="gx-inp" value={tradeLicense} onChange={e => setTradeLicense(e.target.value)} placeholder="DED-XXXXXXXX" />
                        </Field>
                      </div>
                      {/* Parent brokerage — only for Agents Company */}
                      {companyType === 'agents' && (
                        <Field label="Parent Brokerage" htmlFor="pf-parent">
                          <input id="pf-parent" className="gx-inp" value={parentBrokerageName} onChange={e => setParentBrokerageName(e.target.value)} placeholder="The brokerage you operate under" />
                        </Field>
                      )}
                      <div className="gx-two">
                        <Field label="Phone" htmlFor="pf-phone">
                          <input id="pf-phone" className="gx-inp" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+971 50 123 4567" />
                        </Field>
                        <Field label="Business Email" htmlFor="pf-email" hint={<><Lock size={9} aria-hidden /> From your account</>}>
                          <input id="pf-email" className="gx-inp" readOnly value={user?.email ?? ''} style={{ background: 'var(--ms-surface-2)', color: 'var(--ms-ink-3)', cursor: 'not-allowed' }} />
                        </Field>
                      </div>
                      <div className="gx-two">
                        <Field label="Website" htmlFor="pf-web" hint="Shown here only — not saved to your profile yet.">
                          <input id="pf-web" className="gx-inp" value={bizWebsite} onChange={e => setBizWebsite(e.target.value)} placeholder="www.company.ae" />
                        </Field>
                        <Field label="Emirate" htmlFor="pf-emirate">
                          <select id="pf-emirate" className="gx-sel" value={bizEmirate} onChange={e => setBizEmirate(e.target.value)}>
                            <option value="">Select emirate…</option>
                            {EMIRATES_LIST.map(e => <option key={e}>{e}</option>)}
                          </select>
                        </Field>
                      </div>
                      <Field label="Office Address" htmlFor="pf-addr">
                        <input id="pf-addr" className="gx-inp" value={bizAddress} onChange={e => setBizAddress(e.target.value)} placeholder="Building, Street, Area" />
                      </Field>
                      <Field label="About the Company" htmlFor="pf-about" hint={`${bizDesc.length}/500 · Shown here only — not saved to your profile yet.`}>
                        <textarea id="pf-about" className="gx-ta" value={bizDesc} onChange={e => setBizDesc(e.target.value)} rows={3} maxLength={500} placeholder="Brief description of your company, specialisations, and areas served…" />
                      </Field>
                    </>
                  )}

                  {/* TRN + Legal Notices Address — general profile fields (Authorized
                      Signatory & POA live in their own card below). */}
                  <div style={{ borderTop: '1px solid var(--ms-surface-3)', paddingTop: 13, marginTop: 4 }}>
                    <Field label="TRN (Tax Registration Number)" htmlFor="pf-trn">
                      <input id="pf-trn" className="gx-inp" value={vatTrn} onChange={e => { setVatTrn(e.target.value.replace(/[^0-9]/g, '')); setBizSaved(false); }} inputMode="numeric" maxLength={15} placeholder="15-digit TRN — leave blank if not VAT-registered" style={{ fontFamily: 'ui-monospace, Menlo, monospace' }} />
                    </Field>
                    <Field label="Legal Notices Address" htmlFor="pf-legal">
                      <input id="pf-legal" className="gx-inp" value={legalNoticesAddress} onChange={e => { setLegalNoticesAddress(e.target.value); setBizSaved(false); }} placeholder="Address where legal correspondence should be sent" />
                    </Field>
                  </div>

                  <CardFoot note={<>
                    <SaveNote error={bizError} saved={bizSaved && !savingBiz} savedText="Profile saved." />
                    {!bizError && !(bizSaved && !savingBiz) && (
                      <span className="gx-hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 0 }}>
                        <Lock size={10} aria-hidden /> Email changes require account verification.
                      </span>
                    )}
                  </>}>
                    <SaveBtn type="submit" saving={savingBiz} label="Save Profile" />
                  </CardFoot>
                </div>
              )}
            </Card>
          </form>

          {/* KYC Documents — landlord identity, licensing, banking and (when assigned) POA
              documents. Reuses KycDocumentsPanel (presigned-S3 upload flow); remounts via
              docsReloadKey after a profile save so a POA toggle is picked up immediately. */}
          <section className="gx-card" id="profile-kyc">
            <div className="gx gx-card-hd">
              <div>
                <h3>KYC Documents</h3>
                <div className="sub">
                  Upload your identity and licensing documents for verification.
                  {hasPoa && ' Power of Attorney documents are attached in the Authorized Signatory & POA section below.'}
                </div>
              </div>
            </div>
            <div style={{ padding: '13px 16px' }}>
              <KycDocumentsPanel
                key={docsReloadKey}
                profileApiPath="/profiles/rental-provider/me"
                ownerType="rental_provider"
                compact
                excludeKeys={POA_DOC_KEYS}
                allowDownload
              />
            </div>
          </section>

          {/* Authorized Signatory & Power of Attorney — its own card, saved independently. */}
          <form onSubmit={handleSavePoa} className="gx-card" id="profile-poa">
            <div className="gx gx-card-hd">
              <div>
                <h3>Authorized Signatory &amp; Power of Attorney</h3>
                <div className="sub">Record who signs on your behalf and attach their Power of Attorney documents.</div>
              </div>
            </div>
            <div className="gx gx-pad">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--ms-border)', background: 'var(--ms-surface-2)' }}>
                <p style={{ fontSize: 12.5, fontWeight: 600 }}>A Power of Attorney holder acts on my behalf</p>
                <Toggle value={hasPoa} onChange={toggleHasPoa} label="A Power of Attorney holder acts on my behalf" />
              </div>

              {hasPoa && (
                <div style={{ marginTop: 14 }}>
                  <Field label="Authorized Signatory Name" htmlFor="poa-name">
                    <input id="poa-name" className="gx-inp" value={authorizedSignatoryName} onChange={e => { setAuthorizedSignatoryName(e.target.value); setPoaSaved(false); }} placeholder="Person who signs on your behalf" />
                  </Field>
                  <div className="gx-two">
                    <Field label="POA Holder Phone" htmlFor="poa-phone">
                      <input id="poa-phone" className="gx-inp" value={poaPersonPhone} onChange={e => { setPoaPersonPhone(e.target.value); setPoaSaved(false); }} placeholder="+971 50 123 4567" />
                    </Field>
                    <Field label="POA Holder Email" htmlFor="poa-email">
                      <input id="poa-email" className="gx-inp" value={poaPersonEmail} onChange={e => { setPoaPersonEmail(e.target.value); setPoaSaved(false); }} placeholder="signatory@example.com" />
                    </Field>
                  </div>

                  {/* Invite the holder to act on the landlord's behalf inside the app */}
                  <Callout tone="info" title="Let them act on your behalf.">
                    Invite as a manager — a popup lets you review and edit their permissions (POA pre-selected) before sending. Their ID documents stay shared.
                    <div className="gx-btn-row" style={{ marginTop: 8 }}>
                      <Btn variant="primary" size="sm" onClick={() => { setInviteMsg(null); setPoaInviteOpen(true); }}>
                        <Send size={13} aria-hidden /> Invite as manager
                      </Btn>
                      {inviteMsg && <span role="status" style={{ fontSize: 11.5, color: 'var(--ms-primary-dark)' }}>{inviteMsg}</span>}
                    </div>
                  </Callout>

                  <div className="gx-lb" style={{ marginTop: 14 }}>Required Documents</div>
                </div>
              )}
            </div>

            {/* POA documents — attached directly here (embedded panel, outside the .gx scope) */}
            {hasPoa && (
              <div style={{ padding: '0 16px' }}>
                <KycDocumentsPanel
                  key={`poa-${docsReloadKey}`}
                  profileApiPath="/profiles/rental-provider/me"
                  ownerType="rental_provider"
                  compact
                  onlyKeys={POA_DOC_KEYS}
                  allowDownload
                />
              </div>
            )}

            <div className="gx gx-pad">
              {hasPoa && (
                <Lede style={{ fontSize: 11 }}>
                  The holder’s Emirates ID, Passport &amp; Visa are shared with their manager account once they’re invited and linked. Each document can be downloaded — the POA pack is often needed off-platform (Ejari, the bank, a notary).
                </Lede>
              )}
              <CardFoot note={<SaveNote error={poaError} saved={poaSaved && !savingPoa} />}>
                <SaveBtn type="submit" saving={savingPoa} label="Save Signatory & POA" />
              </CardFoot>
            </div>
          </form>

          {/* Banking Details — its own card; a landlord may hold multiple accounts. */}
          <form onSubmit={handleSaveBank} className="gx" id="profile-banking">
            <Card title="Banking Details" sub="Accounts you collect rent into. You can add more than one — the first is treated as your primary account.">
              <div className="gx-pad">
                {bankAccounts.length === 0 && (
                  <div className="gx-empty" style={{ padding: '14px 0' }}><b>No bank accounts added yet.</b>Add the account your rent is paid into.</div>
                )}

                <div style={{ display: 'grid', gap: 10 }}>
                  {bankAccounts.map((acct, i) => {
                    const update = (patch: Partial<BankAccount>) => {
                      setBankAccounts(prev => prev.map(b => b.id === acct.id ? { ...b, ...patch } : b));
                      setBankSaved(false);
                    };
                    const fid = (f: string) => `bank-${acct.id}-${f}`;
                    return (
                      <div key={acct.id} style={{ border: '1px solid var(--ms-border)', borderRadius: 10, padding: '11px 13px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                          <span className="strong" style={{ fontWeight: 700, fontSize: 12.5 }}>Account {i + 1}</span>
                          {i === 0 && <Pill tone="primary" dot={false}>Primary</Pill>}
                          <span style={{ marginLeft: 'auto' }}>
                            <Btn size="xs" variant="danger" onClick={() => { setBankAccounts(prev => prev.filter(b => b.id !== acct.id)); setBankSaved(false); }}>
                              Remove
                            </Btn>
                          </span>
                        </div>
                        <div className="gx-two">
                          <Field label="Account Holder Name" htmlFor={fid('name')}>
                            <input id={fid('name')} className="gx-inp" value={acct.accountName} onChange={e => update({ accountName: e.target.value })} placeholder="Name on bank account" />
                          </Field>
                          <Field label="Bank Name" htmlFor={fid('bank')}>
                            <input id={fid('bank')} className="gx-inp" value={acct.bankName} onChange={e => update({ bankName: e.target.value })} placeholder="e.g. Emirates NBD" />
                          </Field>
                          <Field label="IBAN" htmlFor={fid('iban')}>
                            <input id={fid('iban')} className="gx-inp" value={acct.iban} onChange={e => update({ iban: e.target.value })} placeholder="AE07 0331 2345 6789 0123 456" style={{ fontFamily: 'ui-monospace, Menlo, monospace' }} />
                          </Field>
                          <Field label="Account No. (optional)" htmlFor={fid('no')}>
                            <input id={fid('no')} className="gx-inp" value={acct.accountNumber} onChange={e => update({ accountNumber: e.target.value })} placeholder="1234567890" style={{ fontFamily: 'ui-monospace, Menlo, monospace' }} />
                          </Field>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: 10 }}>
                  <Btn size="sm" onClick={() => { setBankAccounts(prev => [...prev, newBankAccount()]); setBankSaved(false); }}>
                    <Plus size={13} aria-hidden /> Add bank account
                  </Btn>
                </div>

                <CardFoot note={<SaveNote error={bankError} saved={bankSaved && !savingBank} savedText="Banking details saved." />}>
                  <SaveBtn type="submit" saving={savingBank} label="Save Banking Details" />
                </CardFoot>
              </div>
            </Card>
          </form>
        </>
      )}

      {/* ── Rules (fee rules, schedules, penalties, plans, VAT, reviews, reminders) ── */}
      {mainTab === 'fee_rules' && (
        <>
          <nav aria-label="On this page" className="gx">
            <div className="gx-chips">
              {RULES_ANCHORS.map(a => <a key={a.id} href={`#${a.id}`} className="gx-chip">{a.label}</a>)}
            </div>
          </nav>

          {/* Fees: contract type × property type, with the live preview on the right */}
          <div id="rules-fees" className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-[14px] items-start" style={{ scrollMarginTop: 16 }}>
            <div className="gx min-w-0">
              <Card
                title={contractType === 'new' ? 'New Contract Fees' : 'Renewal Contract Fees'}
                sub="Customise each fee — UpNow defaults follow standard UAE practice."
              >
                <div className="gx-pad" style={{ display: 'grid', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span className="gx-lb" style={{ margin: 0 }}>Contract</span>
                    <PressSeg<ContractType>
                      label="Contract type" value={contractType}
                      options={CONTRACT_OPTS.map(o => ({ v: o.value, l: o.label }))}
                      onChange={setContractType}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span className="gx-lb" style={{ margin: 0 }}>Property type</span>
                    <PressSeg<FeeCategory>
                      label="Property type" value={feeTab}
                      options={FEE_TAB_CATEGORIES.map(cat => ({ v: cat, l: categoryDisplayLabel(cat) }))}
                      onChange={cat => { setFeeTab(cat); setFeesSaved(false); }}
                    />
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ms-ink-3)' }}>
                      <Pill tone="outline" dot={false}>{contractOpt.tag}</Pill> {contractOpt.desc}
                    </span>
                  </div>

                  {/* Mixed-use explainer — there is no separate mixed-use rate; a mixed-use
                      building's units are priced per unit against these Residential /
                      Commercial rules (resolved from the unit type). */}
                  <Callout tone="info">
                    <strong>Mixed-use buildings</strong> use these rules per unit — a residential unit follows your <strong>Residential</strong> rates (rent VAT-exempt) and a commercial unit follows your <strong>Commercial</strong> rates (5% rent VAT). There is no separate mixed-use rate to set.
                  </Callout>

                  {contractType === 'renewal' && (
                    <Callout tone="warn" title="Renewal logic:">
                      the refundable security deposit is collected once on the original contract and carries forward, so it&apos;s excluded here. Update only the fees that should re-charge on renewal.
                    </Callout>
                  )}

                  {/* Phase 6 — Annual rent increment default. Pre-fills the New Annual Rent
                      field on the Propose Renewal modal; the RP can still override per renewal. */}
                  {contractType === 'renewal' && (
                    <div style={{ border: '1px solid var(--ms-border)', borderRadius: 10, padding: '11px 13px', background: 'var(--ms-surface-2)' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 220 }}>
                          <label className="gx-lb" htmlFor="renewal-inc-pct">Annual rent increment</label>
                          <Lede style={{ fontSize: 11.5 }}>When you open Propose Renewal, the New Annual Rent field starts at the previous rent bumped by this percentage.</Lede>
                        </div>
                        <div className="gx-btn-row">
                          <Affix post="%">
                            <input
                              id="renewal-inc-pct"
                              type="number"
                              min={0}
                              max={100}
                              step="0.5"
                              value={renewalIncPct}
                              onChange={e => { setRenewalIncPct(e.target.value); setRenewalIncSaved(false); }}
                              placeholder="0"
                              style={{ ...affixInput, width: 72 }}
                            />
                          </Affix>
                          <SaveBtn saving={renewalIncSaving} onClick={saveRenewalIncrement} label="Save" />
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                        {renewalIncPct && !Number.isNaN(Number(renewalIncPct)) && Number(renewalIncPct) > 0 ? (
                          <Lede style={{ fontSize: 11.5 }}>
                            Preview: AED {previewRent.toLocaleString('en-AE')} →{' '}
                            <b style={{ color: 'var(--ms-ink)' }}>AED {Math.round(previewRent * (1 + Number(renewalIncPct) / 100)).toLocaleString('en-AE')}</b>
                          </Lede>
                        ) : <span />}
                        <SaveNote error={renewalIncError} saved={renewalIncSaved && !renewalIncSaving} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Fee rows */}
                {feesLoading ? (
                  <div className="gx-pad" aria-busy="true" style={{ display: 'grid', gap: 10 }}>
                    {FEE_ORDER.map(ft => <div key={ft} className="gx-skel" style={{ height: 38 }} />)}
                  </div>
                ) : (
                  <div className="gx-tbl-scroll" style={{ borderTop: '1px solid var(--ms-surface-3)' }}>
                    <table className="gx-tbl" style={{ minWidth: 880 }}>
                      <thead>
                        <tr><th>Fee</th><th>Charged as</th><th>Value</th><th>VAT</th><th className="num">Amount</th></tr>
                      </thead>
                      <tbody>
                        {FEE_ORDER.map(ft => (
                          <FeeRow
                            key={ft}
                            rule={feeRules[ft]}
                            rent={previewRent}
                            onChange={r => setRule(ft, r)}
                            isRenewal={contractType === 'renewal'}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="gx-pad" style={{ borderTop: '1px solid var(--ms-surface-3)', background: 'var(--ms-surface-2)', borderRadius: '0 0 12px 12px' }}>
                  <CardFoot note={<span style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>Changes apply to future contracts only — existing leases are unaffected.</span>}>
                    <SaveNote error={feesError} saved={feesSaved && !feesSaving} />
                    <Btn size="sm" onClick={loadDefaults}><RotateCcw size={13} aria-hidden /> Reset to UAE defaults</Btn>
                    <SaveBtn saving={feesSaving} onClick={handleSaveFees} label="Save changes" />
                  </CardFoot>
                </div>
              </Card>
            </div>

            <div className="gx xl:sticky xl:top-4">
              <FeePreviewPanel
                rules={feeRules}
                rent={previewRent}
                setRent={setPreviewRent}
                contractType={contractType}
                propertyType={feeTab}
                onSave={handleSaveFees}
                onLoadDefaults={loadDefaults}
                saving={feesSaving}
                saved={feesSaved}
                error={feesError}
              />
            </div>
          </div>

          {/* Contract scheduling */}
          <div className="gx gx-cols gx-cols-2e">
            <form onSubmit={handleSaveDays} id="rules-start-days" style={{ scrollMarginTop: 16, minWidth: 0 }}>
              <Card title="Contract Start Days" sub="Days of the month a contract can start">
                <div className="gx-pad">
                  <Lede style={{ marginBottom: 10 }}>
                    Customers will only be able to pick these days in the booking calendar. Leave empty to allow any date.
                  </Lede>
                  <DayChips days={preferredDays} onToggle={togglePreferredDay} label="Contract start days" />
                  {preferredDays.length > 0 && (
                    <Lede style={{ marginTop: 10, color: 'var(--ms-primary-dark)' }}>
                      Selected: {preferredDays.map(ordinal).join(', ')} of each month
                    </Lede>
                  )}
                  <CardFoot note={<SaveNote error={daysError} saved={daysSaved && !daysSaving} />}>
                    {preferredDays.length > 0 && <Btn size="sm" variant="ghost" onClick={() => { setPreferredDays([]); setDaysSaved(false); }}>Clear all</Btn>}
                    <SaveBtn type="submit" saving={daysSaving} label="Save Start Days" />
                  </CardFoot>
                </div>
              </Card>
            </form>

            <form onSubmit={handleSaveChequeDays} id="rules-cheque-days" style={{ scrollMarginTop: 16, minWidth: 0 }}>
              <Card title="Cheque Due Days" sub="Days of the month installments fall on">
                <div className="gx-pad">
                  <Lede style={{ marginBottom: 10 }}>
                    Select the days your cheque / installment payments should fall on (e.g. 1st, 10th, 25th). Auto-generated payment plans snap each recurring cheque to the nearest of these days, so collections land on a consistent day every period. Leave empty to use the contract start day.
                  </Lede>
                  <DayChips days={chequeDays} onToggle={toggleChequeDay} label="Cheque due days" />
                  {chequeDays.length > 0 && (
                    <Lede style={{ marginTop: 10, color: 'var(--ms-primary-dark)' }}>
                      Cheques due on the {chequeDays.map(ordinal).join(', ')} of each period
                    </Lede>
                  )}
                  <CardFoot note={<SaveNote error={chequeError} saved={chequeSaved && !chequeSaving} />}>
                    {chequeDays.length > 0 && <Btn size="sm" variant="ghost" onClick={() => { setChequeDays([]); setChequeSaved(false); }}>Clear all</Btn>}
                    <SaveBtn type="submit" saving={chequeSaving} label="Save Cheque Days" />
                  </CardFoot>
                </div>
              </Card>
            </form>
          </div>

          {/* Penalty & charge rules. Early Termination (months of rent) and Late Move-out
              (daily prorate) carry purpose-built modes; the others are flat / %. */}
          <div className="gx" id="rules-penalties" style={{ scrollMarginTop: 16 }}>
            <Card title="Penalty & charge rules" sub="Seeded as editable deductions at settlement and as contract charges. Each rule saves on its own.">
              <div className="gx-tbl-scroll">
                <table className="gx-tbl" style={{ minWidth: 900 }}>
                  <thead>
                    <tr><th>Rule</th><th>On</th><th>Charged as</th><th>Amount</th><th className="act">Save</th></tr>
                  </thead>
                  <tbody>
                    {PENALTY_RULES.map(cfg => (
                      <PenaltyRow
                        key={cfg.key}
                        cfg={cfg}
                        state={penalties[cfg.key]}
                        saving={penaltySavingKey === cfg.key}
                        saved={penaltySavedKey === cfg.key}
                        error={penaltyErrorKey === cfg.key ? penaltyErrorMsg : null}
                        onChange={(s) => updatePenalty(cfg.key, s)}
                        onSave={() => savePenaltyRule(cfg.key)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <div className="gx gx-cols gx-cols-2e">
            {/* Payment Installment Plans */}
            <div id="rules-installments" style={{ scrollMarginTop: 16, minWidth: 0 }}>
              <Card title="Payment Installment Plans" sub="The cheque-split plans you offer">
                <div className="gx-pad">
                  <Lede style={{ marginBottom: 10 }}>
                    Only the selected plans appear wherever a payment schedule is set up — your contract forms, the customer booking flow and the public listing. Select none to allow every plan.
                  </Lede>
                  <div className="gx-chips" role="group" aria-label="Installment plans offered">
                    {INSTALLMENT_PLANS.map(p => (
                      <button
                        key={p.value}
                        type="button"
                        className="gx-chip"
                        aria-pressed={allowedInst.includes(p.value)}
                        onClick={() => {
                          setAllowedInst(prev =>
                            prev.includes(p.value) ? prev.filter(v => v !== p.value) : [...prev, p.value].sort((a, b) => a - b),
                          );
                          setInstSaved(false);
                        }}
                      >
                        {p.value} · {p.label}
                      </button>
                    ))}
                  </div>
                  <Lede style={{ marginTop: 10, ...(allowedInst.length ? { color: 'var(--ms-primary-dark)' } : null) }}>
                    {allowedInst.length === 0
                      ? 'All plans available — no restriction.'
                      : `Offered: ${allowedInst.map(v => installmentLabel(v)).join(', ')}.`}
                  </Lede>
                  <CardFoot note={<SaveNote error={instError} saved={instSaved && !instSaving} />}>
                    {allowedInst.length > 0 && <Btn size="sm" variant="ghost" onClick={() => { setAllowedInst([]); setInstSaved(false); }}>Clear all</Btn>}
                    <SaveBtn saving={instSaving} onClick={saveAllowedInstallments} label="Save Plans" />
                  </CardFoot>
                </div>
              </Card>
            </div>

            {/* Rent VAT collection — saved the moment an option is picked */}
            <div id="rules-rent-vat" style={{ scrollMarginTop: 16, minWidth: 0 }}>
              <Card title="Rent VAT collection" sub="Saved as soon as you pick an option">
                <div className="gx-pad">
                  <Lede style={{ marginBottom: 10 }}>
                    How the 5% VAT on VATable (commercial / industrial) rent is collected. Rent and fee
                    cheques are always <strong>net</strong> — VAT is a separate cheque. Rent VAT follows
                    this setting; fee VAT (admin / Contract Registration / commission) is always one separate cheque.
                    Applies to new contracts and renewals; VAT-exempt (residential) leases are unaffected.
                  </Lede>
                  <div className="gx-chips" role="group" aria-label="Rent VAT collection">
                    {([
                      { value: 'installment' as const, label: 'One VAT cheque per rent cheque', sub: 'Matches quarterly VAT filing' },
                      { value: 'annual'      as const, label: 'One annual VAT cheque',          sub: 'Single annual tax invoice' },
                    ]).map(opt => {
                      const active = vatMode === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          className="gx-chip"
                          aria-pressed={active}
                          disabled={vatSaving}
                          onClick={() => saveVatMode(opt.value)}
                          style={{ borderRadius: 10, textAlign: 'left', padding: '7px 12px' }}
                        >
                          {opt.label}
                          <span style={{ display: 'block', fontSize: 10.5, fontWeight: 500, opacity: 0.8 }}>{opt.sub}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ minHeight: 18, marginTop: 8 }}>
                    {vatSaving && <Lede>Saving…</Lede>}
                    <SaveNote saved={vatSaved && !vatSaving} />
                  </div>
                </div>
              </Card>
            </div>
          </div>

          <div className="gx gx-cols gx-cols-2e">
            {/* Market rate review schedule (owner, 7 Oct 2026). Its own card — the rates serve
                new leases and renewals alike. Whether a period is reviewed is read off the rates
                actually set (Units page) and shown on Units and in the Operation Plan report. */}
            <div id="rules-market-review" style={{ scrollMarginTop: 16, minWidth: 0 }}>
              <Card title="Market Rate Review" sub="For new leases and renewals alike">
                <div className="gx-pad">
                  <Lede style={{ marginBottom: 10 }}>
                    How often the manager reviews the market rates and updates the asking rents in the unit mix. A period counts as reviewed once a layout&apos;s rate is set in it — shown on the Units page and in the Operation Plan.
                  </Lede>
                  <div className="gx-two">
                    <Field label="How often" htmlFor="market-review-period">
                      <select
                        id="market-review-period"
                        className="gx-sel"
                        value={reviewPeriod}
                        onChange={e => { setReviewPeriod(e.target.value as 'monthly' | 'quarterly' | 'half_yearly' | 'yearly'); setReviewSaved(false); }}
                      >
                        <option value="monthly">Every month</option>
                        <option value="quarterly">Every quarter</option>
                        <option value="half_yearly">Every half-year</option>
                        <option value="yearly">Every year</option>
                      </select>
                    </Field>
                    <Field label="By day (of the first month)" htmlFor="market-review-due-day" hint="1 – 28">
                      <input
                        id="market-review-due-day"
                        className="gx-inp"
                        type="number"
                        min={1}
                        max={28}
                        step="1"
                        value={reviewDueDay}
                        onChange={e => { setReviewDueDay(e.target.value); setReviewSaved(false); }}
                      />
                    </Field>
                  </div>
                  {(() => {
                    const day = Number(reviewDueDay) || 15;
                    const months = reviewPeriod === 'quarterly' ? ['Jan', 'Apr', 'Jul', 'Oct'] : reviewPeriod === 'half_yearly' ? ['Jan', 'Jul'] : ['Jan'];
                    return <Evid>Rates updated by <strong>{reviewPeriod === 'monthly' ? `day ${day} of every month` : months.map(m => `${day} ${m}`).join(' · ')}</strong>.</Evid>;
                  })()}
                  <CardFoot note={<SaveNote error={reviewError} saved={reviewSaved && !reviewSaving} />}>
                    <SaveBtn saving={reviewSaving} onClick={saveMarketRateReview} label="Save" />
                  </CardFoot>
                </div>
              </Card>
            </div>

            {/* Bills from email (0382/0385) — how often the mailbox is checked for bills;
                the AMC page shows the last and next check and has a "Check now" button. */}
            <div id="rules-bills" style={{ scrollMarginTop: 16, minWidth: 0 }}>
              <Card title="Bills from Email" sub="DEWA and e& bills filed on AMC contracts">
                <div className="gx-pad">
                  <Lede style={{ marginBottom: 10 }}>
                    How often the connected mailbox is checked for DEWA and e&amp; bills, which are then filed on the AMC contract holding the account number. The AMC page shows the last and next check and can check at once.
                  </Lede>
                  <Field label="Check the mailbox" htmlFor="bills-email-every">
                    <select
                      id="bills-email-every"
                      className="gx-sel"
                      value={billsEvery}
                      onChange={e => { setBillsEvery(e.target.value); setBillsSaved(false); }}
                    >
                      <option value="1">Every hour</option>
                      <option value="3">Every 3 hours</option>
                      <option value="6">Every 6 hours</option>
                      <option value="12">Every 12 hours</option>
                      <option value="24">Once a day</option>
                      <option value="168">Once a week</option>
                    </select>
                  </Field>
                  <Evid>Bills are filed on their contracts <strong>{billsEvery === '1' ? 'every hour' : billsEvery === '24' ? 'once a day' : billsEvery === '168' ? 'once a week' : `every ${billsEvery} hours`}</strong>.</Evid>
                  <CardFoot note={<SaveNote error={billsError} saved={billsSaved && !billsSaving} />}>
                    <SaveBtn saving={billsSaving} onClick={saveBillsFromEmail} label="Save" />
                  </CardFoot>
                </div>
              </Card>
            </div>
          </div>

          {/* Reminders to WhatsApp (0386) — the AMC bills reminder (and contracts awaiting
              signature) posted to the chosen group at the chosen time; the preview is the exact text. */}
          <div className="gx" id="rules-reminders" style={{ scrollMarginTop: 16 }}>
            <Card title="WhatsApp Reminders" sub="Posted once a day to one of your WhatsApp groups">
              <div className="gx-pad">
                <Lede style={{ marginBottom: 10 }}>
                  The AMC bills to pay (account, bill, due date and a link to pay), then, when there are any, the contracts awaiting your signature with your signing link. Pick the group and the time; the text below is what goes out.
                </Lede>
                <div className="gx-two">
                  <Field label="WhatsApp group" htmlFor="reminders-group">
                    <select
                      id="reminders-group"
                      className="gx-sel"
                      value={remChat}
                      onChange={e => { setRemChat(e.target.value); setRemSaved(false); }}
                    >
                      <option value="">Off — no group</option>
                      {remGroups.map(g => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Time of day (Dubai)" htmlFor="reminders-time">
                    <input
                      id="reminders-time"
                      className="gx-inp"
                      type="time"
                      value={remTime}
                      onChange={e => { setRemTime(e.target.value); setRemSaved(false); }}
                    />
                  </Field>
                </div>
                <Evid>
                  {remChat ? <>Posted to <strong>{remGroups.find(g => String(g.id) === remChat)?.name ?? 'the group'}</strong> every day at <strong>{remTime}</strong> Dubai time.</> : 'Off until a group is picked.'}
                  {remPreview?.last && <> Last post {new Date(remPreview.last.at).toLocaleString('en-AE', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}{remPreview.last.chatName ? ` to ${remPreview.last.chatName}` : ''}: {remPreview.last.status === 'sent' ? 'posted' : `not sent${remPreview.last.error ? ` — ${remPreview.last.error}` : ''}`}.</>}
                </Evid>
                <CardFoot note={<SaveNote error={remError} saved={remSaved && !remSaving} />}>
                  <SaveBtn saving={remSaving} onClick={saveReminders} label="Save" />
                </CardFoot>

                {remPreview && (
                  <div style={{ marginTop: 14, border: '1px solid var(--ms-border)', borderRadius: 10, background: 'var(--ms-surface-2)', padding: '11px 13px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                      <p style={{ fontSize: 12, fontWeight: 700 }}>AMC bills reminder for today — {remPreview.bills} {remPreview.bills === 1 ? 'bill' : 'bills'}{remPreview.overdue ? `, ${remPreview.overdue} overdue` : ''}</p>
                      <div className="gx-btn-row">
                        {remSendNote && <span role="status" style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>{remSendNote}</span>}
                        <Btn size="sm" onClick={sendReminderNow} disabled={remSending || !remChat} title={!remChat ? 'Pick a group first' : undefined}>
                          <Send size={13} aria-hidden /> {remSending ? 'Sending…' : 'Send now'}
                        </Btn>
                      </div>
                    </div>
                    <pre id="reminders-preview" style={{ margin: 0, fontFamily: 'inherit', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--ms-ink)' }}>{remPreview.message}</pre>
                  </div>
                )}
                {remPreview?.signatures && (
                  <div style={{ marginTop: 10, border: '1px solid var(--ms-border)', borderRadius: 10, background: 'var(--ms-surface-2)', padding: '11px 13px' }}>
                    <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Second message — {remPreview.signatures.count} {remPreview.signatures.count === 1 ? 'contract' : 'contracts'} awaiting your signature. The link is your own signing link; a fresh one is issued when the message is posted if the last one has expired.</p>
                    <pre id="reminders-signatures-preview" style={{ margin: 0, fontFamily: 'inherit', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--ms-ink)' }}>{remPreview.signatures.message}</pre>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </>
      )}

      {/* POA holder invite popup — editable permissions */}
      <Modal
        open={poaInviteOpen}
        onClose={closePoaInvite}
        title="Invite to act as manager"
        width={520}
        footer={
          <>
            {inviteMsg && <span role="alert" style={{ fontSize: 11.5, color: 'var(--ms-danger)', marginRight: 'auto' }}>{inviteMsg}</span>}
            {!inviteMsg && !Object.values(poaPerms).some(Boolean) && <span style={{ fontSize: 11, color: 'var(--ms-ink-3)', marginRight: 'auto' }}>Select at least one permission.</span>}
            <Btn onClick={closePoaInvite}>Cancel</Btn>
            <Btn
              variant="primary"
              onClick={handleSendPoaInvite}
              disabled={sendingPoaInvite || !poaPersonEmail.trim() || !Object.values(poaPerms).some(Boolean)}
            >
              {sendingPoaInvite ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Send size={13} aria-hidden />}
              {sendingPoaInvite ? 'Sending…' : 'Send invitation'}
            </Btn>
          </>
        }
      >
        <div className="gx-two">
          <Field label="Name" htmlFor="poa-inv-name">
            <input id="poa-inv-name" className="gx-inp" value={authorizedSignatoryName} onChange={e => { setAuthorizedSignatoryName(e.target.value); setPoaSaved(false); }} placeholder="Person who signs on your behalf" />
          </Field>
          <Field label="Email" htmlFor="poa-inv-email">
            <input id="poa-inv-email" className="gx-inp" value={poaPersonEmail} onChange={e => { setPoaPersonEmail(e.target.value); setPoaSaved(false); }} placeholder="signatory@example.com" />
          </Field>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, margin: '4px 0 8px' }}>
          <p style={{ fontSize: 12.5, fontWeight: 700 }}>Permissions</p>
          <Btn size="xs" variant="ghost" onClick={() => setPoaPerms({ ...POA_INVITE_DEFAULTS })}>Reset to POA defaults</Btn>
        </div>
        <div style={{ display: 'grid', gap: 14 }}>
          {PERM_GROUPS.map(group => (
            <div key={group.label}>
              <div className="gx-lb">{group.label}</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {group.perms.map(perm => (
                  <div key={perm.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontSize: 12.5, color: 'var(--ms-ink-2)' }}>{perm.label}</span>
                    <Toggle value={!!poaPerms[perm.meta]} onChange={v => setPoaPerms(p => ({ ...p, [perm.meta]: v }))} label={perm.label} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Modal>
      </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return <RpSettings view="settings" />;
}
