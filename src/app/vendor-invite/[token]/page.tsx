'use client';

/**
 * The vendor's acceptance page (PUBLIC — the invite token is the
 * authorization; maintenance v2, artifact 217df5b4). One tap: accept →
 * the landlord can assign work → sign in by email OTP.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { useParams } from 'next/navigation';

interface Info { vendorName: string; landlordName: string; relationship: string; accepted: boolean; signInEmail: string | null }

export default function VendorInvitePage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`/api/vendor-invites/${token}`).then(async r => {
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.message ?? 'This invitation does not exist or was withdrawn.');
      setInfo(await r.json());
    }).catch(e => setErr(e instanceof Error ? e.message : 'Could not open this invitation.'));
  }, [token]);
  const accept = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/vendor-invites/${token}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!r.ok) throw new Error('Could not accept — try the link again.');
      setInfo(await r.json());
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not accept.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen grid place-items-center px-4" style={{ background: '#f7f5f0', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <div className="bg-white border border-[#e4e9e5] rounded-2xl w-full max-w-md p-7 grid gap-4 text-center">
        <div className="mx-auto w-11 h-11 rounded-xl grid place-items-center font-extrabold text-white text-lg" style={{ background: '#047246' }}>U</div>
        {err && <p className="text-sm text-red-700">{err}</p>}
        {!info && !err && <p className="text-sm text-[#8a948d]">Opening your invitation…</p>}
        {info && !info.accepted && (
          <>
            <h1 className="text-xl font-extrabold text-[#14201a]" style={{ textWrap: 'balance' }}>{info.landlordName} wants to send maintenance work to {info.vendorName}</h1>
            <div className="text-left text-[13.5px] text-[#5f6b63] grid gap-1.5 bg-[#f6f8f6] border border-[#f0eeea] rounded-xl p-4">
              <span>• Their requests land on your job board — photos, unit, preferred time.</span>
              <span>• Your technicians get their own sign-ins and mark work fixed with proof.</span>
              <span>• {info.landlordName} pays you directly, outside UpNow.</span>
              <span>• No catalog, no fees, no marketplace onboarding.</span>
            </div>
            <button type="button" disabled={busy} onClick={accept}
              className="h-12 rounded-xl text-[15px] font-bold text-white cursor-pointer disabled:opacity-50" style={{ background: '#047246' }}>
              {busy ? 'Accepting…' : 'Accept the invitation'}
            </button>
            <p className="text-[11.5px] text-[#8a948d]">Nothing happens until you accept. You can join the UpNow marketplace later, from your account.</p>
          </>
        )}
        {info?.accepted && (
          <>
            <CheckCircle2 size={36} className="mx-auto" style={{ color: '#1a7a5a' }} />
            <h1 className="text-xl font-extrabold text-[#14201a]">You&apos;re in</h1>
            <p className="text-sm text-[#5f6b63]">{info.landlordName} can now send work to {info.vendorName}.{info.signInEmail ? <> Sign in with <b>{info.signInEmail}</b> — a one-time code is emailed to you.</> : <> Ask {info.landlordName} to add your email so you can sign in.</>}</p>
            <Link href="/login" className="h-12 rounded-xl text-[15px] font-bold text-white grid place-items-center" style={{ background: '#047246' }}>Go to sign in</Link>
          </>
        )}
      </div>
    </div>
  );
}
