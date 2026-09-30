'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Users, Plus, Mail, Phone, Trash2, RefreshCw, Clock, ChevronRight, X, ShieldCheck,
} from 'lucide-react';
import { apiGet, apiPost, apiDelete, apiPatch } from '@/lib/api';
import { useBackClose } from '@/lib/useSlideOver';
import { SectionHeader } from '@/components/dashboard/DashboardWidgets';
import { REPORT_TILES, GROUPS } from '@/components/upnow/reportCatalog';
import { useWhatsappEnabled } from '@/lib/useWhatsappEnabled';

/** Reports a manager can be granted access to — the live ones a manager can
 *  actually open (rpOnly reports 403 in the manager portal, so granting them
 *  is dead UI). Kept with their catalog group so the checklist can mirror the
 *  Reports page grouping. */
const AVAILABLE_REPORTS = REPORT_TILES.filter((r) => r.available && !r.rpOnly && !r.hidden)
  .map((r) => ({ slug: r.slug, title: r.title, group: r.group }));

/** The checklist grouped the same way — and in the same order — as the Reports
 *  page, dropping any group that has no grantable reports. */
const REPORT_GROUPS = GROUPS
  .map((g) => ({ title: g.title, reports: AVAILABLE_REPORTS.filter((r) => r.group === g.key) }))
  .filter((g) => g.reports.length > 0);

// ─── Types ───────────────────────────────────────────────────────────────────

interface ManagerPermissions {
  id: number;
  managerUserId: number;
  /** Per-landlord activation — false = deactivated for this landlord. */
  isActive: boolean;
  // Properties & listings
  canListProperties:    boolean;
  canEditProperties:    boolean;
  canPublishListings:   boolean;
  canManageDocuments:   boolean;
  canDeleteDocuments:   boolean;
  // Leads & viewings
  canManageViewings:    boolean;
  canCreateLeads:       boolean;
  canReviewLeadDocuments: boolean;
  canManageLeadDocuments: boolean;
  canManageLeaseDocuments: boolean;
  // Customers & contracts
  canManageAgreements:  boolean;
  canCreateContracts:   boolean;
  canManageContractLifecycle: boolean;
  canManageRenewals:    boolean;
  canManageTermination: boolean;
  canManageInspections: boolean;
  canManageTemplates:   boolean;
  // Signing
  canSignDocuments:     boolean;
  canSignAddenda:       boolean;
  canManageEjari:       boolean;
  canActAsPoa:          boolean;
  // Finance
  canManageDeposits:    boolean;
  canSettleDeposits:    boolean;
  canRecordPayments:    boolean;
  canClearCheques:      boolean;
  canManageCollections: boolean;
  canViewFinancials:    boolean;
  canViewReports:       boolean;
  // Maintenance & communication
  canManageMaintenance: boolean;
  canManageVendors:     boolean;
  canManageAmc:         boolean;
  canRecordVendorPayments: boolean;
  canHandOverCheques:   boolean;
  canManageLegal:       boolean;
  canCommunicateTenants: boolean;
  canReadEmails: boolean;
  canSendEmails: boolean;
  canReadWhatsapp: boolean;
  canSendWhatsapp: boolean;
  // Per-report access — report slugs (empty = all reports)
  reportAccess:         string[];
}

interface ManagerMember {
  id: number;
  userId: number;
  status: string;
  /** Per-landlord activation. A deactivated manager keeps every permission flag
   *  but is blocked from acting for this landlord until re-activated. */
  active?: boolean;
  jobTitle?: string | null;
  createdAt: string;
  user: { id: number; name: string; email: string; phone: string | null };
}

interface Invitation {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  expiresAt: string;
  metadata: Record<string, boolean> | null;
}

// ─── Permission groups for the UI ────────────────────────────────────────────

