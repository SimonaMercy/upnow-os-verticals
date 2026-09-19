'use client';

/**
 * Manager → Emails. The landlord's mailbox, used on their behalf: shown only
 * when the selected landlord has granted "Email customers and leads".
 */
import { Lock } from 'lucide-react';
import { useManagerLandlordScope, SelectLandlordNotice } from '@/components/dashboard/managerLandlordScope';
import { EmailInbox } from '@/components/email/EmailInbox';

export default function ManagerCommunicationsPage() {
  const { effectiveRp, allowed, permsLoading, needsLandlord } = useManagerLandlordScope('canReadEmails');
  if (permsLoading) return <div className="p-6 text-sm text-[#9b9890]">Loading…</div>;
  if (needsLandlord) return <SelectLandlordNotice resource="Emails" />;
  if (!allowed || effectiveRp == null) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e8e6e0] rounded-2xl px-7 py-10 mt-12">
          <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#f4f3ef] text-[#6b6860]"><Lock size={20} /></div>
          <p className="text-base font-bold text-[#1a1916]">No access to emails</p>
          <p className="text-sm text-[#6b6860] mt-1.5 leading-relaxed">This landlord has not given you permission to email their customers and leads.</p>
        </div>
      </div>
    );
  }
  return <EmailInbox rp={effectiveRp} isManager />;
}
