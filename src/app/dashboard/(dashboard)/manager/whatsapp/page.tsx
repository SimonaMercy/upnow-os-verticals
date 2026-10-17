'use client';

/**
 * Manager → WhatsApp. The landlord's numbers, used on their behalf: shown only
 * when the selected landlord has granted "Communicate with customers".
 */
import { Lock } from 'lucide-react';
import { useManagerLandlordScope, SelectLandlordNotice } from '@/components/dashboard/managerLandlordScope';
import { WhatsAppInbox } from '@/components/whatsapp/WhatsAppInbox';

export default function ManagerWhatsAppPage() {
  const { effectiveRp, allowed, permsLoading, needsLandlord } = useManagerLandlordScope('canReadWhatsapp');
  if (permsLoading) return <div className="p-6 text-sm text-[#8a948d]">Loading…</div>;
  if (needsLandlord) return <SelectLandlordNotice resource="WhatsApp" />;
  if (!allowed || effectiveRp == null) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e4e9e5] rounded-2xl px-7 py-10 mt-12">
          <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#eef1ef] text-[#5f6b63]"><Lock size={20} /></div>
          <p className="text-base font-bold text-[#14201a]">No access to WhatsApp</p>
          <p className="text-sm text-[#5f6b63] mt-1.5 leading-relaxed">This landlord has not given you permission to communicate with their customers and leads.</p>
        </div>
      </div>
    );
  }
  return <WhatsAppInbox rp={effectiveRp} isManager />;
}