// Groups mirror the Rental Provider sidebar navigation so an RP can adjust a
// team member's access section-by-section, exactly as they see their own menu.
export const PERM_GROUPS = [
  {
    label: 'Leads & Viewings',
    description: 'The Leads section',
    perms: [
      { key: 'canManageViewings',    label: 'Manage leads & viewings',      meta: 'can_manage_viewings' },
      // Creating a lead also creates the customer's portal account, so it's its
      // own grant — same split as "View & manage leases" vs "Create contracts".
      { key: 'canCreateLeads',       label: 'Add new leads',                meta: 'can_create_leads' },
      { key: 'canReviewLeadDocuments', label: 'Review & request customer documents on leads', meta: 'can_review_lead_documents' },
      { key: 'canManageLeadDocuments', label: 'Upload, approve & date customer documents on leads', meta: 'can_manage_lead_documents' },
    ],
  },
  {
    label: 'Properties & Units',
    description: 'The Properties and Units sections',
    perms: [
      { key: 'canListProperties',    label: 'View properties & units',      meta: 'can_list_properties' },
      { key: 'canEditProperties',    label: 'Edit property & unit details', meta: 'can_edit_properties' },
      { key: 'canPublishListings',   label: 'Publish / unpublish listings', meta: 'can_publish_listings' },
      { key: 'canManageDocuments',   label: 'Upload & manage property & unit documents', meta: 'can_manage_documents' },
      // Separate from the row above on purpose: attaching a document and
      // destroying one are different authorities, and the landlord grants the
      // second deliberately. Applies everywhere documents are listed, not just
      // properties. Off for every existing manager (migration 0247).
      { key: 'canDeleteDocuments',   label: 'Delete documents',             meta: 'can_delete_documents' },
    ],
  },
  {
    label: 'Leases & Contracts',
    description: 'Also unlocks the Customers, Operations & Ended-Leases sections',
    perms: [
      { key: 'canManageAgreements',  label: 'View & manage leases + customers', meta: 'can_manage_agreements' },
      { key: 'canManageLeaseDocuments', label: 'Upload & manage lease, customer & deposit documents', meta: 'can_manage_lease_documents' },
      { key: 'canCreateContracts',   label: 'Create new contracts',         meta: 'can_create_contracts' },
      { key: 'canManageContractLifecycle', label: 'Issue / activate / cancel leases', meta: 'can_manage_contract_lifecycle' },
      { key: 'canManageRenewals',    label: 'Manage contract renewals',     meta: 'can_manage_renewals' },
      { key: 'canManageTermination', label: 'Terminate leases',             meta: 'can_manage_termination' },
      { key: 'canManageInspections', label: 'Inspections & Restoration List', meta: 'can_manage_inspections' },
      { key: 'canSignDocuments',     label: 'Sign tenancy contracts',       meta: 'can_sign_documents' },
      { key: 'canSignAddenda',       label: 'Sign addenda & amendments',    meta: 'can_sign_addenda' },
      { key: 'canManageEjari',       label: 'Register / manage Contract Registration',      meta: 'can_manage_ejari' },
      { key: 'canActAsPoa',          label: 'Act with full POA (Power of Attorney)', meta: 'can_act_as_poa' },
    ],
  },
  {
    label: 'Payments & Deposits',
    description: 'The Payments and Deposits sections',
    perms: [
      { key: 'canManageDeposits',    label: 'Manage security deposits',     meta: 'can_manage_deposits' },
      { key: 'canSettleDeposits',    label: 'Settle deposits (refund / deduct)', meta: 'can_settle_deposits' },
      { key: 'canRecordPayments',    label: 'Record & edit payments',       meta: 'can_record_payments' },
      { key: 'canClearCheques',      label: 'Change cheque status (cleared / bounced)', meta: 'can_clear_cheques' },
      { key: 'canManageCollections', label: 'Manage rent collections',      meta: 'can_manage_collections' },
      { key: 'canViewFinancials',    label: 'View financial statements',    meta: 'can_view_financials' },
      // Only for a landlord with a separate head office (0326): the collector
      // hands cheques / cash in and takes them back, and sees the custody trail.
      { key: 'canHandOverCheques',   label: 'Hand cheques to head office (landlords with a separate head office)', meta: 'can_hand_over_cheques' },
    ],
  },
  {
    label: 'Templates',
    description: 'The Templates section',
    perms: [
      { key: 'canManageTemplates',   label: 'Manage addendum templates',    meta: 'can_manage_templates' },
    ],
  },
  {
    label: 'Maintenance & Legal',
    description: 'Requests, the vendor roster, AMC contracts, vendor payments, and breaches & legal cases (0275, 0285, 0319)',
    perms: [
      { key: 'canManageMaintenance', label: 'Handle maintenance requests & coverage', meta: 'can_manage_maintenance' },
      { key: 'canManageVendors',     label: 'Handle vendors (roster, invites, licences)', meta: 'can_manage_vendors' },
      { key: 'canManageAmc',         label: 'Handle AMC contracts & visits (add, edit, cancel, renew)', meta: 'can_manage_amc' },
      { key: 'canRecordVendorPayments', label: 'Record vendor payments (AMC bills, installments paid, expenses report)', meta: 'can_record_vendor_payments' },
      { key: 'canManageLegal',       label: 'Handle breaches & legal cases', meta: 'can_manage_legal' },
    ],
  },
  // Email and WhatsApp: reading and sending are granted apart, per channel. Without
  // "read" the team member sees nothing of it — not the menu entry, not the inbox,
  // not the Emails / WhatsApp section of a lead, lease, customer or vendor, not the
  // unread icon on Operations. "Send" needs "read", so the two move together.
  {
    label: 'Emails',
    description: 'Your mailbox — the Emails page, and the Emails section of leads, leases, customers and vendors',
    perms: [
      { key: 'canReadEmails', label: 'Read emails — every email in your mailbox, the Other tab included', meta: 'can_read_emails' },
      { key: 'canSendEmails', label: 'Send emails — write, reply, reply all and forward from your mailbox', meta: 'can_send_emails', requires: 'canReadEmails' },
    ],
  },
  {
    label: 'WhatsApp',
    description: 'Your WhatsApp numbers — the WhatsApp page, and the WhatsApp section of leads, leases, customers and vendors',
    perms: [
      { key: 'canReadWhatsapp', label: 'Read WhatsApp conversations', meta: 'can_read_whatsapp' },
      { key: 'canSendWhatsapp', label: 'Send on WhatsApp — answer, start a chat, send files and voice notes', meta: 'can_send_whatsapp', requires: 'canReadWhatsapp' },
    ],
  },
  {
    label: 'Reports',
    description: 'The Reports section (per-report access below)',
    perms: [
      { key: 'canViewReports',       label: 'Access reports section',       meta: 'can_view_reports' },
    ],
  },
  // NOTE: Settings (Fee/VAT rules, penalty/installment rules, Team) is
  // rental-provider-only — intentionally NOT delegatable to managers.
] as const;

