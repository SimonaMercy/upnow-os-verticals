'use client';

/** RP → printable building inspection report (0383). */
import { useParams } from 'next/navigation';
import { BuildingInspectionReport } from '@/components/upnow/BuildingInspectionReport';

export default function BuildingInspectionReportPage() {
  const { id } = useParams<{ id: string }>();
  return <BuildingInspectionReport id={Number(id)} />;
}
