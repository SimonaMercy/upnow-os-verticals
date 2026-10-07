'use client';

import { BuildingInspectionsIndex } from '@/components/upnow/BuildingInspectionsIndex';
import { ManagerBuildingInspectionsGate } from './_gate';

export default function ManagerBuildingInspectionsPage() {
  return <ManagerBuildingInspectionsGate>{(rp) => <BuildingInspectionsIndex manager={{ rp }} />}</ManagerBuildingInspectionsGate>;
}
