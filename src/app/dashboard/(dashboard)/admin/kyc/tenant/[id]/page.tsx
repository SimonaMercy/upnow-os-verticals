"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ExternalLink,
  FileText,
  User,
  RefreshCw,
  Calendar,
  RotateCcw,
  Zap,
  UploadCloud,
  Loader2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type DocStatus = "ATTACHED" | "PROCESSED" | "COMPLETE" | "EXPIRED" | "REJECTED" | "PENDING" | null;

interface TenantUser {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  kycStatus?: string;
  createdAt?: string;
}

interface TenantProfile {
  id: number;
  userId: number;
  user?: TenantUser;
  entityType?: string;
  tradeLicenseNumber?: string | null;
  tradeLicenseAuthority?: string | null;
  activeStatus?: string;
  documentStatus?: string;
  createdAt: string;
  updatedAt: string;
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

const UTILITY_KEY = "utility_proof_of_payment";

interface TenantDetail {
  profile: TenantProfile;
  uploadedDocs: UploadedDoc[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function docStatusBadge(s: DocStatus) {
  if (!s) return <span className="text-xs text-gray-400">Not uploaded</span>;
  const map: Record<string, string> = {
    ATTACHED: "bg-amber-100 text-amber-700",
    PENDING: "bg-gray-100 text-gray-500",
    PROCESSED: "bg-blue-100 text-blue-700",
    COMPLETE: "bg-emerald-100 text-emerald-800",
    EXPIRED: "bg-red-100 text-red-700",
    REJECTED: "bg-red-100 text-red-700",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[s] ?? "bg-gray-100 text-gray-600"}`}>
      {s}
    </span>
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

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-2 py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500 w-40 flex-shrink-0">{label}</span>
      <span className="text-xs text-gray-900 font-medium">{value || <span className="text-gray-300">—</span>}</span>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function TenantKycDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expiryEdits, setExpiryEdits] = useState<Record<number, string>>({});
  const [savingExpiryId, setSavingExpiryId] = useState<number | null>(null);
  const [rerequestingId, setRerequestingId] = useState<number | null>(null);
  const [verifyingDocId, setVerifyingDocId] = useState<number | null>(null);

  // Utility upload on behalf of tenant
  const [utilityAccountInput, setUtilityAccountInput] = useState("");
  const [utilityUploading, setUtilityUploading] = useState(false);
  const [utilityAccountSaving, setUtilityAccountSaving] = useState(false);
  const [utilityError, setUtilityError] = useState<string | null>(null);
  const [utilitySuccess, setUtilitySuccess] = useState<string | null>(null);
  const utilityFileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<TenantDetail>(`/admin/kyc/tenants/${id}`);
      setDetail(data);
      const dewaDoc = data.uploadedDocs.find((d) => d.documentKey === UTILITY_KEY);
      if (dewaDoc?.documentNumber) setUtilityAccountInput(dewaDoc.documentNumber);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUtilityUpload(file: File) {
    if (!detail) return;
    const tenantProfileId = detail.profile.id;
    setUtilityError(null);
    setUtilitySuccess(null);
    setUtilityUploading(true);
    try {
      const urlRes = await fetch("/api/documents/upload-url", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerType: "customer", ownerId: tenantProfileId,
          documentKey: UTILITY_KEY, originalName: file.name, mimeType: file.type,
        }),
      });
      if (!urlRes.ok) { setUtilityError("Failed to get upload URL"); return; }
      const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey: string };

      const target = (() => {
        try { const p = new URL(uploadUrl); return p.pathname.startsWith("/api/") ? p.pathname + p.search : uploadUrl; }
        catch { return uploadUrl; }
      })();

      const putRes = await fetch(target, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!putRes.ok) { setUtilityError("File upload failed"); return; }

      const existingDewaDoc = detail.uploadedDocs.find((d) => d.documentKey === UTILITY_KEY);
      let docRes: Response;
      if (existingDewaDoc) {
        docRes = await fetch(`/api/documents/${existingDewaDoc.id}`, {
          method: "PATCH", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileUrl, mimeType: file.type, s3Key: fileKey, documentNumber: utilityAccountInput.trim() || null }),
        });
      } else {
        docRes = await fetch("/api/documents", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ownerType: "customer", ownerId: tenantProfileId,
            documentKey: UTILITY_KEY, category: "payment",
            displayName: "Utility Proof of Payment",
            fileUrl, mimeType: file.type, s3Key: fileKey,
            documentNumber: utilityAccountInput.trim() || null,
            isVisibleToTenant: true,
          }),
        });
      }
      if (!docRes.ok) {
        const b = await docRes.json().catch(() => ({})) as { message?: string | string[] };
        setUtilityError(Array.isArray(b.message) ? b.message[0] : (b.message ?? "Failed to save document"));
        return;
      }
      setUtilitySuccess("Utility proof uploaded successfully.");
      if (utilityFileRef.current) utilityFileRef.current.value = "";
      void load();
    } catch { setUtilityError("Unexpected error during upload"); }
    finally { setUtilityUploading(false); }
  }

  async function saveUtilityAccountOnly() {
    if (!detail) return;
    const dewaDoc = detail.uploadedDocs.find((d) => d.documentKey === UTILITY_KEY);
    if (!dewaDoc) return;
    setUtilityError(null);
    setUtilitySuccess(null);
    setUtilityAccountSaving(true);
    try {
      await fetch(`/api/documents/${dewaDoc.id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentNumber: utilityAccountInput.trim() || null }),
      });
      setUtilitySuccess("Account number updated.");
      void load();
    } catch { setUtilityError("Failed to save account number."); }
    finally { setUtilityAccountSaving(false); }
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
    if (!confirm("Mark this document as rejected and ask the customer to re-upload?")) return;
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
        {error ?? "Customer not found"}
      </div>
    );
  }

  const { profile, uploadedDocs } = detail;
  const name = profile.user ? `${profile.user.firstName} ${profile.user.lastName}` : `Customer #${profile.id}`;
  const expiredDocs = uploadedDocs.filter((d) => expiryLevel(d.expiryDate) === "expired");
  const soonDocs = uploadedDocs.filter((d) => expiryLevel(d.expiryDate) === "soon");

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
            <div className="h-12 w-12 rounded-xl bg-purple-50 flex items-center justify-center">
              <User className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{name}</h1>
              <p className="text-sm text-gray-500">{profile.user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {expiredDocs.length > 0 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-red-100 text-red-700">
                <XCircle className="h-4 w-4" />
                {expiredDocs.length} expired
              </span>
            )}
            {soonDocs.length > 0 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-amber-100 text-amber-700">
                <AlertCircle className="h-4 w-4" />
                {soonDocs.length} expiring soon
              </span>
            )}
            {expiredDocs.length === 0 && soonDocs.length === 0 && uploadedDocs.length > 0 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                Documents OK
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500 mb-1">Docs Uploaded</div>
          <div className="text-2xl font-bold text-gray-900">{uploadedDocs.length}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500 mb-1">Approved</div>
          <div className="text-2xl font-bold text-emerald-600">
            {uploadedDocs.filter((d) => d.status === "PROCESSED" || d.status === "COMPLETE").length}
          </div>
        </div>
        <div className={`rounded-xl p-4 ${expiredDocs.length > 0 ? "bg-red-50" : "bg-gray-50"}`}>
          <div className="text-xs text-gray-500 mb-1">Expired</div>
          <div className={`text-2xl font-bold ${expiredDocs.length > 0 ? "text-red-600" : "text-gray-400"}`}>
            {expiredDocs.length}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500 mb-1">Registered</div>
          <div className="text-sm font-semibold text-gray-800">{new Date(profile.createdAt).toLocaleDateString("en-AE")}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: profile + documents */}
        <div className="lg:col-span-2 space-y-6">
          {/* Profile */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <User className="h-4 w-4 text-gray-400" />
              Customer Profile
            </h2>
            <InfoRow label="Entity Type" value={profile.entityType?.replace(/_/g, " ")} />
            <InfoRow label="Document Status" value={profile.documentStatus} />
            <InfoRow label="Active Status" value={profile.activeStatus} />
            <InfoRow label="Trade License No." value={profile.tradeLicenseNumber} />
            <InfoRow label="License Authority" value={profile.tradeLicenseAuthority} />
            <InfoRow label="Phone" value={profile.user?.phone} />
            <InfoRow label="KYC Status" value={profile.user?.kycStatus} />
          </div>

          {/* Utility Setup — admin upload on behalf of tenant */}
          {(() => {
            const dewaDoc = uploadedDocs.find((d) => d.documentKey === UTILITY_KEY);
            return (
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
                  <Zap className="h-4 w-4 text-yellow-500" />
                  Utility Setup
                  {dewaDoc && (
                    <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">Proof uploaded</span>
                  )}
                </h2>

                {/* Account number row */}
                <div className="mb-4">
                  <label className="text-xs font-medium text-gray-500 block mb-1.5">Utility Account Number</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={utilityAccountInput}
                      onChange={(e) => setUtilityAccountInput(e.target.value)}
                      placeholder="e.g. 1234567890"
                      className="flex-1 text-sm font-mono border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    {dewaDoc && (
                      <button
                        onClick={() => void saveUtilityAccountOnly()}
                        disabled={utilityAccountSaving}
                        className="text-xs px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
                      >
                        {utilityAccountSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        {utilityAccountSaving ? "…" : "Save"}
                      </button>
                    )}
                  </div>
                  {dewaDoc?.documentNumber && !utilityAccountInput && (
                    <p className="text-xs text-gray-400 mt-1">Saved: {dewaDoc.documentNumber}</p>
                  )}
                </div>

                {/* Proof of payment */}
                <div className="border border-dashed border-gray-200 rounded-lg p-4 space-y-3">
                  <p className="text-xs font-medium text-gray-700">
                    {dewaDoc ? "Proof of Payment — uploaded" : "Proof of Payment — not yet uploaded"}
                  </p>
                  {dewaDoc?.fileUrl && (
                    <a href={dewaDoc.fileUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                      <ExternalLink className="h-3 w-3" /> View current file
                    </a>
                  )}
                  <label className={[
                    "flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg cursor-pointer text-white w-fit transition-opacity",
                    utilityUploading ? "opacity-50 pointer-events-none" : "",
                    dewaDoc ? "bg-gray-500 hover:bg-gray-600" : "bg-yellow-500 hover:bg-yellow-600",
                  ].join(" ")}>
                    {utilityUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
                    {utilityUploading ? "Uploading…" : dewaDoc ? "Replace file" : "Upload on behalf of customer"}
                    <input ref={utilityFileRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUtilityUpload(f); e.target.value = ""; }} />
                  </label>
                  <p className="text-[11px] text-gray-400">Accepts PDF, JPG, PNG · This will be visible to the customer</p>
                </div>

                {utilityError && <p className="mt-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{utilityError}</p>}
                {utilitySuccess && <p className="mt-2 text-xs text-emerald-600 bg-emerald-50 rounded-lg px-3 py-2">{utilitySuccess}</p>}
              </div>
            );
          })()}

          {/* Uploaded Documents — expiry management */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <FileText className="h-4 w-4 text-gray-400" />
              Uploaded Documents
            </h2>
            {uploadedDocs.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">No documents uploaded yet</p>
            ) : (
              <div className="space-y-3">
                {uploadedDocs.map((doc) => {
                  const level = expiryLevel(doc.expiryDate);
                  const editVal = expiryEdits[doc.id] ?? doc.expiryDate ?? "";
                  return (
                    <div key={doc.id} className={`p-3 rounded-lg border ${level === "expired" ? "border-red-200 bg-red-50" : level === "soon" ? "border-amber-200 bg-amber-50" : "border-gray-100 bg-gray-50"}`}>
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-gray-800 capitalize">{doc.documentKey.replace(/_/g, " ")}</div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {docStatusBadge(doc.status as DocStatus)}
                            <ExpiryBadge expiryDate={doc.expiryDate} />
                          </div>
                          {doc.notes && (
                            <div className="text-xs text-gray-500 mt-1 italic">{doc.notes}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {doc.fileUrl && (
                            <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                          {doc.status === "ATTACHED" && (
                            <button
                              onClick={() => void verifyDoc(doc.id)}
                              disabled={verifyingDocId === doc.id}
                              className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              {verifyingDocId === doc.id ? "…" : "Verify"}
                            </button>
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
                      {/* Expiry date editor */}
                      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-200">
                        <Calendar className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
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
            )}
          </div>
        </div>

        {/* Right: expiry summary */}
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Expiry Summary</h2>
            {uploadedDocs.length === 0 ? (
              <p className="text-xs text-gray-400">No documents uploaded</p>
            ) : expiredDocs.length === 0 && soonDocs.length === 0 ? (
              <p className="text-xs text-emerald-600 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" /> All documents are valid
              </p>
            ) : (
              <div className="space-y-2">
                {expiredDocs.map((d) => (
                  <div key={d.id} className="flex items-start gap-1.5 text-xs text-red-700">
                    <XCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                    <span className="capitalize">{d.documentKey.replace(/_/g, " ")} — expired {new Date(d.expiryDate!).toLocaleDateString("en-AE")}</span>
                  </div>
                ))}
                {soonDocs.map((d) => (
                  <div key={d.id} className="flex items-start gap-1.5 text-xs text-amber-700">
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                    <span className="capitalize">{d.documentKey.replace(/_/g, " ")} — expires {new Date(d.expiryDate!).toLocaleDateString("en-AE")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