// ─── Schema ──────────────────────────────────────────────────────────────────

export const metaDefaults = {
  // Properties & listings — a fresh manager can VIEW but not mutate.
  can_list_properties:    true,
  can_edit_properties:    false,
  can_publish_listings:   false,
  can_manage_documents:   false,
  can_delete_documents:   false,
  // Leads & viewings
  can_manage_viewings:    true,
  can_create_leads:       false,
  can_review_lead_documents: true,
  can_manage_lead_documents: false,
  can_manage_lease_documents: false,
  // Customers & contracts
  can_manage_agreements:  true,
  can_create_contracts:   false,
  can_manage_contract_lifecycle: false,
  can_manage_renewals:    false,
  can_manage_termination: false,
  can_manage_inspections: false,
  can_manage_templates:   false,
  // Signing
  can_sign_documents:     false,
  can_sign_addenda:       false,
  can_manage_ejari:       false,
  can_act_as_poa:         false,
  // Finance
  can_manage_deposits:    false,
  can_settle_deposits:    false,
  can_record_payments:    false,
  can_clear_cheques:      false,
  can_manage_collections: false,
  can_view_financials:    false,
  can_view_reports:       true,
  // Maintenance & communication
  can_manage_maintenance: false,
  can_manage_vendors:     false,
  can_manage_amc:         false,
  can_record_vendor_payments: false,
  can_hand_over_cheques:  false,
  can_manage_legal:       false,
  can_communicate_tenants: false,
  // Email and WhatsApp start off: a customer's whole trail is granted, never assumed.
  can_read_emails:        false,
  can_send_emails:        false,
  can_read_whatsapp:      false,
  can_send_whatsapp:      false,
};

// ─── Role presets (editable starting templates) ──────────────────────────────
// Each preset pre-selects a sensible bundle of flags; the RP can still adjust
// individual toggles afterwards. Keyed by the camelCase permission key.
export const ROLE_PRESETS: { id: string; label: string; keys: string[]; /** Report slugs the preset opens; omitted = every report. */ reports?: string[] }[] = [
  {
    id: 'leasing_agent',
    label: 'Leasing Agent',
    keys: ['canListProperties', 'canPublishListings', 'canManageViewings', 'canCreateLeads', 'canReviewLeadDocuments', 'canManageLeadDocuments', 'canManageAgreements', 'canManageLeaseDocuments', 'canCreateContracts', 'canCommunicateTenants'],
  },
  {
    id: 'accountant',
    label: 'Accountant / Finance',
    // Finance only — no Properties & Units (owner, 22 Sep 2026: "what will the
    // accountant do with properties and units?"); vendor payments come with it.
    // Properties came back on 23 Sep ("see the available properties but not the
    // market price") — the pages hide asking / market rent for a finance-only
    // manager and keep them off the Units workspace.
    keys: ['canListProperties', 'canManageDeposits', 'canSettleDeposits', 'canRecordPayments', 'canClearCheques', 'canManageCollections', 'canViewFinancials', 'canRecordVendorPayments', 'canViewReports'],
    // Two reports and the dashboard (owner, 23 Sep 2026: "report only for cash
    // management and cheque management and dashboard for accounts").
    reports: ['rent-receivable', 'cheques-management'],
  },
  {
    id: 'operations',
    label: 'Operations / Property Manager',
    keys: ['canListProperties', 'canEditProperties', 'canPublishListings', 'canManageDocuments', 'canManageViewings', 'canCreateLeads', 'canReviewLeadDocuments', 'canManageLeadDocuments', 'canManageAgreements', 'canManageLeaseDocuments', 'canCreateContracts', 'canManageContractLifecycle', 'canManageRenewals', 'canManageTermination', 'canManageInspections', 'canManageTemplates', 'canManageEjari', 'canManageMaintenance', 'canManageVendors', 'canManageAmc', 'canRecordVendorPayments', 'canManageLegal', 'canViewFinancials', 'canViewReports'],
  },
  {
    id: 'maintenance',
    label: 'Maintenance Coordinator',
    keys: ['canListProperties', 'canManageMaintenance', 'canManageVendors', 'canManageAmc', 'canRecordVendorPayments'],
  },
];

/** Every permission entry (key + meta) flattened — used to apply a role preset. */
const ALL_PERMS: { key: string; label: string; meta: string }[] = PERM_GROUPS.flatMap(
  (g) => g.perms as readonly { key: string; label: string; meta: string }[],
);

const inviteSchema = z.object({
  email: z.string().email('Valid email required'),
  firstName: z.string().min(1, 'First name required').max(100),
  lastName: z.string().max(100).optional(),
  phone: z.string().optional(),
  // Flag map (snake_case → boolean). Kept as a record so it stays in sync with
  // metaDefaults / PERM_GROUPS without re-enumerating every flag here.
  metadata: z.record(z.string(), z.boolean()),
  // Per-report access — report slugs (empty = all reports).
  reportAccess: z.array(z.string()),
}).refine(
  (d) => Object.values(d.metadata).some(Boolean),
  { message: 'Select at least one permission', path: ['metadata'] },
);

