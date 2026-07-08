import { Schibsted_Grotesk } from 'next/font/google';
import { SpJobReady } from '@/components/upnow/SpJobReady';

// The design ("UpNow SP Onboarding" dc project) sets this flow in Schibsted
// Grotesk on a #F7F8F6 canvas — scoped to this page, not the whole dashboard.
const grotesk = Schibsted_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'] });

export default function ServiceProviderJobReadyPage() {
  return (
    <div className={grotesk.className} style={{ background: '#F7F8F6', minHeight: '100%', color: '#182420' }}>
      <div className="p-4 sm:p-7">
        <SpJobReady />
      </div>
    </div>
  );
}
