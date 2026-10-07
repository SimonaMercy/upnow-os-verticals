'use client';

import { useParams } from 'next/navigation';
import { BuildingInspectionVisit } from '@/components/upnow/BuildingInspectionVisit';
import { ManagerBuildingInspectionsGate } from '../_gate';

export default function ManagerBuildingInspectionVisitPage() {
  const { id } = useParams<{ id: string }>();
  return <ManagerBuildingInspectionsGate>{(rp) => <BuildingInspectionVisit id={Number(id)} manager={{ rp }} />}</ManagerBuildingInspectionsGate>;
}