type InviteForm = z.infer<typeof inviteSchema>;

// ─── Permission toggle ────────────────────────────────────────────────────────

function PermToggle({
  label, value, onChange,
}: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
      <span className="text-sm" style={{ color: 'var(--color-neutral-700)' }}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
        style={{ background: value ? 'var(--color-primary)' : 'var(--color-base-200)' }}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
          style={{ left: value ? '1.25rem' : '0.125rem' }}
        />
      </button>
    </label>
  );
}

/** Row of quick role-preset buttons. `onApply` receives the set of camelCase
 *  permission keys the preset turns on (everything else turns off). */
function RolePresets({ onApply }: { onApply: (keys: Set<string>, reports: string[]) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <span className="text-[11px] font-medium" style={{ color: 'var(--color-neutral-500)' }}>Quick role:</span>
      {ROLE_PRESETS.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onApply(new Set(r.keys), r.reports ?? [])}
          className="text-[11px] font-medium px-2.5 py-1 rounded-full hover:bg-[var(--color-base-200)]"
          style={{ border: '1px solid var(--color-base-200)', color: 'var(--color-neutral-600)' }}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

/** Per-report access checklist. Empty selection = access to ALL reports. */
function ReportAccessChecklist({
  selected, onChange,
}: { selected: string[]; onChange: (slugs: string[]) => void }) {
  // A grant list can carry slugs of reports since retired or hidden (a manager
  // set up in 2025 still names `tenant-ledger`, `cheque-register`…). They are
  // not on the checklist, so they must not be counted ("21 of 14 selected") —
  // and the next save drops them: every change is written from the known
  // slugs only.
  const known = new Set(AVAILABLE_REPORTS.map((r) => r.slug));
  const current = selected.filter((s) => known.has(s));
  const stale = selected.length - current.length;
  const toggle = (slug: string) =>
    onChange(current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug]);
  const toggleGroup = (slugs: string[], on: boolean) =>
    onChange(on
      ? Array.from(new Set([...current, ...slugs]))
      : current.filter((s) => !slugs.includes(s)));
  return (
    <div>
      <p className="text-[11px] mb-2" style={{ color: 'var(--color-neutral-400)' }}>
        {selected.length === 0
          ? 'All reports — leave unchecked for full access, or pick specific reports.'
          : `${current.length} of ${AVAILABLE_REPORTS.length} reports selected.${stale ? ` ${stale} granted report${stale === 1 ? ' is' : 's are'} no longer offered and will be dropped on save.` : ''}`}
      </p>
      <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
        {REPORT_GROUPS.map((g) => {
          const slugs = g.reports.map((r) => r.slug);
          const allOn = slugs.every((s) => current.includes(s));
          return (
            <div key={g.title}>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-neutral-400)' }}>{g.title}</p>
                <button
                  type="button"
                  onClick={() => toggleGroup(slugs, !allOn)}
                  className="text-[10px] font-medium"
                  style={{ color: 'var(--color-primary)' }}
                >
                  {allOn ? 'Clear' : 'Select all'}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {g.reports.map((r) => (
                  <label key={r.slug} className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-neutral-700)' }}>
                    <input
                      type="checkbox"
                      checked={current.includes(r.slug)}
                      onChange={() => toggle(r.slug)}
                      style={{ accentColor: 'var(--color-primary)' }}
                    />
                    {r.title}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** `requires`: an authority that means nothing without another — "send" without "read". */
type PermEntry = { key: string; label: string; meta: string; requires?: string };

/**
 * One switch can move another: turning "send" ON turns its "read" on too, and
 * turning "read" OFF turns the "send" that needs it off. Returns every switch
 * that changes, the one pressed included.
 */
function withLinked(perm: PermEntry, value: boolean): Array<[PermEntry, boolean]> {
  const all: PermEntry[] = PERM_GROUPS.flatMap((g) => [...(g.perms as readonly PermEntry[])]);
  const out: Array<[PermEntry, boolean]> = [[perm, value]];
  if (value && perm.requires) { const need = all.find((p) => p.key === perm.requires); if (need) out.push([need, true]); }
  if (!value) for (const p of all) if (p.requires === perm.key) out.push([p, false]);
  return out;
}

/** Collapsible, nav-aligned permission sections shared by the invite modal and
 *  the edit panel. Each section shows a granted-count badge and a select-all. */
function PermissionSections({
  getValue,
  onToggle,
  onToggleGroup,
}: {
  getValue: (perm: PermEntry) => boolean;
  onToggle: (perm: PermEntry, v: boolean) => void;
  onToggleGroup: (perms: PermEntry[], v: boolean) => void;
}) {
  const waOn = useWhatsappEnabled();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="space-y-2">
      {PERM_GROUPS.filter((group) => waOn || group.label !== 'WhatsApp').map((group) => {
        const perms = group.perms as readonly PermEntry[];
        const granted = perms.filter((p) => getValue(p)).length;
        const total = perms.length;
        const allOn = granted === total;
        const isOpen = open[group.label] ?? granted > 0;
        return (
          <div key={group.label} className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-base-200)' }}>
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [group.label]: !isOpen }))}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
              style={{ background: 'var(--color-base-100)' }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <ChevronRight className="w-4 h-4 shrink-0 transition-transform" style={{ transform: isOpen ? 'rotate(90deg)' : 'none', color: 'var(--color-neutral-400)' }} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-neutral-700)' }}>{group.label}</p>
                  {'description' in group && (
                    <p className="text-[10px] truncate" style={{ color: 'var(--color-neutral-400)' }}>
                      {(group as { description?: string }).description}
                    </p>
                  )}
                </div>
              </div>
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                style={{
                  background: granted > 0 ? 'color-mix(in srgb, var(--color-primary) 14%, white)' : 'var(--color-base-200)',
                  color: granted > 0 ? 'var(--color-primary)' : 'var(--color-neutral-400)',
                }}
              >
                {granted}/{total}
              </span>
            </button>
            {isOpen && (
              <div className="px-3 pb-3 pt-2 space-y-2.5 border-t" style={{ borderColor: 'var(--color-base-200)', background: 'color-mix(in srgb, var(--color-base-200) 30%, white)' }}>
                <button
                  type="button"
                  onClick={() => onToggleGroup([...perms], !allOn)}
                  className="text-[11px] font-medium"
                  style={{ color: 'var(--color-primary)' }}
                >
                  {allOn ? 'Clear all' : 'Select all'}
                </button>
                {perms.map((perm) => (
                  <PermToggle key={perm.key} label={perm.label} value={getValue(perm)} onChange={(v) => onToggle(perm, v)} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Invite Manager Modal ─────────────────────────────────────────────────────

export interface InviteManagerModalProps {
  onClose: () => void;
  /** Prefill name / email / phone and pre-check permissions (e.g. for a POA holder). */
  initialValues?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    metadata?: Partial<InviteForm['metadata']>;
    reportAccess?: string[];
  };
  /** Optional heading override (e.g. "Invite POA holder as manager"). */
  title?: string;
  /** Called after a successful invite, before the modal closes. */
  onInvited?: () => void;
}

export function InviteManagerModal({ onClose, initialValues, title = 'Invite Manager', onInvited }: InviteManagerModalProps) {
  const qc = useQueryClient();
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      firstName: initialValues?.firstName ?? '',
      lastName: initialValues?.lastName ?? '',
      email: initialValues?.email ?? '',
      phone: initialValues?.phone ?? '',
      metadata: { ...metaDefaults, ...(initialValues?.metadata ?? {}) },
      reportAccess: initialValues?.reportAccess ?? [],
    },
  });

  const metaError = (errors as { metadata?: { message?: string } }).metadata?.message;
  // Subscribe to the whole flag map so the sections re-render on any toggle.
  const md = watch('metadata') ?? {};

  const mutation = useMutation({
    mutationFn: (data: InviteForm) =>
      apiPost('/invitations', { ...data, role: 'manager' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rp-invites'] });
      onInvited?.();
      onClose();
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-manager-title"
        className="w-full max-w-lg rounded-2xl p-6 my-8"
        style={{ background: 'var(--color-base-100)', border: '1px solid var(--color-base-200)' }}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 id="invite-manager-title" className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="p-1 rounded-lg" style={{ color: 'var(--color-neutral-400)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {mutation.error && (
          <div className="rounded-xl p-3 mb-4 text-sm" style={{ background: 'color-mix(in srgb, var(--color-error) 10%, white)', color: 'var(--color-error)' }}>
            {(mutation.error as Error).message}
          </div>
        )}

        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-5">
          {/* Name + email fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="rp-inv-firstName" className="block text-xs font-medium mb-1" style={{ color: 'var(--color-neutral-600)' }}>First Name *</label>
              <input
                id="rp-inv-firstName"
                {...register('firstName')}
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                style={{ border: `1px solid ${errors.firstName ? 'var(--color-error)' : 'var(--color-base-200)'}`, background: 'var(--color-base-100)' }}
                placeholder="Ahmed"
              />
              {errors.firstName && <p className="text-xs mt-1" style={{ color: 'var(--color-error)' }}>{errors.firstName.message}</p>}
            </div>
            <div>
              <label htmlFor="rp-inv-lastName" className="block text-xs font-medium mb-1" style={{ color: 'var(--color-neutral-600)' }}>Last Name</label>
              <input
                id="rp-inv-lastName"
                {...register('lastName')}
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                style={{ border: '1px solid var(--color-base-200)', background: 'var(--color-base-100)' }}
                placeholder="Al Mansoori"
              />
            </div>
          </div>

          <div>
            <label htmlFor="rp-inv-email" className="block text-xs font-medium mb-1" style={{ color: 'var(--color-neutral-600)' }}>Email *</label>
            <input
              id="rp-inv-email"
              {...register('email')}
              type="email"
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ border: `1px solid ${errors.email ? 'var(--color-error)' : 'var(--color-base-200)'}`, background: 'var(--color-base-100)' }}
              placeholder="ahmed@company.ae"
            />
            {errors.email && <p className="text-xs mt-1" style={{ color: 'var(--color-error)' }}>{errors.email.message}</p>}
          </div>

          {/* Permissions panel */}
          <div>
            <p className="text-xs font-semibold mb-3 flex items-center gap-1.5" style={{ color: 'var(--color-neutral-600)' }}>
              <ShieldCheck className="w-3.5 h-3.5" /> Permissions
            </p>
            {metaError && (
              <p className="text-xs mb-2" style={{ color: 'var(--color-error)' }}>{metaError}</p>
            )}
            <RolePresets
              onApply={(keys, reports) => {
                ALL_PERMS.forEach((p) =>
                  setValue(`metadata.${p.meta}`, keys.has(p.key), { shouldDirty: true }),
                );
                setValue('reportAccess', reports, { shouldDirty: true });
              }}
            />
            <PermissionSections
              getValue={(p) => !!md[p.meta]}
              onToggle={(p, v) => withLinked(p, v).forEach(([x, on]) => setValue(`metadata.${x.meta}`, on, { shouldDirty: true }))}
              onToggleGroup={(perms, v) =>
                perms.forEach((p) => setValue(`metadata.${p.meta}`, v, { shouldDirty: true }))
              }
            />
            {watch('metadata.can_view_reports') && (
              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-neutral-500)' }}>
                  Reports access
                </p>
                <ReportAccessChecklist
                  selected={watch('reportAccess') ?? []}
                  onChange={(slugs) => setValue('reportAccess', slugs, { shouldDirty: true })}
                />
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium"
              style={{ border: '1px solid var(--color-base-200)', color: 'var(--color-neutral-600)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
              style={{ background: 'var(--color-primary)', opacity: mutation.isPending ? 0.7 : 1 }}
            >
              {mutation.isPending ? 'Sending…' : 'Send Invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Permissions slide panel ──────────────────────────────────────────────────

function PermissionsPanel({
  manager,
  onClose,
}: {
  manager: ManagerMember;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  // Browser Back closes this slide-over instead of navigating away; backdrop / X
  // route through the same path. See useBackClose.
  const dismiss = useBackClose(onClose);

  const { data: perms, isLoading } = useQuery<ManagerPermissions>({
    queryKey: ['manager-perms', manager.userId],
    queryFn: () => apiGet(`/managers/${manager.userId}/permissions`),
  });

  const updateMutation = useMutation({
    mutationFn: (dto: Partial<ManagerPermissions>) =>
      apiPatch(`/managers/${manager.userId}/permissions`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['manager-perms', manager.userId] });
      // Activation lives on the permission record — refresh the team list chip.
      qc.invalidateQueries({ queryKey: ['rp-team'] });
    },
  });

  // ── Editable identity/details (name / email / phone / job title) ──
  const [details, setDetails] = useState({
    name: manager.user.name ?? '',
    email: manager.user.email ?? '',
    phone: manager.user.phone ?? '',
    jobTitle: manager.jobTitle ?? '',
  });
  const detailsMutation = useMutation({
    mutationFn: (dto: typeof details) => apiPatch(`/managers/${manager.userId}/details`, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rp-team'] }),
  });
  const active = perms?.isActive !== false;

  if (isLoading || !perms) {
    return (
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md flex flex-col" style={{ background: 'var(--color-base-100)', borderLeft: '1px solid var(--color-base-200)', boxShadow: '-4px 0 24px rgba(0,0,0,0.08)' }}>
        <div className="p-6 flex items-center justify-center flex-1">
          <p className="text-sm" style={{ color: 'var(--color-neutral-400)' }}>Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex"
      onClick={(e) => e.target === e.currentTarget && dismiss()}
      style={{ background: 'rgba(0,0,0,0.2)' }}
    >
      <div
        className="ml-auto w-full max-w-sm flex flex-col overflow-y-auto"
        style={{ background: 'var(--color-base-100)', borderLeft: '1px solid var(--color-base-200)', boxShadow: '-4px 0 24px rgba(0,0,0,0.08)' }}
      >
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: 'var(--color-base-200)' }}>
          <div>
            <p className="font-semibold text-sm">{manager.user.name}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-neutral-500)' }}>Edit details & permissions</p>
          </div>
          <button onClick={dismiss} className="p-1.5 rounded-lg" style={{ color: 'var(--color-neutral-400)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-6 flex-1">
          {/* ── Manager details (identity + job title) ── */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-neutral-400)' }}>
              Manager details
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-neutral-600)' }}>Full name</label>
                <input
                  value={details.name}
                  onChange={(e) => setDetails((d) => ({ ...d, name: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ border: '1px solid var(--color-base-200)', background: 'var(--color-base-100)' }}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-neutral-600)' }}>Email (login)</label>
                  <input
                    type="email"
                    value={details.email}
                    onChange={(e) => setDetails((d) => ({ ...d, email: e.target.value }))}
                    className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                    style={{ border: '1px solid var(--color-base-200)', background: 'var(--color-base-100)' }}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-neutral-600)' }}>Phone</label>
                  <input
                    value={details.phone}
                    onChange={(e) => setDetails((d) => ({ ...d, phone: e.target.value }))}
                    className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                    style={{ border: '1px solid var(--color-base-200)', background: 'var(--color-base-100)' }}
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-neutral-600)' }}>Job title</label>
                <input
                  value={details.jobTitle}
                  onChange={(e) => setDetails((d) => ({ ...d, jobTitle: e.target.value }))}
                  placeholder="e.g. Leasing Manager"
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ border: '1px solid var(--color-base-200)', background: 'var(--color-base-100)' }}
                />
              </div>
              {detailsMutation.error && (
                <p className="text-xs" style={{ color: 'var(--color-error)' }}>{(detailsMutation.error as Error).message}</p>
              )}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => detailsMutation.mutate(details)}
                  disabled={detailsMutation.isPending}
                  className="px-3.5 py-2 rounded-xl text-sm font-semibold text-white"
                  style={{ background: 'var(--color-primary)', opacity: detailsMutation.isPending ? 0.7 : 1 }}
                >
                  {detailsMutation.isPending ? 'Saving…' : 'Save details'}
                </button>
                {detailsMutation.isSuccess && !detailsMutation.isPending && (
                  <span className="text-xs font-medium" style={{ color: 'var(--color-primary)' }}>✓ Saved</span>
                )}
              </div>
            </div>
          </div>

          {/* ── Activation (landlord can deactivate anytime; reversible) ── */}
          <div
            className="rounded-xl p-4 flex items-center justify-between gap-3"
            style={{
              border: '1px solid var(--color-base-200)',
              background: active ? 'var(--color-base-100)' : 'color-mix(in srgb, var(--color-error) 6%, white)',
            }}
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold" style={{ color: active ? 'var(--color-neutral-700)' : 'var(--color-error)' }}>
                {active ? 'Active' : 'Deactivated'}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-neutral-500)' }}>
                {active
                  ? 'This manager can act on your account. Deactivate to block access — permissions are kept and you can re-activate anytime.'
                  : 'Access is blocked. Permissions are preserved — re-activate to restore access.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => updateMutation.mutate({ isActive: !active })}
              disabled={updateMutation.isPending}
              className="px-3.5 py-2 rounded-xl text-sm font-semibold shrink-0"
              style={
                active
                  ? { border: '1px solid var(--color-error)', color: 'var(--color-error)', background: 'transparent' }
                  : { background: 'var(--color-primary)', color: 'white' }
              }
            >
              {active ? 'Deactivate' : 'Activate'}
            </button>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-neutral-400)' }}>
              Permissions
            </p>
          <RolePresets
            onApply={(keys, reports) =>
              updateMutation.mutate({
                ...(Object.fromEntries(
                  ALL_PERMS.map((p) => [p.key, keys.has(p.key)]),
                ) as Partial<ManagerPermissions>),
                reportAccess: reports,
              })
            }
          />
          <PermissionSections
            getValue={(p) => !!perms[p.key as keyof ManagerPermissions]}
            onToggle={(p, v) => updateMutation.mutate(Object.fromEntries(withLinked(p, v).map(([x, on]) => [x.key, on])) as Partial<ManagerPermissions>)}
            onToggleGroup={(gp, v) =>
              updateMutation.mutate(
                Object.fromEntries(gp.map((p) => [p.key, v])) as Partial<ManagerPermissions>,
              )
            }
          />
          {perms.canViewReports && (
            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-neutral-400)' }}>
                Reports access
              </p>
              <ReportAccessChecklist
                selected={perms.reportAccess ?? []}
                onChange={(slugs) => updateMutation.mutate({ reportAccess: slugs })}
              />
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Status chip ─────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: string }) {
  const styles: Record<string, { bg: string; text: string }> = {
    active:    { bg: 'color-mix(in srgb, var(--color-primary) 12%, white)', text: 'var(--color-primary)' },
    pending:   { bg: 'color-mix(in srgb, #d97706 12%, white)', text: '#d97706' },
    inactive:  { bg: 'color-mix(in srgb, var(--color-error) 12%, white)', text: 'var(--color-error)' },
    expired:   { bg: 'color-mix(in srgb, var(--color-neutral-400) 15%, white)', text: 'var(--color-neutral-500)' },
    cancelled: { bg: 'color-mix(in srgb, var(--color-error) 12%, white)', text: 'var(--color-error)' },
  };
  const s = styles[status] ?? styles.expired;
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize" style={{ background: s.bg, color: s.text }}>
      {status.replace('_', ' ')}
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function TeamPanel() {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [selectedManager, setSelectedManager] = useState<ManagerMember | null>(null);
  // Deactivated managers stay folded away until the landlord asks to see them.
  const [showDeactivated, setShowDeactivated] = useState(false);
  const qc = useQueryClient();

  const { data: managers = [], isLoading: loadingManagers } = useQuery<ManagerMember[]>({
    queryKey: ['rp-team'],
    queryFn: () => apiGet('/team/managers'),
  });

  const { data: invites = [], isLoading: loadingInvites } = useQuery<Invitation[]>({
    queryKey: ['rp-invites'],
    queryFn: () => apiGet('/invitations?status=pending'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/invitations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rp-invites'] }),
  });

  const resendMutation = useMutation({
    mutationFn: (id: number) => apiPost(`/invitations/${id}/resend`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rp-invites'] }),
  });

  const activeManagers = managers.filter((m) => m.active !== false);
  const deactivatedManagers = managers.filter((m) => m.active === false);

  const daysLeft = (expiresAt: string) => {
    const diff = new Date(expiresAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / 86400000));
  };

  return (
    // Embedded in Settings → Team tab: render plain content (no DashboardPage
    // chrome) so the layout matches the General and Rules tabs. Invite action
    // sits inline, right-aligned.
    <div>
      <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
        <p className="text-sm text-[#6b6860]">Manage the asset managers working under your account.</p>
        <button
          onClick={() => setShowInviteModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <Plus className="w-4 h-4" />
          Invite Manager
        </button>
      </div>
      {showInviteModal && <InviteManagerModal onClose={() => setShowInviteModal(false)} />}
      {selectedManager && (
        <PermissionsPanel
          manager={selectedManager}
          onClose={() => setSelectedManager(null)}
        />
      )}

      {/* Active Managers */}
      <section className="mb-8">
        <SectionHeader title={`Active Managers (${activeManagers.length})`} />
        {loadingManagers ? (
          <div className="rounded-2xl p-8 text-center text-sm bg-white" style={{ boxShadow: 'var(--shadow-sm)', color: 'var(--color-neutral-400)' }}>Loading…</div>
        ) : activeManagers.length === 0 ? (
          <div
            className="rounded-2xl p-8 flex flex-col items-center justify-center gap-3 text-center bg-white"
            style={{ boxShadow: 'var(--shadow-sm)' }}
          >
            <Users className="w-8 h-8" style={{ color: 'var(--color-neutral-300)' }} />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-neutral-600)' }}>{managers.length === 0 ? 'No managers yet' : 'No active managers'}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-neutral-400)' }}>
                {managers.length === 0 ? 'Invite your first manager to help manage your properties' : 'Everyone on your team is deactivated — re-activate a manager below or invite a new one'}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {activeManagers.map((mgr) => (
              <ManagerRow key={mgr.id} mgr={mgr} onSelect={setSelectedManager} />
            ))}
          </div>
        )}
      </section>

      {/* Pending Invites */}
      {(loadingInvites || invites.length > 0) && (
        <section className={deactivatedManagers.length > 0 ? 'mb-8' : undefined}>
          <SectionHeader title={`Pending Invites (${invites.length})`} />
          <div className="space-y-3">
            {invites.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center gap-4 px-5 py-4 bg-white rounded-2xl"
                style={{ boxShadow: 'var(--shadow-sm)' }}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: 'color-mix(in srgb, #d97706 12%, white)' }}
                >
                  <Clock className="w-4 h-4" style={{ color: '#d97706' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {inv.firstName} {inv.lastName ?? ''}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-neutral-500)' }}>
                    {inv.email} · Expires in {daysLeft(inv.expiresAt)} day{daysLeft(inv.expiresAt) !== 1 ? 's' : ''}
                  </p>
                </div>
                <StatusChip status={inv.status} />
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => resendMutation.mutate(inv.id)}
                    disabled={resendMutation.isPending}
                    title="Resend invite"
                    className="p-1.5 rounded-lg"
                    style={{ color: 'var(--color-primary)' }}
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => cancelMutation.mutate(inv.id)}
                    disabled={cancelMutation.isPending}
                    title="Cancel invite"
                    className="p-1.5 rounded-lg"
                    style={{ color: 'var(--color-error)' }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Deactivated — kept apart, at the bottom, so the working team reads clean */}
      {deactivatedManagers.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setShowDeactivated((v) => !v)}
            aria-expanded={showDeactivated}
            className="w-full flex items-center justify-between gap-3 px-5 py-3 bg-white rounded-2xl text-left transition-shadow hover:shadow-md"
            style={{ boxShadow: 'var(--shadow-sm)' }}
          >
            <span className="font-semibold text-sm" style={{ color: 'var(--color-neutral-600)' }}>
              Deactivated ({deactivatedManagers.length})
            </span>
            <ChevronRight
              className="w-4 h-4 flex-shrink-0 transition-transform"
              style={{ color: 'var(--color-neutral-400)', transform: showDeactivated ? 'rotate(90deg)' : undefined }}
            />
          </button>
          {showDeactivated && (
            <div className="space-y-3 mt-3">
              {deactivatedManagers.map((mgr) => (
                <ManagerRow key={mgr.id} mgr={mgr} onSelect={setSelectedManager} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function ManagerRow({ mgr, onSelect }: { mgr: ManagerMember; onSelect: (mgr: ManagerMember) => void }) {
  return (
    <button
      onClick={() => onSelect(mgr)}
      className="w-full flex items-center gap-4 px-5 py-4 text-left bg-white rounded-2xl transition-shadow hover:shadow-md"
      style={{ boxShadow: 'var(--shadow-sm)', opacity: mgr.active === false ? 0.6 : 1 }}
    >
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
        style={{ background: 'color-mix(in srgb, var(--color-primary) 15%, white)', color: 'var(--color-primary)' }}
      >
        {mgr.user.name.slice(0, 1).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">
          {mgr.user.name}
          {mgr.jobTitle && (
            <span className="ml-2 font-normal text-xs" style={{ color: 'var(--color-neutral-400)' }}>{mgr.jobTitle}</span>
          )}
        </p>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-neutral-500)' }}>
            <Mail className="w-3 h-3" />{mgr.user.email}
          </span>
          {mgr.user.phone && (
            <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-neutral-500)' }}>
              <Phone className="w-3 h-3" />{mgr.user.phone}
            </span>
          )}
        </div>
      </div>
      <StatusChip status={mgr.status} />
      <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-neutral-400)' }} />
    </button>
  );
}
