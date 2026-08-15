"use client";
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useEffect, useState, useRef } from "react";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { openDocViewer } from "@/lib/docViewer";
import {
  Building2, Wrench, Users, Clock, CheckCircle2, XCircle,
  AlertCircle, RefreshCw, ShieldCheck, FileText, Files, User,
  CreditCard, MousePointerClick, ExternalLink, UserCheck, Layers,
} from "lucide-react";
import Link from "next/link";
import { BackLink } from "@/components/dashboard/DashboardWidgets";
import { CustomerDocsModal, type CustomerDoc } from "@/components/upnow/CustomerDocsModal";

// ─── Types ────────────────────────────────────────────────────────────────────

type ComplianceStatus = "compliant" | "pending_review" | "action_required" | "expired" | "paused";
type DocStatus = "ATTACHED" | "PROCESSED" | "COMPLETE" | "EXPIRED" | null;

interface ProviderUser {
  id: number;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phone?: string;
  kycStatus?: string;
  status?: string;
  createdAt?: string;
}

interface RentalProvider {
  id: number;
  userId: number;
  user?: ProviderUser;
  entityType?: string;
  companyName?: string;
  contactAddress?: string;
  dateOfBirth?: string;
  nationality?: string;
  gender?: string;
  hasPoa?: boolean;
  poaPersonName?: string | null;
  poaPersonPhone?: string | null;
  poaPersonEmail?: string | null;
  bankIban?: string;
  bankName?: string;
  bankAccountName?: string;
  tradeLicenseNumber?: string;
  emiratesIdNumber?: string;
  passportNumber?: string;
  complianceStatus: ComplianceStatus;
  complianceNotes?: string;
  createdAt: string;
}

interface ServiceProvider {
  id: number;
  userId: number;
  user?: ProviderUser;
  entityType?: string;
  businessName?: string;
  ownerName?: string;
  companyName?: string;
  serviceCategory?: string;
  serviceCategories?: string;
  servicesOffered?: string | null;
  scopeOfWork?: string | null;
  certifications?: string | null;
  emiratesServed?: string;
  serviceZones?: string | null;
  serviceArea?: string | null;
  availability?: string | null;
  emergencyResponse?: boolean;
  isGovernment?: boolean;
  nationality?: string;
  gender?: string;
  dateOfBirth?: string;
  emiratesIdNumber?: string;
  contactAddress?: string;
  tradeLicenseNumber?: string;
  vatTrn?: string;
  teamSizeBand?: string | null;
  fleetSizeBand?: string | null;
  maxConcurrentJobs?: number | null;
  minNoticeHours?: number | null;
  opsContactName?: string | null;
  opsContactPhone?: string | null;
  opsContactWhatsapp?: boolean;
  opsContactLanguages?: string[] | null;
  accountTypeConfirmedAt?: string | null;
  jobReadyAt?: string | null;
  complianceStatus: ComplianceStatus;
  complianceNotes?: string;
  averageRating?: number;
  totalReviews?: number;
  createdAt: string;
}

interface Tenant {
  id: number;
  userId: number;
  user?: ProviderUser;
  entityType?: string;
  documentStatus?: string;
  activeStatus?: string;
  createdAt: string;
}

interface ChecklistItem {
  key: string;
  displayName: string;
  category: string;
  required: boolean;
  uploaded: boolean;
  status: DocStatus;
  documentId: number | null;
  fileUrl: string | null;
  description?: string;
}

interface UploadedDoc {
  id: number;
  documentKey: string;
  fileUrl: string;
  mimeType: string | null;
  status: string;
  notes: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  documentNumber?: string | null;
  createdAt: string;
}

interface TenantDetail {
  profile: {
    id: number;
    entityType?: string | null;
    tradeLicenseNumber?: string | null;
    tradeLicenseAuthority?: string | null;
    activeStatus?: string | null;
    documentStatus?: string | null;
    createdAt: string;
    updatedAt?: string | null;
    user?: { firstName?: string | null; lastName?: string | null; name?: string | null; email?: string | null; phone?: string | null; kycStatus?: string | null; createdAt?: string | null };
  };
  uploadedDocs: UploadedDoc[];
}

interface RpDetail {
  profile: RentalProvider;
  checklist: ChecklistItem[];
  uploadedDocs: UploadedDoc[];
  completionScore: number;
}

interface SpService {
  id: number;
  category: string;
  name: string;
  basePrice: number | null;
  priceUnit: string;
  pricingMode: string;
  currency: string;
  isFromPrice: boolean;
  minCalloutCharge: number | null;
  isEmergency: boolean;
  listingStatus: string;
  isAvailable: boolean;
}

interface SpDetail {
  profile: ServiceProvider;
  checklist: ChecklistItem[];
  uploadedDocs: UploadedDoc[];
  completionScore: number;
  services?: SpService[];
}

type Tab = "rental" | "service" | "tenants" | "managers" | "technicians";
type StatusFilter = "all" | "pending_review" | "action_required" | "compliant" | "expired";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function providerName(p: RentalProvider | ServiceProvider | Tenant, fallback: string) {
  if (!p.user) return fallback;
  return p.user.name || [p.user.firstName, p.user.lastName].filter(Boolean).join(" ") || fallback;
}

const COMPLIANCE_CFG: Record<ComplianceStatus, { label: string; bg: string; color: string; Icon: React.ElementType }> = {
  compliant:       { label: "Compliant",       bg: "#dcfce7", color: "#15803d", Icon: CheckCircle2 },
  pending_review:  { label: "Pending Review",  bg: "#fef3c7", color: "#b45309", Icon: Clock },
  action_required: { label: "Action Required", bg: "#fee2e2", color: "#dc2626", Icon: AlertCircle },
  expired:         { label: "Expired",         bg: "#f3f4f6", color: "#6b7280", Icon: XCircle },
  paused:          { label: "Paused",          bg: "#ffedd5", color: "#c2410c", Icon: AlertCircle },
};

function ComplianceBadge({ s }: { s: ComplianceStatus }) {
  const cfg = COMPLIANCE_CFG[s] ?? COMPLIANCE_CFG.pending_review;
  const Icon = cfg.Icon;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}>
      <Icon size={10} />{cfg.label}
    </span>
  );
}

// Admin control: flip a user's account active ↔ inactive (suspended).
function UserStatusToggle({ userId, status, onChange }: { userId?: number; status?: string; onChange?: (s: string) => void }) {
  const [val, setVal]   = useState(status ?? "active");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setVal(status ?? "active"); }, [status]);
  if (!userId) return null;
  const isActive = val === "active";
  async function toggle() {
    const next = isActive ? "suspended" : "active";
    setBusy(true);
    try {
      await apiPatch(`/admin/users/${userId}/status`, { status: next });
      setVal(next);
      onChange?.(next);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={isActive ? "Click to deactivate this account" : "Click to activate this account"}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-opacity disabled:opacity-50"
      style={{
        backgroundColor: isActive ? "#dcfce7" : "#f3f4f6",
        color: isActive ? "#15803d" : "#6b7280",
        border: `1px solid ${isActive ? "#bbf7d0" : "#e5e7eb"}`,
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: 99, display: "inline-block",
        backgroundColor: isActive ? "#16a34a" : "#9ca3af" }} />
      {busy ? "Saving…" : isActive ? "Active" : "Inactive"}
    </button>
  );
}

// ─── Queue card (list item) ───────────────────────────────────────────────────

