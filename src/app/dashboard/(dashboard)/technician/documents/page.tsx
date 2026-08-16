'use client';

/**
 * Technician · My Documents (SP-131) — Emirates ID + residence visa, each with
 * its expiry date. These are the inputs to the technician half of Gate 1: an
 * admin verifies them (SP-212) and only a `compliant` technician is dispatched
 * once the gate is on (SP-129). Same KycDocumentsPanel the provider uses for
 * their own pack; documents are inline-view-only.
 */

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ShieldCheck } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { DashboardPage } from '@/components/dashboard/DashboardWidgets';
import { KycDocumentsPanel } from '@/components/dashboard/KycDocumentsPanel';

interface ChecklistItem {
  key: string;
  displayName: string;
  required: boolean;
  uploaded: boolean;
  status: string | null;
  expiryDate: string | null;
  notes?: string | null;
}
interface TechDocs {
  profile: { id: number; name: string; complianceStatus: string; complianceNotes: string | null };
  checklist: ChecklistItem[];
  kyc: { requiredMissing: string[]; rejected: number; expired: number; expiringSoon: number; complete: boolean };
}

const DAY_MS = 86_400_000;
const daysTo = (d: string, now: number) => Math.floor((new Date(d).getTime() - now) / DAY_MS);
const pretty = (code: string) => code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function TechnicianDocumentsPage() {
  const qc = useQueryClient();
  const [data, setData] = useState<TechDocs | null>(null);
  const [now] = useState(() => Date.now());

  const load = () =>
    apiGet<TechDocs>('/technician/me/documents').then(setData).catch(() => setData(null));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const checklist = data?.checklist ?? [];
  // Documents needing attention: rejected, expired, or expiring within 30 days —
  // the same rule the provider sees on their own settings page.
  const attention = checklist
    .map((c) => {
      if (String(c.status ?? '').toLowerCase() === 'rejected') {
        return { key: c.key, name: c.displayName ?? pretty(c.key), why: `Rejected — re-upload required${c.notes ? ` (${c.notes})` : ''}`, level: 'red' as const };
      }
      if (c.uploaded && c.expiryDate) {
        const d = daysTo(c.expiryDate, now);
        if (d < 0) return { key: c.key, name: c.displayName ?? pretty(c.key), why: 'Expired — upload the renewed document', level: 'red' as const };
        if (d <= 30) return { key: c.key, name: c.displayName ?? pretty(c.key), why: `Expires in ${d} day${d === 1 ? '' : 's'}`, level: 'amber' as const };
      }
      return null;
    })
    .filter(Boolean) as Array<{ key: string; name: string; why: string; level: 'red' | 'amber' }>;

  const verified = data?.profile.complianceStatus === 'compliant';

  return (
    <DashboardPage
      title="My Documents"
      subtitle="Your Emirates ID and residence visa, with their expiry dates. UpNow reviews them before you can be assigned jobs."
    >
      {data && (
        <div
          className="rounded-2xl px-5 py-4 mb-6 flex items-start gap-3 bg-white"
          style={{ boxShadow: 'var(--shadow-sm)', borderLeft: `4px solid ${verified ? 'var(--color-primary)' : '#d97706'}` }}
        >
          {verified
            ? <ShieldCheck className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: 'var(--color-primary)' }} />
            : <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: '#d97706' }} />}
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: 'var(--color-neutral-900)' }}>
              {verified
                ? 'Verified — keep these documents current'
                : data.kyc.complete
                  ? 'Documents submitted — waiting for UpNow review'
                  : `Upload your ${data.kyc.requiredMissing.map(pretty).join(' and ')} to be reviewed`}
            </p>
            <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--color-neutral-500)' }}>
              {verified
                ? 'An expired document pauses your verification automatically — replace it here before it lapses.'
                : data.profile.complianceStatus === 'action_required' && data.profile.complianceNotes
                  ? `Reviewer note: ${data.profile.complianceNotes}`
                  : 'Both documents need the expiry date printed on them. Only UpNow reviewers can see them.'}
            </p>
          </div>
        </div>
      )}

      {attention.length > 0 && (
        <div className="mb-4 rounded-2xl px-5 py-4 bg-red-50 border border-red-200">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-red-700">
            <AlertCircle size={15} /> {attention.length} document{attention.length === 1 ? '' : 's'} need{attention.length === 1 ? 's' : ''} attention
          </p>
          <div className="mt-1.5 space-y-1">
            {attention.map((a) => (
              <p key={a.key} className={`text-xs ${a.level === 'red' ? 'text-red-700' : 'text-amber-700'}`}>
                <b>{a.name}</b> — {a.why}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-white p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
        <KycDocumentsPanel
          profileApiPath="/technician/me/documents"
          ownerType="technician"
          onAfterUpload={() => {
            void load();
            qc.invalidateQueries({ queryKey: ['technician-me'] });
          }}
        />
      </div>
    </DashboardPage>
  );
}
