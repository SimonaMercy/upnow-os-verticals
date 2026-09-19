'use client';

/**
 * The landlord's WhatsApp numbers. Each number is served by a small bridge
 * program that stays signed in to WhatsApp (like WhatsApp Web on a computer).
 * Linking a number here issues a delivery key — shown once — that the bridge
 * uses to hand every message to the platform.
 */
import { useEffect, useState } from 'react';
import { Check, Copy, Loader2, Plus, Trash2, X } from 'lucide-react';
import { errorText, prettyPhone, whatsappApi, type WaLine } from '@/lib/whatsappApi';

const STATE: Record<string, { label: string; tone: string }> = {
  connected: { label: 'Connected', tone: 'text-[#1a7a5a] bg-[#eef9f4]' },
  qr_pending: { label: 'Waiting for QR scan', tone: 'text-[#8a6d1d] bg-[#fdf3e3]' },
  disconnected: { label: 'Not connected', tone: 'text-[#b42318] bg-red-50' },
};

export function WaLinesDialog({ lines, onClose, onChanged }: { lines: WaLine[]; onClose: () => void; onChanged: () => void }) {
  const [adding, setAdding] = useState(lines.length === 0);
  const [label, setLabel] = useState('');
  const [bridgeUrl, setBridgeUrl] = useState('');
  const [bridgeKey, setBridgeKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ label: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    if (!label.trim() || !bridgeUrl.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await whatsappApi.saveLine({ label: label.trim(), bridgeUrl: bridgeUrl.trim(), ...(bridgeKey.trim() ? { bridgeKey: bridgeKey.trim() } : {}) });
      if (r.ingestKey) setIssued({ label: r.line.label, key: r.ingestKey });
      setAdding(false); setLabel(''); setBridgeUrl(''); setBridgeKey(''); onChanged();
    } catch (e) { setError(errorText(e, 'The number could not be linked')); } finally { setBusy(false); }
  };
  const rotate = async (l: WaLine) => {
    setBusy(true); setError(null);
    try { const r = await whatsappApi.saveLine({ id: l.id, label: l.label, bridgeUrl: l.bridgeUrl ?? '', rotateIngestKey: true }); if (r.ingestKey) setIssued({ label: l.label, key: r.ingestKey }); onChanged(); }
    catch (e) { setError(errorText(e, 'A new key could not be issued')); } finally { setBusy(false); }
  };
  const remove = async (id: number) => {
    setBusy(true); setError(null);
    try { await whatsappApi.removeLine(id); setConfirmRemove(null); onChanged(); }
    catch (e) { setError(errorText(e, 'The number could not be removed')); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="WhatsApp numbers" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-[560px] max-h-[88vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-[#e8e6e0] shrink-0">
          <h2 className="text-base font-semibold text-[#1a1916] flex-1">WhatsApp numbers</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-full text-[#6b6860] hover:bg-[#f4f3ef] cursor-pointer"><X size={16} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
          {issued && (
            <div className="rounded-xl bg-[#eef9f4] border border-[#d7ede5] px-4 py-3">
              <div className="text-sm font-semibold text-[#1a7a5a]">Delivery key for “{issued.label}” — shown only once</div>
              <p className="text-xs text-[#4a4842] mt-1 leading-relaxed">Save it in the bridge’s <code className="font-mono">.ingest.key</code> file and restart the bridge. Without it the bridge cannot hand messages to the platform.</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 min-w-0 font-mono text-xs bg-white border border-[#d7ede5] rounded-md px-2.5 py-2 break-all">{issued.key}</code>
                <button type="button" onClick={() => { void navigator.clipboard?.writeText(issued.key).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }); }} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-[#2e9f82] text-white hover:bg-[#26856d] cursor-pointer">{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}</button>
              </div>
            </div>
          )}
          {lines.map((l) => {
            const s = STATE[l.status] ?? STATE.disconnected;
            return (
              <div key={l.id} className="rounded-xl border border-[#e8e6e0] px-4 py-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-[#1a1916]">{l.label}</span>
                  <span className="text-sm text-[#6b6860] tabular-nums">{prettyPhone(l.phone)}</span>
                  <span className={`ml-auto text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${s.tone}`}>{s.label}</span>
                </div>
                <div className="text-xs text-[#6b6860] mt-1 break-all">{l.displayName ? `${l.displayName} · ` : ''}{l.bridgeUrl}</div>
                {l.lastError && l.status !== 'connected' && <div className="text-xs text-[#b42318] mt-1 break-words">{l.lastError}</div>}
                <div className="flex flex-wrap items-center gap-2 mt-2.5">
                  <button type="button" disabled={busy} onClick={() => void rotate(l)} className="text-xs px-2.5 py-1.5 rounded-lg border border-[#e8e6e0] text-[#4a4842] hover:border-[#2e9f82] cursor-pointer disabled:opacity-60">Issue a new delivery key</button>
                  {confirmRemove === l.id ? (
                    <>
                      <span className="text-xs text-[#b42318]">Removes this number and all its conversations from the platform. WhatsApp itself is untouched.</span>
                      <button type="button" disabled={busy} onClick={() => void remove(l.id)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[#b42318] text-white cursor-pointer disabled:opacity-60">Remove</button>
                      <button type="button" onClick={() => setConfirmRemove(null)} className="text-xs px-2.5 py-1.5 rounded-lg border border-[#e8e6e0] text-[#4a4842] cursor-pointer">Keep</button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmRemove(l.id)} className="text-xs inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#e8e6e0] text-[#6b6860] hover:border-[#b42318] hover:text-[#b42318] cursor-pointer"><Trash2 size={12} /> Remove</button>
                  )}
                </div>
              </div>
            );
          })}

          {adding ? (
            <div className="rounded-xl border border-[#e8e6e0] px-4 py-3.5 space-y-3">
              <div className="text-sm font-semibold text-[#1a1916]">Link a number</div>
              <div>
                <label htmlFor="wa-line-label" className="block text-xs font-medium text-[#6b6860] mb-1">Name of this number</label>
                <input id="wa-line-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Property Manager" className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" />
              </div>
              <div>
                <label htmlFor="wa-line-url" className="block text-xs font-medium text-[#6b6860] mb-1">Bridge address</label>
                <input id="wa-line-url" value={bridgeUrl} onChange={(e) => setBridgeUrl(e.target.value)} placeholder="http://localhost:3100" className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#2e9f82]" />
              </div>
              <div>
                <label htmlFor="wa-line-key" className="block text-xs font-medium text-[#6b6860] mb-1">Bridge API key <span className="text-[#9b9890] font-normal">— only if the bridge is protected with one</span></label>
                <input id="wa-line-key" value={bridgeKey} onChange={(e) => setBridgeKey(e.target.value)} type="password" autoComplete="off" className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2e9f82]" />
              </div>
              <div className="flex justify-end gap-2">
                {lines.length > 0 && <button type="button" onClick={() => setAdding(false)} className="px-3.5 py-2 rounded-lg text-sm border border-[#e8e6e0] text-[#4a4842] cursor-pointer">Cancel</button>}
                <button type="button" onClick={() => void save()} disabled={!label.trim() || !bridgeUrl.trim() || busy} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-[#2e9f82] text-white hover:bg-[#26856d] cursor-pointer disabled:opacity-60">{busy && <Loader2 size={14} className="animate-spin" />} Link the number</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm border border-dashed border-[#c9c6bd] text-[#4a4842] hover:border-[#2e9f82] cursor-pointer"><Plus size={14} /> Link another number</button>
          )}
          {error && <div className="text-sm text-[#b42318]">{error}</div>}
        </div>
      </div>
    </div>
  );
}
