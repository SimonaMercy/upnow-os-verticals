/**
 * SP-248 / SP-266 / SP-268 — the provider-side "tools & materials" declaration,
 * shared by My Services (chip + expandable checklist per listing) and the
 * onboarding wizard's "What do you offer?" step (ONE checklist per picked
 * CATEGORY). Since SP-268 the declaration is held once per provider per tool
 * — a listing checklist and a category checklist read the same rows — so a
 * tick / photo / verification on one surface shows on every service in the
 * category. Tick what you have, optional note, photo per ticked tool; every
 * change saved immediately.
 *
 * Advisory by decision — nothing here blocks a step or an approval; UpNow
 * verifies the declaration at review (admin side lives in AdminListingsView).
 */
'use client';

import { useRef, useState } from 'react';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';

/* ── Types (mirror CapabilitiesService.checklists on the backend) ────────── */
export interface CapabilityRow {
  requirementId: number;
  label: string;
  description: string | null;
  requirementType: string;
  isMandatory: boolean;
  /** SP-268 — authored on the category (shared) or this one template (extra). */
  scope?: 'category' | 'template';
  declared: boolean;
  note: string | null;
  /** SP-267 — signed view URL of the provider's photo of this tool (null = none). */
  photoUrl: string | null;
  photoUploadedAt: string | null;
  verifiedAt: string | null;
}
export interface CapabilitySummary {
  total: number;
  mandatory: number;
  declared: number;
  declaredMandatory: number;
  verified: number;
  verifiedMandatory: number;
  declarationComplete: boolean;
  verificationComplete: boolean;
  /** SP-267 — declared lines with / without a photo. */
  withPhoto: number;
  photosMissing: number;
}
export interface ListingChecklist {
  serviceCatalogId: number;
  templateId?: number | null;
  categoryId?: number | null;
  serviceName?: string | null;
  summary: CapabilitySummary;
  rows: CapabilityRow[];
}
/** SP-268 — the checklist for one CATEGORY the provider offers services in (declared once). */
export interface CategoryChecklist {
  categoryId: number;
  categoryCode: string;
  categoryName: string;
  listingCount: number;
  summary: CapabilitySummary;
  rows: CapabilityRow[];
}
/** Anything with rows + summary renders in the shared checklist. */
export type AnyChecklist = Pick<ListingChecklist, 'summary' | 'rows'>;

/** Client-side mirror of CapabilitiesService.summarise — used to show a subset (e.g. a listing's EXTRAS only). */
export function summariseRows(rows: CapabilityRow[]): CapabilitySummary {
  const mandatory = rows.filter((r) => r.isMandatory);
  const declared = rows.filter((r) => r.declared);
  const verified = rows.filter((r) => r.declared && r.verifiedAt != null);
  const declaredMandatory = mandatory.filter((r) => r.declared).length;
  const verifiedMandatory = mandatory.filter((r) => r.declared && r.verifiedAt != null).length;
  const withPhoto = declared.filter((r) => !!r.photoUrl).length;
  return {
    total: rows.length, mandatory: mandatory.length, declared: declared.length, declaredMandatory,
    verified: verified.length, verifiedMandatory,
    declarationComplete: mandatory.length === 0 || declaredMandatory === mandatory.length,
    verificationComplete: mandatory.length === 0 || verifiedMandatory === mandatory.length,
    withPhoto, photosMissing: declared.length - withPhoto,
  };
}

/* ── API ─────────────────────────────────────────────────────────────────── */
export const fetchMyChecklists = () => apiGet<ListingChecklist[]>('/service-provider/capabilities');
export const fetchMyChecklist = (serviceCatalogId: number) =>
  apiGet<ListingChecklist>(`/service-provider/capabilities/${serviceCatalogId}`);
export const declareCapability = (
  serviceCatalogId: number,
  requirementId: number,
  declared: boolean,
  note?: string | null,
) =>
  apiPut<ListingChecklist>(`/service-provider/capabilities/${serviceCatalogId}`, {
    items: [{ requirementId, declared, ...(note !== undefined ? { note } : {}) }],
  });

