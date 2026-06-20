'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useCallback, useEffect, useState } from 'react';
import { openDocsTogether } from '@/lib/openDocsTogether';
import {
  X,
  MapPin,
  ExternalLink,
  Dumbbell,
  Waves,
  Car,
  FileText,
  Loader2,
  AlignLeft,
  Image as ImageIcon,
  Building2,
  Trash2,
} from 'lucide-react';
import { apiDelete } from '@/lib/api';
import { uploadOwnedDocument } from '@/lib/uploadOwnedDocument';
import { DocSlotCard, categoryDisplayLabel, type PropertyDoc } from '@/components/upnow/PropertyFormModal';
import { DocPreviewModal } from '@/components/upnow/DocPreviewModal';
import { PROPERTY_DOC_SLOTS, docBelongsToSlot } from '@/lib/propertyDocs';

/** Minimal unit shape for the in-popup units list. */
interface UnitLite {
  id: number;
  unitNumber: string;
  unitName: string | null;
  unitType: string;
  availability: string;
  listingStatus: string;
}

interface Property {
  id: number;
  buildingName: string;
  spaceCategory: string;
  fullAddress: string | null;
  countryName?: string | null;
  emirateName: string | null;
  cityName?: string | null;
  communityName: string | null;
  subCommunityName?: string | null;
  street: string | null;
  makaniNumber: string | null;
  plotNumber: string | null;
  latitude: number | null;
  longitude: number | null;
  hasGym: boolean;
  hasPool: boolean;
  hasParking: boolean;
  isStandaloneUnit: boolean;
  propertyDescription: string | null;
  numberOfFloors: string | null;
  createdAt: string;
  unitCount?: number;
  occupiedCount?: number;
  rentTotal?: number;
}

/** Defensive shape for a document record returned by GET /documents. */
interface DocRecord {
  id?: number;
  documentKey?: string;
  document_key?: string;
  displayName?: string | null;
  display_name?: string | null;
  fileUrl?: string;
  file_url?: string;
  url?: string;
  fileName?: string;
  file_name?: string;
  createdAt?: string;
  created_at?: string;
}

function docKey(d: DocRecord): string {
  return d.documentKey ?? d.document_key ?? '';
}

function docUrl(d: DocRecord): string | null {
  return d.fileUrl ?? d.file_url ?? d.url ?? null;
}

