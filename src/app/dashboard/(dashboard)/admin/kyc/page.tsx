"use client";

import { useEffect, useState, useRef } from "react";
import { apiGet, apiPatch } from "@/lib/api";
import {
  Building2, Wrench, Users, Clock, CheckCircle2, XCircle,
  AlertCircle, RefreshCw, ShieldCheck, FileText, User,
  CreditCard, MousePointerClick, ExternalLink, ChevronLeft,
} from "lucide-react";
import Link from "next/link";

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
  serviceCategory?: string;
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
  createdAt: string;
}

interface RpDetail {
  profile: RentalProvider;
  checklist: ChecklistItem[];
  uploadedDocs: UploadedDoc[];
  completionScore: number;
}

type Tab = "rental" | "service" | "tenants";
type StatusFilter = "all" | "pending_review" | "action_required" | "compliant";

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

function ScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? "#16a34a" : score >= 50 ? "#d97706" : "#dc2626";
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: "var(--color-base-100)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs tabular-nums w-7" style={{ color: "var(--color-neutral-500)" }}>{score}%</span>
    </div>
  );
}

// ─── Queue card (list item) ───────────────────────────────────────────────────

function KycCard({
  name, email, status, score, date, selected, onClick,
}: {
  name: string; email?: string; status: ComplianceStatus;
  score: number; date: string; selected: boolean; onClick: () => void;
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
        <p className="text-xs truncate mb-2" style={{ color: "var(--color-neutral-400)" }}>{email}</p>
      )}
      <ScoreBar score={score} />
      <p className="text-xs mt-1.5" style={{ color: "var(--color-neutral-400)" }}>
        {new Date(date).toLocaleDateString("en-AE")}
      </p>
    </button>
  );
}

// ─── LEFT panel: RP document checklist ───────────────────────────────────────

function RpChecklistPanel({
  detail, loading, onBack,
}: {
  detail: RpDetail | null;
  loading: boolean;
  onBack: () => void;
}) {
  const checklist = detail?.checklist ?? [];
  const checkPass = checklist.filter((c) => c.uploaded).length;
  const score = detail?.completionScore ?? 0;

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "#fafdf9" }}>

      <button onClick={onBack}
        className="flex items-center gap-1.5 px-3 py-2.5 border-b text-xs font-medium shrink-0 w-full text-left"
        style={{ borderColor: "var(--color-base-200)", color: "var(--color-neutral-500)" }}>
        <ChevronLeft size={13} /> Back to list
      </button>

      {/* Score badge */}
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="rounded-xl px-3 py-3 text-center"
          style={{ backgroundColor: score >= 80 ? "#dcfce7" : "#fef9eb" }}>
          <p className="text-3xl font-bold leading-none"
            style={{ color: score >= 80 ? "#16a34a" : "#b45309" }}>
            {loading ? "—" : `${score}%`}
          </p>
          <p className="text-xs mt-1 font-medium"
            style={{ color: score >= 80 ? "#166534" : "#92400e" }}>
            KYC Score
          </p>
        </div>
      </div>

      {/* Document checklist */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide py-1"
          style={{ color: "var(--color-neutral-400)" }}>
          Documents
        </p>

        {loading && <p className="text-xs" style={{ color: "var(--color-neutral-400)" }}>Loading…</p>}
        {!loading && checklist.length === 0 && (
          <p className="text-xs" style={{ color: "var(--color-neutral-400)" }}>No checklist</p>
        )}

        {checklist.map((item) => (
          <div key={item.key} className="rounded-xl p-3"
            style={{
              backgroundColor: item.uploaded ? "#f0fdf4" : item.required ? "#fef2f2" : "#f9fafb",
              border: `1px solid ${item.uploaded ? "#bbf7d0" : item.required ? "#fecaca" : "#e5e7eb"}`,
            }}>
            <div className="flex items-center gap-2 mb-0.5">
              {item.uploaded
                ? <CheckCircle2 size={13} style={{ color: "#16a34a", flexShrink: 0 }} />
                : <XCircle size={13} style={{ color: item.required ? "#dc2626" : "#9ca3af", flexShrink: 0 }} />}
              <span className="text-xs font-semibold leading-tight"
                style={{ color: item.uploaded ? "#15803d" : item.required ? "#b91c1c" : "#6b7280" }}>
                {item.displayName}
              </span>
            </div>
            <p className="text-xs pl-5 leading-tight"
              style={{ color: item.uploaded ? "#166534" : item.required ? "#dc2626" : "#9ca3af", opacity: 0.85 }}>
              {item.uploaded ? (item.status ?? "Uploaded") : item.required ? "Required" : "Optional"}
            </p>
          </div>
        ))}

        {checklist.length > 0 && (
          <p className="text-xs pt-1" style={{ color: "var(--color-neutral-400)" }}>
            {checkPass}/{checklist.length} uploaded
          </p>
        )}
      </div>
    </div>
  );
}

