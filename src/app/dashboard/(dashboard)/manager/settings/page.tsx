'use client';

/**
 * Manager → Settings — the same grouped menu the landlord has, holding only what a
 * manager can be delegated: maintenance coverage and items, the restoration list,
 * and the AMC categories. Each entry shows only when the selected landlord has
 * granted that permission (owner, 12 Sep: the lists should not sit in the sidebar).
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Lock, Building2, Wrench, ClipboardList, ClipboardCheck, Receipt, FileSignature, BellRing } from 'lucide-react';
import { useManagerLandlordScope } from '@/components/dashboard/managerLandlordScope';
import { MaintenanceCoveragePanel } from '@/components/dashboard/rp/MaintenanceCoveragePanel';
import { MaintenanceListWorkspace } from '@/app/rental-provider/dashboard/maintenance-list/page';
import { RestorationListWorkspace } from '@/app/rental-provider/dashboard/restoration-list/page';
import { AmcCategoriesView } from '@/components/amc/AmcCategoriesView';
import { BuildingInspectionsSettings } from '@/components/upnow/BuildingInspectionsSettings';
import { BrowserAlertsCard } from '@/components/dashboard/BrowserAlertsCard';
import { useWhatsappEnabled } from '@/lib/useWhatsappEnabled';

type Tab = 'maintenance' | 'maintenance_list' | 'restoration' | 'building_inspections' | 'categories' | 'browser_alerts';
type Flag = 'canManageMaintenance' | 'canManageInspections' | 'canManageAmc' | 'canReadEmails' | 'canReadWhatsapp';
// `flag`: one permission, or any of several (browser alerts: either channel the landlord lets them read).
const TABS: { key: Tab; label: string; flag: Flag | Flag[]; Icon: React.ComponentType<{ size?: number }> }[] = [
  { key: 'maintenance', label: 'Coverage', flag: 'canManageMaintenance', Icon: Wrench },
  { key: 'maintenance_list', label: 'Items', flag: 'canManageMaintenance', Icon: ClipboardList },
  { key: 'restoration', label: 'Restoration list', flag: 'canManageInspections', Icon: Receipt },
  { key: 'building_inspections', label: 'Building inspections', flag: 'canManageInspections', Icon: ClipboardCheck },
  { key: 'categories', label: 'AMC categories', flag: 'canManageAmc', Icon: FileSignature },
  { key: 'browser_alerts', label: 'Browser alerts', flag: ['canReadEmails', 'canReadWhatsapp'], Icon: BellRing },
];
const MENU: { title: string; tabs: Tab[] }[] = [
  { title: 'Maintenance', tabs: ['maintenance', 'maintenance_list', 'restoration'] },
  { title: 'Buildings', tabs: ['building_inspections'] },
  { title: 'Contracts', tabs: ['categories'] },
  { title: 'Notifications', tabs: ['browser_alerts'] },
];

export default function ManagerSettingsPage() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => { const t = params.get('tab'); return TABS.some(x => x.key === t) ? (t as Tab) : 'maintenance'; });
  const flag = TABS.find(t => t.key === tab)!.flag;
  const { effectiveRp, allowed, permsLoading, needsLandlord, canForRp } = useManagerLandlordScope(flag);
  // Only the entries this landlord has granted.
  const granted = (f: Flag | Flag[]) => effectiveRp != null && (Array.isArray(f) ? f : [f]).some(x => canForRp(x, effectiveRp));
  const waOn = useWhatsappEnabled('manager');
  useEffect(() => {
    const url = new URL(window.location.href); url.searchParams.set('tab', tab); window.history.replaceState(null, '', url.toString());
  }, [tab]);

  if (!permsLoading && needsLandlord) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e8e6e0] rounded-[18px] px-7 py-10 mt-12">
          <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#eef3f1] text-[#2e6f5e]"><Building2 size={20} /></div>
          <p className="text-base font-bold text-[#1a1916]">Select a landlord</p>
          <p className="text-[13.5px] text-[#9b9890] mt-1.5 leading-relaxed">Settings are per landlord. Choose one from the switcher above.</p>
        </div>
      </div>
    );
  }
  const visible = TABS.filter(t => granted(t.flag));
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1a1916]">Settings</h1>
        <p className="text-sm text-[#6b6860] mt-0.5">What this landlord has delegated to you.</p>
      </div>
      <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] gap-6 items-start">
        <nav className="bg-white rounded-2xl border border-[#e8e6e0] shadow-sm p-2 mb-6 lg:mb-0 lg:sticky lg:top-4">
          {MENU.map(group => {
            const entries = group.tabs.map(k => TABS.find(t => t.key === k)!).filter(t => granted(t.flag));
            if (!entries.length) return null;
            return (
              <div key={group.title} className="mb-2 last:mb-0">
                <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-[#9b9890]">{group.title}</div>
                {entries.map(t => (
                  <button key={t.key} onClick={() => setTab(t.key)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors cursor-pointer ${tab === t.key ? 'bg-[#eef9f4] text-[#1a7a5a] font-semibold' : 'text-[#4a4842] hover:bg-[#f4f3ef]'}`}>
                    <t.Icon size={15} /> {t.label}
                  </button>
                ))}
              </div>
            );
          })}
          {!permsLoading && visible.length === 0 && <p className="px-3 py-3 text-[12px] text-[#9b9890]">Nothing delegated for this landlord.</p>}
        </nav>
        <div className="min-w-0">
          {!permsLoading && !allowed ? (
            <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e8e6e0] rounded-[18px] px-7 py-10 mt-6">
              <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]"><Lock size={20} /></div>
              <p className="text-base font-bold text-[#1a1916]">Permission required</p>
              <p className="text-[13.5px] text-[#9b9890] mt-1.5 leading-relaxed">This landlord hasn&apos;t delegated this to you.</p>
            </div>
          ) : effectiveRp != null && (
            <>
              {tab === 'maintenance' && <MaintenanceCoveragePanel manager={{ rp: effectiveRp }} />}
              {tab === 'maintenance_list' && <MaintenanceListWorkspace manager={{ rp: effectiveRp }} embedded />}
              {tab === 'restoration' && <RestorationListWorkspace manager={{ rp: effectiveRp }} embedded />}
              {tab === 'building_inspections' && <BuildingInspectionsSettings manager={{ rp: effectiveRp }} embedded />}
              {tab === 'categories' && <AmcCategoriesView base="/manager/amc" rp={effectiveRp} listHref={`/dashboard/manager/amc?rp=${effectiveRp}`} embedded />}
              {tab === 'browser_alerts' && <BrowserAlertsCard forManager showWhatsapp={waOn && canForRp('canReadWhatsapp', effectiveRp)} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
