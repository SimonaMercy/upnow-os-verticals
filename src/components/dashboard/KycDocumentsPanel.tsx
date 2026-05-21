"use client";

/**
 * KycDocumentsPanel — single source of truth for KYC document upload UX.
 *
 * Used in two contexts:
 *  1. Onboarding wizard step  — pass `onAllRequiredUploaded` to show a "Continue" button
 *  2. Standalone documents page — omit `onAllRequiredUploaded`; just manages uploads
 *
 * Props
 * ─────
 * profileApiPath     GET endpoint that returns { profile: { id, entityType, ... }, checklist: ChecklistItem[] }
 * ownerType          "rental_provider" | "service_provider" | "customer"
 * profileHref        Optional link shown in the "Complete profile first" banner
 * onAllRequiredUploaded   Optional callback fired when all *required* docs are uploaded
 * continueLabel      Label for the continue button (default: "Go to my dashboard")
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  Upload,
  AlertCircle,
  FileText,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { apiGet, apiPost } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KycChecklistItem {
  key: string;
  displayName: string;
  category: string;
  required: boolean;
  description: string;
  uploaded: boolean;
  status: string | null;
  documentId: number | null;
  fileUrl: string | null;
  mimeType: string | null;
}

interface KycProfile {
  id: number;
  entityType: string;
  contactAddress?: string | null;
  bankAccountName?: string | null;
  bankIban?: string | null;
}

interface KycData {
  profile: KycProfile;
  checklist: KycChecklistItem[];
}

export interface KycDocumentsPanelProps {
  /** GET endpoint returning { profile, checklist } */
  profileApiPath: string;
  /** Used in /documents/upload-url and /documents POST calls */
  ownerType: "rental_provider" | "service_provider" | "customer";
  /**
   * When provided, overrides the server-computed checklist with the client-side
   * requirements for this entity type. Use this when the entity type is selected
   * in a form that hasn't been saved yet — so the document list updates instantly.
   */
  entityTypeOverride?: "individual" | "company";
  /**
   * For rental providers in "company" mode — selects between the landlord,
   * brokerage, and agents document variants. Only consulted when ownerType is
   * "rental_provider" and entityTypeOverride is "company".
   */
  companyTypeOverride?: "landlord" | "brokerage" | "agents";
  /**
   * Optional — only needed for RP/SP onboarding panels.
   * When set and all required docs are uploaded, a "Continue" button appears
   * and calls this callback.
   */
  onAllRequiredUploaded?: () => void;
  /** Button label. Defaults to "Go to my dashboard". */
  continueLabel?: string;
  /**
   * When provided, shows a warning banner if the profile is incomplete
   * (missing contactAddress / bankAccountName / bankIban).
   */
  profileHref?: string;
}

// ─── Client-side requirements (mirrors backend document-requirements.ts) ──────
// Kept in sync with src/documents/document-requirements.ts.
// Stored here so the checklist updates instantly when entityTypeOverride changes
// without waiting for a profile re-fetch.

type DocReq = Pick<KycChecklistItem, "key" | "displayName" | "category" | "required" | "description">;

// Shared base documents for landlord/brokerage company variants. Passport
// and Visa are optional — only effectively required for non-UAE signatories.
const RP_COMPANY_BASE: DocReq[] = [
  { key: "trade_license",   displayName: "Trade License",                       category: "license",    required: true,  description: "Valid UAE trade license. Must be current — expired licences cannot be accepted." },
  { key: "emirates_id",     displayName: "Emirates ID of Authorised Signatory", category: "identity",   required: true,  description: "Emirates ID (both sides) of the person authorised to sign on behalf of the company." },
  { key: "passport",        displayName: "Passport",                            category: "identity",   required: false, description: "Bio-data page of the authorised signatory's valid passport. Required only for non-UAE signatories." },
  { key: "visa",            displayName: "UAE Visa",                            category: "identity",   required: false, description: "UAE residency or entry visa of the authorised signatory. Required only for non-UAE residents." },
];