const PHOTO_MAX_BYTES = 10 * 1024 * 1024; // matches the KYC / booking-evidence ceiling

/**
 * SP-267 — photo of a declared tool: presign → PUT the binary → persist.
 * Same three-step cycle as booking evidence (lib/bookingEvidence.ts).
 * Returns the refreshed checklist for the listing.
 */
export async function uploadCapabilityPhoto(
  serviceCatalogId: number,
  requirementId: number,
  file: File,
): Promise<ListingChecklist> {
  if (file.size > PHOTO_MAX_BYTES) throw new Error('Photo is too large — 10 MB max.');
  const { uploadUrl, fileUrl } = await apiPost<{ uploadUrl: string; fileUrl: string }>(
    `/service-provider/capabilities/${serviceCatalogId}/photo-url`,
    { requirementId, mimeType: file.type, originalName: file.name },
  );
  const put = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  if (!put.ok) throw new Error('Photo upload failed — please try again.');
  return apiPost<ListingChecklist>(`/service-provider/capabilities/${serviceCatalogId}/photo`, {
    requirementId,
    url: fileUrl,
  });
}

export const removeCapabilityPhoto = (serviceCatalogId: number, requirementId: number) =>
  apiDelete<ListingChecklist>(`/service-provider/capabilities/${serviceCatalogId}/photo/${requirementId}`);

/* ── SP-268: provider-level (declare ONCE per category — onboarding) ─────── */
const idsQs = (categoryIds?: number[]) => (categoryIds?.length ? `?categoryIds=${categoryIds.join(',')}` : '');
export const fetchMyCategoryChecklists = (categoryIds?: number[]) =>
  apiGet<CategoryChecklist[]>(`/service-provider/capabilities/categories${idsQs(categoryIds)}`);
export const declareCapabilityMine = (requirementId: number, declared: boolean, note?: string | null, categoryIds?: number[]) =>
  apiPut<CategoryChecklist[]>(`/service-provider/capabilities/declare${idsQs(categoryIds)}`, {
    items: [{ requirementId, declared, ...(note !== undefined ? { note } : {}) }],
  });
export async function uploadCapabilityPhotoMine(requirementId: number, file: File, categoryIds?: number[]): Promise<CategoryChecklist[]> {
  if (file.size > PHOTO_MAX_BYTES) throw new Error('Photo is too large — 10 MB max.');
  const { uploadUrl, fileUrl } = await apiPost<{ uploadUrl: string; fileUrl: string }>(
    '/service-provider/capabilities/photo-url',
    { requirementId, mimeType: file.type, originalName: file.name },
  );
  const put = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  if (!put.ok) throw new Error('Photo upload failed — please try again.');
  return apiPost<CategoryChecklist[]>(`/service-provider/capabilities/photo${idsQs(categoryIds)}`, { requirementId, url: fileUrl });
}
export const removeCapabilityPhotoMine = (requirementId: number, categoryIds?: number[]) =>
  apiDelete<CategoryChecklist[]>(`/service-provider/capabilities/photo/${requirementId}${idsQs(categoryIds)}`);

/* ── Tokens (design 2a — same as the SP portal pages) ────────────────────── */
const GREEN = '#0B7A4E';
const INK = '#182420';
const MUTE = '#55645B';
const FAINT = '#8A968D';
const HAIRLINE = '1px solid #EEF1EE';
const TINT_GREEN = '#E9F4EE';

export function chipTone(sm: CapabilitySummary): { bg: string; fg: string } {
  if (sm.verificationComplete) return { bg: TINT_GREEN, fg: GREEN };
  if (sm.declarationComplete) return { bg: '#EEF2FF', fg: '#4338CA' };
  return { bg: '#FEF6E7', fg: '#92400E' };
}

/** "Tools 4/6" — amber until every mandatory item is declared, indigo when
 *  declared, green ✓ once UpNow verified. Renders nothing for a service with
 *  no requirements. */