function KycCard({
  name, email, status, date, selected, onClick,
}: {
  name: string; email?: string; status: ComplianceStatus;
  date: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3.5 border-b transition-colors"
      style={{
        borderColor: "var(--color-base-100)",
        backgroundColor: selected ? "var(--color-primary-50)" : "#fff",
        borderLeft: selected ? "3px solid var(--color-primary)" : "3px solid transparent",
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-sm font-semibold truncate" style={{ color: "var(--color-neutral-900)" }}>{name}</span>
        <ComplianceBadge s={status} />
      </div>
      {email && (
        <p className="text-xs truncate mb-1.5" style={{ color: "var(--color-neutral-400)" }}>{email}</p>
      )}
      <p className="text-xs" style={{ color: "var(--color-neutral-400)" }}>
        {new Date(date).toLocaleDateString("en-AE", { timeZone: APP_TIME_ZONE })}
      </p>
    </button>
  );
}

// ─── RIGHT panel: RP content + actions ───────────────────────────────────────

/**
 * Per-document verdict controls — Approve (with an expiry date) / Reject.
 *
 * Approving opens a small confirm so the reviewer can record the expiry read
 * off the document itself. The reviewer is the only person holding the physical
 * document, so this is where a missing or wrong expiry gets fixed — customers
 * never enter one. Leave the field blank for documents that don't expire.
 *
 * Self-contained (owns its own busy/modal state) so it can drop into any of the
 * KYC panels. SCRUM-662.
 */
/**
 * Document types that always carry an expiry date, matched on part of the key.
 *
 * Substring rather than prefix: occupant docs are prefixed
 * (`occupant_2_passport`) and repeats are suffixed (`passport_2`), so the
 * identifying word can sit anywhere. Mirrors `expiring-doc-types.ts` on the
 * backend, which enforces the same rule — this copy exists so the reviewer is
 * told before submitting rather than bounced by a 400.
 */
const EXPIRING_KEY_PARTS = ['emirates_id', 'passport', 'visa', 'trade_licen', 'poa_id'];
function requiresExpiry(documentKey: string): boolean {
  const key = (documentKey || '').toLowerCase();
  return EXPIRING_KEY_PARTS.some((part) => key.includes(part));
}

function DocReviewActions({
  doc, onUpdate,
}: {
  doc: UploadedDoc;
  onUpdate: (docId: number, patch: Partial<UploadedDoc>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [expiry, setExpiry] = useState('');

  const status = String(doc.status ?? '').toLowerCase();
  const isVerified = ['processed', 'complete'].includes(status);
  const isRejected = status === 'rejected';
  const label = doc.documentKey.replace(/_/g, ' ');
  // An ID or licence always has an expiry, and the reviewer is holding it.
  const expiryRequired = requiresExpiry(doc.documentKey);
  const blocked = expiryRequired && !expiry.trim();

  function openConfirm() {
    setExpiry(doc.expiryDate ? String(doc.expiryDate).slice(0, 10) : '');
    setConfirming(true);
  }

  async function approve() {
    setBusy(true);
    try {
      const updated = await apiPost<{ status?: string; expiryDate?: string | null }>(
        `/admin/kyc/documents/${doc.id}/verify`,
        expiry ? { expiryDate: expiry } : {},
      );
      onUpdate(doc.id, {
        status: updated?.status ?? 'processed',
        expiryDate: updated?.expiryDate ?? (expiry || doc.expiryDate),
        notes: null,
      });
      setConfirming(false);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    const input = window.prompt('Reason for rejecting this document (shown to the owner):', '');
    if (input === null) return; // cancelled
    const reason = input.trim() || undefined;
    setBusy(true);
    try {
      const updated = await apiPost<{ status?: string }>(
        `/admin/kyc/documents/${doc.id}/reject`,
        { reason },
      );
      onUpdate(doc.id, { status: updated?.status ?? 'rejected', notes: reason ?? null });
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!isVerified && (
        <button type="button" disabled={busy} onClick={openConfirm}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" }}
          title="Approve this document">
          <CheckCircle2 size={11} /> Approve
        </button>
      )}
      {!isRejected && (
        <button type="button" disabled={busy} onClick={() => void reject()}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}
          title="Reject this document (owner must re-upload)">
          <XCircle size={11} /> Reject
        </button>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
          onClick={() => { if (!busy) setConfirming(false); }}>
          <div className="w-full max-w-sm rounded-2xl p-5 bg-white" style={{ boxShadow: "0 12px 32px rgba(0,0,0,0.18)" }}
            onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold mb-1" style={{ color: "var(--color-neutral-900)" }}>Approve document</h3>
            <p className="text-xs mb-4" style={{ color: "var(--color-neutral-500)" }}>
              {label.replace(/\b\w/g, (c) => c.toUpperCase())}
            </p>

            <label className="block text-xs font-semibold mb-1" style={{ color: "var(--color-neutral-600)" }}>
              Expiry date{expiryRequired && <span style={{ color: "#dc2626" }}> *</span>}
            </label>
            <input
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{
                border: `1px solid ${blocked ? "#fecaca" : "var(--color-base-200)"}`,
                color: "var(--color-neutral-900)",
              }}
            />
            <p className="text-[11px] mt-1.5" style={{ color: blocked ? "#dc2626" : "var(--color-neutral-400)" }}>
              {expiryRequired
                ? "Read it off the document — this type always has one, and the reminders that warn before it lapses can't run without it."
                : "Read it off the document. Leave blank if this document doesn't expire."}
            </p>

            <div className="flex items-center justify-end gap-2 mt-5">
              <button type="button" disabled={busy} onClick={() => setConfirming(false)}
                className="px-3 py-2 rounded-lg text-xs font-medium cursor-pointer disabled:opacity-50"
                style={{ backgroundColor: "var(--color-base-100)", color: "var(--color-neutral-700)" }}>
                Cancel
              </button>
              <button type="button" disabled={busy || blocked} onClick={() => void approve()}
                title={blocked ? "Enter the expiry date shown on the document" : undefined}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: "var(--color-primary)", color: "#fff" }}>
                <CheckCircle2 size={12} /> {busy ? "Approving…" : "Approve"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function RpContentPanel({
  detail, rpId, loading, error, onStatusChange, onDocUpdate,
}: {
  detail: RpDetail | null;
  rpId: number;
  loading: boolean;
  error: string | null;
  onStatusChange: (id: number, status: ComplianceStatus) => void;
  onDocUpdate: (docId: number, patch: Partial<UploadedDoc>) => void;
}) {
  const [acting, setActing] = useState(false);
  const [notes, setNotes] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNotes("");
    scrollRef.current?.scrollTo({ top: 0 });
  }, [rpId]);

  const profile = detail?.profile;
  const allDocs = detail?.uploadedDocs ?? [];
  // Keep Power-of-Attorney documents (the deed + the holder's identity docs) in
  // their own card so they never blur into the owner's own KYC documents.
  const poaDocs = allDocs.filter((d) => d.documentKey.startsWith("poa_"));
  const docs = allDocs.filter((d) => !d.documentKey.startsWith("poa_"));

  // Required-document checklist — what an admin must see before approving. Drives
  // the approval-checklist card + the "Mark Compliant" missing-docs gate.
  const checklist = detail?.checklist ?? [];
  const requiredItems = checklist.filter((c) => c.required);
  const missingRequired = requiredItems.filter((c) => !c.uploaded);

  async function act(status: ComplianceStatus) {
    if (!profile) return;
    setActing(true);
    try {
      await apiPatch(`/admin/kyc/rental-providers/${rpId}/compliance`, {
        complianceStatus: status,
        ...(notes.trim() ? { complianceNotes: notes.trim() } : {}),
      });
      onStatusChange(rpId, status);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">

        {profile && (
          <div className="mb-3 pb-3 border-b" style={{ borderColor: "var(--color-base-100)" }}>
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <h2 className="text-sm font-semibold" style={{ color: "var(--color-neutral-900)" }}>
                {providerName(profile, `RP #${rpId}`)}
              </h2>
              <ComplianceBadge s={profile.complianceStatus} />
              <div className="ml-auto flex items-center gap-2">
                <UserStatusToggle userId={profile.user?.id} status={profile.user?.status} />
                <Link href={`/dashboard/admin/kyc/rental-provider/${rpId}`}
                  className="flex items-center gap-1 text-xs"
                  style={{ color: "var(--color-primary)" }}>
                  <ExternalLink size={11} /> Full page
                </Link>
              </div>
            </div>
            <p className="text-xs" style={{ color: "var(--color-neutral-500)" }}>
              {profile.user?.email}{profile.user?.phone ? ` · ${profile.user.phone}` : ""}
            </p>
            {profile.complianceNotes && (
              <p className="text-xs mt-1 px-2 py-1 rounded-lg"
                style={{ backgroundColor: "#fef9eb", color: "#92400e" }}>
                {profile.complianceNotes}
              </p>
            )}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center h-32 text-sm"
            style={{ color: "var(--color-neutral-400)" }}>Loading…</div>
        )}
        {error && (
          <div className="text-sm p-3 rounded-xl"
            style={{ backgroundColor: "#fef2f2", color: "#dc2626" }}>{error}</div>
        )}

        {profile && !loading && (
          <div className="space-y-3">

            {/* Missing for approval — only the gaps; everything provided is visible below */}
            {missingRequired.length > 0 ? (
              <div className="rounded-xl p-3" style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca" }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <AlertCircle size={12} style={{ color: "#dc2626" }} />
                  <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#b91c1c" }}>
                    Missing for approval — {missingRequired.length} item{missingRequired.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="space-y-1">
                  {missingRequired.map((c) => (
                    <div key={c.key} className="flex items-center gap-1.5 text-[11px]">
                      <XCircle size={11} style={{ color: "#dc2626" }} className="shrink-0" />
                      <span className="font-medium truncate" style={{ color: "#b91c1c" }}>{c.displayName}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : requiredItems.length > 0 && (
              <div className="rounded-xl p-2.5 flex items-center gap-1.5" style={{ backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                <CheckCircle2 size={12} style={{ color: "#16a34a" }} />
                <span className="text-xs font-semibold" style={{ color: "#15803d" }}>All required documents are on file.</span>
              </div>
            )}

            {/* Identity */}
            <div className="rounded-xl p-3" style={{ backgroundColor: "#fff", border: "1px solid var(--color-base-200)" }}>
              <div className="flex items-center gap-1.5 mb-2">
                <User size={12} style={{ color: "var(--color-primary)" }} />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-neutral-500)" }}>Identity</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4">
                {[
                  { label: "Entity type",   value: profile.entityType?.replace(/_/g, " ") },
                  { label: "Company",       value: profile.companyName },
                  { label: "Emirates ID",   value: profile.emiratesIdNumber },
                  { label: "Passport",      value: profile.passportNumber },
                  { label: "Nationality",   value: profile.nationality },
                  { label: "Gender",        value: profile.gender },
                  { label: "Date of birth", value: profile.dateOfBirth ? new Date(profile.dateOfBirth).toLocaleDateString("en-AE", { timeZone: APP_TIME_ZONE }) : undefined },
                  { label: "Address",       value: profile.contactAddress },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between py-1.5 border-b col-span-1"
                    style={{ borderColor: "var(--color-base-100)" }}>
                    <span className="text-xs" style={{ color: "var(--color-neutral-400)" }}>{label}</span>
                    <span className="text-xs font-semibold"
                      style={{ color: value ? "var(--color-neutral-800)" : "var(--color-neutral-300)" }}>
                      {value ?? "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Trade license */}
            <div className="rounded-xl p-3" style={{ backgroundColor: "#fff", border: "1px solid var(--color-base-200)" }}>
              <div className="flex items-center gap-1.5 mb-2">
                <Building2 size={12} style={{ color: "var(--color-primary)" }} />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-neutral-500)" }}>Trade License</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b"
                style={{ borderColor: "var(--color-base-100)" }}>
                <span className="text-xs" style={{ color: "var(--color-neutral-400)" }}>License No.</span>
                <span className="text-xs font-semibold"
                  style={{ color: profile.tradeLicenseNumber ? "var(--color-neutral-800)" : "var(--color-neutral-300)" }}>
                  {profile.tradeLicenseNumber ?? "—"}
                </span>
              </div>
            </div>

            {/* Banking */}
            <div className="rounded-xl p-3" style={{ backgroundColor: "#fff", border: "1px solid var(--color-base-200)" }}>
              <div className="flex items-center gap-1.5 mb-2">
                <CreditCard size={12} style={{ color: "var(--color-primary)" }} />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-neutral-500)" }}>Banking</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4">
                {[
                  { label: "Bank",         value: profile.bankName },
                  { label: "Account name", value: profile.bankAccountName },
                  { label: "IBAN",         value: profile.bankIban },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between py-1.5 border-b"
                    style={{ borderColor: "var(--color-base-100)" }}>
                    <span className="text-xs" style={{ color: "var(--color-neutral-400)" }}>{label}</span>
                    <span className="text-xs font-semibold"
                      style={{ color: value ? "var(--color-neutral-800)" : "var(--color-neutral-300)" }}>
                      {value ?? "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Power of Attorney — kept separate from the owner's own KYC */}
            {(profile.hasPoa || poaDocs.length > 0) && (
              <div className="rounded-xl p-3" style={{ backgroundColor: "#fff", border: "1px solid var(--color-base-200)" }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <ShieldCheck size={12} style={{ color: "var(--color-primary)" }} />
                  <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-neutral-500)" }}>
                    Power of Attorney
                  </span>
                  {poaDocs.some((d) => d.fileUrl) && (
                    <button type="button"
                      onClick={() => openDocViewer(
                        poaDocs.map((d) => ({ fileUrl: d.fileUrl, caption: d.documentKey.replace(/_/g, " ") })),
                        "Power of Attorney",
                      )}
                      className="ml-auto flex items-center gap-0.5 text-[11px] font-semibold cursor-pointer"
                      style={{ color: "var(--color-primary)" }}>
                      <ExternalLink size={11} /> View all
                    </button>
                  )}
                </div>

                {/* POA holder person */}
                {(profile.poaPersonName || profile.poaPersonPhone || profile.poaPersonEmail) && (
                  <div className="grid grid-cols-2 gap-x-4 mb-2">
                    {[
                      { label: "Holder", value: profile.poaPersonName },
                      { label: "Phone",  value: profile.poaPersonPhone },
                      { label: "Email",  value: profile.poaPersonEmail },
                    ].filter((r) => r.value).map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between gap-2 py-1.5 border-b col-span-1"
                        style={{ borderColor: "var(--color-base-100)" }}>
                        <span className="text-xs shrink-0" style={{ color: "var(--color-neutral-400)" }}>{label}</span>
                        <span className="text-xs font-semibold truncate" style={{ color: "var(--color-neutral-800)" }}>{value}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* POA documents */}
                {poaDocs.length > 0 ? (
                  <div className="space-y-1.5">
                    {poaDocs.map((doc) => (
                      <div key={doc.id} className="flex items-center justify-between gap-2 py-1.5 border-b"
                        style={{ borderColor: "var(--color-base-100)" }}>
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate capitalize" style={{ color: "var(--color-neutral-700)" }}>
                            {doc.documentKey.replace(/^poa_/, "").replace(/_/g, " ")}
                          </p>
                          {doc.expiryDate && (
                            <p className="text-xs" style={{ color: "var(--color-neutral-400)" }}>
                              Exp: {new Date(doc.expiryDate).toLocaleDateString("en-AE", { timeZone: APP_TIME_ZONE })}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{
                              backgroundColor: ["processed", "complete"].includes(String(doc.status).toLowerCase()) ? "#dcfce7" : "#fef3c7",
                              color: ["processed", "complete"].includes(String(doc.status).toLowerCase()) ? "#15803d" : "#b45309",
                            }}>
                            {doc.status}
                          </span>
                          {doc.fileUrl && (
                            <button type="button" onClick={() => openDocViewer({ fileUrl: doc.fileUrl, caption: doc.documentKey.replace(/_/g, " ") })} className="cursor-pointer">
                              <ExternalLink size={11} style={{ color: "var(--color-primary)" }} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs" style={{ color: "var(--color-neutral-400)" }}>No POA documents uploaded yet.</p>
                )}
              </div>
            )}

            {/* Uploaded documents */}
            {docs.length > 0 && (
              <div className="rounded-xl p-3" style={{ backgroundColor: "#fff", border: "1px solid var(--color-base-200)" }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <FileText size={12} style={{ color: "var(--color-primary)" }} />
                  <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-neutral-500)" }}>
                    Uploaded Docs ({docs.length})
                  </span>
                  {docs.some((d) => d.fileUrl) && (
                    <button type="button"
                      onClick={() => openDocViewer(
                        docs.map((d) => ({ fileUrl: d.fileUrl, caption: d.documentKey.replace(/_/g, " ") })),
                        "Uploaded Documents",
                      )}
                      className="ml-auto flex items-center gap-0.5 text-[11px] font-semibold cursor-pointer"
                      style={{ color: "var(--color-primary)" }}>
                      <ExternalLink size={11} /> View all
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {docs.map((doc) => {
                    const st = String(doc.status).toLowerCase();
                    const ok = ["processed", "complete"].includes(st);
                    const bad = st === "rejected";
                    return (
                      <div key={doc.id} className="py-1.5 border-b last:border-b-0" style={{ borderColor: "var(--color-base-100)" }}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate" style={{ color: "var(--color-neutral-700)" }}>
                              {doc.documentKey.replace(/_/g, " ")}
                            </p>
                            {doc.expiryDate && (
                              <p className="text-xs" style={{ color: "var(--color-neutral-400)" }}>
                                Exp: {new Date(doc.expiryDate).toLocaleDateString("en-AE", { timeZone: APP_TIME_ZONE })}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                              style={{
                                backgroundColor: ok ? "#dcfce7" : bad ? "#fee2e2" : "#fef3c7",
                                color: ok ? "#15803d" : bad ? "#dc2626" : "#b45309",
                              }}>
                              {doc.status}
                            </span>
                            {doc.fileUrl && (
                              <button type="button" onClick={() => openDocViewer({ fileUrl: doc.fileUrl, caption: doc.documentKey.replace(/_/g, " ") })} className="cursor-pointer">
                                <ExternalLink size={11} style={{ color: "var(--color-primary)" }} />
                              </button>
                            )}
                            {/* Per-document verdict — RP docs were view-only before (SCRUM-662) */}
                            <DocReviewActions doc={doc} onUpdate={onDocUpdate} />
                          </div>
                        </div>
                        {bad && doc.notes && (
                          <p className="text-[11px] mt-1 px-2 py-1 rounded-lg" style={{ backgroundColor: "#fef2f2", color: "#991b1b" }}>
                            <span className="font-semibold">Rejection reason: </span>{doc.notes}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sticky action bar */}
      {profile && (
        <div className="shrink-0 border-t px-4 py-3 space-y-2"
          style={{ borderColor: "var(--color-base-200)", backgroundColor: "#fff" }}>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional — shown to provider on action required)"
            className="w-full px-3 py-1.5 rounded-lg text-xs border outline-none"
            style={{ borderColor: "var(--color-base-200)", color: "var(--color-neutral-800)" }}
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (missingRequired.length > 0 && !window.confirm(
                  `${missingRequired.length} required document${missingRequired.length === 1 ? "" : "s"} still missing:\n\n` +
                  missingRequired.map((c) => `• ${c.displayName}`).join("\n") +
                  `\n\nApprove (Mark Compliant) anyway?`,
                )) return;
                void act("compliant");
              }}
              disabled={acting || loading}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
              style={{ backgroundColor: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" }}>
              <CheckCircle2 size={13} /> Mark Compliant
            </button>
            <button onClick={() => void act("action_required")} disabled={acting || loading}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
              style={{ backgroundColor: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>
              <AlertCircle size={13} /> Mark Action Required
            </button>
            <button onClick={() => void act("expired")} disabled={acting || loading}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
              style={{ backgroundColor: "#f3f4f6", color: "#6b7280", border: "1px solid #e5e7eb" }}>
              <XCircle size={13} /> Mark Expired
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// A titled section card. Fields render as stacked label-over-value pairs in a
// responsive grid — far easier to scan than stretched "label ……… value" rows,
// and values wrap in full (IBANs, Emirates IDs) instead of truncating.
function DetailCard({
  icon: Icon, title, rows, children, cols = 2,
}: {
  icon: React.ElementType;
  title: string;
  rows?: { label: string; value?: React.ReactNode }[];
  children?: React.ReactNode;
  cols?: 1 | 2;
}) {
  return (
    <section className="rounded-xl overflow-hidden h-full" style={{ backgroundColor: "#fff", border: "1px solid var(--color-base-200)" }}>
      <div className="flex items-center gap-1.5 px-3.5 py-2.5 border-b"
        style={{ borderColor: "var(--color-base-100)", backgroundColor: "color-mix(in srgb, var(--color-primary) 4%, white)" }}>
        <Icon size={13} style={{ color: "var(--color-primary)" }} />
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--color-neutral-600)" }}>{title}</span>
      </div>
      <div className="px-3.5 py-3">
        {rows && rows.length > 0 && (
          <dl className={`grid ${cols === 1 ? "grid-cols-1" : "grid-cols-2"} gap-x-5 gap-y-3`}>
            {rows.map(({ label, value }) => {
              const has = value != null && value !== "";
              return (
                <div key={label} className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-wide mb-0.5" style={{ color: "var(--color-neutral-400)" }}>{label}</dt>
                  <dd className="text-[13px] font-semibold leading-snug break-words"
                    style={{ color: has ? "var(--color-neutral-800)" : "var(--color-neutral-300)" }}>
                    {has ? value : "—"}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
        {children && <div className={rows && rows.length > 0 ? "mt-3" : ""}>{children}</div>}
      </div>
    </section>
  );
}

// A labelled row of pill tags (categories, emirates, languages).
function ChipRow({ label, items, tone = "primary" }: { label: string; items: string[]; tone?: "primary" | "neutral" }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide mb-1.5" style={{ color: "var(--color-neutral-400)" }}>{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((c) => (
          <span key={c} className="text-[11px] font-medium px-2.5 py-1 rounded-full capitalize"
            style={tone === "primary"
              ? { backgroundColor: "var(--color-primary-50)", color: "var(--color-primary)" }
              : { backgroundColor: "var(--color-base-100)", color: "var(--color-neutral-600)" }}>
            {c.replace(/_/g, " ")}
          </span>
        ))}
      </div>
    </div>
  );
}

// Compact "value + label" stat pill for the at-a-glance header strip.
function StatPill({ value, label, tone = "neutral" }: { value: React.ReactNode; label: string; tone?: "neutral" | "ok" | "warn" }) {
  const palette = tone === "ok"
    ? { bg: "#f0fdf4", border: "#bbf7d0", val: "#15803d", lab: "#16a34a" }
    : tone === "warn"
    ? { bg: "#fef2f2", border: "#fecaca", val: "#b91c1c", lab: "#dc2626" }
    : { bg: "#fff", border: "var(--color-base-200)", val: "var(--color-neutral-800)", lab: "var(--color-neutral-400)" };
  return (
    <span className="inline-flex items-baseline gap-1 px-2.5 py-1 rounded-lg border"
      style={{ backgroundColor: palette.bg, borderColor: palette.border }}>
      <span className="text-[13px] font-bold leading-none" style={{ color: palette.val }}>{value}</span>
      <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: palette.lab }}>{label}</span>
    </span>
  );
}

// A labelled subsection inside a DetailCard — a divider + heading, then either a
// label/value grid (rows) or custom content (children). Lets related-but-distinct
// groups (owner identity, licensing, coverage) live inside one card.
function SubGroup({
  icon: Icon, title, rows, children,
}: {
  icon?: React.ElementType;
  title: string;
  rows?: { label: string; value?: React.ReactNode }[];
  children?: React.ReactNode;
}) {
  return (
    <div className="pt-3 border-t" style={{ borderColor: "var(--color-base-100)" }}>
      <div className="flex items-center gap-1.5 mb-2">
        {Icon && <Icon size={11} style={{ color: "var(--color-primary)" }} />}
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-neutral-500)" }}>{title}</span>
      </div>
      {rows && rows.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
          {rows.map(({ label, value }) => {
            const has = value != null && value !== "";
            return (
              <div key={label} className="min-w-0">
                <dt className="text-[10px] font-medium uppercase tracking-wide mb-0.5" style={{ color: "var(--color-neutral-400)" }}>{label}</dt>
                <dd className="text-[13px] font-semibold leading-snug break-words"
                  style={{ color: has ? "var(--color-neutral-800)" : "var(--color-neutral-300)" }}>
                  {has ? value : "—"}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {children}
    </div>
  );
}

// ─── RIGHT panel: SP content + actions ───────────────────────────────────────

function SpContentPanel({
  detail, sp, spId, loading, error, onStatusChange, onDocUpdate,
}: {
  detail: SpDetail | null;
  sp: ServiceProvider;              // list-row fallback while detail loads
  spId: number;
  loading: boolean;
  error: string | null;
  onStatusChange: (id: number, status: ComplianceStatus) => void;
  onDocUpdate: (docId: number, patch: Partial<UploadedDoc>) => void;
}) {
  const [acting, setActing] = useState(false);
  const [notes, setNotes] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNotes("");
    scrollRef.current?.scrollTo({ top: 0 });
  }, [spId]);

  // Prefer the freshly-fetched detail profile; fall back to the list row so the
  // header/badge render immediately while the detail request is in flight.
  const profile = detail?.profile ?? sp;
  const docs = detail?.uploadedDocs ?? [];

  // Required-document checklist — drives the approval gate + "missing" card.
  const checklist = detail?.checklist ?? [];
  const requiredItems = checklist.filter((c) => c.required);
  const missingRequired = requiredItems.filter((c) => !c.uploaded);

  const titleize = (s?: string | null) => (s ?? "").replace(/_/g, " ");
  const csv = (s?: string | null) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);
  const categories = profile.serviceCategories ? csv(profile.serviceCategories)
    : profile.serviceCategory ? [profile.serviceCategory] : [];
  const emirates = csv(profile.emiratesServed);
  const languages = Array.isArray(profile.opsContactLanguages) ? profile.opsContactLanguages : [];
  // serviceZones is stored as a JSON string: { dubai: ["JLT","Marina"], … }
  let zones: Record<string, string[]> = {};
  try { zones = profile.serviceZones ? JSON.parse(profile.serviceZones) : {}; } catch { zones = {}; }
  const zoneEntries = Object.entries(zones).filter(([, v]) => Array.isArray(v) && v.length);

  // Adopted catalogue services (the "sub-categories" under each category),
  // grouped by category so the reviewer sees exactly what was priced.
  const services = detail?.services ?? [];
  const servicesByCat = services.reduce<Record<string, SpService[]>>((acc, s) => {
    (acc[s.category] ??= []).push(s); return acc;
  }, {});
  const priceLabel = (s: SpService) => {
    if (s.pricingMode === "quote" || s.basePrice == null)
      return s.minCalloutCharge != null ? `Quote · callout AED ${s.minCalloutCharge}` : "Quote after callout";
    const unit = s.priceUnit === "per_hour" ? "/hr" : s.priceUnit === "per_unit" ? "/unit" : "";
    return `${s.isFromPrice ? "from " : ""}${s.currency ?? "AED"} ${s.basePrice}${unit}`;
  };

  // ── Approval decision engine ────────────────────────────────────────────────
  // Synthesised from compliance / operations / fraud review criteria: the auto-
  // computable gates an admin needs before approving a vendor, the red flags
  // that separate legit companies from shell registrations, and the manual
  // document checks the panel should prompt. Everything derives from fields
  // already on the detail payload.
  const digitsOf = (s?: string | null) => (s ?? "").replace(/\D/g, "");
  const MS_DAY = 86_400_000;
  const now = Date.now();
  const docByKey = (k: string) => docs.find((d) => d.documentKey === k);
  const expiryDays = (d?: UploadedDoc) =>
    d?.expiryDate ? Math.floor((new Date(d.expiryDate).getTime() - now) / MS_DAY) : null;

  const expiredDocs  = docs.filter((d) => { const n = expiryDays(d); return n != null && n < 0; });
  const expiringDocs = docs.filter((d) => { const n = expiryDays(d); return n != null && n >= 0 && n <= 30; });

  const eidDigits = digitsOf(profile.emiratesIdNumber);
  const eidValid = /^784\d{12}$/.test(eidDigits);
  const trnDigits = digitsOf(profile.vatTrn);
  const age = profile.dateOfBirth
    ? Math.floor((now - new Date(profile.dateOfBirth).getTime()) / (365.25 * MS_DAY))
    : null;
  const emailDomain = (profile.user?.email ?? "").split("@")[1]?.toLowerCase() ?? "";
  const DISPOSABLE_DOMAINS = ["mailinator.com", "yopmail.com", "guerrillamail.com", "temp-mail.org", "10minutemail.com", "tempmail.com", "trashmail.com", "maildrop.cc", "getnada.com", "dispostable.com", "sharklasers.com"];
  const FREE_WEBMAIL = ["gmail.com", "hotmail.com", "yahoo.com", "outlook.com", "icloud.com", "live.com"];
  const unpricedCats = categories.filter((c) => !(servicesByCat[c]?.length));

  type CheckStatus = "pass" | "warn" | "fail";
  const checks: { label: string; status: CheckStatus; detail: string }[] = [];

  // Hands-on home services are company-only under UAE law (freelance permits
  // don't cover them) — an individual entity can never be approved as-is.
  checks.push(profile.entityType === "company"
    ? { label: "Licensed company", status: "pass", detail: "Company entity — eligible for hands-on services" }
    : { label: "Licensed company", status: "fail", detail: "Individual entity — hands-on services require a licensed company" });

  checks.push(missingRequired.length === 0
    ? { label: "Required documents", status: "pass", detail: `All ${requiredItems.length} on file` }
    : { label: "Required documents", status: "fail", detail: `${missingRequired.length} missing: ${missingRequired.map((c) => c.displayName).join(", ")}` });

  checks.push(expiredDocs.length > 0
    ? { label: "Documents in date", status: "fail", detail: `Expired: ${expiredDocs.map((d) => titleize(d.documentKey)).join(", ")}` }
    : expiringDocs.length > 0
    ? { label: "Documents in date", status: "warn", detail: expiringDocs.map((d) => `${titleize(d.documentKey)} expires in ${expiryDays(d)}d`).join("; ") }
    : { label: "Documents in date", status: "pass", detail: "No expired or imminently-expiring documents" });

  checks.push(!profile.emiratesIdNumber
    ? { label: "Signatory Emirates ID", status: "warn", detail: "No EID number on profile — read it from the document" }
    : eidValid
    ? { label: "Signatory Emirates ID", status: "pass", detail: profile.emiratesIdNumber }
    : { label: "Signatory Emirates ID", status: "warn", detail: `"${profile.emiratesIdNumber}" — not a valid 15-digit 784… number` });

  checks.push(profile.tradeLicenseNumber
    ? { label: "Trade licence No.", status: "pass", detail: profile.tradeLicenseNumber }
    : { label: "Trade licence No.", status: "warn", detail: "Not on profile — confirm from the licence document" });

  checks.push(!trnDigits
    ? { label: "VAT TRN", status: "warn", detail: "Not provided — assumed below registration threshold" }
    : /^\d{15}$/.test(trnDigits)
    ? { label: "VAT TRN", status: "pass", detail: profile.vatTrn as string }
    : { label: "VAT TRN", status: "fail", detail: `"${profile.vatTrn}" — TRN must be exactly 15 digits` });

  checks.push((profile.user?.phone || profile.opsContactPhone)
    ? { label: "Contactable", status: "pass", detail: [profile.user?.phone, profile.opsContactName ? `ops: ${profile.opsContactName}` : null].filter(Boolean).join(" · ") }
    : { label: "Contactable", status: "fail", detail: "No phone number on account or ops contact" });

  checks.push(profile.user?.status === "suspended"
    ? { label: "Account standing", status: "fail", detail: "User account is suspended — do not approve" }
    : { label: "Account standing", status: "pass", detail: "Account active" });

  // Per-document review state — every uploaded doc should be individually
  // approved (processed) or rejected before the profile-level verdict.
  const rejectedDocs = docs.filter((d) => String(d.status).toLowerCase() === "rejected");
  const pendingDocs = docs.filter((d) => ["attached", "pending"].includes(String(d.status).toLowerCase()));
  const verifiedDocs = docs.filter((d) => ["processed", "complete"].includes(String(d.status).toLowerCase()));
  if (docs.length > 0) {
    checks.push(rejectedDocs.length > 0
      ? { label: "Documents reviewed", status: "fail", detail: `${rejectedDocs.length} rejected — awaiting re-upload: ${rejectedDocs.map((d) => titleize(d.documentKey)).join(", ")}` }
      : pendingDocs.length > 0
      ? { label: "Documents reviewed", status: "warn", detail: `${pendingDocs.length} of ${docs.length} awaiting review — approve or reject each below` }
      : { label: "Documents reviewed", status: "pass", detail: `All ${verifiedDocs.length} uploaded documents verified` });
  }

  // Red flags — plausibility/fraud signals that don't map to a single gate.
  const flags: string[] = [];
  if (DISPOSABLE_DOMAINS.includes(emailDomain)) flags.push(`Disposable email domain (${emailDomain})`);
  else if (profile.entityType === "company" && FREE_WEBMAIL.includes(emailDomain)) flags.push(`Company using free webmail (${emailDomain})`);
  if (profile.teamSizeBand === "1-2" && (categories.length >= 3 || emirates.length >= 3))
    flags.push(`Solo team (1-2) promising ${categories.length} categories across ${emirates.length} emirate${emirates.length === 1 ? "" : "s"}`);
  if (profile.fleetSizeBand === "0" && emirates.length > 1) flags.push("No vehicles but multi-emirate coverage");
  if (profile.teamSizeBand === "1-2" && services.some((s) => s.isEmergency)) flags.push("Offers 24/7 emergency services with a 1-2 person team");
  if (unpricedCats.length > 0) flags.push(`No priced services in: ${unpricedCats.map(titleize).join(", ")}`);
  if (age != null && age < 18) flags.push(`Signatory is under 18 (age ${age})`);
  if ((profile.totalReviews ?? 0) > 0 && profile.complianceStatus !== "compliant") flags.push("Has reviews before approval — possible account reuse");

  const gateFailures = checks.filter((c) => c.status === "fail");

  // Manual eyeball prompts — what the reviewer must confirm on the documents
  // themselves before approving; each links straight to the relevant file.
  const manualVerify = [
    { text: `Licence activities cover all ${categories.length} selected categories`, docKey: "trade_license" },
    { text: `Emirates ID name & DOB match “${profile.ownerName ?? "the owner"}”`, docKey: "emirates_id" },
    { text: "Bank / IBAN letter account holder matches the company name", docKey: "bank_statement" },
    { text: "MOA names the signatory as owner / authorised manager", docKey: "moa" },
  ];

  async function act(status: ComplianceStatus) {
    setActing(true);
    try {
      await apiPatch(`/admin/kyc/service-providers/${spId}/compliance`, {
        complianceStatus: status,
        ...(notes.trim() ? { complianceNotes: notes.trim() } : {}),
      });
      onStatusChange(spId, status);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">

        <div className="mb-3 pb-3 border-b" style={{ borderColor: "var(--color-base-100)" }}>
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-neutral-900)" }}>
              {profile.businessName ?? profile.ownerName ?? providerName(profile, `SP #${spId}`)}
            </h2>
            <ComplianceBadge s={profile.complianceStatus} />
            <div className="ml-auto">
              <UserStatusToggle userId={profile.user?.id} status={profile.user?.status} />
            </div>
          </div>
          <p className="text-xs" style={{ color: "var(--color-neutral-500)" }}>
            {profile.user?.email}{profile.user?.phone ? ` · ${profile.user.phone}` : ""}
          </p>

          {/* At-a-glance — quick scan of the application's shape */}
          {!loading && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              <StatPill value={categories.length} label="categories" />
              <StatPill value={services.length} label="services" />
              <StatPill value={emirates.length} label="emirates" />
              {requiredItems.length > 0 && (
                <StatPill
                  value={`${requiredItems.length - missingRequired.length}/${requiredItems.length}`}
                  label="docs"
                  tone={missingRequired.length > 0 ? "warn" : "ok"}
                />
              )}
              {detail && (gateFailures.length + flags.length > 0 ? (
                <StatPill value={gateFailures.length + flags.length}
                  label={gateFailures.length + flags.length === 1 ? "issue" : "issues"} tone="warn" />
              ) : (
                <StatPill value="0" label="issues" tone="ok" />
              ))}
            </div>
          )}

          {profile.complianceNotes && (
            <p className="text-xs mt-2 px-2.5 py-1.5 rounded-lg"
              style={{ backgroundColor: "#fef9eb", color: "#92400e" }}>
              <span className="font-semibold">Note: </span>{profile.complianceNotes}
            </p>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center h-32 text-sm"
            style={{ color: "var(--color-neutral-400)" }}>Loading…</div>
        )}
        {error && (
          <div className="text-sm p-3 rounded-xl"
            style={{ backgroundColor: "#fef2f2", color: "#dc2626" }}>{error}</div>
        )}

        <div className="space-y-3">

          {/* Approval Checks — the decision summary: auto-computed gates, red
              flags, and the manual document verifications, all in one card so
              the admin can decide without hunting through the sections below. */}
          {!loading && detail && (
            <section className="rounded-xl overflow-hidden" style={{ backgroundColor: "#fff", border: "1px solid var(--color-base-200)" }}>
              <div className="flex items-center gap-1.5 px-3.5 py-2.5 border-b"
                style={{
                  borderColor: "var(--color-base-100)",
                  backgroundColor: gateFailures.length ? "#fef2f2" : "color-mix(in srgb, var(--color-primary) 4%, white)",
                }}>
                <ShieldCheck size={13} style={{ color: gateFailures.length ? "#dc2626" : "var(--color-primary)" }} />
                <span className="text-[11px] font-bold uppercase tracking-wider"
                  style={{ color: gateFailures.length ? "#b91c1c" : "var(--color-neutral-600)" }}>
                  Approval Checks · {checks.filter((c) => c.status === "pass").length}/{checks.length} passing
                  {gateFailures.length > 0 ? ` · ${gateFailures.length} blocking` : ""}
                </span>
              </div>
              <div className="px-3.5 py-3 space-y-3">

                {/* Auto-computed gates */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2">
                  {checks.map((c) => {
                    const Icon = c.status === "pass" ? CheckCircle2 : c.status === "warn" ? AlertCircle : XCircle;
                    const color = c.status === "pass" ? "#16a34a" : c.status === "warn" ? "#b45309" : "#dc2626";
                    return (
                      <div key={c.label} className="flex items-start gap-2 min-w-0">
                        <Icon size={13} style={{ color, marginTop: 2 }} className="shrink-0" />
                        <p className="text-xs leading-snug min-w-0">
                          <span className="font-semibold" style={{ color: "var(--color-neutral-800)" }}>{c.label}</span>
                          <span style={{ color: c.status === "pass" ? "var(--color-neutral-400)" : color }}> — {c.detail}</span>
                        </p>
                      </div>
                    );
                  })}
                </div>

                {/* Red flags — only when something triggers */}
                {flags.length > 0 && (
                  <div className="rounded-lg px-3 py-2" style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca" }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#b91c1c" }}>
                      Red flags · {flags.length}
                    </p>
                    <div className="space-y-1">
                      {flags.map((f) => (
                        <p key={f} className="text-[11px] flex items-start gap-1.5 leading-snug" style={{ color: "#991b1b" }}>
                          <AlertCircle size={11} className="shrink-0" style={{ marginTop: 1 }} />{f}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Manual verifications — the reviewer's document checklist */}
                <div className="pt-2.5 border-t" style={{ borderColor: "var(--color-base-100)" }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "var(--color-neutral-500)" }}>
                    Verify on the documents before approving
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1.5">
                    {manualVerify.map((m) => {
                      const doc = docByKey(m.docKey);
                      return (
                        <div key={m.text} className="flex items-center justify-between gap-2">
                          <span className="text-[11px] flex items-start gap-1.5 min-w-0 leading-snug" style={{ color: "var(--color-neutral-600)" }}>
                            <span className="shrink-0 font-bold" style={{ color: "var(--color-neutral-300)" }}>☐</span>
                            <span>{m.text}</span>
                          </span>
                          {doc?.fileUrl && (
                            <button type="button"
                              onClick={() => openDocViewer({ fileUrl: doc.fileUrl, caption: titleize(m.docKey) })}
                              className="text-[11px] font-semibold shrink-0 cursor-pointer flex items-center gap-0.5"
                              style={{ color: "var(--color-primary)" }}>
                              <ExternalLink size={10} /> View
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Two-column masonry to cut vertical scroll — cards flow into two
              balanced columns (single column on narrow screens). Reads top-to-
              bottom down the first column, then the second. */}
          <div className="lg:columns-2 gap-3 [&>*]:mb-3 [&>*]:break-inside-avoid">

          {/* Business basics + owner identity + licensing, all one entity card */}
          <DetailCard icon={Building2} title="Business & Owner" rows={[
            { label: "Entity type",       value: titleize(profile.entityType) },
            { label: "Business name",     value: profile.businessName },
            { label: "Owner / signatory", value: profile.ownerName },
            { label: "Registered",        value: profile.createdAt ? new Date(profile.createdAt).toLocaleDateString("en-AE", { timeZone: APP_TIME_ZONE }) : undefined },
          ]}>
            <div className="space-y-3">
              <SubGroup icon={User} title="Owner Identity" rows={[
                { label: "Emirates ID",   value: profile.emiratesIdNumber },
                { label: "Nationality",   value: profile.nationality },
                { label: "Date of birth", value: profile.dateOfBirth ? new Date(profile.dateOfBirth).toLocaleDateString("en-AE", { timeZone: APP_TIME_ZONE }) : undefined },
              ]} />
              <SubGroup icon={CreditCard} title="Licensing & Tax" rows={[
                { label: "Trade licence No.", value: profile.tradeLicenseNumber },
                { label: "VAT TRN",           value: profile.vatTrn },
              ]} />
            </div>
          </DetailCard>

          {/* Operations + coverage (where they work) in one card */}
          <DetailCard icon={Users} title="Operations & Coverage" rows={[
            { label: "Team size",   value: profile.teamSizeBand },
            { label: "Fleet size",  value: profile.fleetSizeBand },
            { label: "Min notice",  value: profile.minNoticeHours != null ? `${profile.minNoticeHours} h` : undefined },
            { label: "Ops contact", value: profile.opsContactName },
            { label: "Ops phone",   value: profile.opsContactPhone },
            { label: "WhatsApp",    value: profile.opsContactWhatsapp ? "Yes" : "No" },
            { label: "Job-ready",   value: profile.jobReadyAt ? new Date(profile.jobReadyAt).toLocaleDateString("en-AE", { timeZone: APP_TIME_ZONE }) : "Not yet" },
          ]}>
            <div className="space-y-3">
              <ChipRow label="Languages" items={languages} tone="neutral" />
              <SubGroup icon={ShieldCheck} title="Coverage">
                <ChipRow label={`Emirates served (${emirates.length})`} items={emirates} tone="neutral" />
                {emirates.length === 0 && (
                  <p className="text-xs" style={{ color: "var(--color-neutral-300)" }}>No emirates selected.</p>
                )}
                {zoneEntries.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--color-neutral-400)" }}>Zones</p>
                    {zoneEntries.map(([em, list]) => (
                      <div key={em} className="flex gap-1.5 text-xs">
                        <span className="capitalize font-semibold shrink-0" style={{ color: "var(--color-neutral-600)" }}>{titleize(em)}:</span>
                        <span style={{ color: "var(--color-neutral-500)" }}>{list.join(", ")}</span>
                      </div>
                    ))}
                  </div>
                )}
              </SubGroup>
            </div>
          </DetailCard>

          {/* Step 2 — categories with their priced services listed underneath.
              One unified grouped price-list (no separate chip row) so the
              category headers and service names never blur together. */}
          <DetailCard icon={Wrench} title="Services">
            {categories.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--color-neutral-300)" }}>No categories selected.</p>
            ) : (
              <>
                <div className="flex items-baseline justify-between mb-2.5">
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--color-neutral-400)" }}>
                    Categories &amp; services offered
                  </p>
                  <span className="text-[10px] tabular-nums" style={{ color: "var(--color-neutral-400)" }}>
                    {categories.length} categories · {services.length} services
                  </span>
                </div>
                <div className="space-y-3">
                  {categories.map((cat) => {
                    const list = servicesByCat[cat] ?? [];
                    return (
                      <div key={cat}>
                        {/* Category header bar — tinted + uppercase so it can't be
                            confused with a service row of the same name */}
                        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg mb-1"
                          style={{ backgroundColor: "var(--color-primary-50)" }}>
                          <Layers size={11} style={{ color: "var(--color-primary)" }} />
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-primary)" }}>
                            {titleize(cat)}
                          </span>
                          <span className="ml-auto text-[10px] font-medium" style={{ color: "var(--color-primary)", opacity: 0.7 }}>
                            {list.length ? `${list.length} service${list.length === 1 ? "" : "s"}` : "none priced"}
                          </span>
                        </div>
                        {list.length > 0 ? (
                          <div className="pl-1">
                            {list.map((s) => (
                              <div key={s.id} className="flex items-baseline justify-between gap-3 py-1.5 border-b border-dashed last:border-b-0"
                                style={{ borderColor: "var(--color-base-200)" }}>
                                <span className="text-[13px] flex items-center gap-1.5 min-w-0" style={{ color: "var(--color-neutral-800)" }}>
                                  <span className="truncate">{s.name}</span>
                                  {s.isEmergency && <span className="text-[9px] font-semibold px-1 rounded shrink-0" style={{ backgroundColor: "#fef2f2", color: "#dc2626" }}>24/7</span>}
                                </span>
                                <span className="text-[13px] font-semibold shrink-0 tabular-nums" style={{ color: "var(--color-neutral-700)" }}>
                                  {priceLabel(s)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px] pl-2 py-0.5" style={{ color: "var(--color-neutral-300)" }}>
                            No services priced in this category yet.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </DetailCard>

          </div>

          {/* KYC documents — full-width row at the end; two-up so rows breathe */}
          {(checklist.length > 0 || docs.length > 0) && (
            <section className="rounded-xl overflow-hidden" style={{ backgroundColor: "#fff", border: "1px solid var(--color-base-200)" }}>
              <div className="flex items-center gap-1.5 px-3.5 py-2.5 border-b"
                style={{ borderColor: "var(--color-base-100)", backgroundColor: "color-mix(in srgb, var(--color-primary) 4%, white)" }}>
                <FileText size={13} style={{ color: "var(--color-primary)" }} />
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--color-neutral-600)" }}>
                  KYC Documents{checklist.length > 0 ? ` · ${checklist.filter((c) => c.uploaded).length}/${checklist.length}` : ""}
                </span>
                {docs.some((d) => d.fileUrl) && (
                  <button type="button"
                    onClick={() => openDocViewer(
                      docs.filter((d) => d.fileUrl).map((d) => ({ fileUrl: d.fileUrl, caption: titleize(d.documentKey) })),
                      "KYC Documents",
                    )}
                    className="ml-auto flex items-center gap-0.5 text-[11px] font-semibold cursor-pointer"
                    style={{ color: "var(--color-primary)" }}>
                    <ExternalLink size={11} /> View all
                  </button>
                )}
              </div>
              <div className="px-3.5 py-1">
                {(checklist.length > 0 ? checklist : docs.map((d) => ({
                  key: d.documentKey, displayName: titleize(d.documentKey), required: false,
                  uploaded: true, fileUrl: d.fileUrl,
                }))).map((c) => {
                  const doc = docs.find((d) => d.documentKey === c.key);
                  const fileUrl = ("fileUrl" in c && c.fileUrl) || doc?.fileUrl || null;
                  const days = expiryDays(doc);
                  const st = String(doc?.status ?? "").toLowerCase();
                  const isVerified = ["processed", "complete"].includes(st);
                  const isRejected = st === "rejected";
                  const isExpired = days != null && days < 0;
                  // Badge reflects the review verdict, not just upload presence.
                  const badge = !c.uploaded
                    ? { text: "missing",        bg: "#fef2f2", color: "#dc2626" }
                    : isRejected
                    ? { text: "rejected",       bg: "#fef2f2", color: "#dc2626" }
                    : isExpired
                    ? { text: "expired",        bg: "#fef3c7", color: "#b45309" }
                    : isVerified
                    ? { text: "verified",       bg: "#dcfce7", color: "#15803d" }
                    : { text: "pending review", bg: "#fef3c7", color: "#b45309" };
                  return (
                    <div key={c.key} className="py-2 border-b last:border-b-0" style={{ borderColor: "var(--color-base-100)" }}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate" style={{ color: "var(--color-neutral-700)" }}>
                            {c.displayName}
                            {c.required && <span className="ml-1 text-[10px]" style={{ color: "#dc2626" }}>• required</span>}
                          </p>
                          {doc?.expiryDate && (
                            <p className="text-xs font-medium"
                              style={{ color: isExpired ? "#dc2626" : days != null && days <= 30 ? "#b45309" : "var(--color-neutral-400)" }}>
                              {isExpired
                                ? `Expired ${new Date(doc.expiryDate).toLocaleDateString("en-AE", { timeZone: APP_TIME_ZONE })}`
                                : days != null && days <= 30
                                ? `Expires in ${days}d — ${new Date(doc.expiryDate).toLocaleDateString("en-AE", { timeZone: APP_TIME_ZONE })}`
                                : `Exp: ${new Date(doc.expiryDate).toLocaleDateString("en-AE", { timeZone: APP_TIME_ZONE })}`}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                            style={{ backgroundColor: badge.bg, color: badge.color }}>
                            {badge.text}
                          </span>
                          {fileUrl && (
                            <button type="button" onClick={() => openDocViewer({ fileUrl, caption: c.displayName })}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold cursor-pointer"
                              style={{
                                backgroundColor: "var(--color-primary-50)",
                                color: "var(--color-primary)",
                                border: "1px solid color-mix(in srgb, var(--color-primary) 25%, white)",
                              }}
                              title="View document">
                              <ExternalLink size={11} /> View
                            </button>
                          )}
                          {/* Per-document review verdict (approve captures expiry) */}
                          {doc && <DocReviewActions doc={doc} onUpdate={onDocUpdate} />}
                        </div>
                      </div>
                      {isRejected && doc?.notes && (
                        <p className="text-[11px] mt-1 px-2 py-1 rounded-lg" style={{ backgroundColor: "#fef2f2", color: "#991b1b" }}>
                          <span className="font-semibold">Rejection reason: </span>{doc.notes}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Sticky action bar */}
      <div className="shrink-0 border-t px-4 py-3 space-y-2"
        style={{ borderColor: "var(--color-base-200)", backgroundColor: "#fff" }}>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional — shown to provider on action required)"
          className="w-full px-3 py-1.5 rounded-lg text-xs border outline-none"
          style={{ borderColor: "var(--color-base-200)", color: "var(--color-neutral-800)" }}
        />
        <div className="flex gap-2">
          <button
            onClick={() => {
              // Surface every failing gate + red flag before letting the admin
              // approve — approving over them is allowed but must be deliberate.
              const blockers = [
                ...gateFailures.map((c) => `✗ ${c.label} — ${c.detail}`),
                ...flags.map((f) => `⚑ ${f}`),
              ];
              if (blockers.length > 0 && !window.confirm(
                `${gateFailures.length} failing check${gateFailures.length === 1 ? "" : "s"} and ${flags.length} red flag${flags.length === 1 ? "" : "s"}:\n\n` +
                blockers.join("\n") +
                `\n\nApprove (Mark Compliant) anyway?`,
              )) return;
              void act("compliant");
            }}
            disabled={acting || loading}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
            style={{ backgroundColor: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" }}>
            <CheckCircle2 size={13} /> Mark Compliant
          </button>
          <button onClick={() => void act("action_required")} disabled={acting || loading}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
            style={{ backgroundColor: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>
            <AlertCircle size={13} /> Mark Action Required
          </button>
          <button onClick={() => void act("expired")} disabled={acting || loading}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
            style={{ backgroundColor: "#f3f4f6", color: "#6b7280", border: "1px solid #e5e7eb" }}>
            <XCircle size={13} /> Mark Expired
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── RIGHT panel: Tenant content ─────────────────────────────────────────────

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function KycBadge({ status }: { status?: string | null }) {
  const v = (status ?? "").toLowerCase();
  const cfg = !v
    ? { bg: "#f3f4f6", fg: "#6b7280", label: "KYC unknown" }
    : v.includes("verif") || v === "approved" || v === "complete"
      ? { bg: "#dcfce7", fg: "#15803d", label: "Verified" }
      : v.includes("reject") || v.includes("fail")
        ? { bg: "#fee2e2", fg: "#b91c1c", label: status!.replace(/_/g, " ") }
        : { bg: "#fef3c7", fg: "#b45309", label: status!.replace(/_/g, " ") };
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium capitalize"
      style={{ backgroundColor: cfg.bg, color: cfg.fg }}>
      <ShieldCheck size={10} /> {cfg.label}
    </span>
  );
}

function TenantContentPanel({ tenant, detail, loading, onDocUpdate }: {
  tenant: Tenant;
  detail: TenantDetail | null;
  loading: boolean;
  onDocUpdate: (docId: number, patch: Partial<UploadedDoc>) => void;
}) {
  const [showDocs, setShowDocs] = useState(false);
  const name = providerName(tenant, `Customer #${tenant.id}`);
  const p = detail?.profile;
  const u = p?.user;
  const docs = detail?.uploadedDocs ?? null;
  const email = u?.email ?? tenant.user?.email;
  const phone = u?.phone;
  const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-AE", { timeZone: APP_TIME_ZONE }) : "—");

  const overviewRows = [
    { label: "Entity type",       value: (p?.entityType ?? tenant.entityType)?.replace(/_/g, " ") },
    { label: "Document status",   value: (p?.documentStatus ?? tenant.documentStatus)?.replace(/_/g, " ") },
    { label: "Active status",     value: (p?.activeStatus ?? tenant.activeStatus)?.replace(/_/g, " ") },
    { label: "Registered",        value: fmtDate(p?.createdAt ?? tenant.createdAt) },
    { label: "Last updated",      value: p?.updatedAt ? fmtDate(p.updatedAt) : undefined },
    { label: "Trade licence no",  value: p?.tradeLicenseNumber },
    { label: "Licence authority", value: p?.tradeLicenseAuthority },
  ].filter(r => r.value);

  // Map the admin uploaded docs into the shared CustomerDocsModal shape.
  const customerDocs: CustomerDoc[] = (docs ?? []).map(d => ({
    id: d.id, documentKey: d.documentKey, displayName: null, category: null,
    status: d.status, fileUrl: d.fileUrl, expiryDate: d.expiryDate, ownerType: "customer",
  }));

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4">
        {/* Header — avatar + identity */}
        <div className="flex items-start gap-3 mb-4 pb-3 border-b" style={{ borderColor: "var(--color-base-100)" }}>
          <div className="w-11 h-11 rounded-full grid place-items-center text-sm font-bold shrink-0"
            style={{ backgroundColor: "var(--color-primary-50)", color: "var(--color-primary)" }}>
            {initials(name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold" style={{ color: "var(--color-neutral-900)" }}>{name}</h2>
              <KycBadge status={u?.kycStatus} />
              <div className="ml-auto">
                <UserStatusToggle userId={tenant.user?.id} status={tenant.user?.status} />
              </div>
            </div>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-neutral-500)" }}>
              {email}{phone ? ` · ${phone}` : ""}
            </p>
          </div>
        </div>

        {/* Overview */}
        <div className="rounded-xl p-3 mb-4" style={{ backgroundColor: "#fff", border: "1px solid var(--color-base-200)" }}>
          <div className="flex items-center gap-1.5 mb-2">
            <User size={12} style={{ color: "var(--color-primary)" }} />
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-neutral-500)" }}>Overview</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4">
            {overviewRows.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between gap-2 py-1.5 border-b"
                style={{ borderColor: "var(--color-base-100)" }}>
                <span className="text-xs shrink-0" style={{ color: "var(--color-neutral-400)" }}>{label}</span>
                <span className="text-xs font-semibold text-right capitalize truncate" style={{ color: "var(--color-neutral-800)" }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Documents */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <FileText size={12} style={{ color: "var(--color-primary)" }} />
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-neutral-500)" }}>
              Documents{docs ? ` (${docs.length})` : ""}
            </span>
          </div>
          {docs && docs.length > 0 && (
            <button type="button" onClick={() => setShowDocs(true)}
              className="inline-flex items-center gap-1 text-xs font-semibold cursor-pointer hover:underline"
              style={{ color: "var(--color-primary)" }}>
              <Files size={12} /> View all documents
            </button>
          )}
        </div>
        <div className="rounded-xl p-3" style={{ backgroundColor: "#fff", border: "1px solid var(--color-base-200)" }}>
          {loading ? (
            <p className="text-xs py-3 text-center" style={{ color: "var(--color-neutral-400)" }}>Loading documents…</p>
          ) : !docs || docs.length === 0 ? (
            <p className="text-xs py-3 text-center" style={{ color: "var(--color-neutral-400)" }}>No documents uploaded yet.</p>
          ) : (
            <div className="space-y-2">
              {docs.map((doc) => {
                const ok = ["PROCESSED", "COMPLETE", "processed", "complete", "approved"].includes(doc.status);
                const exp = doc.expiryDate ? new Date(doc.expiryDate) : null;
                const expired = exp ? exp < new Date() : false;
                const soon = exp && !expired ? (exp.getTime() - Date.now()) < 30 * 864e5 : false;
                const expColor = expired ? "#dc2626" : soon ? "#b45309" : "var(--color-neutral-500)";
                return (
                  <div key={doc.id} className="rounded-lg p-2.5" style={{ backgroundColor: "var(--color-base-50, #fafafa)", border: "1px solid var(--color-base-100)" }}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="min-w-0 flex items-center gap-1.5">
                        <FileText size={12} style={{ color: "var(--color-primary)" }} />
                        <span className="text-xs font-semibold truncate capitalize" style={{ color: "var(--color-neutral-800)" }}>
                          {doc.documentKey.replace(/_/g, " ")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium capitalize"
                          style={{ backgroundColor: ok ? "#dcfce7" : "#fef3c7", color: ok ? "#15803d" : "#b45309" }}>
                          {String(doc.status).toLowerCase()}
                        </span>
                        {doc.fileUrl && (
                          <button type="button" onClick={() => openDocViewer({ fileUrl: doc.fileUrl, caption: doc.documentKey.replace(/_/g, " ") })} className="flex items-center gap-0.5 text-[11px] cursor-pointer" style={{ color: "var(--color-primary)" }}>
                            <ExternalLink size={11} /> View
                          </button>
                        )}
                        {/* Approve / Reject — the same control the RP and SP
                            panels use. Customers hold the ID documents (Emirates
                            ID, passport, visa), so a review centre that could not
                            act on them could not do its job: 203 customers sat in
                            the queue read-only while 4 rental providers had
                            working buttons. */}
                        <DocReviewActions doc={doc} onUpdate={onDocUpdate} />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 pl-[18px]">
                      {doc.documentNumber && <span className="text-[11px]" style={{ color: "var(--color-neutral-500)" }}>No: <b style={{ color: "var(--color-neutral-700)" }}>{doc.documentNumber}</b></span>}
                      {doc.issueDate && <span className="text-[11px]" style={{ color: "var(--color-neutral-500)" }}>Issued: {new Date(doc.issueDate).toLocaleDateString("en-AE", { timeZone: APP_TIME_ZONE })}</span>}
                      {doc.expiryDate && <span className="text-[11px] font-medium" style={{ color: expColor }}>Expires: {new Date(doc.expiryDate).toLocaleDateString("en-AE", { timeZone: APP_TIME_ZONE })}{expired ? " (expired)" : soon ? " (soon)" : ""}</span>}
                      <span className="text-[11px]" style={{ color: "var(--color-neutral-400)" }}>Uploaded: {new Date(doc.createdAt).toLocaleDateString("en-AE", { timeZone: APP_TIME_ZONE })}</span>
                      {doc.notes && <span className="text-[11px] w-full" style={{ color: "var(--color-neutral-500)" }}>Note: {doc.notes}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {showDocs && (
        <CustomerDocsModal tenantName={name} documents={customerDocs} onClose={() => setShowDocs(false)} />
      )}
    </div>
  );
}

// ─── Team (managers / technicians) types + panels ───────────────────────────

interface ManagerLandlord {
  rentalProviderId: number; rpName: string;
  grantedCount: number; permissions: Record<string, boolean>;
}
interface ManagerDoc {
  id: number; documentKey: string; status: string;
  displayName: string | null; createdAt: string;
}
interface ManagerRow {
  id: number; assetManagerId: number | null; name: string; email: string; status: string;
  createdAt: string; lastLoginAt: string | null;
  landlordCount: number; landlords: ManagerLandlord[];
  uploadedDocs: ManagerDoc[];
}
/** SP-129/212 · GET /admin/kyc/technicians row — the technician half of Gate 1. */
interface TechnicianRow {
  id: number; userId: number; name: string; email: string | null; phone: string | null; status: string;
  isLeadCapable: boolean;
  /** SP-254 solo self-row: verdict lives on the PROVIDER — read-only here. */
  isSelf: boolean;
  complianceStatus: ComplianceStatus; compliancePausedAt: string | null;
  complianceNotes: string | null; complianceReviewedAt: string | null;
  complianceReviewedBy: { id: number; name: string } | null;
  assignable: boolean; documentCount: number; lastLoginAt: string | null; createdAt: string;
  provider: { id: number; name: string; entityType: string; complianceStatus: ComplianceStatus };
}
interface TechnicianDetail {
  technician: TechnicianRow;
  checklist: ChecklistItem[];
  uploadedDocs: UploadedDoc[];
  completionScore: number;
  assignability: { assignable: boolean; reason: string | null };
}

function permLabel(k: string) {
  return k.replace("can", "").replace(/([A-Z])/g, " $1").trim();
}
function accountBadge(status: string) {
  const cfg = status === "active"
    ? { bg: "#dcfce7", fg: "#166534", label: "Active" }
    : status === "suspended" || status === "deactivated"
      ? { bg: "#fef2f2", fg: "#b91c1c", label: status }
      : { bg: "#fef9eb", fg: "#92400e", label: status.replace(/_/g, " ") };
  return (
    <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 capitalize shrink-0"
      style={{ backgroundColor: cfg.bg, color: cfg.fg }}>{cfg.label}</span>
  );
}

/** Queue card for managers/technicians — mirrors KycCard's style. */
function TeamCard({
  name, email, sub, status, date, selected, onClick, badge,
}: {
  name: string; email?: string | null; sub: string; status: string;
  date: string; selected: boolean; onClick: () => void;
  /** Replaces the account-status chip (technicians show their compliance verdict). */
  badge?: React.ReactNode;
}) {
  return (
    <button onClick={onClick}
      className="w-full text-left px-4 py-3.5 border-b transition-colors"
      style={{
        borderColor: "var(--color-base-100)",
        backgroundColor: selected ? "var(--color-primary-50)" : "#fff",
        borderLeft: selected ? "3px solid var(--color-primary)" : "3px solid transparent",
      }}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-sm font-semibold truncate" style={{ color: "var(--color-neutral-900)" }}>{name}</span>
        {badge ?? accountBadge(status)}
      </div>
      {email && <p className="text-xs truncate mb-1" style={{ color: "var(--color-neutral-400)" }}>{email}</p>}
      <p className="text-xs" style={{ color: "var(--color-primary)" }}>{sub}</p>
      <p className="text-xs mt-1" style={{ color: "var(--color-neutral-400)" }}>
        {new Date(date).toLocaleDateString("en-AE", { timeZone: APP_TIME_ZONE })}
      </p>
    </button>
  );
}

/** Column-3 detail for a selected manager — additional info under sections. */
function ManagerContentPanel({ m }: { m: ManagerRow }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4">
        {/* Header */}
        <div className="mb-3 pb-3 border-b" style={{ borderColor: "var(--color-base-100)" }}>
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-neutral-900)" }}>{m.name}</h2>
            {accountBadge(m.status)}
          </div>
          <p className="text-xs" style={{ color: "var(--color-neutral-500)" }}>{m.email}</p>
        </div>

        {/* Section: Account */}
        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-neutral-400)" }}>Account details</p>
        <div className="rounded-xl p-3 mb-4" style={{ backgroundColor: "#fff", border: "1px solid var(--color-base-200)" }}>
          {[
            { label: "Role", value: "Asset Manager" },
            { label: "Landlords managed", value: String(m.landlordCount) },
            { label: "Member since", value: new Date(m.createdAt).toLocaleDateString("en-AE", { timeZone: APP_TIME_ZONE }) },
            { label: "Last login", value: m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString("en-AE") : "Never" },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "var(--color-base-100)" }}>
              <span className="text-xs" style={{ color: "var(--color-neutral-400)" }}>{label}</span>
              <span className="text-xs font-semibold" style={{ color: "var(--color-neutral-800)" }}>{value}</span>
            </div>
          ))}
        </div>

        {/* Section: Identity documents (optional) */}
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-neutral-400)" }}>
            Identity documents
          </p>
          <span className="text-[10px]" style={{ color: "var(--color-neutral-400)" }}>Optional</span>
        </div>
        <div className="rounded-xl p-3 mb-4" style={{ backgroundColor: "#fff", border: "1px solid var(--color-base-200)" }}>
          {[
            { key: "emirates_id", label: "Emirates ID" },
            { key: "passport", label: "Passport" },
            { key: "visa", label: "UAE Residency Visa" },
          ].map(({ key, label }) => {
            const doc = m.uploadedDocs.find((d) => d.documentKey === key);
            return (
              <div key={key} className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "var(--color-base-100)" }}>
                <div className="flex items-center gap-1.5 min-w-0">
                  <FileText size={12} style={{ color: doc ? "var(--color-primary)" : "var(--color-neutral-300)" }} />
                  <span className="text-xs" style={{ color: "var(--color-neutral-600)" }}>{label}</span>
                </div>
                {doc ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium capitalize"
                    style={{ backgroundColor: "#dcfce7", color: "#15803d" }}>
                    {String(doc.status).toLowerCase()}
                  </span>
                ) : (
                  <span className="text-[10px]" style={{ color: "var(--color-neutral-300)" }}>Not uploaded</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Section: Landlords & permissions */}
        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-neutral-400)" }}>
          Landlords &amp; permissions
        </p>
        <div className="space-y-2.5">
          {m.landlords.length === 0 && (
            <p className="text-xs" style={{ color: "var(--color-neutral-400)" }}>Not attached to any landlord yet.</p>
          )}
          {m.landlords.map((l) => {
            const granted = Object.entries(l.permissions).filter(([, v]) => v).map(([k]) => permLabel(k));
            return (
              <div key={l.rentalProviderId} className="rounded-xl p-3" style={{ backgroundColor: "#fff", border: "1px solid var(--color-base-200)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <Building2 size={13} style={{ color: "var(--color-primary)" }} />
                  <span className="text-sm font-medium" style={{ color: "var(--color-neutral-900)" }}>{l.rpName}</span>
                  <span className="text-[10px] ml-auto" style={{ color: "var(--color-neutral-400)" }}>
                    {l.grantedCount} permission{l.grantedCount !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {granted.length === 0
                    ? <span className="text-[11px]" style={{ color: "#b45309" }}>No permissions granted</span>
                    : granted.map((p) => (
                        <span key={p} className="text-[10px] rounded-full px-2 py-0.5"
                          style={{ backgroundColor: "var(--color-primary-50)", color: "var(--color-primary-dark)", border: "1px solid var(--color-primary-light)" }}>{p}</span>
                      ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Column-3 detail for a selected technician (SP-129/212) — the review surface:
 * documents with Approve/Reject (same control as RP/SP/customer), the
 * Emirates ID + visa checklist, and the verdict bar. A solo operator's
 * self-row is read-only: the person is vetted as the PROVIDER (SP-254).
 */
function TechnicianContentPanel({
  t, onStatusChange,
}: {
  t: TechnicianRow;
  onStatusChange: (id: number, patch: Partial<TechnicianRow>) => void;
}) {
  const [detail, setDetail] = useState<TechnicianDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState("");
  const [acting, setActing] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true); setDetail(null); setNotes("");
    apiGet<TechnicianDetail>(`/admin/kyc/technicians/${t.id}`)
      .then((d) => { if (alive) { setDetail(d); setNotes(d.technician.complianceNotes ?? ""); } })
      .catch(() => { /* panel shows the row we already have */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [t.id]);

  const row = detail?.technician ?? t;
  const docs = detail?.uploadedDocs ?? null;
  const checklist = detail?.checklist ?? [];
  const requiredMissing = checklist.filter((c) => c.required && !c.uploaded);
  const docsVerified = (docs ?? []).filter((d) => ["processed", "complete", "approved"].includes(String(d.status).toLowerCase())).length;

  function onDocUpdate(docId: number, patch: Partial<UploadedDoc>) {
    setDetail((prev) => prev
      ? { ...prev, uploadedDocs: prev.uploadedDocs.map((d) => d.id === docId ? { ...d, ...patch } : d) }
      : prev);
  }

  async function act(status: ComplianceStatus) {
    setActing(true);
    try {
      const d = await apiPatch<TechnicianDetail>(`/admin/kyc/technicians/${t.id}/compliance`, {
        complianceStatus: status,
        ...(notes.trim() ? { complianceNotes: notes.trim() } : {}),
      });
      setDetail(d);
      onStatusChange(t.id, {
        complianceStatus: d.technician.complianceStatus,
        assignable: d.technician.assignable,
        complianceReviewedAt: d.technician.complianceReviewedAt,
        complianceReviewedBy: d.technician.complianceReviewedBy,
        complianceNotes: d.technician.complianceNotes,
      });
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setActing(false);
    }
  }

  const overviewRows: Array<{ label: string; value: string }> = [
    { label: "Provider", value: `${row.provider.name}${row.provider.entityType === "individual" ? " (solo)" : ""}` },
    { label: "Provider verdict", value: row.provider.complianceStatus.replace(/_/g, " ") },
    { label: "Lead capable", value: row.isLeadCapable ? "Yes" : "No" },
    { label: "Account", value: row.status },
    { label: "App login", value: row.email ? (row.lastLoginAt ? `Signed in ${new Date(row.lastLoginAt).toLocaleDateString("en-AE", { timeZone: APP_TIME_ZONE })}` : "Never signed in") : "No login (roster entry)" },
    { label: "Member since", value: new Date(row.createdAt).toLocaleDateString("en-AE", { timeZone: APP_TIME_ZONE }) },
    ...(row.complianceReviewedAt ? [{ label: "Last verdict", value: `${row.complianceReviewedBy?.name ?? "Admin"} · ${new Date(row.complianceReviewedAt).toLocaleDateString("en-AE", { timeZone: APP_TIME_ZONE })}` }] : []),
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4">
        {/* Header */}
        <div className="mb-3 pb-3 border-b" style={{ borderColor: "var(--color-base-100)" }}>
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-neutral-900)" }}>{row.name}</h2>
            <ComplianceBadge s={row.complianceStatus} />
            {row.isSelf && (
              <span className="text-[10px] font-semibold rounded-full px-2 py-0.5" style={{ backgroundColor: "#eef2ff", color: "#4338ca" }}>Solo operator</span>
            )}
          </div>
          <p className="text-xs" style={{ color: "var(--color-neutral-500)" }}>
            {row.email ?? "No app login yet"}{row.phone ? ` · ${row.phone}` : ""}
          </p>
          <p className="text-xs mt-1 font-medium" style={{ color: row.assignable ? "#15803d" : "#b45309" }}>
            {row.assignable ? "Cleared for dispatch" : (detail?.assignability.reason ?? "Not assignable until verified")}
          </p>
        </div>

        {/* Overview */}
        <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: "#fff", border: "1px solid var(--color-base-200)" }}>
          <div className="grid grid-cols-2 gap-x-4">
            {overviewRows.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between gap-2 py-1.5 border-b" style={{ borderColor: "var(--color-base-100)" }}>
                <span className="text-xs shrink-0" style={{ color: "var(--color-neutral-400)" }}>{label}</span>
                <span className="text-xs font-semibold text-right capitalize truncate" style={{ color: "var(--color-neutral-800)" }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Checklist */}
        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-neutral-400)" }}>
          KYC checklist{detail ? ` · ${detail.completionScore}%` : ""}
        </p>
        <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: "#fff", border: "1px solid var(--color-base-200)" }}>
          {loading && !detail ? (
            <p className="text-xs py-2 text-center" style={{ color: "var(--color-neutral-400)" }}>Loading…</p>
          ) : checklist.length === 0 ? (
            <p className="text-xs py-2 text-center" style={{ color: "var(--color-neutral-400)" }}>No checklist for this owner type.</p>
          ) : checklist.map((c) => (
            <div key={c.key} className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "var(--color-base-100)" }}>
              <span className="text-xs" style={{ color: "var(--color-neutral-700)" }}>
                {c.displayName}{c.required && <span style={{ color: "#dc2626" }}> *</span>}
              </span>
              <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 capitalize"
                style={c.uploaded
                  ? { backgroundColor: "#dcfce7", color: "#15803d" }
                  : { backgroundColor: c.required ? "#fee2e2" : "#f3f4f6", color: c.required ? "#dc2626" : "#6b7280" }}>
                {c.uploaded ? String(c.status ?? "uploaded").toLowerCase() : "missing"}
              </span>
            </div>
          ))}
        </div>

        {/* Documents */}
        <div className="flex items-center gap-1.5 mb-2">
          <FileText size={12} style={{ color: "var(--color-primary)" }} />
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-neutral-500)" }}>
            Documents{docs ? ` (${docs.length}, ${docsVerified} verified)` : ""}
          </span>
        </div>
        <div className="rounded-xl p-3" style={{ backgroundColor: "#fff", border: "1px solid var(--color-base-200)" }}>
          {loading && !detail ? (
            <p className="text-xs py-3 text-center" style={{ color: "var(--color-neutral-400)" }}>Loading documents…</p>
          ) : !docs || docs.length === 0 ? (
            <p className="text-xs py-3 text-center" style={{ color: "var(--color-neutral-400)" }}>
              No documents uploaded yet — the technician (or their provider) uploads Emirates ID + visa from the app.
            </p>
          ) : (
            <div className="space-y-2">
              {docs.map((doc) => {
                const ok = ["processed", "complete", "approved"].includes(String(doc.status).toLowerCase());
                const exp = doc.expiryDate ? new Date(doc.expiryDate) : null;
                const expired = exp ? exp < new Date() : false;
                const soon = exp && !expired ? (exp.getTime() - Date.now()) < 30 * 864e5 : false;
                const expColor = expired ? "#dc2626" : soon ? "#b45309" : "var(--color-neutral-500)";
                return (
                  <div key={doc.id} className="rounded-lg p-2.5" style={{ backgroundColor: "var(--color-base-50, #fafafa)", border: "1px solid var(--color-base-100)" }}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="min-w-0 flex items-center gap-1.5">
                        <FileText size={12} style={{ color: "var(--color-primary)" }} />
                        <span className="text-xs font-semibold truncate capitalize" style={{ color: "var(--color-neutral-800)" }}>
                          {doc.documentKey.replace(/_/g, " ")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium capitalize"
                          style={{ backgroundColor: ok ? "#dcfce7" : "#fef3c7", color: ok ? "#15803d" : "#b45309" }}>
                          {String(doc.status).toLowerCase()}
                        </span>
                        {doc.fileUrl && (
                          <button type="button" onClick={() => openDocViewer({ fileUrl: doc.fileUrl, caption: doc.documentKey.replace(/_/g, " ") })} className="flex items-center gap-0.5 text-[11px] cursor-pointer" style={{ color: "var(--color-primary)" }}>
                            <ExternalLink size={11} /> View
                          </button>
                        )}
                        <DocReviewActions doc={doc} onUpdate={onDocUpdate} />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 pl-[18px]">
                      {doc.expiryDate && <span className="text-[11px] font-medium" style={{ color: expColor }}>Expires: {new Date(doc.expiryDate).toLocaleDateString("en-AE", { timeZone: APP_TIME_ZONE })}{expired ? " (expired)" : soon ? " (soon)" : ""}</span>}
                      <span className="text-[11px]" style={{ color: "var(--color-neutral-400)" }}>Uploaded: {new Date(doc.createdAt).toLocaleDateString("en-AE", { timeZone: APP_TIME_ZONE })}</span>
                      {doc.notes && <span className="text-[11px] w-full" style={{ color: "var(--color-neutral-500)" }}>Note: {doc.notes}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Sticky verdict bar */}
      <div className="shrink-0 border-t px-4 py-3 space-y-2" style={{ borderColor: "var(--color-base-200)", backgroundColor: "#fff" }}>
        {row.isSelf ? (
          <p className="text-xs" style={{ color: "var(--color-neutral-500)" }}>
            Solo operator — this person is vetted as the <b>provider</b>; their technician verdict mirrors it. Review them under the Service Providers tab.
          </p>
        ) : (
          <>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optional — shown to the technician and provider on action required)"
              className="w-full px-3 py-1.5 rounded-lg text-xs border outline-none"
              style={{ borderColor: "var(--color-base-200)", color: "var(--color-neutral-800)" }}
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const blockers = [
                    ...requiredMissing.map((c) => `✗ ${c.displayName} not uploaded`),
                    ...((docs ?? []).length > 0 && docsVerified === 0 ? ["⚑ No document has been verified yet"] : []),
                  ];
                  if (blockers.length > 0 && !window.confirm(`${blockers.length} open item${blockers.length === 1 ? "" : "s"}:\n\n${blockers.join("\n")}\n\nMark compliant anyway?`)) return;
                  void act("compliant");
                }}
                disabled={acting || loading}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
                style={{ backgroundColor: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" }}>
                <CheckCircle2 size={13} /> Mark Compliant
              </button>
              <button onClick={() => void act("action_required")} disabled={acting || loading}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
                style={{ backgroundColor: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>
                <AlertCircle size={13} /> Mark Action Required
              </button>
              <button onClick={() => void act("expired")} disabled={acting || loading}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
                style={{ backgroundColor: "#f3f4f6", color: "#6b7280", border: "1px solid #e5e7eb" }}>
                <XCircle size={13} /> Mark Expired
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminKycPage() {
  const [tab, setTab]         = useState<Tab>("rental");
  const [rps, setRps]         = useState<RentalProvider[]>([]);
  const [sps, setSps]         = useState<ServiceProvider[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [managers, setManagers]       = useState<ManagerRow[]>([]);
  const [technicians, setTechnicians] = useState<TechnicianRow[]>([]);
  const [loading, setLoading]         = useState(false); // first page of a tab
  const [loadingMore, setLoadingMore] = useState(false); // appending next page
  const [error, setError]             = useState<string | null>(null);

  // Per-tab total record counts (from the paginated API) — drives tab badges
  // and the infinite-scroll "is there more?" check.
  const [totals, setTotals] = useState<{ rental: number; service: number; tenants: number; managers: number; technicians: number }>({
    rental: 0, service: 0, tenants: 0, managers: 0, technicians: 0,
  });

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId]     = useState<number | null>(null);

  // RP detail fetched when an RP is selected — shared by left checklist + right content
  const [rpDetail, setRpDetail]               = useState<RpDetail | null>(null);
  const [rpDetailLoading, setRpDetailLoading] = useState(false);
  const [rpDetailError, setRpDetailError]     = useState<string | null>(null);
  // SP detail fetched when an SP is selected — profile + checklist + docs
  const [spDetail, setSpDetail]               = useState<SpDetail | null>(null);
  const [spDetailLoading, setSpDetailLoading] = useState(false);
  const [spDetailError, setSpDetailError]     = useState<string | null>(null);
  const [tenantDetail, setTenantDetail]       = useState<TenantDetail | null>(null);
  const [tenantDocsLoading, setTenantDocsLoading] = useState(false);

  // Infinite-scroll plumbing for the queue column
  const PAGE_SIZE = 10;
  const listScrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef   = useRef<HTMLDivElement>(null);

  // Deep-link: seed the active tab + compliance-status filter from the URL
  // (?tab=rental|service|tenants|managers|technicians, ?status=compliant|…) so
  // Overview drill-downs land on the right queue.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const t = p.get("tab"); const s = p.get("status");
    if (t && ["rental", "service", "tenants", "managers", "technicians"].includes(t)) setTab(t as Tab);
    if (s && ["all", "pending_review", "action_required", "compliant", "expired"].includes(s)) setStatusFilter(s as StatusFilter);
  }, []);

  // Paginated KYC tabs only — managers/technicians render via TeamOversight.
  const TAB_PATH: Record<"rental" | "service" | "tenants", string> = {
    rental:  "/admin/kyc/rental-providers",
    service: "/admin/kyc/service-providers",
    tenants: "/admin/kyc/tenants",
  };

  // Load one page (10 records) for a tab. reset=true replaces the list (initial
  // load / refresh); reset=false appends the next page (lazy scroll).
  async function loadPage(t: "rental" | "service" | "tenants", offset: number, reset: boolean) {
    if (!reset) setLoadingMore(true); // initial/refresh loading owned by load()
    try {
      const res = await apiGet<{ data?: unknown[]; total?: number }>(
        `${TAB_PATH[t]}?limit=${PAGE_SIZE}&offset=${offset}`,
      );
      const batch = (res.data ?? (res as unknown as unknown[])) ?? [];
      const total = res.total ?? batch.length;
      setTotals((prev) => ({ ...prev, [t]: total }));
      if (t === "rental")
        setRps((prev) => (reset ? (batch as RentalProvider[]) : [...prev, ...(batch as RentalProvider[])]));
      else if (t === "service")
        setSps((prev) => (reset ? (batch as ServiceProvider[]) : [...prev, ...(batch as ServiceProvider[])]));
      else
        setTenants((prev) => (reset ? (batch as Tenant[]) : [...prev, ...(batch as Tenant[])]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (!reset) setLoadingMore(false);
    }
  }

  // Initial: fetch the first page of all three tabs (so tab badges + RP/SP
  // stats populate). The active tab then lazy-loads more on scroll.
  async function load() {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        loadPage("rental", 0, true),
        loadPage("service", 0, true),
        loadPage("tenants", 0, true),
        // Team tabs (managers / technicians) — same split-panel pattern as the others
        apiGet<ManagerRow[]>("/admin/team/managers")
          .then(d => { const a = Array.isArray(d) ? d : []; setManagers(a); setTotals(p => ({ ...p, managers: a.length })); }).catch(() => {}),
        // SP-129/212: the review queue (compliance, provider, doc counts) —
        // pending_review first. Cap 200; the console lists a pilot-sized roster.
        apiGet<{ data: TechnicianRow[]; total: number }>("/admin/kyc/technicians?limit=200")
          .then(d => { const a = Array.isArray(d?.data) ? d.data : []; setTechnicians(a); setTotals(p => ({ ...p, technicians: d?.total ?? a.length })); }).catch(() => {}),
      ]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore the last-selected tab from the URL (?tab=…) so a refresh keeps you
  // on the same tab (e.g. Customers stays Customers).
  useEffect(() => {
    const VALID: Tab[] = ["rental", "service", "tenants", "managers", "technicians"];
    const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    if (t && VALID.includes(t)) setTab(t);
  }, []);

  // Infinite scroll — load the next page of the ACTIVE tab when the sentinel
  // scrolls into view, until all records for that tab are loaded.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    // Team tabs (managers/technicians) render via TeamOversight — no pagination.
    if (tab === "managers" || tab === "technicians") return;
    const pagTab = tab;
    const loaded = pagTab === "rental" ? rps.length : pagTab === "service" ? sps.length : tenants.length;
    const total  = totals[pagTab];
    if (loaded >= total) return; // nothing more to fetch
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore && !loading) {
          void loadPage(pagTab, loaded, false);
        }
      },
      { root: listScrollRef.current, rootMargin: "120px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [tab, rps.length, sps.length, tenants.length, totals, loadingMore, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch full RP detail whenever the selected RP changes.
  // AbortController cancels the in-flight request when selectedId changes quickly,
  // preventing a slower earlier response from overwriting a faster later one.
  useEffect(() => {
    if (tab !== "rental" || selectedId === null) { setRpDetail(null); return; }
    const controller = new AbortController();
    setRpDetail(null);
    setRpDetailLoading(true);
    setRpDetailError(null);
    apiGet<RpDetail>(`/admin/kyc/rental-providers/${selectedId}`, { signal: controller.signal })
      .then((d) => { if (!controller.signal.aborted) setRpDetail(d); })
      .catch((e) => { if (!controller.signal.aborted) setRpDetailError((e as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setRpDetailLoading(false); });
    return () => controller.abort();
  }, [selectedId, tab]);

  // Fetch full SP detail whenever the selected SP changes (same abort guard as RP).
  useEffect(() => {
    if (tab !== "service" || selectedId === null) { setSpDetail(null); return; }
    const controller = new AbortController();
    setSpDetail(null);
    setSpDetailLoading(true);
    setSpDetailError(null);
    apiGet<SpDetail>(`/admin/kyc/service-providers/${selectedId}`, { signal: controller.signal })
      .then((d) => { if (!controller.signal.aborted) setSpDetail(d); })
      .catch((e) => { if (!controller.signal.aborted) setSpDetailError((e as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setSpDetailLoading(false); });
    return () => controller.abort();
  }, [selectedId, tab]);

  // Load the selected customer's uploaded documents inline (same data the
  // standalone Full KYC page uses) so everything lives inside the tab.
  useEffect(() => {
    if (tab !== "tenants" || selectedId === null) { setTenantDetail(null); return; }
    const controller = new AbortController();
    setTenantDetail(null);
    setTenantDocsLoading(true);
    apiGet<TenantDetail>(`/admin/kyc/tenants/${selectedId}`, { signal: controller.signal })
      .then((d) => { if (!controller.signal.aborted) setTenantDetail(d); })
      .catch(() => { if (!controller.signal.aborted) setTenantDetail(null); })
      .finally(() => { if (!controller.signal.aborted) setTenantDocsLoading(false); });
    return () => controller.abort();
  }, [selectedId, tab]);

  function handleTabChange(t: Tab) {
    setTab(t); setSelectedId(null); setStatusFilter("all");
    // Persist to the URL so a refresh keeps this tab selected.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", t);
      window.history.replaceState({}, "", url);
    } catch { /* no-op */ }
  }
  function handleStatusFilter(s: StatusFilter) { setStatusFilter(s); setSelectedId(null); }
  function handleRpStatusChange(id: number, status: ComplianceStatus) {
    setRps((prev) => prev.map((r) => r.id === id ? { ...r, complianceStatus: status } : r));
  }
  function handleTechnicianChange(id: number, patch: Partial<TechnicianRow>) {
    setTechnicians((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } : t));
  }
  function handleSpStatusChange(id: number, status: ComplianceStatus) {
    setSps((prev) => prev.map((s) => s.id === id ? { ...s, complianceStatus: status } : s));
    setSpDetail((prev) => prev && prev.profile.id === id
      ? { ...prev, profile: { ...prev.profile, complianceStatus: status } } : prev);
  }
  // Patch one document in the loaded SP detail after an approve/reject verdict
  // so the row + "Documents reviewed" check update without a refetch.
  function handleSpDocUpdate(docId: number, patch: Partial<UploadedDoc>) {
    setSpDetail((prev) => prev
      ? { ...prev, uploadedDocs: prev.uploadedDocs.map((d) => d.id === docId ? { ...d, ...patch } : d) }
      : prev);
  }

  function handleRpDocUpdate(docId: number, patch: Partial<UploadedDoc>) {
    setRpDetail((prev) => prev
      ? { ...prev, uploadedDocs: prev.uploadedDocs.map((d) => d.id === docId ? { ...d, ...patch } : d) }
      : prev);
  }

  function handleTenantDocUpdate(docId: number, patch: Partial<UploadedDoc>) {
    setTenantDetail((prev) => prev
      ? { ...prev, uploadedDocs: prev.uploadedDocs.map((d) => d.id === docId ? { ...d, ...patch } : d) }
      : prev);
  }

  const filteredRps     = rps.filter((r)  => statusFilter === "all" || r.complianceStatus === statusFilter);
  const filteredSps     = sps.filter((sp) => statusFilter === "all" || sp.complianceStatus === statusFilter);
  const filteredTechnicians = technicians.filter((t) => statusFilter === "all" || t.complianceStatus === statusFilter);
  const filteredTenants = tenants;

  const selectedRp     = selectedId !== null && tab === "rental"  ? rps.find((r)  => r.id === selectedId) ?? null : null;
  const selectedSp     = selectedId !== null && tab === "service" ? sps.find((s)  => s.id === selectedId) ?? null : null;
  const selectedTenant = selectedId !== null && tab === "tenants" ? tenants.find((t) => t.id === selectedId) ?? null : null;
  const selectedManager    = selectedId !== null && tab === "managers"    ? managers.find((m) => m.id === selectedId) ?? null : null;
  const selectedTechnician = selectedId !== null && tab === "technicians" ? technicians.find((t) => t.id === selectedId) ?? null : null;
  const hasSelection   = !!(selectedRp || selectedSp || selectedTenant || selectedManager || selectedTechnician);

  const visibleList = tab === "rental" ? filteredRps : tab === "service" ? filteredSps
    : tab === "tenants" ? filteredTenants : tab === "managers" ? managers : technicians;
  // Raw loaded count (pre status-filter) — drives the lazy-load sentinel/footer.
  const loadedCount = tab === "rental" ? rps.length : tab === "service" ? sps.length
    : tab === "tenants" ? tenants.length : tab === "managers" ? managers.length : technicians.length;

  return (
    <div className="flex flex-col h-full" style={{ padding: "12px 20px 16px" }}>
      <BackLink />

      {/* ── Header row ────────────────────────────────────── */}
      <div className="flex items-center gap-1 pb-2 border-b flex-shrink-0"
        style={{ borderColor: "var(--color-base-200)" }}>

        <span className="text-sm font-bold mr-3 shrink-0" style={{ color: "var(--color-neutral-900)" }}>
          Profile Verification
        </span>

        {([
          { id: "rental"      as Tab, label: "Rental Providers",  Icon: Building2, count: totals.rental },
          { id: "service"     as Tab, label: "Service Providers", Icon: Wrench,    count: totals.service },
          { id: "tenants"     as Tab, label: "Customers",         Icon: Users,     count: totals.tenants },
          { id: "managers"    as Tab, label: "Managers",          Icon: UserCheck, count: totals.managers },
          { id: "technicians" as Tab, label: "Technicians",       Icon: Wrench,    count: totals.technicians },
        ]).map(({ id, label, Icon, count }) => (
          <button key={id} onClick={() => handleTabChange(id)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-[9px] transition-colors"
            style={tab === id
              ? { borderColor: "var(--color-primary)", color: "var(--color-primary)" }
              : { borderColor: "transparent", color: "var(--color-neutral-500)" }}>
            <Icon size={13} />
            {label}
            <span className="text-xs px-1.5 py-0.5 rounded-full"
              style={tab === id
                ? { backgroundColor: "var(--color-primary-50)", color: "var(--color-primary)" }
                : { backgroundColor: "var(--color-base-100)", color: "var(--color-neutral-500)" }}>
              {count}
            </span>
          </button>
        ))}

        <button onClick={() => void load()} disabled={loading}
          className="ml-auto p-1.5 rounded-lg transition-colors"
          style={{ border: "1px solid var(--color-base-200)" }} title="Refresh">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""}
            style={{ color: "var(--color-neutral-500)" }} />
        </button>
      </div>

      {error && (
        <div className="rounded-xl p-2 mt-2 text-sm flex-shrink-0"
          style={{ backgroundColor: "#fef2f2", color: "#dc2626" }}>{error}</div>
      )}

      {/* ── Filters + split panel ─────────────────────────── */}
      <div className="flex flex-col flex-1 min-h-0 mt-2">

        {/* Status chips — compliance filter for RP / SP / technicians */}
        {(tab === "rental" || tab === "service" || tab === "technicians") && (
          <div className="flex flex-wrap gap-2 mb-2 flex-shrink-0">
            {([
              { id: "all"             as StatusFilter, label: "All" },
              { id: "pending_review"  as StatusFilter, label: "Pending Review" },
              { id: "action_required" as StatusFilter, label: "Action Required" },
              { id: "compliant"       as StatusFilter, label: "Compliant" },
              { id: "expired"         as StatusFilter, label: "Expired" },
            ]).map(({ id, label }) => (
              <button key={id} onClick={() => handleStatusFilter(id)}
                className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
                style={statusFilter === id
                  ? { backgroundColor: "var(--color-primary)", color: "#fff" }
                  : { backgroundColor: "var(--color-base-100)", color: "var(--color-neutral-600)" }}>
                {label}
              </button>
            ))}
          </div>
        )}

        {loading && (
          <div className="rounded-2xl p-8 bg-white text-center text-sm flex-shrink-0"
            style={{ color: "var(--color-neutral-400)" }}>Loading…</div>
        )}

        {!loading && visibleList.length === 0 && (
          <div className="flex flex-col items-center justify-center flex-1 gap-2"
            style={{ color: "var(--color-neutral-400)" }}>
            <ShieldCheck size={28} strokeWidth={1.5} />
            <p className="text-sm">No records in this tab.</p>
          </div>
        )}

        {!loading && visibleList.length > 0 && (
          <div className="flex rounded-2xl overflow-hidden border flex-1 min-h-0"
            style={{ borderColor: "var(--color-base-200)", boxShadow: "var(--shadow-sm)" }}>

            {/* COLUMN 1: user queue — ALWAYS visible, lazy-loaded 10 at a time */}
            <div className="flex flex-col shrink-0 border-r overflow-hidden"
              style={{ width: 280, borderColor: "var(--color-base-200)", backgroundColor: "#fff" }}>
              <div ref={listScrollRef} className="flex-1 overflow-y-auto">
                {tab === "rental" && filteredRps.map((rp) => (
                  <KycCard key={rp.id}
                    name={providerName(rp, `RP #${rp.id}`)}
                    email={rp.user?.email}
                    status={rp.complianceStatus}
                    date={rp.createdAt}
                    selected={selectedId === rp.id}
                    onClick={() => setSelectedId(rp.id)}
                  />
                ))}
                {tab === "service" && filteredSps.map((sp) => (
                  <KycCard key={sp.id}
                    name={sp.businessName ?? sp.ownerName ?? providerName(sp, `SP #${sp.id}`)}
                    email={sp.user?.email}
                    status={sp.complianceStatus}
                    date={sp.createdAt}
                    selected={selectedId === sp.id}
                    onClick={() => setSelectedId(sp.id)}
                  />
                ))}
                {tab === "tenants" && filteredTenants.map((t) => (
                  <KycCard key={t.id}
                    name={providerName(t, `Customer #${t.id}`)}
                    email={t.user?.email}
                    status={"pending_review"}
                    date={t.createdAt}
                    selected={selectedId === t.id}
                    onClick={() => setSelectedId(t.id)}
                  />
                ))}
                {tab === "managers" && managers.map((m) => (
                  <TeamCard key={m.id}
                    name={m.name} email={m.email}
                    sub={`${m.landlordCount} landlord${m.landlordCount !== 1 ? "s" : ""}`}
                    status={m.status} date={m.createdAt}
                    selected={selectedId === m.id}
                    onClick={() => setSelectedId(m.id)}
                  />
                ))}
                {tab === "technicians" && filteredTechnicians.map((t) => (
                  <TeamCard key={t.id}
                    name={t.name} email={t.email ?? undefined}
                    sub={`${t.provider.name}${t.isSelf ? " · solo" : ""}${t.documentCount ? ` · ${t.documentCount} doc${t.documentCount === 1 ? "" : "s"}` : " · no docs"}`}
                    status={t.status} date={t.createdAt}
                    badge={<ComplianceBadge s={t.complianceStatus} />}
                    selected={selectedId === t.id}
                    onClick={() => setSelectedId(t.id)}
                  />
                ))}

                {/* Infinite-scroll sentinel + status footer */}
                {loadedCount < totals[tab] && (
                  <div ref={sentinelRef} className="px-4 py-3 text-center text-xs"
                    style={{ color: "var(--color-neutral-400)" }}>
                    {loadingMore ? "Loading more…" : "Scroll to load more"}
                  </div>
                )}
                {loadedCount > 0 && loadedCount >= totals[tab] && (
                  <p className="px-4 py-3 text-center text-xs" style={{ color: "var(--color-neutral-300)" }}>
                    {totals[tab]} {tab === "tenants" ? "customers" : tab === "rental" ? "rental providers"
                      : tab === "service" ? "service providers" : tab === "managers" ? "managers" : "technicians"}
                  </p>
                )}
              </div>
            </div>

            {/* COLUMN 3: detail content */}
            <div className="flex-1 overflow-hidden" style={{ backgroundColor: "#fafafa" }}>
              {!hasSelection ? (
                <div className="flex flex-col items-center justify-center h-full gap-3"
                  style={{ color: "var(--color-neutral-400)" }}>
                  <MousePointerClick size={32} strokeWidth={1.5} />
                  <p className="text-sm">Select a user to review their details</p>
                </div>
              ) : selectedRp ? (
                <RpContentPanel
                  onDocUpdate={handleRpDocUpdate}
                  detail={rpDetail}
                  rpId={selectedRp.id}
                  loading={rpDetailLoading}
                  error={rpDetailError}
                  onStatusChange={handleRpStatusChange}
                />
              ) : selectedSp ? (
                <SpContentPanel
                  detail={spDetail}
                  sp={selectedSp}
                  spId={selectedSp.id}
                  loading={spDetailLoading}
                  error={spDetailError}
                  onStatusChange={handleSpStatusChange}
                  onDocUpdate={handleSpDocUpdate}
                />
              ) : selectedTenant ? (
                <TenantContentPanel tenant={selectedTenant} detail={tenantDetail} loading={tenantDocsLoading} onDocUpdate={handleTenantDocUpdate} />
              ) : selectedManager ? (
                <ManagerContentPanel m={selectedManager} />
              ) : selectedTechnician ? (
                <TechnicianContentPanel t={selectedTechnician} onStatusChange={handleTechnicianChange} />
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
