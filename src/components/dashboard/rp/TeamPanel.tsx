'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Users, Plus, Mail, Phone, Trash2, RefreshCw, Clock, ChevronRight, X, ShieldCheck,
} from 'lucide-react';
import { apiGet, apiPost, apiDelete, apiPatch } from '@/lib/api';
import { SectionHeader } from '@/components/dashboard/DashboardWidgets';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ManagerPermissions {
  id: number;
  managerUserId: number;
  // Properties
  canListProperties:    boolean;
  canEditProperties:    boolean;
  canPublishListings:   boolean;
  // Viewings
  canManageViewings:    boolean;
  // Contracts & signing
  canManageAgreements:  boolean;
  canCreateContracts:   boolean;
  canManageRenewals:    boolean;
  canSignDocuments:     boolean;
  canSignAddenda:       boolean;
  canActAsPoa:          boolean;
  // Finance
  canManageDeposits:    boolean;
  canManageCollections: boolean;
  canViewFinancials:    boolean;
  canViewReports:       boolean;
  // Operations
  canManageDocuments:   boolean;
  canManageMaintenance: boolean;
  // Communication & admin
  canCommunicateTenants: boolean;
  canEscalateToAdmin:    boolean;
  canInviteManager:      boolean;
}

interface ManagerMember {
  id: number;
  userId: number;
  status: string;
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

export const PERM_GROUPS = [
  {
    label: 'Properties',
    description: 'Listing and property management',
    perms: [
      { key: 'canListProperties',    label: 'View properties',        meta: 'can_list_properties' },
      { key: 'canEditProperties',    label: 'Edit property details',  meta: 'can_edit_properties' },
      { key: 'canPublishListings',   label: 'Publish / unpublish listings', meta: 'can_publish_listings' },
    ],
  },
  {
    label: 'Viewings',
    description: 'Customer appointments',
    perms: [
      { key: 'canManageViewings',    label: 'Schedule & manage viewings', meta: 'can_manage_viewings' },
    ],
  },
  {
    label: 'Contracts & Signing',
    description: 'Tenancy agreements and legal documents',
    perms: [
      { key: 'canManageAgreements',  label: 'View & manage contracts',       meta: 'can_manage_agreements' },
      { key: 'canCreateContracts',   label: 'Create new contracts',          meta: 'can_create_contracts' },
      { key: 'canManageRenewals',    label: 'Manage contract renewals',      meta: 'can_manage_renewals' },
      { key: 'canSignDocuments',     label: 'Sign tenancy contracts',        meta: 'can_sign_documents' },
      { key: 'canSignAddenda',       label: 'Sign addenda & amendments',     meta: 'can_sign_addenda' },
      { key: 'canActAsPoa',          label: 'Act with full POA (Power of Attorney)', meta: 'can_act_as_poa' },
    ],
  },
  {
    label: 'Finance',
    description: 'Payments, collections and reports',
    perms: [
      { key: 'canManageDeposits',    label: 'Manage security deposits',   meta: 'can_manage_deposits' },
      { key: 'canManageCollections', label: 'Manage rent collections',    meta: 'can_manage_collections' },
      { key: 'canViewFinancials',    label: 'View financial statements',  meta: 'can_view_financials' },
      { key: 'canViewReports',       label: 'View analytics & reports',   meta: 'can_view_reports' },
    ],
  },
  {
    label: 'Operations',
    description: 'Documents and maintenance',
    perms: [
      { key: 'canManageDocuments',    label: 'Upload & manage documents',   meta: 'can_manage_documents' },
      { key: 'canManageMaintenance',  label: 'Handle maintenance requests', meta: 'can_manage_maintenance' },
    ],
  },
  {
    label: 'Communication & Admin',
    description: 'Tenant communication and delegation',
    perms: [
      { key: 'canCommunicateTenants', label: 'Communicate with tenants',  meta: 'can_communicate_tenants' },
      { key: 'canEscalateToAdmin',    label: 'Escalate issues to admin',  meta: 'can_escalate_to_admin' },
      { key: 'canInviteManager',      label: 'Invite sub-managers',       meta: 'can_invite_manager' },
    ],
  },
] as const;

// ─── Schema ──────────────────────────────────────────────────────────────────

export const metaDefaults = {
  can_list_properties:    false,
  can_edit_properties:    false,
  can_publish_listings:   false,
  can_manage_viewings:    false,
  can_manage_agreements:  false,
  can_create_contracts:   false,
  can_manage_renewals:    false,
  can_sign_documents:     false,
  can_sign_addenda:       false,
  can_act_as_poa:         false,
  can_manage_deposits:    false,
  can_manage_collections: false,
  can_view_financials:    false,
  can_view_reports:       false,
  can_manage_documents:   false,
  can_manage_maintenance: false,
  can_communicate_tenants: false,
  can_escalate_to_admin:  false,
  can_invite_manager:     false,
};

const inviteSchema = z.object({
  email: z.string().email('Valid email required'),
  firstName: z.string().min(1, 'First name required').max(100),
  lastName: z.string().max(100).optional(),
  phone: z.string().optional(),
  metadata: z.object({
    can_list_properties:    z.boolean(),
    can_edit_properties:    z.boolean(),
    can_publish_listings:   z.boolean(),
    can_manage_viewings:    z.boolean(),
    can_manage_agreements:  z.boolean(),
    can_create_contracts:   z.boolean(),
    can_manage_renewals:    z.boolean(),
    can_sign_documents:     z.boolean(),
    can_sign_addenda:       z.boolean(),
    can_act_as_poa:         z.boolean(),
    can_manage_deposits:    z.boolean(),
    can_manage_collections: z.boolean(),
    can_view_financials:    z.boolean(),
    can_view_reports:       z.boolean(),
    can_manage_documents:   z.boolean(),
    can_manage_maintenance: z.boolean(),
    can_communicate_tenants: z.boolean(),
    can_escalate_to_admin:  z.boolean(),
    can_invite_manager:     z.boolean(),
  }),
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
  };
  /** Optional heading override (e.g. "Invite POA holder as manager"). */
  title?: string;
  /** Called after a successful invite, before the modal closes. */
  onInvited?: () => void;
}

export function InviteManagerModal({ onClose, initialValues, title = 'Invite Manager', onInvited }: InviteManagerModalProps) {
  const qc = useQueryClient();
  const { register, handleSubmit, control, formState: { errors } } = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      firstName: initialValues?.firstName ?? '',
      lastName: initialValues?.lastName ?? '',
      email: initialValues?.email ?? '',
      phone: initialValues?.phone ?? '',
      metadata: { ...metaDefaults, ...(initialValues?.metadata ?? {}) },
    },
  });

  const metaError = (errors as { metadata?: { message?: string } }).metadata?.message;

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
            <div className="space-y-5">
              {PERM_GROUPS.map((group) => (
                <div key={group.label}>
                  <div className="mb-2">
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-neutral-500)' }}>
                      {group.label}
                    </p>
                    {'description' in group && (
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-neutral-400)' }}>
                        {(group as { description?: string }).description}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2.5 pl-1">
                    {group.perms.map((perm) => {
                      const metaKey = perm.meta as keyof typeof metaDefaults;
                      return (
                        <Controller
                          key={perm.key}
                          control={control}
                          name={`metadata.${metaKey}` as `metadata.${keyof typeof metaDefaults}`}
                          render={({ field }) => (
                            <PermToggle
                              label={perm.label}
                              value={field.value}
                              onChange={field.onChange}
                            />
                          )}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
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

  const { data: perms, isLoading } = useQuery<ManagerPermissions>({
    queryKey: ['manager-perms', manager.userId],
    queryFn: () => apiGet(`/managers/${manager.userId}/permissions`),
  });

  const updateMutation = useMutation({
    mutationFn: (dto: Partial<ManagerPermissions>) =>
      apiPatch(`/managers/${manager.userId}/permissions`, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['manager-perms', manager.userId] }),
  });

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
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{ background: 'rgba(0,0,0,0.2)' }}
    >
      <div
        className="ml-auto w-full max-w-sm flex flex-col overflow-y-auto"
        style={{ background: 'var(--color-base-100)', borderLeft: '1px solid var(--color-base-200)', boxShadow: '-4px 0 24px rgba(0,0,0,0.08)' }}
      >
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: 'var(--color-base-200)' }}>
          <div>
            <p className="font-semibold text-sm">{manager.user.name}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-neutral-500)' }}>Edit permissions</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: 'var(--color-neutral-400)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-6 flex-1">
          {PERM_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-neutral-400)' }}>
                {group.label}
              </p>
              <div className="space-y-3">
                {group.perms.map(({ key, label }) => {
                  const val = perms[key as keyof ManagerPermissions] as boolean;
                  return (
                    <PermToggle
                      key={key}
                      label={label}
                      value={val}
                      onChange={(v) => updateMutation.mutate({ [key]: v })}
                    />
                  );
                })}
              </div>
            </div>
          ))}
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
        <SectionHeader title={`Active Managers (${managers.length})`} />
        {loadingManagers ? (
          <div className="rounded-2xl p-8 text-center text-sm bg-white" style={{ boxShadow: 'var(--shadow-sm)', color: 'var(--color-neutral-400)' }}>Loading…</div>
        ) : managers.length === 0 ? (
          <div
            className="rounded-2xl p-8 flex flex-col items-center justify-center gap-3 text-center bg-white"
            style={{ boxShadow: 'var(--shadow-sm)' }}
          >
            <Users className="w-8 h-8" style={{ color: 'var(--color-neutral-300)' }} />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-neutral-600)' }}>No managers yet</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-neutral-400)' }}>Invite your first manager to help manage your properties</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {managers.map((mgr) => (
              <button
                key={mgr.id}
                onClick={() => setSelectedManager(mgr)}
                className="w-full flex items-center gap-4 px-5 py-4 text-left bg-white rounded-2xl transition-shadow hover:shadow-md"
                style={{ boxShadow: 'var(--shadow-sm)' }}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                  style={{ background: 'color-mix(in srgb, var(--color-primary) 15%, white)', color: 'var(--color-primary)' }}
                >
                  {mgr.user.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{mgr.user.name}</p>
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
            ))}
          </div>
        )}
      </section>

      {/* Pending Invites */}
      {(loadingInvites || invites.length > 0) && (
        <section>
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
    </div>
  );
}
