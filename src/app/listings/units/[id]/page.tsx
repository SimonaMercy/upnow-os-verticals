import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import ListingPageClient, { type PublicUnit, type PublicProperty, type UnitMediaItem } from './ListingPageClient';

const BACKEND = process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface ListingPayload {
  unit: PublicUnit;
  property: PublicProperty;
  media: UnitMediaItem[];
  preferredStartDays?: number[];
  allowedInstallments?: number[];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const res = await fetch(`${BACKEND}/listings/units/${id}`, { cache: 'no-store' });
    if (!res.ok) return { title: 'Listing Not Found — UpNow' };
    const { unit, property }: ListingPayload = await res.json();
    const label = unit.unitName ?? `Unit ${unit.unitNumber}`;
    return {
      title: `${label} at ${property.buildingName} — UpNow`,
      description: unit.description ?? property.propertyDescription ?? undefined,
    };
  } catch {
    return { title: 'UpNow Listing' };
  }
}

export default async function PublicUnitListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let payload: ListingPayload;
  try {
    const res = await fetch(`${BACKEND}/listings/units/${id}`, { cache: 'no-store' });
    if (!res.ok) return notFound();
    payload = await res.json();
  } catch {
    return notFound();
  }

  return <ListingPageClient unit={payload.unit} property={payload.property} media={payload.media ?? []} preferredStartDays={payload.preferredStartDays ?? []} allowedInstallments={payload.allowedInstallments ?? []} />;
}
