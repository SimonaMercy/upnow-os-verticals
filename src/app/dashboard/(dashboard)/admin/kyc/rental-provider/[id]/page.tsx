"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  ExternalLink,
  FileText,
  Building2,
  User,
  CreditCard,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ComplianceStatus = "COMPLIANT" | "PENDING_REVIEW" | "ACTION_REQUIRED" | "EXPIRED" | "PAUSED";
type DocStatus = "ATTACHED" | "PROCESSED" | "COMPLETE" | "EXPIRED" | null;

interface ProviderUser {
  id: number;
  firstName: string;
  lastName: string;
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
  hasPoa?: boolean;
  poaPersonName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankName?: string;
  bankIban?: string;
  bankAccountStatus?: string;
  tradeLicenseNumber?: string;
  tradeLicenseAuthority?: string;
  authorizedSignatoryName?: string;
  emiratesIdNumber?: string;
  passportNumber?: string;
  complianceStatus: ComplianceStatus;
  complianceNotes?: string;
  compliancePausedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface ChecklistItem {
  key: string;
  displayName: string;
  category: string;
  required: boolean;
  description: string;
  uploaded: boolean;
  status: DocStatus;
  documentId: number | null;
  fileUrl: string | null;
  mimeType: string | null;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function complianceColor(s: ComplianceStatus) {
  switch (s) {
    case "COMPLIANT": return "bg-emerald-100 text-emerald-800";
    case "PENDING_REVIEW": return "bg-amber-100 text-amber-800";
    case "ACTION_REQUIRED": return "bg-red-100 text-red-800";
    case "EXPIRED": return "bg-gray-100 text-gray-700";
    case "PAUSED": return "bg-orange-100 text-orange-800";
  }
}

function complianceIcon(s: ComplianceStatus) {
  switch (s) {
    case "COMPLIANT": return <CheckCircle2 className="h-4 w-4" />;
    case "PENDING_REVIEW": return <Clock className="h-4 w-4" />;
    case "ACTION_REQUIRED": return <AlertCircle className="h-4 w-4" />;
    case "EXPIRED": return <XCircle className="h-4 w-4" />;
    case "PAUSED": return <AlertCircle className="h-4 w-4" />;
  }
}

function docStatusBadge(s: DocStatus) {
  if (!s) return <span className="text-xs text-gray-400">Not uploaded</span>;
  const map: Record<string, string> = {
    ATTACHED: "bg-amber-100 text-amber-700",
    PROCESSED: "bg-blue-100 text-blue-700",
    COMPLETE: "bg-emerald-100 text-emerald-800",
    EXPIRED: "bg-red-100 text-red-700",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[s] ?? "bg-gray-100 text-gray-600"}`}>
      {s}
    </span>
  );
}

function riskScore(detail: RpDetail): { score: number; level: "low" | "medium" | "high"; reasons: string[] } {
  const { profile, checklist, completionScore } = detail;
  const reasons: string[] = [];
  let risk = 0;

  if (completionScore < 50) { risk += 40; reasons.push("Less than 50% profile complete"); }
  else if (completionScore < 80) { risk += 20; reasons.push("Profile partially complete"); }

  const requiredMissing = checklist.filter((c) => c.required && !c.uploaded).length;
  if (requiredMissing > 0) { risk += requiredMissing * 15; reasons.push(`${requiredMissing} required document(s) missing`); }

  if (profile.complianceStatus === "ACTION_REQUIRED") { risk += 25; reasons.push("Compliance action required"); }
  if (profile.complianceStatus === "PAUSED") { risk += 20; reasons.push("Compliance paused"); }
  if (profile.complianceStatus === "EXPIRED") { risk += 30; reasons.push("Compliance expired"); }

  if (!profile.bankIban) { risk += 10; reasons.push("No bank IBAN on file"); }
  if (!profile.emiratesIdNumber && !profile.passportNumber) { risk += 15; reasons.push("No identity document number"); }

  const score = Math.min(100, risk);
  const level = score >= 60 ? "high" : score >= 30 ? "medium" : "low";
  return { score, level, reasons };
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-2 py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500 w-40 flex-shrink-0">{label}</span>
      <span className="text-xs text-gray-900 font-medium">{value || <span className="text-gray-300">—</span>}</span>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function RpKycDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<RpDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [verifyingDocId, setVerifyingDocId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [newStatus, setNewStatus] = useState<ComplianceStatus>("PENDING_REVIEW");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<RpDetail>(`/admin/kyc/rental-providers/${id}`);
      setDetail(data);
      setNotes(data.profile.complianceNotes ?? "");
      setNewStatus(data.profile.complianceStatus);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveCompliance() {
    if (!detail) return;
    setSaving(true);
    try {
      await apiPatch(`/admin/kyc/rental-providers/${id}/compliance`, {
        complianceStatus: newStatus,
        complianceNotes: notes || null,
      });
      void load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function verifyDoc(docId: number) {
    setVerifyingDocId(docId);
    try {
      await apiPost(`/admin/kyc/documents/${docId}/verify`);
      void load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to verify document");
    } finally {
      setVerifyingDocId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400">
        <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
        {error ?? "Provider not found"}
      </div>
    );
  }

  const { profile, checklist, completionScore } = detail;
  const risk = riskScore(detail);
  const name = profile.user ? `${profile.user.firstName} ${profile.user.lastName}` : `RP #${profile.id}`;
  const requiredDocs = checklist.filter((c) => c.required);
  const uploadedRequired = requiredDocs.filter((c) => c.uploaded).length;

  const riskColor = risk.level === "high" ? "text-red-600 bg-red-50" : risk.level === "medium" ? "text-amber-600 bg-amber-50" : "text-emerald-600 bg-emerald-50";

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to KYC Queue
        </button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-blue-50 flex items-center justify-center">
              <Building2 className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{name}</h1>
              <p className="text-sm text-gray-500">{profile.user?.email}</p>
            </div>
          </div>
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${complianceColor(profile.complianceStatus)}`}>
            {complianceIcon(profile.complianceStatus)}
            {profile.complianceStatus.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      {/* Score cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500 mb-1">Profile Completeness</div>
          <div className={`text-2xl font-bold ${completionScore >= 80 ? "text-emerald-600" : completionScore >= 50 ? "text-amber-600" : "text-red-600"}`}>
            {completionScore}%
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500 mb-1">Required Docs</div>
          <div className="text-2xl font-bold text-gray-900">{uploadedRequired}/{requiredDocs.length}</div>
        </div>
        <div className={`rounded-xl p-4 ${riskColor}`}>
          <div className="text-xs mb-1 opacity-70">Risk Score</div>
          <div className="text-2xl font-bold">{risk.score}</div>
          <div className="text-xs mt-0.5 capitalize font-medium">{risk.level} risk</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500 mb-1">Registered</div>
          <div className="text-sm font-semibold text-gray-800">{new Date(profile.createdAt).toLocaleDateString("en-AE")}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: profile + banking */}
        <div className="lg:col-span-2 space-y-6">
          {/* Profile Overview */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <User className="h-4 w-4 text-gray-400" />
              Profile Overview
            </h2>
            <InfoRow label="Entity Type" value={profile.entityType?.replace(/_/g, " ")} />
            <InfoRow label="Company Name" value={profile.companyName} />
            <InfoRow label="Trade License No." value={profile.tradeLicenseNumber} />
            <InfoRow label="License Authority" value={profile.tradeLicenseAuthority} />
            <InfoRow label="Authorized Signatory" value={profile.authorizedSignatoryName} />
            <InfoRow label="Emirates ID" value={profile.emiratesIdNumber} />
            <InfoRow label="Passport No." value={profile.passportNumber} />
            <InfoRow label="Nationality" value={profile.nationality} />
            <InfoRow label="Date of Birth" value={profile.dateOfBirth ? new Date(profile.dateOfBirth).toLocaleDateString("en-AE") : null} />
            <InfoRow label="Contact Address" value={profile.contactAddress} />
            {profile.hasPoa && <InfoRow label="PoA Person" value={profile.poaPersonName} />}
          </div>

          {/* Banking */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <CreditCard className="h-4 w-4 text-gray-400" />
              Banking Details
            </h2>
            <InfoRow label="Account Name" value={profile.bankAccountName} />
            <InfoRow label="Bank Name" value={profile.bankName} />
            <InfoRow label="IBAN" value={profile.bankIban} />
            <InfoRow label="Account Number" value={profile.bankAccountNumber} />
            <InfoRow label="Account Status" value={profile.bankAccountStatus} />
          </div>

          {/* Document Checklist */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <FileText className="h-4 w-4 text-gray-400" />
              KYC Document Checklist
            </h2>
            <div className="space-y-2">
              {checklist.map((item) => (
                <div key={item.key} className={`flex items-start justify-between gap-3 p-3 rounded-lg ${item.uploaded ? "bg-emerald-50" : item.required ? "bg-red-50" : "bg-gray-50"}`}>
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    {item.uploaded ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className={`h-4 w-4 flex-shrink-0 mt-0.5 ${item.required ? "text-red-500" : "text-gray-300"}`} />
                    )}
                    <div>
                      <div className="text-xs font-medium text-gray-800">
                        {item.displayName}
                        {item.required && <span className="ml-1 text-red-500">*</span>}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">{item.description}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {docStatusBadge(item.status)}
                    {item.uploaded && item.fileUrl && (
                      <a href={item.fileUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                    {item.uploaded && item.documentId && item.status === "ATTACHED" && (
                      <button
                        onClick={() => void verifyDoc(item.documentId!)}
                        disabled={verifyingDocId === item.documentId}
                        className="text-xs px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {verifyingDocId === item.documentId ? "…" : "Verify"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column: risk + compliance action */}
        <div className="space-y-6">
          {/* Risk Indicators */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <ShieldCheck className="h-4 w-4 text-gray-400" />
              Risk Indicators
            </h2>
            {risk.reasons.length === 0 ? (
              <p className="text-xs text-emerald-600 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" /> No risk flags
              </p>
            ) : (
              <ul className="space-y-1.5">
                {risk.reasons.map((r) => (
                  <li key={r} className="flex items-start gap-1.5 text-xs text-gray-700">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                    {r}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Compliance Action */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Compliance Decision</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Status</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as ComplianceStatus)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="PENDING_REVIEW">Pending Review</option>
                  <option value="COMPLIANT">Compliant — Approve</option>
                  <option value="ACTION_REQUIRED">Action Required</option>
                  <option value="PAUSED">Paused</option>
                  <option value="EXPIRED">Expired</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Notes (visible to provider)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  placeholder="e.g. Trade license expiry needs to be renewed before approval…"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <button
                onClick={() => void saveCompliance()}
                disabled={saving}
                className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving…" : "Save Decision"}
              </button>
            </div>
          </div>

          {/* Compliance notes history */}
          {profile.complianceNotes && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="text-xs font-medium text-amber-800 mb-1">Existing Notes</div>
              <p className="text-xs text-amber-700">{profile.complianceNotes}</p>
              {profile.compliancePausedAt && (
                <p className="text-xs text-amber-500 mt-1">
                  Paused at {new Date(profile.compliancePausedAt).toLocaleDateString("en-AE")}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