export function SpToolsChip({
  checklist,
  open,
  onToggle,
  size = 'md',
}: {
  checklist: AnyChecklist | undefined;
  open?: boolean;
  onToggle?: () => void;
  size?: 'sm' | 'md';
}) {
  if (!checklist || checklist.summary.total === 0) return null;
  const sm = checklist.summary;
  const tone = chipTone(sm);
  const title = sm.declarationComplete
    ? sm.verificationComplete
      ? 'UpNow verified your tools & materials for this service'
      : 'Declared — awaiting UpNow verification'
    : 'Tell us which tools & materials you have for this service';
  const photos = sm.declared > 0 && !sm.verificationComplete ? ` · photos ${sm.withPhoto}/${sm.declared}` : '';
  const label = `Tools ${sm.declaredMandatory}/${sm.mandatory}${photos}${sm.verificationComplete ? ' ✓' : ''}`;
  const style = {
    fontSize: size === 'sm' ? 10.5 : 11.5,
    fontWeight: 700,
    padding: size === 'sm' ? '2px 7px' : '3px 9px',
    borderRadius: 999,
    background: tone.bg,
    color: tone.fg,
    border: 'none',
    whiteSpace: 'nowrap' as const,
  };
  if (!onToggle) return <span title={title} style={style}>{label}</span>;
  return (
    <button type="button" onClick={onToggle} title={title} style={{ ...style, cursor: 'pointer' }}>
      {label} {open ? '▴' : '▾'}
    </button>
  );
}