const RP_INDIVIDUAL: DocReq[] = [
  { key: "emirates_id", displayName: "Emirates ID",        category: "identity", required: true,  description: "Clear scan of your Emirates ID (both sides). Required for UAE nationals and residents." },
  { key: "passport",    displayName: "Passport",           category: "identity", required: false, description: "Bio-data page of your valid passport. Required for non-UAE nationals." },
  { key: "visa",        displayName: "UAE Residency Visa", category: "identity", required: false, description: "Residency visa page. Required for expatriate residents." },
];

const RP_LANDLORD: DocReq[] = [...RP_COMPANY_BASE];

const RP_BROKERAGE: DocReq[] = [
  ...RP_COMPANY_BASE,
  { key: "brokerage_license", displayName: "Brokerage License", category: "license", required: true, description: "Valid real-estate brokerage license from the relevant emirate regulator (RERA/DLD for Dubai, DMT for Abu Dhabi, SRERD for Sharjah, or the local authority where you operate)." },
];

// Agents Company operates under a parent brokerage's licence — so MOA / UBO
// declaration sit with the parent. Replace those with agent-registration
// + the agency agreement linking the agents company to its parent.
const RP_AGENTS: DocReq[] = [
  { key: "trade_license",              displayName: "Trade License",                          category: "license",    required: true,  description: "Valid UAE trade license. Must be current — expired licences cannot be accepted." },
  { key: "emirates_id",                displayName: "Emirates ID of Authorised Signatory",    category: "identity",   required: true,  description: "Emirates ID (both sides) of the person authorised to sign on behalf of the company." },
  { key: "passport",                   displayName: "Passport",                               category: "identity",   required: false, description: "Bio-data page of the authorised signatory's valid passport. Required only for non-UAE signatories." },
  { key: "visa",                       displayName: "UAE Visa",                               category: "identity",   required: false, description: "UAE residency or entry visa of the authorised signatory. Required only for non-UAE residents." },
  { key: "broker_registration",        displayName: "Broker Registration Number Certificate", category: "license",    required: true,  description: "Real-estate agent registration certificate issued by the relevant emirate regulator (BRN card or equivalent)." },
  { key: "parent_brokerage_agreement", displayName: "Agency Agreement with Parent Brokerage", category: "compliance", required: true,  description: "Signed agreement authorising you to operate as an agent under the named parent brokerage firm." },
];

const CLIENT_REQUIREMENTS: Partial<Record<string, Partial<Record<"individual" | "company", DocReq[]>>>> = {
  rental_provider: {
    individual: RP_INDIVIDUAL,
    // company default (no companyType supplied) = landlord
    company: RP_LANDLORD,
  },
};

// Company-variant lookup — only consulted for ownerType=rental_provider + entityType=company
const RP_COMPANY_VARIANTS: Record<"landlord" | "brokerage" | "agents", DocReq[]> = {
  landlord:  RP_LANDLORD,
  brokerage: RP_BROKERAGE,
  agents:    RP_AGENTS,
};

// ─── Status labels ────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  attached:  { label: "Uploaded — pending review", color: "var(--color-warning, #f59e0b)" },
  processed: { label: "Under review",               color: "var(--color-primary)" },
  complete:  { label: "Verified",                   color: "var(--color-success, #22c55e)" },
  expired:   { label: "Expired — re-upload",        color: "var(--color-error)" },
};

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

// ─── Component ────────────────────────────────────────────────────────────────

