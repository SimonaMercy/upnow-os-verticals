'use client';

/**
 * Settings → WhatsApp. The landlord links the WhatsApp numbers their team already
 * uses; every conversation on them then appears in the portal and can be answered
 * from it. One card, like Settings → Email: the numbers and their health, link
 * another, remove one.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import { errorText, whatsappApi, type WaLines } from '@/lib/whatsappApi';
import { WaLinesManager } from './WaLinesManager';

export function WhatsAppSettingsPanel() {
  const [lines, setLines] = useState<WaLines | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (check = false) => {
    try { setLines(await whatsappApi.lines(null, check)); setError(null); }
    catch (e) { setError(errorText(e, 'Could not load your WhatsApp numbers')); }
  }, []);
  // `check` asks each bridge how its number is doing right now, not what was last known.
  useEffect(() => { const t = window.setTimeout(() => { void load(true); }, 0); return () => window.clearTimeout(t); }, [load]);

  if (!lines) return <div className="bg-white rounded-2xl p-6 shadow-sm text-sm text-[#8a948d]">{error ?? 'Loading…'}</div>;

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm">
      <div className="flex items-start gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl grid place-items-center bg-[#eef9f4] text-[#1a7a5a] shrink-0"><MessageCircle size={18} /></div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-base text-[#14201a]">Your WhatsApp numbers</h2>
          <p className="text-xs text-[#8a948d] mt-1 leading-relaxed">
            Link the WhatsApp numbers your team already uses with customers. Every conversation on them appears on the{' '}
            <Link href="/rental-provider/dashboard/whatsapp" className="text-[#1a7a5a] font-medium hover:underline">WhatsApp page</Link>{' '}
            and on the lead, lease, customer or vendor it belongs to, and your team answers from here. Each number is kept signed in by a small
            bridge program — like WhatsApp Web left open on a computer; your phone keeps working as it does today. Who may read and who may
            send is set per person in Settings → Team.
          </p>
        </div>
      </div>
      <WaLinesManager lines={lines.lines} onChanged={() => { void load(true); }} />
      {error && <p className="mt-3 text-sm text-[#b42318]">{error}</p>}
    </div>
  );
}
