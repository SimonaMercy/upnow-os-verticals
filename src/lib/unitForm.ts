/**
 * Shared unit-form glue.
 *
 * Extracted from the portfolio page so the Units page (the new home for unit
 * management) can add/edit units without duplicating the form ↔ DTO mapping or
 * the post-save side-effects (floor-plan / title-deed / addendum uploads).
 */
import { apiPost, apiPatch } from '@/lib/api';
import { uploadOwnedDocument } from '@/lib/uploadOwnedDocument';
import { isResidentialUnitType, unitHasBathrooms } from '@/lib/unitTaxonomy';
import type { UnitFormData } from '@/components/upnow/UnitFormModal';

// Sub-lease charge line items — persisted as two regular `additionalPayments`
// rows so the customer / contract picks them up like any other charge, but the
// unit editor recognises these exact labels to present them as a single
// auto-synced toggle (20% of Market Price + 5% VAT on that 20%). Only offered
// for sub-lease properties, and fully optional (not every landlord applies it).
//
// The net line names the levy for what it is — the head lessor's percentage of
// the lease — rather than "Sub-lease charge (20%)", which read as a fee. These
// are the terms every store now holds (migration 0186 renamed the 28 units and
// 38 payment rows); changing one without the other would strand the toggle,
// since the match below is by exact string.
export const SUBLEASE_NET_LABEL = '20% on sub-lease';
export const SUBLEASE_VAT_LABEL = '5% VAT on sub-lease';
export const isSubleaseChargeRow = (label: string) =>
  label === SUBLEASE_NET_LABEL || label === SUBLEASE_VAT_LABEL;

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
  sewerageNumber: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parkingSpaces: number | null;
  unitSizeSqft: number | null;
  unitSizeSqm: number | null;
  view: string | null;
  furnishing: string | null;
  facilities: string | null;
  rentalPrice: number | null;
  // Contracted Annual Rent — annual_rent of the unit's latest lease (portfolio
  // canonical rule); null when never leased. Read-only, set server-side.
  lastLeaseRent?: number | null;
  // Annual Rent as the portfolio shows it — annual_rent of the lease counting as
  // current income: running today, or the next term whose cheques are already
  // collected. Null when neither exists. Read-only, set server-side.
  currentLeaseRent?: number | null;
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

/** RP-defined extra one-off charges stored in the unit's facilities JSON, as the
 *  form's string-rows. Empty / malformed ⇒ []. */
