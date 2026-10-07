'use client';

/** RP → one building visit (0383). */
import { useParams } from 'next/navigation';
import { BuildingInspectionVisit } from '@/components/upnow/BuildingInspectionVisit';

export default function BuildingInspectionVisitPage() {
  const { id } = useParams<{ id: string }>();
  return <BuildingInspectionVisit id={Number(id)} />;
}
