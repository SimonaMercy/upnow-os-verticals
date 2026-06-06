"use client";

import { useEffect, useState, useRef } from "react";
import { apiGet, apiPatch } from "@/lib/api";
import { TeamOversight } from "@/components/admin/TeamOversight";
import {
  Building2, Wrench, Users, Clock, CheckCircle2, XCircle,
  AlertCircle, RefreshCw, ShieldCheck, FileText, User,
  CreditCard, MousePointerClick, ExternalLink, UserCheck,
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

type Tab = "rental" | "service" | "tenants" | "managers" | "technicians";
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
  detail, loading,
}: {
  detail: RpDetail | null;
  loading: boolean;
}) {
  const checklist = detail?.checklist ?? [];
  const checkPass = checklist.filter((c) => c.uploaded).length;
  const score = detail?.completionScore ?? 0;

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "#fafdf9" }}>

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

function SpLeftPanel({ sp }: { sp: ServiceProvider }) {
  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "#fafdf9" }}>
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

function TenantLeftPanel({ tenant }: { tenant: Tenant }) {
  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "#fafdf9" }}>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        <div className="rounded-xl p-3 text-center"
          style={{ backgroundColor: "#eff6ff", border: "1px solid #bfdbfe" }}>
          <Users size={20} style={{ color: "#2563eb", margin: "0 auto 6px" }} />
          <p className="text-xs font-bold" style={{ color: "#1d4ed8" }}>Customer</p>
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
        {/* The dedicated SP KYC review page isn't built yet — link removed so it
            no longer 404s. SP details are shown inline above. */}
        <div className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-xs font-semibold"
          style={{ backgroundColor: "var(--color-base-100)", color: "var(--color-neutral-400)" }}>
          <ShieldCheck size={13} /> Full KYC review — coming soon
        </div>
      </div>
    </div>
  );
}

// ─── RIGHT panel: Tenant content ─────────────────────────────────────────────

function TenantContentPanel({ tenant }: { tenant: Tenant }) {
  const name = providerName(tenant, `Customer #${tenant.id}`);
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

  // Infinite-scroll plumbing for the queue column
  const PAGE_SIZE = 10;
  const listScrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef   = useRef<HTMLDivElement>(null);

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
        // Team tabs (managers / technicians) — counts only; the cards render via TeamOversight
        apiGet<unknown[]>("/admin/team/managers")
          .then(d => setTotals(p => ({ ...p, managers: Array.isArray(d) ? d.length : 0 }))).catch(() => {}),
        apiGet<unknown[]>("/admin/team/technicians")
          .then(d => setTotals(p => ({ ...p, technicians: Array.isArray(d) ? d.length : 0 }))).catch(() => {}),
      ]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Raw loaded count (pre status-filter) — drives the lazy-load sentinel/footer.
  const loadedCount = tab === "rental" ? rps.length : tab === "service" ? sps.length : tenants.length;

  return (
    <div className="flex flex-col h-full" style={{ padding: "12px 20px 16px" }}>

      {/* ── Header row ────────────────────────────────────── */}
      <div className="flex items-center gap-1 pb-2 border-b flex-shrink-0"
        style={{ borderColor: "var(--color-base-200)" }}>

        <span className="text-sm font-bold mr-3 shrink-0" style={{ color: "var(--color-neutral-900)" }}>
          KYC Queue
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

        {/* Managers / Technicians — delegated sub-accounts (no KYC). Profile
            preview + which manager is attached to which rental provider. */}
        {(tab === "managers" || tab === "technicians") && (
          <div className="flex-1 overflow-y-auto mt-1 pr-1">
            <TeamOversight kind={tab} />
          </div>
        )}

        {/* Status chips — always available; list stays visible alongside detail */}
        {tab !== "tenants" && tab !== "managers" && tab !== "technicians" && (
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

        {loading && tab !== "managers" && tab !== "technicians" && (
          <div className="rounded-2xl p-8 bg-white text-center text-sm flex-shrink-0"
            style={{ color: "var(--color-neutral-400)" }}>Loading…</div>
        )}

        {tab !== "managers" && tab !== "technicians" && !loading && visibleList.length === 0 && (
          <div className="flex flex-col items-center justify-center flex-1 gap-2"
            style={{ color: "var(--color-neutral-400)" }}>
            <ShieldCheck size={28} strokeWidth={1.5} />
            <p className="text-sm">No records match this filter.</p>
          </div>
        )}

        {tab !== "managers" && tab !== "technicians" && !loading && visibleList.length > 0 && (
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
                    name={providerName(t, `Customer #${t.id}`)}
                    email={t.user?.email}
                    status={"pending_review"}
                    score={t.documentStatus === "complete" ? 100 : 40}
                    date={t.createdAt}
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
                    {totals[tab]} {tab === "tenants" ? "customers" : tab === "rental" ? "rental providers" : "service providers"}
                  </p>
                )}
              </div>
            </div>

            {/* COLUMN 2: checklist / summary for the selected record */}
            {hasSelection && (
              <div className="flex flex-col shrink-0 border-r overflow-hidden"
                style={{ width: 240, borderColor: "var(--color-base-200)" }}>
                {selectedRp ? (
                  <RpChecklistPanel detail={rpDetail} loading={rpDetailLoading} />
                ) : selectedSp ? (
                  <SpLeftPanel sp={selectedSp} />
                ) : selectedTenant ? (
                  <TenantLeftPanel tenant={selectedTenant} />
                ) : null}
              </div>
            )}

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