/** The checklist body: one checkbox per requirement, note on ticked rows. */
export function SpCapabilityChecklist({
  checklist,
  busy,
  onDeclare,
  onUploadPhoto,
  onRemovePhoto: onRemovePhotoProp,
  intro,
  compact = false,
}: {
  checklist: AnyChecklist | undefined;
  busy?: boolean;
  onDeclare: (requirementId: number, declared: boolean, note?: string | null) => void;
  /** SP-267 — the caller performs the upload (listing-scoped or provider-level) and refreshes its own state. */
  onUploadPhoto: (requirementId: number, file: File) => Promise<void>;
  onRemovePhoto: (requirementId: number) => Promise<void>;
  /** Override the lead sentence (onboarding uses a shorter one). */
  intro?: string;
  /** Tighter padding for use inside a card row (onboarding). */
  compact?: boolean;
}) {
  // Photo upload state lives here so both surfaces get identical behaviour.
  const [photoBusy, setPhotoBusy] = useState<number | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInputs = useRef<Record<number, HTMLInputElement | null>>({});

  if (!checklist || checklist.summary.total === 0) return null;
  const sm = checklist.summary;
  const missing = sm.mandatory - sm.declaredMandatory;

  const pickPhoto = (requirementId: number) => fileInputs.current[requirementId]?.click();
  const onFile = async (requirementId: number, file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(requirementId);
    setPhotoError(null);
    try {
      await onUploadPhoto(requirementId, file);
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : 'Could not upload the photo');
    } finally {
      setPhotoBusy(null);
      const input = fileInputs.current[requirementId];
      if (input) input.value = '';
    }
  };
  const onRemovePhoto = async (requirementId: number) => {
    setPhotoBusy(requirementId);
    setPhotoError(null);
    try {
      await onRemovePhotoProp(requirementId);
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : 'Could not remove the photo');
    } finally {
      setPhotoBusy(null);
    }
  };
  return (
    <div
      style={{
        padding: compact ? '8px 10px 10px' : '10px 16px 14px',
        background: '#FBFCFA',
        borderTop: compact ? undefined : HAIRLINE,
        border: compact ? HAIRLINE : undefined,
        borderRadius: compact ? 10 : undefined,
      }}
    >
      <p style={{ fontSize: 12, color: MUTE, marginBottom: 8 }}>
        {intro ?? 'What this service needs. Tick what you have and add a photo of each — UpNow checks them when reviewing the service.'}
        {!sm.declarationComplete && (
          <span style={{ color: '#92400E', fontWeight: 600 }}>
            {' '}
            {missing} mandatory item{missing === 1 ? '' : 's'} still unticked.
          </span>
        )}
        {sm.declarationComplete && sm.photosMissing > 0 && (
          <span style={{ color: '#92400E', fontWeight: 600 }}>
            {' '}
            {sm.photosMissing} photo{sm.photosMissing === 1 ? '' : 's'} still missing.
          </span>
        )}
      </p>
      {photoError && (
        <p style={{ fontSize: 12, color: '#B42318', marginBottom: 8 }}>{photoError}</p>
      )}
      <ul style={{ display: 'grid', gap: 6, gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {checklist.rows.map((r) => (
          <li key={r.requirementId} className="flex items-start gap-2" style={{ fontSize: 13, color: INK }}>
            <input
              type="checkbox"
              checked={r.declared}
              disabled={busy}
              onChange={(e) => onDeclare(r.requirementId, e.target.checked)}
              style={{ marginTop: 3, accentColor: GREEN }}
              aria-label={r.label}
            />
            <span style={{ flex: 1 }}>
              {r.label}
              {!r.isMandatory && <span style={{ fontSize: 11, color: FAINT }}> (optional)</span>}
              {r.verifiedAt && (
                <span style={{ fontSize: 10.5, fontWeight: 700, color: GREEN, marginLeft: 6 }}>✓ verified</span>
              )}
              {r.description && (
                <span style={{ display: 'block', fontSize: 11.5, color: FAINT }}>{r.description}</span>
              )}
              {r.declared && (
                <span className="flex items-start gap-2" style={{ marginTop: 4 }}>
                  {/* SP-267 — photo of the tool: thumbnail + replace/remove, or an "Add photo" prompt. */}
                  <input
                    ref={(el) => { fileInputs.current[r.requirementId] = el; }}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    onChange={(e) => void onFile(r.requirementId, e.target.files?.[0])}
                  />
                  {r.photoUrl ? (
                    <span className="flex items-center gap-1.5" style={{ flexShrink: 0 }}>
                      <a href={r.photoUrl} target="_blank" rel="noreferrer" title="Open photo">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={r.photoUrl}
                          alt={`Photo of ${r.label}`}
                          style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8, border: HAIRLINE, display: 'block' }}
                        />
                      </a>
                      <span className="flex flex-col gap-1">
                        <button
                          type="button"
                          disabled={busy || photoBusy === r.requirementId}
                          onClick={() => pickPhoto(r.requirementId)}
                          style={{ fontSize: 10.5, fontWeight: 600, color: MUTE, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                        >
                          Replace
                        </button>
                        <button
                          type="button"
                          disabled={busy || photoBusy === r.requirementId}
                          onClick={() => void onRemovePhoto(r.requirementId)}
                          title="Remove photo"
                          style={{ fontSize: 10.5, fontWeight: 600, color: '#B42318', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                        >
                          <Trash2 size={11} style={{ display: 'inline', verticalAlign: '-1px' }} /> Remove
                        </button>
                      </span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy || photoBusy === r.requirementId}
                      onClick={() => pickPhoto(r.requirementId)}
                      className="flex items-center gap-1.5"
                      style={{
                        flexShrink: 0,
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: '#92400E',
                        background: '#FEF6E7',
                        border: '1px dashed #F5D9A6',
                        borderRadius: 8,
                        padding: '5px 9px',
                        cursor: 'pointer',
                      }}
                    >
                      {photoBusy === r.requirementId ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
                      {photoBusy === r.requirementId ? 'Uploading…' : 'Add photo'}
                    </button>
                  )}
                  <input
                    defaultValue={r.note ?? ''}
                    placeholder="Note (brand / model — optional)"
                    disabled={busy}
                    onBlur={(e) => {
                      const next = e.target.value.trim() || null;
                      if (next !== (r.note ?? null)) onDeclare(r.requirementId, true, next);
                    }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 11.5,
                      padding: '5px 6px',
                      border: HAIRLINE,
                      borderRadius: 6,
                      color: MUTE,
                      background: '#fff',
                    }}
                  />
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
