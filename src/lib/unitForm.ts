/**
 * Shared unit-form glue.
 *
 * Extracted from the portfolio page so the Units page (the new home for unit
 * management) can add/edit units without duplicating the form ↔ DTO mapping or
 * the post-save side-effects (floor-plan / title-deed / addendum uploads).
 */
import { apiPost, apiPatch } from '@/lib/api';
import { uploadOwnedDocument } from '@/lib/uploadOwnedDocument';
import type { UnitFormData } from '@/components/upnow/UnitFormModal';

// Unit row as returned by GET /properties/:id/units (and units/all).
export interface UnitRecord {
  id: number;
  propertyId: number;
  unitNumber: string;
  unitName: string | null;
  unitType: string;
  unitTier: string;
  floor: string | null;
  premiseNumber: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parkingSpaces: number | null;
  unitSizeSqft: number | null;
  unitSizeSqm: number | null;
  view: string | null;
  furnishing: string | null;
  facilities: string | null;
  rentalPrice: number | null;
  marketPrice: number | null;
  securityDeposit: number | null;
  adminFee: number | null;
  ejariFeeFils: number | null;
  commission: number | null;
  serviceCharges: number | null;
  availability: string;
  description: string | null;
  isListed: boolean;
  listingStatus: 'draft' | 'pending' | 'in_review' | 'published' | 'expired' | 'rejected';
  planLabel?: string | null;
  floorPlanUrl?: string | null;
}

// ─── facilities JSON readers ──────────────────────────────
export function amenitiesFromUnit(unit: { facilities: string | null }): string[] {
  if (!unit.facilities) return [];
  try {
    const parsed = JSON.parse(unit.facilities);
    if (Array.isArray(parsed)) return parsed as string[];
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.amenities)) return parsed.amenities as string[];
    return [];
  } catch { return []; }
}

export function leaseTermsFromUnit(unit: { facilities: string | null }): {
  minLeaseMonths: string; noticePeriodDays: string; rentEscalationPct: string;
  rentalType: string; numberOfPayments: string; advancePayment: string;
  gracePeriodDays: string; latePaymentFee: string; specialConditions: string;
} {
  const empty = {
    minLeaseMonths: '', noticePeriodDays: '', rentEscalationPct: '',
    rentalType: 'yearly', numberOfPayments: '', advancePayment: '',
    gracePeriodDays: '', latePaymentFee: '', specialConditions: '',
  };
  if (!unit.facilities) return empty;
  try {
    const parsed = JSON.parse(unit.facilities);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return empty;
    const lt = (parsed as { leaseTerms?: Record<string, number | string> }).leaseTerms ?? {};
    const s = (v: number | string | undefined) => (v != null && v !== '' ? String(v) : '');
    return {
      minLeaseMonths:    s(lt.minLeaseMonths),
      noticePeriodDays:  s(lt.noticePeriodDays),
      rentEscalationPct: s(lt.rentEscalationPct),
      rentalType:        lt.rentalType != null && lt.rentalType !== '' ? String(lt.rentalType) : 'yearly',
      numberOfPayments:  s(lt.numberOfPayments),
      advancePayment:    s(lt.advancePayment),
      gracePeriodDays:   s(lt.gracePeriodDays),
      latePaymentFee:    s(lt.latePaymentFee),
      specialConditions: s(lt.specialConditions),
    };
  } catch { return empty; }
}

// ─── form ↔ DTO ───────────────────────────────────────────
export function unitFormToDto(data: UnitFormData) {
  // Empty string means "cleared" — PATCH an explicit null so the backend
  // actually clears the column (undefined would silently keep the old value).
  const clearable = (v: string) => (v ? v : null);
  const num = (v: string) => {
    if (!v) return null;
    const n = Number(v.replace('+', '')); // '6+' bedrooms / '5+' bathrooms
    return Number.isNaN(n) ? null : n;
  };
  return {
    unitNumber: data.unitNumber,
    unitName: clearable(data.unitName),
    unitType: data.unitType,
    unitTier: data.unitTier || 'standard',
    floor: clearable(data.floor),
    premiseNumber: clearable(data.premiseNumber),
    unitSizeSqft: num(data.unitSizeSqft) ?? undefined,
    unitSizeSqm: num(data.unitSizeSqm) ?? undefined,
    bedrooms: data.bedrooms === 'Studio' ? null : num(data.bedrooms) ?? undefined,
    bathrooms: num(data.bathrooms) ?? undefined,
    parkingSpaces: num(data.parkingSpaces) ?? undefined,
    amenities: data.amenities, // empty array clears amenities (kept lease terms are merged server-side)
    view: clearable(data.view),
    furnishing: clearable(data.furnishing),
    rentalPrice: data.rentalPrice ? Number(data.rentalPrice) : undefined,
    marketPrice: num(data.marketPrice),
    securityDeposit: data.securityDeposit ? Number(data.securityDeposit) : undefined,
    adminFee: data.adminFee ? Number(data.adminFee) : undefined,
    ejariFeeFils: data.ejariFeeFils ? Number(data.ejariFeeFils) : undefined,
    commission: data.commission ? Number(data.commission) : undefined,
    serviceCharges: num(data.serviceCharges),
    minLeaseMonths: data.minLeaseMonths ? Number(data.minLeaseMonths) : undefined,
    noticePeriodDays: data.noticePeriodDays ? Number(data.noticePeriodDays) : undefined,
    rentEscalationPct: data.rentEscalationPct ? Number(data.rentEscalationPct) : undefined,
    rentalType: data.rentalType || undefined,
    numberOfPayments: data.numberOfPayments ? Number(data.numberOfPayments) : undefined,
    advancePayment: data.advancePayment ? Number(data.advancePayment) : undefined,
    gracePeriodDays: data.gracePeriodDays ? Number(data.gracePeriodDays) : undefined,
    latePaymentFee: data.latePaymentFee ? Number(data.latePaymentFee) : undefined,
    specialConditions: clearable(data.specialConditions),
    description: clearable(data.description),
  };
}