export function additionalPaymentsFromUnit(unit: { facilities: string | null }): Array<{ label: string; amount: string; vat: string }> {
  if (!unit.facilities) return [];
  try {
    const parsed = JSON.parse(unit.facilities);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return [];
    const list = (parsed as { additionalPayments?: Array<{ label?: string; amount?: number; vat?: number }> }).additionalPayments;
    if (!Array.isArray(list)) return [];
    return list.map(p => ({
      label: String(p?.label ?? ''),
      amount: p?.amount != null ? String(p.amount) : '',
      vat: p?.vat ? String(p.vat) : '',
    }));
  } catch { return []; }
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
  // The form HIDES residential-only fields for commercial / industrial / land
  // units, but the EMPTY_UNIT defaults ('1' beds, '1' baths, 'Unfurnished')
  // would otherwise still be submitted — silently writing phantom values on
  // every non-residential unit. Force them out (explicit null so a PATCH also
  // clears any legacy phantom value):
  //  - bedrooms / furnishing → residential-only (a shop has neither)
  //  - bathrooms → washrooms, kept for any built space, dropped only for land
  const residential = isResidentialUnitType(data.unitType);
  const hasBathrooms = unitHasBathrooms(data.unitType);
  return {
    unitNumber: data.unitNumber,
    unitName: clearable(data.unitName),
    unitType: data.unitType,
    unitTier: data.unitTier || 'standard',
    floor: clearable(data.floor),
    premiseNumber: clearable(data.premiseNumber),
    sewerageNumber: clearable(data.sewerageNumber),
    unitSizeSqft: num(data.unitSizeSqft) ?? undefined,
    unitSizeSqm: num(data.unitSizeSqm) ?? undefined,
    bedrooms: !residential ? null : data.bedrooms === 'Studio' ? null : num(data.bedrooms) ?? undefined,
    bathrooms: !hasBathrooms ? null : num(data.bathrooms) ?? undefined,
    parkingSpaces: num(data.parkingSpaces) ?? undefined,
    amenities: data.amenities, // empty array clears amenities (kept lease terms are merged server-side)
    view: clearable(data.view),
    // Furnished-state is residential-only — null it (not the 'Unfurnished'
    // default) for a shop / warehouse / plot, which the form hides anyway.
    furnishing: residential ? clearable(data.furnishing) : null,
    rentalPrice: data.rentalPrice ? Number(data.rentalPrice) : undefined,
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
    // Always sent (even []) so the editor can add / edit / clear the list; the
    // backend replaces the stored list with this one. Blank / zero rows dropped.
    additionalPayments: (data.additionalPayments ?? [])
      .map(p => ({ label: p.label.trim(), amount: Number(p.amount) || 0, vat: p.vat ? Number(p.vat) : 0 }))
      .filter(p => p.label !== '' && p.amount > 0),
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
    sewerageNumber:   u.sewerageNumber ?? '',
    bedrooms:         u.bedrooms != null ? String(u.bedrooms) : 'Studio',
    bathrooms:        u.bathrooms != null ? String(u.bathrooms) : '1',
    parkingSpaces:    u.parkingSpaces != null ? String(u.parkingSpaces) : '',
    unitSizeSqft:     u.unitSizeSqft != null ? String(u.unitSizeSqft) : '',
    unitSizeSqm:      u.unitSizeSqm != null ? String(u.unitSizeSqm) : '',
    view:             u.view ?? '',
    furnishing:       u.furnishing ?? 'Unfurnished',
    amenities:        amenitiesFromUnit(u),
    rentalPrice:      u.rentalPrice != null ? String(u.rentalPrice) : '',
    securityDeposit:  u.securityDeposit != null ? String(u.securityDeposit) : '',
    adminFee:         u.adminFee != null ? String(u.adminFee) : '',
    ejariFeeFils:     u.ejariFeeFils != null ? String(u.ejariFeeFils) : '',
    commission:       u.commission != null ? String(u.commission) : '',
    serviceCharges:   u.serviceCharges != null ? String(u.serviceCharges) : '',
    ...leaseTermsFromUnit(u),
    // Split the sub-lease charge rows out of the editable list — the editor
    // shows them as the auto-synced "Sub-lease charge" toggle instead, and
    // re-materialises them on save. Everything else stays a plain editable row.
    additionalPayments: additionalPaymentsFromUnit(u).filter(p => !isSubleaseChargeRow(p.label)),
    subleaseCharge:  additionalPaymentsFromUnit(u).some(p => p.label === SUBLEASE_NET_LABEL),
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
  // Manager portal: route create/update + floor-plan through the landlord-scoped
  // /manager endpoints (gated by the manager's permissions for that landlord).
  manager?: { rp: number };
}): Promise<UnitRecord> {
  const { propertyId, editingUnitId, data, floorPlan, titleDeed, addendums, propertyStandalone, manager } = opts;
  const dto = unitFormToDto(data);
  const unitBase = manager ? `/manager/properties/${propertyId}/units` : `/properties/${propertyId}/units`;
  const mgrQ = manager ? `?rp=${manager.rp}` : '';
  const saved = editingUnitId
    ? await apiPatch<UnitRecord>(`${unitBase}/${editingUnitId}${mgrQ}`, dto)
    : await apiPost<UnitRecord>(`${unitBase}${mgrQ}`, dto);

  if (floorPlan && saved?.id) {
    try {
      const fd = new FormData();
      fd.append('file', floorPlan);
      const fpUrl = manager
        ? `/api/manager/properties/${propertyId}/units/${saved.id}/floor-plan?rp=${manager.rp}`
        : `/api/properties/${propertyId}/units/${saved.id}/floor-plan`;
      const res = await fetch(fpUrl, {
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

/**
 * Apply physical unit details to EVERY unit on a layout — the "Edit layout" bulk
 * editor. Sends ONLY the physical fields (type/tier, beds/baths, size, view,
 * furnishing, parking, amenities, description) — never the per-unit identifiers
 * (unit number, premises no., floor) or the money / lease fields (owned by the
 * plan Price editor). An optional floor plan is applied to the whole layout via
 * the existing layout-image endpoint.
 */
export async function saveLayoutDetails(opts: {
  propertyId: number;
  planLabel: string;
  data: UnitFormData;
  floorPlan?: File | null;
  manager?: { rp: number };
}): Promise<void> {
  const { propertyId, planLabel, data, floorPlan, manager } = opts;
  // Every unit field EXCEPT the per-unit identifiers (those stay per-unit).
  const dto = unitFormToDto(data) as Record<string, unknown>;
  delete dto.unitNumber;
  delete dto.premiseNumber;
  delete dto.sewerageNumber;
  delete dto.floor;
  const body = { propertyId, planLabel, ...dto };
  const rpQ = manager ? `?rp=${manager.rp}` : '';
  await apiPatch(manager ? `/manager/units/details${rpQ}` : '/properties/floor-plans/details', body);
  // One floor plan for the whole layout (reuses the existing layout-image endpoint).
  if (floorPlan) {
    const fd = new FormData();
    fd.append('file', floorPlan);
    fd.append('propertyId', String(propertyId));
    fd.append('planLabel', planLabel);
    await fetch(manager ? `/api/manager/units/image${rpQ}` : '/api/properties/floor-plans/image',
      { method: 'POST', credentials: 'include', body: fd });
  }
}
