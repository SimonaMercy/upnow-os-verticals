'use client';

import { useParams } from 'next/navigation';
import { BuildingInspectionReport } from '@/components/upnow/BuildingInspectionReport';
import { ManagerBuildingInspectionsGate } from '../../_gate';

export default function ManagerBuildingInspectionReportPage() {
  const { id } = useParams<{ id: string }>();
  return <ManagerBuildingInspectionsGate>{(rp) => <BuildingInspectionReport id={Number(id)} manager={{ rp }} />}</ManagerBuildingInspectionsGate>;
}