function prettifyKey(key: string, d: DocRecord): string {
  const display = d.displayName ?? d.display_name;
  if (display) return display;
  if (key === 'title_deed') return 'Title deed';
  if (key.startsWith('building_drawing')) return 'Property drawing';
  if (key === 'building_documents') return 'Building documents / Title deed';
  if (key === 'site_plan') return 'Site plan';
  if (!key) return d.fileName ?? d.file_name ?? 'Document';
  const words = key.replace(/_\d{10,}.*$/, '').replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString('en-AE', {
    timeZone: APP_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function PropertyDetailsModal({
  property,
  stats,
  fetchBase = '/properties',
  fetchQuery = '',
  editable = false,
  onClose,
}: {
  property: Property;
  stats?: { units: number; occupied: number; rentTotal: number } | null;
  /** Units base — RP uses '/properties'; the manager passes '/manager/properties' + 'rp=N'. */
  fetchBase?: string;
  fetchQuery?: string;
  /** When true, the documents section allows direct upload / delete (the property exists). */
  editable?: boolean;
  onClose: () => void;
}) {
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState(false);
  const [docsBusy, setDocsBusy] = useState(false);
  const [units, setUnits] = useState<UnitLite[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(true);
  // Full property detail (the list object lacks the structured location names);
  // fetched on open and merged over the passed-in property.
  const [detail, setDetail] = useState<Partial<Property> | null>(null);
  // Building photos (read-only gallery) + click-to-enlarge lightbox.
  const [photos, setPhotos] = useState<{ id: number; url: string }[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);
  // In-app document preview ("View") — same component as the property form.
  const [viewerDoc, setViewerDoc] = useState<{ url: string; mime?: string | null; name: string } | null>(null);

  const loadDocs = useCallback(async () => {
    try {
      const res = await fetch(`/api/documents?ownerType=property&ownerId=${property.id}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDocs(Array.isArray(data) ? data : []);
      setDocsError(false);
    } catch {
      setDocsError(true);
    } finally {
      setDocsLoading(false);
    }
  }, [property.id]);
  // loadDocs only sets state after an await (async), but the rule can't see that.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadDocs(); }, [loadDocs]);

  // Direct upload to a document slot (the property already exists), then refresh.
  const uploadToSlot = async (
    slot: { key: string; label: string; category: string; multiple: boolean },
    files: FileList | null,
  ) => {
    const arr = files ? Array.from(files) : [];
    if (!arr.length) return;
    setDocsBusy(true);
    try {
      for (let i = 0; i < arr.length; i++) {
        const f = arr[i];
        const documentKey = slot.multiple ? `${slot.key}_${Date.now()}_${i}` : slot.key;
        await uploadOwnedDocument({
          ownerType: 'property', ownerId: property.id,
          documentKey, category: slot.category,
          displayName: f.name || slot.label, file: f,
        });
      }
      await loadDocs();
    } catch (e) {
      alert(`Upload failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setDocsBusy(false);
    }
  };

  const removeDoc = async (id: number) => {
    try {
      await apiDelete(`/documents/${id}`);
      await loadDocs();
    } catch (e) {
      alert(`Could not remove the document: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/properties/${property.id}`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setDetail(data);
      } catch { /* fall back to the passed-in property */ }
    })();
    return () => { cancelled = true; };
  }, [property.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/properties/${property.id}/media`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setPhotos(Array.isArray(data) ? data : []);
      } catch { /* no photos */ }
    })();
    return () => { cancelled = true; };
  }, [property.id]);

  // Units shown inside this popup (names + status). Base is configurable so the
  // manager portal can read them via its own scoped endpoint.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api${fetchBase}/${property.id}/units${fetchQuery ? `?${fetchQuery}` : ''}`, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // Sort by unit number naturally — the API orders by a varchar column, so
        // "11" would otherwise sort before "2". Numeric-aware compare fixes it.
        const rows: UnitLite[] = Array.isArray(data) ? data : [];
        rows.sort((a, b) => (a.unitNumber ?? '').localeCompare(b.unitNumber ?? '', undefined, { numeric: true, sensitivity: 'base' }));
        if (!cancelled) setUnits(rows);
      } catch {
        if (!cancelled) setUnits([]);
      } finally {
        if (!cancelled) setUnitsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [property.id, fetchBase, fetchQuery]);

  // Merge: prefer freshly-fetched detail (full location names) over the list row.
  const p: Property = { ...property, ...(detail ?? {}) };

  // Normalised docs for the editable slot cards (id/key/displayName/fileUrl).
  // Drop id-less records so a delete can never hit /documents/0.
  const propertyDocs: PropertyDoc[] = docs
    .filter((d) => d.id != null)
    .map((d) => ({
      id: d.id as number,
      documentKey: docKey(d),
      displayName: d.displayName ?? d.display_name ?? prettifyKey(docKey(d), d),
      fileUrl: docUrl(d) ?? '',
    }));
  // Docs not matched by any editable slot (legacy keys, or a title_deed on a
  // non-standalone property) — surfaced so the "full list" never hides a doc.
  const unmatchedDocs: PropertyDoc[] = propertyDocs.filter((d) => {
    if (d.documentKey === 'title_deed') return !p.isStandaloneUnit;
    if (d.documentKey.startsWith('building_drawing')) return false;
    return !PROPERTY_DOC_SLOTS.some((s) => docBelongsToSlot(d.documentKey, s));
  });

  // Address shows as a prominent line; the rest as tidy label/value cells.
  const addressLine = p.fullAddress?.trim() || null;
  const locCells: Array<{ label: string; value: string; mono?: boolean }> = [];
  if (p.street) locCells.push({ label: 'Street', value: p.street });
  if (p.subCommunityName) locCells.push({ label: 'Sub-community', value: p.subCommunityName });
  if (p.communityName) locCells.push({ label: 'Community', value: p.communityName });
  if (p.emirateName) locCells.push({ label: 'Emirate', value: p.emirateName });
  if (p.countryName) locCells.push({ label: 'Country', value: p.countryName });
  if (p.makaniNumber) locCells.push({ label: 'Makani', value: p.makaniNumber, mono: true });
  if (p.plotNumber) locCells.push({ label: 'Plot', value: p.plotNumber, mono: true });
  if (p.numberOfFloors) locCells.push({ label: 'Floors', value: p.numberOfFloors });

  const hasMapLink = p.latitude != null && p.longitude != null;
  const hasLocation = !!addressLine || locCells.length > 0 || hasMapLink;

  const amenities: Array<{ label: string; icon: typeof Dumbbell }> = [];
  if (p.hasGym) amenities.push({ label: 'Gym', icon: Dumbbell });
  if (p.hasPool) amenities.push({ label: 'Pool', icon: Waves });
  if (p.hasParking) amenities.push({ label: 'Parking', icon: Car });

  const vacant = stats ? Math.max(0, stats.units - stats.occupied) : 0;
  const addedOn = formatDate(p.createdAt);

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-4 border-b border-[#e8e6e0]">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-[#1a1916] truncate">
              {p.buildingName}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-[#dcfce7] text-[#166534]">
                {categoryDisplayLabel(p.spaceCategory)}
              </span>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-[#f4f3ef] text-[#6b6860]">
                {p.isStandaloneUnit ? 'One title deed (single owner)' : 'Units titled separately'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-lg hover:bg-[#f4f3ef] flex items-center justify-center shrink-0 text-[#6b6860]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body — photos on the left, details on the right */}
        <div className="overflow-auto p-5 sm:p-6">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_1fr] gap-5 items-start">

            {/* LEFT — photos (cover + thumbnails); click to enlarge. */}
            <div className="lg:sticky lg:top-0 self-start">
              {photos.length > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() => setLightbox(photos[0].url)}
                    className="relative block w-full aspect-[4/3] rounded-xl overflow-hidden border border-[#e8e6e0] group cursor-zoom-in"
                  >
                    <span className="absolute bottom-2 left-2 z-10 rounded-md bg-[#2e9f82] text-white text-[10px] font-bold px-1.5 py-0.5">COVER</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photos[0].url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                  </button>
                  {photos.length > 1 && (
                    <div className="grid grid-cols-4 gap-2 mt-2">
                      {photos.slice(1).map((ph) => (
                        <button
                          key={ph.id}
                          type="button"
                          onClick={() => setLightbox(ph.url)}
                          className="relative aspect-square rounded-lg overflow-hidden border border-[#e8e6e0] group cursor-zoom-in"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={ph.url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-[#9b9890]">
                    <ImageIcon className="w-3.5 h-3.5" /> {photos.length} photo{photos.length === 1 ? '' : 's'}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center w-full aspect-[4/3] rounded-xl border border-dashed border-[#e8e6e0] bg-[#faf9f7] text-[#c5c3bc]">
                  <ImageIcon className="w-7 h-7" />
                  <span className="text-xs mt-1.5">No photos yet</span>
                </div>
              )}
            </div>

            {/* RIGHT — details */}
            <div className="space-y-4 min-w-0">

          {/* KPI row */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="border border-[#e8e6e0] rounded-xl p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9890]">
                  Units
                </div>
                <div className="text-lg font-bold text-[#1a1916] mt-0.5">
                  {stats.units.toLocaleString('en-AE')}
                </div>
              </div>
              <div className="border border-[#e8e6e0] rounded-xl p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9890]">
                  Occupied
                </div>
                <div className="text-lg font-bold text-[#1a1916] mt-0.5">
                  {stats.occupied.toLocaleString('en-AE')}
                </div>
              </div>
              <div className="border border-[#e8e6e0] rounded-xl p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9890]">
                  Vacant
                </div>
                <div className="text-lg font-bold text-[#1a1916] mt-0.5">
                  {vacant.toLocaleString('en-AE')}
                </div>
              </div>
              <div className="border border-[#e8e6e0] rounded-xl p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9890]">
                  Annual rent
                </div>
                <div className="text-lg font-bold text-[#2e9f82] mt-0.5">
                  AED {stats.rentTotal.toLocaleString('en-AE')}
                </div>
              </div>
            </div>
          )}

          {/* Units — names + status, in the same popup. */}
          <div className="border border-[#e8e6e0] rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[#f0eeea] bg-[#faf9f7]">
              <Building2 className="w-4 h-4 text-[#2e9f82]" />
              <h3 className="text-sm font-bold text-[#1a1916]">Units</h3>
              {!unitsLoading && <span className="text-xs font-semibold text-[#9b9890]">{units.length}</span>}
            </div>
            {unitsLoading ? (
              <div className="flex items-center gap-2 px-4 py-3 text-sm text-[#9b9890]">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading units…
              </div>
            ) : units.length === 0 ? (
              <p className="px-4 py-3 text-sm text-[#9b9890]">No units yet.</p>
            ) : (
              <ul className="divide-y divide-[#f4f3ef] max-h-72 overflow-auto">
                {units.map((u) => {
                  const occ = u.availability === 'occupied';
                  const maint = u.availability === 'maintenance';
                  const pubd = u.listingStatus === 'published';
                  const pillCls = occ || pubd ? 'bg-[#dcfce7] text-[#166534]' : maint ? 'bg-[#fef3c7] text-[#854d0e]' : 'bg-[#f4f3ef] text-[#6b6860]';
                  const pillLabel = occ ? 'Occupied' : maint ? 'Maintenance' : pubd ? 'Published' : 'Available';
                  return (
                    <li key={u.id} className="flex items-center gap-2.5 px-4 py-2.5">
                      <span className="font-mono text-xs font-semibold rounded bg-[#f4f3ef] text-[#1a1916] px-1.5 py-0.5 shrink-0">{u.unitNumber}</span>
                      {u.unitName && <span className="text-sm font-medium text-[#1a1916] truncate">{u.unitName}</span>}
                      <span className="text-xs text-[#6b6860] truncate capitalize">{u.unitType.replace(/_/g, ' ')}</span>
                      <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0 ${pillCls}`}>{pillLabel}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Location */}
          {hasLocation && (
            <div className="border border-[#e8e6e0] rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-[#f0eeea] bg-[#faf9f7]">
                <MapPin className="w-4 h-4 text-[#2e9f82]" />
                <h3 className="text-sm font-bold text-[#1a1916]">Location</h3>
              </div>
              <div className="p-4">
                {addressLine && (
                  <div className="mb-4">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9890] mb-0.5">Address</div>
                    <p className="text-sm text-[#1a1916] font-medium leading-snug break-words">{addressLine}</p>
                  </div>
                )}
                {locCells.length > 0 && (
                  <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-5 gap-y-3.5">
                    {locCells.map(({ label, value, mono }) => (
                      <div key={label} className="min-w-0">
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9890]">{label}</dt>
                        <dd className={`text-sm text-[#1a1916] mt-0.5 break-words ${mono ? 'font-mono tracking-tight' : 'font-medium'}`}>
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                {hasMapLink && (
                  <a
                    href={`https://maps.google.com/?q=${p.latitude},${p.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-4 text-sm font-semibold text-[#2e9f82] hover:underline"
                  >
                    Open in Google Maps
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Amenities */}
          {amenities.length > 0 && (
            <div className="border border-[#e8e6e0] rounded-xl p-4">
              <h3 className="text-sm font-bold text-[#1a1916] mb-3">Amenities</h3>
              <div className="flex flex-wrap gap-2">
                {amenities.map(({ label, icon: Icon }) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-[#dcfce7] text-[#166534]"
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          {p.propertyDescription && (
            <div className="border border-[#e8e6e0] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlignLeft className="w-4 h-4 text-[#2e9f82]" />
                <h3 className="text-sm font-bold text-[#1a1916]">Description</h3>
              </div>
              <p className="text-sm text-[#6b6860] whitespace-pre-line">
                {p.propertyDescription}
              </p>
            </div>
          )}

          {/* Property Documents — full list. Editable = upload / replace / delete
              directly (the property exists); otherwise a read-only list. */}
          <div className="border border-[#e8e6e0] rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[#f0eeea] bg-[#faf9f7]">
              <FileText className="w-4 h-4 text-[#2e9f82] shrink-0" />
              <h3 className="text-sm font-bold text-[#1a1916]">Property Documents</h3>
              {!docsLoading && !docsError && docs.length > 0 && (
                <span className="text-xs font-semibold text-[#9b9890]">{docs.length}</span>
              )}
              {docsBusy ? (
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-[#9b9890]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…
                </span>
              ) : (!docsLoading && !docsError && docs.some((d) => docUrl(d)) && (
                <button
                  type="button"
                  onClick={() => openDocsTogether(docs.map((d) => ({ fileUrl: docUrl(d) })))}
                  className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-[#2e9f82] hover:underline shrink-0 cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Open all
                </button>
              ))}
            </div>

            <div className="p-4">
              {docsLoading ? (
                <div className="flex items-center gap-2 text-sm text-[#9b9890] py-1">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading documents…
                </div>
              ) : editable ? (
                /* Upload-capable slots — same DocSlotCard UI as the add/edit form. */
                <div className="space-y-4">
                  <div className="space-y-2.5">
                    {p.isStandaloneUnit && (
                      <DocSlotCard
                        label="Title Deed" multiple={false}
                        existing={propertyDocs.filter((d) => d.documentKey === 'title_deed')}
                        queued={[]}
                        onAdd={(files) => uploadToSlot({ key: 'title_deed', label: 'Title Deed', category: 'legal', multiple: false }, files)}
                        onRemoveQueued={() => {}}
                        onRemoveExisting={removeDoc}
                        onView={setViewerDoc}
                      />
                    )}
                    {PROPERTY_DOC_SLOTS.filter((slot) => !slot.multiple).map((slot) => (
                      <DocSlotCard
                        key={slot.key}
                        label={slot.label} multiple={false}
                        existing={propertyDocs.filter((d) => docBelongsToSlot(d.documentKey, slot))}
                        queued={[]}
                        onAdd={(files) => uploadToSlot(slot, files)}
                        onRemoveQueued={() => {}}
                        onRemoveExisting={removeDoc}
                        onView={setViewerDoc}
                      />
                    ))}
                  </div>
                  <div className="space-y-2.5">
                    <DocSlotCard
                      label="Building Floor Plans" multiple
                      existing={propertyDocs.filter((d) => d.documentKey.startsWith('building_drawing'))}
                      queued={[]}
                      onAdd={(files) => uploadToSlot({ key: 'building_drawing', label: 'Building Floor Plans', category: 'property', multiple: true }, files)}
                      onRemoveQueued={() => {}}
                      onRemoveExisting={removeDoc}
                      onView={setViewerDoc}
                    />
                    {PROPERTY_DOC_SLOTS.filter((slot) => slot.multiple).map((slot) => (
                      <DocSlotCard
                        key={slot.key}
                        label={slot.label} multiple
                        existing={propertyDocs.filter((d) => docBelongsToSlot(d.documentKey, slot))}
                        queued={[]}
                        onAdd={(files) => uploadToSlot(slot, files)}
                        onRemoveQueued={() => {}}
                        onRemoveExisting={removeDoc}
                        onView={setViewerDoc}
                      />
                    ))}
                  </div>

                  {unmatchedDocs.length > 0 && (
                    <div className="space-y-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#b6b3ab]">Other documents on file</p>
                      <div className="rounded-lg border border-[#e8e6e0] divide-y divide-[#f4f3ef]">
                        {unmatchedDocs.map((d) => (
                          <div key={d.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                            <FileText size={13} className="text-[#2e9f82] shrink-0" />
                            <span className="truncate flex-1 text-[#44423c]">{d.displayName || 'Document'}</span>
                            {d.fileUrl && (
                              <button type="button" onClick={() => setViewerDoc({ url: d.fileUrl, name: d.displayName || 'Document' })}
                                className="text-[#2e9f82] font-medium hover:underline shrink-0">View</button>
                            )}
                            <button type="button" onClick={() => removeDoc(d.id)} title="Remove"
                              className="w-5 h-5 rounded-full bg-[#f4f3ef] grid place-items-center text-[#9b9890] hover:text-[#b91c1c] shrink-0"><Trash2 size={11} /></button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : docsError ? (
                <p className="text-sm text-[#9b9890] py-1">Could not load documents.</p>
              ) : docs.length === 0 ? (
                <p className="text-sm text-[#9b9890] py-1">No documents uploaded yet.</p>
              ) : (
                <ul className="divide-y divide-[#f4f3ef]">
                  {docs.map((d, i) => {
                    const url = docUrl(d);
                    return (
                      <li key={d.id ?? `${docKey(d)}-${i}`} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                        <FileText className="w-4 h-4 text-[#9b9890] shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-[#1a1916] truncate">{prettifyKey(docKey(d), d)}</div>
                        </div>
                        {url && (
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-[#2e9f82] hover:underline shrink-0">
                            Open <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        {addedOn && (
          <div className="flex items-center gap-3 px-5 sm:px-6 py-4 border-t border-[#e8e6e0]">
            <span className="text-xs text-[#9b9890]">Added {addedOn}</span>
          </div>
        )}
      </div>
    </div>

    {/* Lightbox — full-screen enlarged photo */}
    {lightbox && (
      <div
        className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-4 cursor-zoom-out"
        onClick={() => setLightbox(null)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={lightbox} alt="" className="max-w-full max-h-full object-contain rounded-lg" />
        <button
          type="button"
          onClick={() => setLightbox(null)}
          aria-label="Close"
          className="absolute top-4 right-4 w-9 h-9 rounded-lg bg-black/50 hover:bg-black/70 text-white flex items-center justify-center"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    )}

    {/* In-app document preview ("View") */}
    {viewerDoc && (
      <DocPreviewModal
        title={viewerDoc.name}
        docs={[{ id: 1, fileUrl: viewerDoc.url, mimeType: viewerDoc.mime ?? null, caption: viewerDoc.name }]}
        onClose={() => setViewerDoc(null)}
      />
    )}
    </>
  );
}
