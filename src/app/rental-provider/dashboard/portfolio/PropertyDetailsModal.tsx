'use client';

import { useEffect, useState } from 'react';
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
  ChevronDown,
  Image as ImageIcon,
} from 'lucide-react';

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
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function PropertyDetailsModal({
  property,
  stats,
  onClose,
}: {
  property: Property;
  stats?: { units: number; occupied: number; rentTotal: number } | null;
  onClose: () => void;
}) {
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState(false);
  // Full property detail (the list object lacks the structured location names);
  // fetched on open and merged over the passed-in property.
  const [detail, setDetail] = useState<Partial<Property> | null>(null);
  // Documents is a collapsible tab (collapsed by default).
  const [docsOpen, setDocsOpen] = useState(false);
  // Building photos (read-only gallery) + click-to-enlarge lightbox.
  const [photos, setPhotos] = useState<{ id: number; url: string }[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/documents?ownerType=property&ownerId=${property.id}`,
          { credentials: 'include' },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setDocs(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setDocsError(true);
      } finally {
        if (!cancelled) setDocsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [property.id]);

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

  // Merge: prefer freshly-fetched detail (full location names) over the list row.
  const p: Property = { ...property, ...(detail ?? {}) };

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
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-4 border-b border-[#e8e6e0]">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-[#1a1916] truncate">
              {p.buildingName}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-[#dcfce7] text-[#166534] capitalize">
                {p.spaceCategory}
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

        {/* Body */}
        <div className="overflow-auto p-5 sm:p-6 space-y-4">
          {/* Photos — read-only gallery; click to enlarge. Cover (first) is larger. */}
          {photos.length > 0 && (
            <div className="border border-[#e8e6e0] rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-[#f0eeea] bg-[#faf9f7]">
                <ImageIcon className="w-4 h-4 text-[#2e9f82]" />
                <h3 className="text-sm font-bold text-[#1a1916]">Photos</h3>
                <span className="text-xs font-semibold text-[#9b9890]">{photos.length}</span>
              </div>
              <div className="p-4 grid grid-cols-3 sm:grid-cols-4 gap-2">
                {photos.map((ph, i) => (
                  <button
                    key={ph.id}
                    type="button"
                    onClick={() => setLightbox(ph.url)}
                    className={`relative aspect-square rounded-lg overflow-hidden border group cursor-zoom-in
                      ${i === 0 ? 'border-[#2e9f82]' : 'border-[#e8e6e0]'}`}
                  >
                    {i === 0 && (
                      <span className="absolute bottom-0 left-0 right-0 bg-[#2e9f82] text-white text-[9px] font-bold text-center py-0.5 z-10 leading-tight">
                        COVER
                      </span>
                    )}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={ph.url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                  </button>
                ))}
              </div>
            </div>
          )}

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

          {/* Documents — collapsible tab */}
          <div className="border border-[#e8e6e0] rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[#f0eeea] bg-[#faf9f7]">
              <button
                type="button"
                onClick={() => setDocsOpen((o) => !o)}
                className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer"
                aria-expanded={docsOpen}
              >
                <FileText className="w-4 h-4 text-[#2e9f82] shrink-0" />
                <h3 className="text-sm font-bold text-[#1a1916]">Property Documents</h3>
                {!docsLoading && !docsError && docs.length > 0 && (
                  <span className="text-xs font-semibold text-[#9b9890]">{docs.length}</span>
                )}
                <ChevronDown
                  className={`w-4 h-4 text-[#9b9890] ml-auto transition-transform ${docsOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {!docsLoading && !docsError && docs.some((d) => docUrl(d)) && (
                <button
                  type="button"
                  onClick={() => openDocsTogether(docs.map((d) => ({ fileUrl: docUrl(d) })))}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#2e9f82] hover:underline shrink-0 cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> View all
                </button>
              )}
            </div>
            {docsOpen && (
              <div className="p-4">
                {docsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-[#9b9890] py-1">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading documents…
                  </div>
                ) : docsError ? (
                  <p className="text-sm text-[#9b9890] py-1">
                    Could not load documents.
                  </p>
                ) : docs.length === 0 ? (
                  <p className="text-sm text-[#9b9890] py-1">
                    No documents uploaded — add the title deed from the property
                    edit form.
                  </p>
                ) : (
                  <ul className="divide-y divide-[#f4f3ef]">
                    {docs.map((d, i) => {
                      const url = docUrl(d);
                      return (
                        <li
                          key={d.id ?? `${docKey(d)}-${i}`}
                          className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                        >
                          <FileText className="w-4 h-4 text-[#9b9890] shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-[#1a1916] truncate">
                              {prettifyKey(docKey(d), d)}
                            </div>
                          </div>
                          {url && (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-sm font-semibold text-[#2e9f82] hover:underline shrink-0"
                            >
                              Open
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
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
    </>
  );
}
