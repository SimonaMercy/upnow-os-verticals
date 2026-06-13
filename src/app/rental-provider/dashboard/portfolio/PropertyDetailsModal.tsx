'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
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
} from 'lucide-react';

interface Property {
  id: number;
  buildingName: string;
  spaceCategory: string;
  fullAddress: string | null;
  emirateName: string | null;
  communityName: string | null;
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

function docDate(d: DocRecord): string | null {
  return d.createdAt ?? d.created_at ?? null;
}

function prettifyKey(key: string, d: DocRecord): string {
  const display = d.displayName ?? d.display_name;
  if (display) return display;
  if (key === 'building_documents') return 'Building documents / Title deed';
  if (key === 'site_plan') return 'Site plan';
  if (!key) return d.fileName ?? d.file_name ?? 'Document';
  const words = key.replace(/_/g, ' ').trim();
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
    return () => {
      cancelled = true;
    };
  }, [property.id]);

  const locationRows: Array<[string, string]> = [];
  if (property.fullAddress) locationRows.push(['Address', property.fullAddress]);
  if (property.street) locationRows.push(['Street', property.street]);
  if (property.communityName) locationRows.push(['Community', property.communityName]);
  if (property.emirateName) locationRows.push(['Emirate', property.emirateName]);
  if (property.makaniNumber) locationRows.push(['Makani', property.makaniNumber]);
  if (property.plotNumber) locationRows.push(['Plot', property.plotNumber]);
  if (property.numberOfFloors) locationRows.push(['Floors', property.numberOfFloors]);

  const hasMapLink = property.latitude != null && property.longitude != null;
  const hasLocation = locationRows.length > 0 || hasMapLink;

  const amenities: Array<{ label: string; icon: typeof Dumbbell }> = [];
  if (property.hasGym) amenities.push({ label: 'Gym', icon: Dumbbell });
  if (property.hasPool) amenities.push({ label: 'Pool', icon: Waves });
  if (property.hasParking) amenities.push({ label: 'Parking', icon: Car });

  const vacant = stats ? Math.max(0, stats.units - stats.occupied) : 0;
  const addedOn = formatDate(property.createdAt);

  return (
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
              {property.buildingName}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-[#dcfce7] text-[#166534]">
                {property.spaceCategory}
              </span>
              {property.isStandaloneUnit && (
                <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-[#f4f3ef] text-[#6b6860]">
                  Standalone unit
                </span>
              )}
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
            <div className="border border-[#e8e6e0] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <MapPin className="w-4 h-4 text-[#2e9f82]" />
                <h3 className="text-sm font-bold text-[#1a1916]">Location</h3>
              </div>
              {locationRows.length > 0 && (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                  {locationRows.map(([label, value]) => (
                    <div key={label} className="flex gap-2 text-sm min-w-0">
                      <dt className="text-[#9b9890] shrink-0 w-20">{label}</dt>
                      <dd className="text-[#1a1916] font-medium break-words min-w-0">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {hasMapLink && (
                <a
                  href={`https://maps.google.com/?q=${property.latitude},${property.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mt-3 text-sm font-semibold text-[#2e9f82] hover:underline"
                >
                  Open in Google Maps
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
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
          {property.propertyDescription && (
            <div className="border border-[#e8e6e0] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlignLeft className="w-4 h-4 text-[#2e9f82]" />
                <h3 className="text-sm font-bold text-[#1a1916]">Description</h3>
              </div>
              <p className="text-sm text-[#6b6860] whitespace-pre-line">
                {property.propertyDescription}
              </p>
            </div>
          )}

          {/* Documents */}
          <div className="border border-[#e8e6e0] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-[#2e9f82]" />
              <h3 className="text-sm font-bold text-[#1a1916]">Documents</h3>
            </div>
            {docsLoading ? (
              <div className="flex items-center gap-2 text-sm text-[#9b9890] py-2">
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
                  const uploaded = formatDate(docDate(d));
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
                        {uploaded && (
                          <div className="text-xs text-[#9b9890]">
                            Uploaded {uploaded}
                          </div>
                        )}
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
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-t border-[#e8e6e0]">
          {addedOn ? (
            <span className="text-xs text-[#9b9890]">Added {addedOn}</span>
          ) : (
            <span />
          )}
          <Link
            href={`/rental-provider/dashboard/portfolio/${property.id}`}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#2e9f82] hover:underline"
          >
            Open full page
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