// ─── LEFT panel: SP summary ───────────────────────────────────────────────────

function SpLeftPanel({ sp, onBack }: { sp: ServiceProvider; onBack: () => void }) {
  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "#fafdf9" }}>
      <button onClick={onBack}
        className="flex items-center gap-1.5 px-3 py-2.5 border-b text-xs font-medium shrink-0 w-full text-left"
        style={{ borderColor: "var(--color-base-200)", color: "var(--color-neutral-500)" }}>
        <ChevronLeft size={13} /> Back to list
      </button>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        <div className="rounded-xl p-3 text-center"
          style={{ backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0" }}>
          <Wrench size={20} style={{ color: "#16a34a", margin: "0 auto 6px" }} />
          <p className="text-xs font-bold" style={{ color: "#15803d" }}>Service Provider</p>
          <p className="text-xs mt-0.5" style={{ color: "#166534" }}>
            {sp.serviceCategory?.replace(/_/g, " ") ?? "—"}
          </p>
        </div>

        <p className="text-xs font-semibold uppercase tracking-wide py-1"
          style={{ color: "var(--color-neutral-400)" }}>
          Summary
        </p>

        {([
          { label: "Status", value: <ComplianceBadge s={sp.complianceStatus} /> },
          { label: "Entity", value: sp.entityType?.replace(/_/g, " ") ?? "—" },
          { label: "Rating", value: sp.averageRating != null ? `${sp.averageRating.toFixed(1)} (${sp.totalReviews ?? 0})` : "—" },
        ] as { label: string; value: React.ReactNode }[]).map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between py-2 border-b"
            style={{ borderColor: "var(--color-base-100)" }}>
            <span className="text-xs" style={{ color: "var(--color-neutral-400)" }}>{label}</span>
            <span className="text-xs font-semibold" style={{ color: "var(--color-neutral-700)" }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── LEFT panel: Tenant summary ───────────────────────────────────────────────

function TenantLeftPanel({ tenant, onBack }: { tenant: Tenant; onBack: () => void }) {
  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "#fafdf9" }}>
      <button onClick={onBack}
        className="flex items-center gap-1.5 px-3 py-2.5 border-b text-xs font-medium shrink-0 w-full text-left"
        style={{ borderColor: "var(--color-base-200)", color: "var(--color-neutral-500)" }}>
        <ChevronLeft size={13} /> Back to list
      </button>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        <div className="rounded-xl p-3 text-center"
          style={{ backgroundColor: "#eff6ff", border: "1px solid #bfdbfe" }}>
          <Users size={20} style={{ color: "#2563eb", margin: "0 auto 6px" }} />
          <p className="text-xs font-bold" style={{ color: "#1d4ed8" }}>Tenant</p>
          <p className="text-xs mt-0.5" style={{ color: "#1e40af" }}>
            {tenant.entityType?.replace(/_/g, " ") ?? "—"}
          </p>
        </div>

        <p className="text-xs font-semibold uppercase tracking-wide py-1"
          style={{ color: "var(--color-neutral-400)" }}>
          Summary
        </p>

        {[
          { label: "Doc status",    value: tenant.documentStatus ?? "—" },
          { label: "Active status", value: tenant.activeStatus ?? "—" },
          { label: "Registered",    value: new Date(tenant.createdAt).toLocaleDateString("en-AE") },
        ].map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between py-2 border-b"
            style={{ borderColor: "var(--color-base-100)" }}>
            <span className="text-xs" style={{ color: "var(--color-neutral-400)" }}>{label}</span>
            <span className="text-xs font-semibold" style={{ color: "var(--color-neutral-700)" }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── RIGHT panel: RP content + actions ───────────────────────────────────────

function RpContentPanel({
  detail, rpId, loading, error, onStatusChange,
}: {
  detail: RpDetail | null;
  rpId: number;
  loading: boolean;
  error: string | null;
  onStatusChange: (id: number, status: ComplianceStatus) => void;
}) {
  const [acting, setActing] = useState(false);
  const [notes, setNotes] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNotes("");
    scrollRef.current?.scrollTo({ top: 0 });
  }, [rpId]);

  const profile = detail?.profile;
  const docs = detail?.uploadedDocs ?? [];

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
              <Link href={`/dashboard/admin/kyc/rental-provider/${rpId}`}
                className="ml-auto flex items-center gap-1 text-xs"
                style={{ color: "var(--color-primary)" }}>
                <ExternalLink size={11} /> Full page
              </Link>
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
                  { label: "Date of birth", value: profile.dateOfBirth ? new Date(profile.dateOfBirth).toLocaleDateString("en-AE") : undefined },
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

            {/* Uploaded documents */}
            {docs.length > 0 && (
              <div className="rounded-xl p-3" style={{ backgroundColor: "#fff", border: "1px solid var(--color-base-200)" }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <FileText size={12} style={{ color: "var(--color-primary)" }} />
                  <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-neutral-500)" }}>
                    Uploaded Docs ({docs.length})
                  </span>
                </div>
                <div className="space-y-1.5">
                  {docs.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between gap-2 py-1.5 border-b"
                      style={{ borderColor: "var(--color-base-100)" }}>
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate" style={{ color: "var(--color-neutral-700)" }}>
                          {doc.documentKey.replace(/_/g, " ")}
                        </p>
                        {doc.expiryDate && (
                          <p className="text-xs" style={{ color: "var(--color-neutral-400)" }}>
                            Exp: {new Date(doc.expiryDate).toLocaleDateString("en-AE")}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{
                            backgroundColor: doc.status === "PROCESSED" || doc.status === "COMPLETE" ? "#dcfce7" : "#fef3c7",
                            color: doc.status === "PROCESSED" || doc.status === "COMPLETE" ? "#15803d" : "#b45309",
                          }}>
                          {doc.status}
                        </span>
                        {doc.fileUrl && (
                          <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink size={11} style={{ color: "var(--color-primary)" }} />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
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
            <button onClick={() => void act("compliant")} disabled={acting || loading}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
              style={{ backgroundColor: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" }}>
              <CheckCircle2 size={13} /> Mark Compliant
            </button>
            <button onClick={() => void act("action_required")} disabled={acting || loading}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
              style={{ backgroundColor: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>
              <AlertCircle size={13} /> Request Action
            </button>
            <button onClick={() => void act("expired")} disabled={acting || loading}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
              style={{ backgroundColor: "#f3f4f6", color: "#6b7280", border: "1px solid #e5e7eb" }}>
              <XCircle size={13} /> Expire
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── RIGHT panel: SP content ──────────────────────────────────────────────────

function SpContentPanel({ sp }: { sp: ServiceProvider }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-3 pb-3 border-b" style={{ borderColor: "var(--color-base-100)" }}>
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-neutral-900)" }}>
              {sp.businessName ?? sp.ownerName ?? providerName(sp, `SP #${sp.id}`)}
            </h2>
            <ComplianceBadge s={sp.complianceStatus} />
            <Link href={`/dashboard/admin/kyc/service-provider/${sp.id}`}
              className="ml-auto flex items-center gap-1 text-xs" style={{ color: "var(--color-primary)" }}>
              <ExternalLink size={11} /> Full page
            </Link>
          </div>
          <p className="text-xs" style={{ color: "var(--color-neutral-500)" }}>{sp.user?.email}</p>
        </div>

        <div className="rounded-xl p-3" style={{ backgroundColor: "#fff", border: "1px solid var(--color-base-200)" }}>
          <div className="grid grid-cols-2 gap-x-4">
            {[
              { label: "Entity type", value: sp.entityType?.replace(/_/g, " ") },
              { label: "Category",    value: sp.serviceCategory?.replace(/_/g, " ") },
              { label: "Rating",      value: sp.averageRating != null ? `${sp.averageRating.toFixed(1)} (${sp.totalReviews ?? 0})` : undefined },
              { label: "Notes",       value: sp.complianceNotes },
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
      </div>

      <div className="shrink-0 border-t px-4 py-3"
        style={{ borderColor: "var(--color-base-200)", backgroundColor: "#fff" }}>
        <Link href={`/dashboard/admin/kyc/service-provider/${sp.id}`}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-xs font-semibold"
          style={{ backgroundColor: "var(--color-primary)", color: "#fff" }}>
          <ShieldCheck size={13} /> Open Full KYC Review
        </Link>
      </div>
    </div>
  );
}

// ─── RIGHT panel: Tenant content ─────────────────────────────────────────────

function TenantContentPanel({ tenant }: { tenant: Tenant }) {
  const name = providerName(tenant, `Tenant #${tenant.id}`);
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-3 pb-3 border-b" style={{ borderColor: "var(--color-base-100)" }}>
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-neutral-900)" }}>{name}</h2>
            <Link href={`/dashboard/admin/kyc/tenant/${tenant.id}`}
              className="ml-auto flex items-center gap-1 text-xs" style={{ color: "var(--color-primary)" }}>
              <ExternalLink size={11} /> Full page
            </Link>
          </div>
          <p className="text-xs" style={{ color: "var(--color-neutral-500)" }}>{tenant.user?.email}</p>
        </div>

        <div className="rounded-xl p-3" style={{ backgroundColor: "#fff", border: "1px solid var(--color-base-200)" }}>
          {[
            { label: "Entity type",   value: tenant.entityType?.replace(/_/g, " ") },
            { label: "Doc status",    value: tenant.documentStatus },
            { label: "Active status", value: tenant.activeStatus },
            { label: "Registered",    value: new Date(tenant.createdAt).toLocaleDateString("en-AE") },
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

      <div className="shrink-0 border-t px-4 py-3"
        style={{ borderColor: "var(--color-base-200)", backgroundColor: "#fff" }}>
        <Link href={`/dashboard/admin/kyc/tenant/${tenant.id}`}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-xs font-semibold"
          style={{ backgroundColor: "var(--color-primary)", color: "#fff" }}>
          <ShieldCheck size={13} /> Open Full KYC Review
        </Link>
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
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId]     = useState<number | null>(null);

  // RP detail fetched when an RP is selected — shared by left checklist + right content
  const [rpDetail, setRpDetail]               = useState<RpDetail | null>(null);
  const [rpDetailLoading, setRpDetailLoading] = useState(false);
  const [rpDetailError, setRpDetailError]     = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [rpData, spData, tenantData] = await Promise.all([
        apiGet<{ data: RentalProvider[] }>("/admin/kyc/rental-providers").then((r) => r.data ?? (r as unknown as RentalProvider[])),
        apiGet<{ data: ServiceProvider[] }>("/admin/kyc/service-providers").then((r) => r.data ?? (r as unknown as ServiceProvider[])),
        apiGet<{ data: Tenant[] }>("/admin/kyc/tenants").then((r) => r.data ?? (r as unknown as Tenant[])),
      ]);
      setRps(rpData ?? []);
      setSps(spData ?? []);
      setTenants(tenantData ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  function kycScore(rp: RentalProvider) {
    const fields = [rp.entityType, rp.contactAddress, rp.tradeLicenseNumber, rp.emiratesIdNumber, rp.bankIban, rp.companyName];
    return Math.round((fields.filter(Boolean).length / fields.length) * 100);
  }
  function spScore(sp: ServiceProvider) {
    const fields = [sp.entityType, sp.businessName ?? sp.ownerName, sp.serviceCategory];
    return Math.round((fields.filter(Boolean).length / fields.length) * 100);
  }

  function handleTabChange(t: Tab) { setTab(t); setSelectedId(null); setStatusFilter("all"); }
  function handleStatusFilter(s: StatusFilter) { setStatusFilter(s); setSelectedId(null); }
  function handleRpStatusChange(id: number, status: ComplianceStatus) {
    setRps((prev) => prev.map((r) => r.id === id ? { ...r, complianceStatus: status } : r));
  }

  const filteredRps     = rps.filter((r)  => statusFilter === "all" || r.complianceStatus === statusFilter);
  const filteredSps     = sps.filter((sp) => statusFilter === "all" || sp.complianceStatus === statusFilter);
  const filteredTenants = tenants;

  const rpPending = rps.filter((r)  => r.complianceStatus === "pending_review").length;
  const rpAction  = rps.filter((r)  => r.complianceStatus === "action_required").length;
  const spPending = sps.filter((sp) => sp.complianceStatus === "pending_review").length;
  const spAction  = sps.filter((sp) => sp.complianceStatus === "action_required").length;

  const selectedRp     = selectedId !== null && tab === "rental"  ? rps.find((r)  => r.id === selectedId) ?? null : null;
  const selectedSp     = selectedId !== null && tab === "service" ? sps.find((s)  => s.id === selectedId) ?? null : null;
  const selectedTenant = selectedId !== null && tab === "tenants" ? tenants.find((t) => t.id === selectedId) ?? null : null;
  const hasSelection   = !!(selectedRp || selectedSp || selectedTenant);

  const visibleList = tab === "rental" ? filteredRps : tab === "service" ? filteredSps : filteredTenants;

  return (
    <div className="flex flex-col h-full" style={{ padding: "12px 20px 16px" }}>

      {/* ── Header row ────────────────────────────────────── */}
      <div className="flex items-center gap-1 pb-2 border-b flex-shrink-0"
        style={{ borderColor: "var(--color-base-200)" }}>

        <span className="text-sm font-bold mr-3 shrink-0" style={{ color: "var(--color-neutral-900)" }}>
          KYC Queue
        </span>

        {([
          { id: "rental"  as Tab, label: "Rental Providers",  Icon: Building2, count: rps.length },
          { id: "service" as Tab, label: "Service Providers", Icon: Wrench,    count: sps.length },
          { id: "tenants" as Tab, label: "Tenants",           Icon: Users,     count: tenants.length },
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

        {/* Compact stats */}
        <div className="ml-auto flex items-center gap-3 mr-2">
          {[
            { label: "RP Pending", value: rpPending, warn: rpPending > 0 },
            { label: "RP Action",  value: rpAction,  warn: rpAction > 0 },
            { label: "SP Pending", value: spPending, warn: spPending > 0 },
            { label: "SP Action",  value: spAction,  warn: spAction > 0 },
          ].map(({ label, value, warn }, i, arr) => (
            <span key={label} className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-xs">
                <span className="font-semibold"
                  style={{ color: warn ? "#dc2626" : "var(--color-neutral-700)" }}>{value}</span>
                <span style={{ color: "var(--color-neutral-400)" }}>{label}</span>
              </span>
              {i < arr.length - 1 && <span style={{ color: "var(--color-base-200)" }}>·</span>}
            </span>
          ))}
        </div>

        <button onClick={() => void load()} disabled={loading}
          className="p-1.5 rounded-lg transition-colors"
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

        {/* Status chips — shown only when browsing the list */}
        {tab !== "tenants" && !hasSelection && (
          <div className="flex flex-wrap gap-2 mb-2 flex-shrink-0">
            {([
              { id: "all"             as StatusFilter, label: "All" },
              { id: "pending_review"  as StatusFilter, label: "Pending Review" },
              { id: "action_required" as StatusFilter, label: "Action Required" },
              { id: "compliant"       as StatusFilter, label: "Compliant" },
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

        {!loading && visibleList.length === 0 && !hasSelection && (
          <div className="flex flex-col items-center justify-center flex-1 gap-2"
            style={{ color: "var(--color-neutral-400)" }}>
            <ShieldCheck size={28} strokeWidth={1.5} />
            <p className="text-sm">No records match this filter.</p>
          </div>
        )}

        {!loading && (visibleList.length > 0 || hasSelection) && (
          <div className="flex rounded-2xl overflow-hidden border flex-1 min-h-0"
            style={{ borderColor: "var(--color-base-200)", boxShadow: "var(--shadow-sm)" }}>

            {/* LEFT: list when browsing — checklist/summary when a record is open */}
            <div className="flex flex-col shrink-0 border-r overflow-hidden"
              style={{ width: 280, borderColor: "var(--color-base-200)", backgroundColor: "#fff" }}>

              {hasSelection && selectedRp ? (
                <RpChecklistPanel
                  detail={rpDetail}
                  loading={rpDetailLoading}
                  onBack={() => setSelectedId(null)}
                />
              ) : hasSelection && selectedSp ? (
                <SpLeftPanel sp={selectedSp} onBack={() => setSelectedId(null)} />
              ) : hasSelection && selectedTenant ? (
                <TenantLeftPanel tenant={selectedTenant} onBack={() => setSelectedId(null)} />
              ) : (
                <div className="flex-1 overflow-y-auto">
                  {tab === "rental" && filteredRps.map((rp) => (
                    <KycCard key={rp.id}
                      name={providerName(rp, `RP #${rp.id}`)}
                      email={rp.user?.email}
                      status={rp.complianceStatus}
                      score={kycScore(rp)}
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
                      score={spScore(sp)}
                      date={sp.createdAt}
                      selected={selectedId === sp.id}
                      onClick={() => setSelectedId(sp.id)}
                    />
                  ))}
                  {tab === "tenants" && filteredTenants.map((t) => (
                    <KycCard key={t.id}
                      name={providerName(t, `Tenant #${t.id}`)}
                      email={t.user?.email}
                      status={"pending_review"}
                      score={t.documentStatus === "complete" ? 100 : 40}
                      date={t.createdAt}
                      selected={selectedId === t.id}
                      onClick={() => setSelectedId(t.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* RIGHT: detail content */}
            <div className="flex-1 overflow-hidden" style={{ backgroundColor: "#fafafa" }}>
              {!hasSelection ? (
                <div className="flex flex-col items-center justify-center h-full gap-3"
                  style={{ color: "var(--color-neutral-400)" }}>
                  <MousePointerClick size={32} strokeWidth={1.5} />
                  <p className="text-sm">Select a record to review</p>
                </div>
              ) : selectedRp ? (
                <RpContentPanel
                  detail={rpDetail}
                  rpId={selectedRp.id}
                  loading={rpDetailLoading}
                  error={rpDetailError}
                  onStatusChange={handleRpStatusChange}
                />
              ) : selectedSp ? (
                <SpContentPanel sp={selectedSp} />
              ) : selectedTenant ? (
                <TenantContentPanel tenant={selectedTenant} />
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