export function KycDocumentsPanel({
  profileApiPath,
  ownerType,
  entityTypeOverride,
  companyTypeOverride,
  onAllRequiredUploaded,
  continueLabel = "Go to my dashboard",
  profileHref,
}: KycDocumentsPanelProps) {
  const [data, setData] = useState<KycData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  // Instant local preview before the S3 URL propagates
  const [localPreviews, setLocalPreviews] = useState<
    Record<string, { url: string; mimeType: string }>
  >({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingKey = useRef<string | null>(null);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const load = () => {
    setLoading(true);
    setLoadError(false);
    apiGet<KycData>(profileApiPath)
      .then(setData)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(load, [profileApiPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Upload handlers ────────────────────────────────────────────────────────

  const handleUploadClick = (docKey: string) => {
    pendingKey.current = docKey;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const docKey = pendingKey.current;
    if (!file || !docKey || !data) return;
    e.target.value = "";

    if (!ALLOWED_MIME.includes(file.type)) {
      setUploadErrors((p) => ({
        ...p,
        [docKey]: "Only JPG, PNG, WebP, or PDF files are allowed.",
      }));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadErrors((p) => ({ ...p, [docKey]: "File must be under 10 MB." }));
      return;
    }

    setUploadErrors((p) => {
      const next = { ...p };
      delete next[docKey];
      return next;
    });
    setUploading(docKey);

    const localPreviewUrl = URL.createObjectURL(file);

    try {
      const { uploadUrl, fileUrl, fileKey } = await apiPost<{
        uploadUrl: string;
        fileUrl: string;
        fileKey: string;
      }>("/documents/upload-url", {
        ownerType,
        ownerId: data.profile.id,
        documentKey: docKey,
        mimeType: file.type,
        originalName: file.name,
      });

      // Use a relative path when the uploadUrl targets our own proxy (/api/…) to avoid
      // a localhost vs 127.0.0.1 origin mismatch that causes a CORS failure in dev.
      const uploadTarget = (() => {
        try {
          const p = new URL(uploadUrl);
          return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl;
        } catch { return uploadUrl; }
      })();
      const s3Res = await fetch(uploadTarget, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!s3Res.ok) throw new Error("Upload to storage failed");

      const req = checklist.find((c) => c.key === docKey) ?? data.checklist.find((c) => c.key === docKey)!;
      await apiPost("/documents", {
        ownerType,
        ownerId: data.profile.id,
        category: req.category,
        documentKey: docKey,
        displayName: req.displayName,
        fileUrl,
        mimeType: file.type,
        s3Key: fileKey,
        storageProvider: "s3",
      });

      setLocalPreviews((p) => ({
        ...p,
        [docKey]: { url: localPreviewUrl, mimeType: file.type },
      }));
      load();
    } catch (err) {
      URL.revokeObjectURL(localPreviewUrl);
      setUploadErrors((p) => ({
        ...p,
        [docKey]: err instanceof Error ? err.message : "Upload failed. Try again.",
      }));
    } finally {
      setUploading(null);
    }
  };

  // ── Derived state ──────────────────────────────────────────────────────────

  // When entityTypeOverride is provided, compute the checklist client-side so
  // the document list updates instantly when the user switches Individual ↔ Company
  // in the onboarding form — before the profile is saved to the DB.
  const checklist: KycChecklistItem[] = (() => {
    if (!data) return [];
    if (entityTypeOverride) {
      const reqs =
        ownerType === "rental_provider" && entityTypeOverride === "company" && companyTypeOverride
          ? RP_COMPANY_VARIANTS[companyTypeOverride] ?? []
          : (CLIENT_REQUIREMENTS[ownerType]?.[entityTypeOverride] ?? []);
      const uploadedByKey = new Map(data.checklist.map((c) => [c.key, c]));
      return reqs.map((req) => {
        const existing = uploadedByKey.get(req.key);
        return {
          ...req,
          uploaded:    existing?.uploaded    ?? false,
          status:      existing?.status      ?? null,
          documentId:  existing?.documentId  ?? null,
          fileUrl:     existing?.fileUrl     ?? null,
          mimeType:    existing?.mimeType    ?? null,
        };
      });
    }
    return data.checklist;
  })();

  const uploadedCount = checklist.filter((c) => c.uploaded).length;
  const totalCount = checklist.length;
  const requiredDone =
    checklist.filter((c) => c.required).length > 0 &&
    checklist.filter((c) => c.required).every((c) => c.uploaded);

  const profileIncomplete =
    !!profileHref &&
    !!data &&
    (!data.profile.contactAddress ||
      !data.profile.bankAccountName ||
      !data.profile.bankIban);

  // ── Loading / error states ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-10">
        <Loader2
          className="w-5 h-5 animate-spin"
          style={{ color: "var(--color-primary)" }}
        />
        <span className="text-sm" style={{ color: "var(--color-neutral-500)" }}>
          Loading checklist&hellip;
        </span>
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div
        className="flex items-start gap-3 rounded-2xl border p-4"
        style={{
          borderColor: "var(--color-error)",
          backgroundColor: "rgba(220,38,38,0.05)",
        }}
      >
        <AlertCircle
          size={18}
          className="mt-0.5 shrink-0"
          style={{ color: "var(--color-error)" }}
        />
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            Could not load the document checklist
          </p>
          <button
            type="button"
            onClick={load}
            className="mt-1 text-sm underline underline-offset-2"
            style={{ color: "var(--color-primary)" }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Hidden file picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.pdf"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Profile-incomplete banner */}
      {profileIncomplete && (
        <div
          className="flex items-start gap-3 rounded-2xl border p-4"
          style={{
            borderColor: "var(--color-warning, #f59e0b)",
            backgroundColor: "rgba(245,158,11,0.06)",
          }}
        >
          <AlertCircle
            size={18}
            className="mt-0.5 shrink-0"
            style={{ color: "var(--color-warning, #f59e0b)" }}
          />
          <div>
            <p
              className="text-sm font-semibold"
              style={{ color: "var(--color-text)" }}
            >
              Complete your profile first
            </p>
            <p
              className="text-sm mt-0.5"
              style={{ color: "var(--color-neutral-600)" }}
            >
              Address and banking details are required before documents can be
              reviewed.{" "}
              <Link
                href={profileHref!}
                className="underline font-medium"
              >
                Go to profile →
              </Link>
            </p>
          </div>
        </div>
      )}

      {/* Checklist */}
      {checklist.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-neutral-500)" }}>
          No documents required yet. Complete your profile first.
        </p>
      ) : (
        <div className="space-y-3">
          {checklist.map((item) => {
            const statusInfo = item.status ? STATUS_LABELS[item.status] : null;
            const isUploading = uploading === item.key;
            const local = localPreviews[item.key];
            const previewUrl = local?.url ?? item.fileUrl;
            const previewMime = local?.mimeType ?? item.mimeType ?? "";
            const isImage = previewMime.startsWith("image/");

            return (
              <div
                key={item.key}
                className="rounded-2xl border-2 p-5 flex items-center gap-5 transition-all"
                style={{
                  borderColor: item.uploaded
                    ? "var(--color-success, #22c55e)"
                    : uploadErrors[item.key]
                      ? "var(--color-error)"
                      : "var(--color-base-200)",
                  background: item.uploaded
                    ? "color-mix(in srgb, var(--color-success, #22c55e) 4%, white)"
                    : "white",
                }}
              >
                {/* Status icon */}
                <div
                  className="flex-shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center"
                  style={{
                    background: item.uploaded
                      ? "color-mix(in srgb, var(--color-success, #22c55e) 12%, white)"
                      : "var(--color-base-100)",
                  }}
                >
                  {item.uploaded ? (
                    <Check
                      className="w-5 h-5"
                      style={{ color: "var(--color-success, #22c55e)" }}
                    />
                  ) : (
                    <FileText
                      className="w-5 h-5"
                      style={{ color: "var(--color-neutral-400)" }}
                    />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p
                      className="text-sm font-semibold"
                      style={{ color: "var(--color-neutral-900)" }}
                    >
                      {item.displayName}
                    </p>
                    {item.required ? (
                      <span
                        className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                        style={{
                          background:
                            "color-mix(in srgb, var(--color-error) 10%, white)",
                          color: "var(--color-error)",
                        }}
                      >
                        Required
                      </span>
                    ) : (
                      <span
                        className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                        style={{
                          background: "var(--color-base-100)",
                          color: "var(--color-neutral-400)",
                        }}
                      >
                        Optional
                      </span>
                    )}
                  </div>

                  {item.description && (
                    <p
                      className="text-xs mt-1"
                      style={{ color: "var(--color-neutral-500)" }}
                    >
                      {item.description}
                    </p>
                  )}

                  {statusInfo && (
                    <p
                      className="text-xs mt-1 font-medium"
                      style={{ color: statusInfo.color }}
                    >
                      {statusInfo.label}
                    </p>
                  )}

                  {uploadErrors[item.key] && (
                    <p
                      className="text-xs mt-1 flex items-center gap-1"
                      style={{ color: "var(--color-error)" }}
                      role="alert"
                    >
                      <AlertCircle className="w-3 h-3 flex-shrink-0" />
                      {uploadErrors[item.key]}
                    </p>
                  )}

                  {/* Inline preview */}
                  {previewUrl && (
                    <div className="mt-3">
                      {isImage ? (
                        <a
                          href={previewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={previewUrl}
                            alt={item.displayName}
                            className="rounded-xl object-cover border"
                            style={{
                              width: 120,
                              height: 80,
                              borderColor: "var(--color-base-200)",
                            }}
                          />
                        </a>
                      ) : (
                        <a
                          href={previewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-medium underline underline-offset-2"
                          style={{ color: "var(--color-primary)" }}
                        >
                          <FileText className="w-3.5 h-3.5" />
                          View PDF
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {/* Upload button */}
                <button
                  type="button"
                  onClick={() => handleUploadClick(item.key)}
                  disabled={isUploading}
                  className="flex-shrink-0 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all disabled:opacity-50"
                  style={{
                    background: item.uploaded
                      ? "var(--color-base-100)"
                      : "var(--color-primary)",
                    color: item.uploaded ? "var(--color-neutral-600)" : "#fff",
                  }}
                >
                  {isUploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  <span className="hidden sm:inline">
                    {item.uploaded ? "Replace" : "Upload"}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Progress bar */}
      {totalCount > 0 && (
        <div
          className="rounded-2xl px-5 py-4"
          style={{ background: "var(--color-base-100)" }}
        >
          <div className="flex justify-between items-center mb-2">
            <p
              className="text-sm font-semibold"
              style={{ color: "var(--color-neutral-700)" }}
            >
              {uploadedCount} of {totalCount} documents uploaded
            </p>
            <span
              className="text-xs font-bold"
              style={{
                color: requiredDone
                  ? "var(--color-success, #22c55e)"
                  : "var(--color-neutral-500)",
              }}
            >
              {requiredDone ? "All required done ✓" : "Required pending"}
            </span>
          </div>
          <div
            className="h-2 rounded-full overflow-hidden"
            style={{ background: "var(--color-base-200)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${totalCount > 0 ? Math.round((uploadedCount / totalCount) * 100) : 0}%`,
                background: requiredDone
                  ? "var(--color-success, #22c55e)"
                  : "var(--color-primary)",
              }}
            />
          </div>
        </div>
      )}

      {/* Continue button — only shown in onboarding mode */}
      {onAllRequiredUploaded && (
        <div>
          <Button
            onClick={onAllRequiredUploaded}
            disabled={!requiredDone}
            className="w-full sm:w-auto"
          >
            {continueLabel}
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
          {!requiredDone && (
            <p
              className="text-xs mt-3"
              style={{ color: "var(--color-neutral-400)" }}
            >
              Upload all required documents to continue.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