// Build the UnitFormModal `initial` from an existing unit record (edit mode).
export function unitToFormInitial(u: UnitRecord): UnitFormData {
  return {
    unitNumber:       u.unitNumber,
    unitName:         u.unitName ?? '',
    unitType:         u.unitType,
    unitTier:         u.unitTier,
    floor:            u.floor ?? '',
    premiseNumber:    u.premiseNumber ?? '',
    bedrooms:         u.bedrooms != null ? String(u.bedrooms) : 'Studio',
    bathrooms:        u.bathrooms != null ? String(u.bathrooms) : '1',
    parkingSpaces:    u.parkingSpaces != null ? String(u.parkingSpaces) : '',
    unitSizeSqft:     u.unitSizeSqft != null ? String(u.unitSizeSqft) : '',
    unitSizeSqm:      u.unitSizeSqm != null ? String(u.unitSizeSqm) : '',
    view:             u.view ?? '',
    furnishing:       u.furnishing ?? 'Unfurnished',
    amenities:        amenitiesFromUnit(u),
    rentalPrice:      u.rentalPrice != null ? String(u.rentalPrice) : '',
    marketPrice:      u.marketPrice != null ? String(u.marketPrice) : '',
    securityDeposit:  u.securityDeposit != null ? String(u.securityDeposit) : '',
    adminFee:         u.adminFee != null ? String(u.adminFee) : '',
    ejariFeeFils:     u.ejariFeeFils != null ? String(u.ejariFeeFils) : '',
    commission:       u.commission != null ? String(u.commission) : '',
    serviceCharges:   u.serviceCharges != null ? String(u.serviceCharges) : '',
    ...leaseTermsFromUnit(u),
    description:      u.description ?? '',
  };
}

// ─── create / update + post-save uploads ──────────────────
// Mirrors the portfolio handleSaveUnit side-effects. Returns the saved unit.
// Upload failures are non-fatal (the unit itself is saved) and surfaced via alert.
export async function saveUnit(opts: {
  propertyId: number;
  editingUnitId?: number;
  data: UnitFormData;
  floorPlan?: File | null;
  titleDeed?: File | null;
  addendums?: File[];
  propertyStandalone?: boolean;
}): Promise<UnitRecord> {
  const { propertyId, editingUnitId, data, floorPlan, titleDeed, addendums, propertyStandalone } = opts;
  const dto = unitFormToDto(data);
  const saved = editingUnitId
    ? await apiPatch<UnitRecord>(`/properties/${propertyId}/units/${editingUnitId}`, dto)
    : await apiPost<UnitRecord>(`/properties/${propertyId}/units`, dto);

  if (floorPlan && saved?.id) {
    try {
      const fd = new FormData();
      fd.append('file', floorPlan);
      const res = await fetch(`/api/properties/${propertyId}/units/${saved.id}/floor-plan`, {
        method: 'POST', credentials: 'include', body: fd,
      });
      if (!res.ok) throw new Error();
    } catch {
      // non-fatal: the unit saved; only the floor-plan upload failed
    }
  }
  // Per-unit title deed (multi-unit buildings only — standalone deeds live at
  // property level). Skip the upload when the property is standalone.
  if (titleDeed && saved?.id && propertyStandalone !== true) {
    try {
      await uploadOwnedDocument({
        ownerType: 'unit', ownerId: saved.id,
        documentKey: 'title_deed', category: 'legal',
        displayName: `Title deed — Unit ${data.unitNumber || saved.id}`, file: titleDeed,
      });
    } catch (e) {
      alert(`The unit was saved, but the title deed upload failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  }
  // Addendum / amendment files — one document per file under the unit.
  if (addendums?.length && saved?.id) {
    for (let i = 0; i < addendums.length; i++) {
      try {
        await uploadOwnedDocument({
          ownerType: 'unit', ownerId: saved.id,
          documentKey: `addendum_${Date.now()}_${i}`, category: 'legal',
          displayName: addendums[i].name, file: addendums[i],
        });
      } catch (e) {
        alert(`The unit was saved, but an addendum upload failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    }
  }
  return saved;
}
