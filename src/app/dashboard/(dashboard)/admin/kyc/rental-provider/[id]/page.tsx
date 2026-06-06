"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { openDocsTogether } from "@/lib/openDocsTogether";
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
  Calendar,
  RotateCcw,
} from "lucide-react";

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
    case "compliant": return "bg-emerald-100 text-emerald-800";
    case "pending_review": return "bg-amber-100 text-amber-800";
    case "action_required": return "bg-red-100 text-red-800";
    case "expired": return "bg-gray-100 text-gray-700";
    case "paused": return "bg-orange-100 text-orange-800";
  }
}

function complianceIcon(s: ComplianceStatus) {
  switch (s) {
    case "compliant": return <CheckCircle2 className="h-4 w-4" />;
    case "pending_review": return <Clock className="h-4 w-4" />;
    case "action_required": return <AlertCircle className="h-4 w-4" />;
    case "expired": return <XCircle className="h-4 w-4" />;
    case "paused": return <AlertCircle className="h-4 w-4" />;
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

  if (profile.complianceStatus === "action_required") { risk += 25; reasons.push("Compliance action required"); }
  if (profile.complianceStatus === "paused") { risk += 20; reasons.push("Compliance paused"); }
  if (profile.complianceStatus === "expired") { risk += 30; reasons.push("Compliance expired"); }

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

function EditRow({ label, value }: { label: string; value?: string | null; readOnly?: boolean }) {
  return (
    <div className="flex gap-2 py-1 items-center">
      <span className="text-xs text-gray-500 w-36 flex-shrink-0">{label}</span>
      <span className="text-xs text-gray-400 italic">{value || "—"}</span>
    </div>
  );
}

function EditField({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div className="flex gap-2 items-center py-0.5">
      <label className="text-xs text-gray-500 w-36 flex-shrink-0">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-gray-50"
      />
    </div>
  );
}

type ExpiryLevel = "valid" | "soon" | "expired" | "none";

function expiryLevel(expiryDate: string | null): ExpiryLevel {
  if (!expiryDate) return "none";
  const now = new Date();
  const exp = new Date(expiryDate);
  if (exp < now) return "expired";
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  if (exp.getTime() - now.getTime() < thirtyDays) return "soon";
  return "valid";
}

function ExpiryBadge({ expiryDate }: { expiryDate: string | null }) {
  const level = expiryLevel(expiryDate);
  if (level === "none") return <span className="text-xs text-gray-400">No expiry set</span>;
  const map: Record<ExpiryLevel, string> = {
    valid: "bg-emerald-100 text-emerald-700",
    soon: "bg-amber-100 text-amber-700",
    expired: "bg-red-100 text-red-700",
    none: "",
  };
  const label = level === "expired" ? "Expired" : level === "soon" ? "Expiring soon" : "Valid";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[level]}`}>
      {label}: {new Date(expiryDate!).toLocaleDateString("en-AE")}
    </span>
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
  const [newStatus, setNewStatus] = useState<ComplianceStatus>("pending_review");
  const [expiryEdits, setExpiryEdits] = useState<Record<number, string>>({});
  const [savingExpiryId, setSavingExpiryId] = useState<number | null>(null);
  const [rerequestingId, setRerequestingId] = useState<number | null>(null);

  // Inline profile edit state
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileEdit, setProfileEdit] = useState<Partial<RentalProvider>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<RpDetail>(`/admin/kyc/rental-providers/${id}`);
      setDetail(data);
      setNotes(data.profile.complianceNotes ?? "");
      setNewStatus(data.profile.complianceStatus);
      setProfileEdit({
        nationality: data.profile.nationality ?? undefined,
        dateOfBirth: data.profile.dateOfBirth ?? undefined,
        contactAddress: data.profile.contactAddress ?? undefined,
        emiratesIdNumber: data.profile.emiratesIdNumber ?? undefined,
        passportNumber: data.profile.passportNumber ?? undefined,
        authorizedSignatoryName: data.profile.authorizedSignatoryName ?? undefined,
        tradeLicenseNumber: data.profile.tradeLicenseNumber ?? undefined,
        tradeLicenseAuthority: data.profile.tradeLicenseAuthority ?? undefined,
        bankAccountName: data.profile.bankAccountName ?? undefined,
        bankName: data.profile.bankName ?? undefined,
        bankIban: data.profile.bankIban ?? undefined,
      });
      setEditingProfile(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile() {
    setSavingProfile(true);
    try {
      await apiPatch(`/admin/kyc/rental-providers/${id}/profile`, profileEdit);
      void load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSavingProfile(false);
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

  async function saveExpiry(docId: number) {
    const expiryDate = expiryEdits[docId];
    if (!expiryDate) return;
    setSavingExpiryId(docId);
    try {
      await apiPatch(`/documents/${docId}`, { expiryDate });
      void load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to save expiry");
    } finally {
      setSavingExpiryId(null);
    }
  }

  async function rerequestDoc(docId: number) {
    if (!confirm("Mark this document as rejected and ask the provider to re-upload?")) return;
    setRerequestingId(docId);
    try {
      await apiPost(`/documents/${docId}/reject`, { reason: "Document has expired — please upload a renewed copy" });
      void load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to re-request document");
    } finally {
      setRerequestingId(null);
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
  const name = profile.user
    ? (profile.user.name || [profile.user.firstName, profile.user.lastName].filter(Boolean).join(" ") || `RP #${profile.id}`)
    : `RP #${profile.id}`;
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
          {/* Profile Overview — editable */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <User className="h-4 w-4 text-gray-400" />
                Profile Details
              </h2>
              {!editingProfile ? (
                <button
                  onClick={() => setEditingProfile(true)}
                  className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors"
                >
                  Edit
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => { setEditingProfile(false); void load(); }}
                    className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void saveProfile()}
                    disabled={savingProfile}
                    className="text-xs px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {savingProfile ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              )}
            </div>

            {editingProfile ? (
              <div className="space-y-3">
                <EditRow label="Entity Type" value={profile.entityType?.replace(/_/g, " ")} readOnly />
                {profile.entityType === "company" && (
                  <>
                    <EditField label="Trade License No." value={profileEdit.tradeLicenseNumber ?? ""} onChange={(v) => setProfileEdit((p) => ({ ...p, tradeLicenseNumber: v }))} />
                    <EditField label="License Authority" value={profileEdit.tradeLicenseAuthority ?? ""} onChange={(v) => setProfileEdit((p) => ({ ...p, tradeLicenseAuthority: v }))} />
                    <EditField label="Authorised Signatory" value={profileEdit.authorizedSignatoryName ?? ""} onChange={(v) => setProfileEdit((p) => ({ ...p, authorizedSignatoryName: v }))} />
                  </>
                )}
                <EditField label="Emirates ID No." value={profileEdit.emiratesIdNumber ?? ""} onChange={(v) => setProfileEdit((p) => ({ ...p, emiratesIdNumber: v }))} placeholder="784-XXXX-XXXXXXX-X" />
                <EditField label="Passport No." value={profileEdit.passportNumber ?? ""} onChange={(v) => setProfileEdit((p) => ({ ...p, passportNumber: v }))} />
                <EditField label="Nationality" value={profileEdit.nationality ?? ""} onChange={(v) => setProfileEdit((p) => ({ ...p, nationality: v }))} />
                <EditField label="Date of Birth" value={profileEdit.dateOfBirth ?? ""} onChange={(v) => setProfileEdit((p) => ({ ...p, dateOfBirth: v }))} type="date" />
                <EditField label="Contact Address" value={profileEdit.contactAddress ?? ""} onChange={(v) => setProfileEdit((p) => ({ ...p, contactAddress: v }))} />
                <div className="pt-2 border-t border-gray-100 mt-2">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Banking</div>
                  <EditField label="Account Holder Name" value={profileEdit.bankAccountName ?? ""} onChange={(v) => setProfileEdit((p) => ({ ...p, bankAccountName: v }))} />
                  <EditField label="Bank Name" value={profileEdit.bankName ?? ""} onChange={(v) => setProfileEdit((p) => ({ ...p, bankName: v }))} />
                  <EditField label="IBAN" value={profileEdit.bankIban ?? ""} onChange={(v) => setProfileEdit((p) => ({ ...p, bankIban: v.toUpperCase() }))} placeholder="AE07 0331 2345 6789 0123 456" />
                </div>
              </div>
            ) : (
              <>
                <InfoRow label="Entity Type" value={profile.entityType?.replace(/_/g, " ")} />
                {profile.entityType === "company" && (
                  <>
                    <InfoRow label="Company Name" value={profile.companyName} />
                    <InfoRow label="Trade License No." value={profile.tradeLicenseNumber} />
                    <InfoRow label="License Authority" value={profile.tradeLicenseAuthority} />
                    <InfoRow label="Authorised Signatory" value={profile.authorizedSignatoryName} />
                  </>
                )}
                <InfoRow label="Emirates ID" value={profile.emiratesIdNumber} />
                <InfoRow label="Passport No." value={profile.passportNumber} />
                <InfoRow label="Nationality" value={profile.nationality} />
                <InfoRow label="Date of Birth" value={profile.dateOfBirth ? new Date(profile.dateOfBirth).toLocaleDateString("en-AE") : null} />
                <InfoRow label="Contact Address" value={profile.contactAddress} />
                {profile.hasPoa && <InfoRow label="PoA Person" value={profile.poaPersonName} />}
                <div className="pt-3 mt-3 border-t border-gray-100">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Banking</div>
                  <InfoRow label="Account Holder" value={profile.bankAccountName} />
                  <InfoRow label="Bank Name" value={profile.bankName} />
                  <InfoRow label="IBAN" value={profile.bankIban} />
                  <InfoRow label="Account Number" value={profile.bankAccountNumber} />
                </div>
              </>
            )}
          </div>

          {/* Document Checklist */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <FileText className="h-4 w-4 text-gray-400" />
                KYC Document Checklist
              </h2>
              {detail.uploadedDocs.length > 0 && (
                <button
                  onClick={() => openDocsTogether(detail.uploadedDocs)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-700 flex-shrink-0"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  View all documents ({detail.uploadedDocs.length})
                </button>
              )}
            </div>
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

          {/* Uploaded Documents — expiry management */}
          {detail.uploadedDocs.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
                <Calendar className="h-4 w-4 text-gray-400" />
                Document Expiry Management
              </h2>
              <div className="space-y-3">
                {detail.uploadedDocs.map((doc) => {
                  const level = expiryLevel(doc.expiryDate);
                  const editVal = expiryEdits[doc.id] ?? doc.expiryDate ?? "";
                  return (
                    <div key={doc.id} className={`p-3 rounded-lg border ${level === "expired" ? "border-red-200 bg-red-50" : level === "soon" ? "border-amber-200 bg-amber-50" : "border-gray-100 bg-gray-50"}`}>
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-gray-800 capitalize">{doc.documentKey.replace(/_/g, " ")}</div>
                          <div className="mt-1"><ExpiryBadge expiryDate={doc.expiryDate} /></div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {doc.fileUrl && (
                            <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                          {level === "expired" && (
                            <button
                              onClick={() => void rerequestDoc(doc.id)}
                              disabled={rerequestingId === doc.id}
                              className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              <RotateCcw className="h-3 w-3" />
                              {rerequestingId === doc.id ? "…" : "Re-request"}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-500 flex-shrink-0">Set expiry:</label>
                        <input
                          type="date"
                          value={editVal}
                          onChange={(e) => setExpiryEdits((prev) => ({ ...prev, [doc.id]: e.target.value }))}
                          className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          onClick={() => void saveExpiry(doc.id)}
                          disabled={savingExpiryId === doc.id || !expiryEdits[doc.id]}
                          className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {savingExpiryId === doc.id ? "…" : "Save"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
                  <option value="pending_review">Pending Review</option>
                  <option value="compliant">Compliant — Approve</option>
                  <option value="action_required">Action Required</option>
                  <option value="paused">Paused</option>
                  <option value="expired">Expired</option>
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
