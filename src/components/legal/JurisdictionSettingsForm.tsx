'use client';

/**
 * Jurisdiction settings form (spec §3, §7.4) — one form, two owners:
 *   - scope "platform": Admin → Jurisdiction, the default every landlord starts from;
 *   - scope "landlord": Settings → Legal, the landlord's own periods and fee rule
 *     (owner, 14 Sep: "Landlord can't set those pricing instead of admin?").
 * Every deadline, guard and fee in the Breach and Legal pipelines reads from the
 * saved values, so each field says what it drives. Nothing about a country,
 * authority or law is hardcoded — the authority's name is free text for help copy.
 */
import { useEffect, useState } from 'react';
import { Loader2, Scale } from 'lucide-react';
import type { JurisdictionConfig } from '@/lib/legal';

type DayKey = 'breachCorrectionDays' | 'paymentCurePeriodDays' | 'breachRemedyPeriodDays' | 'renewalTermsNoticeDays' | 'nonRenewalNoticeDays' | 'appealWindowDays';
export type ConfigWithSource = JurisdictionConfig & { source?: 'own' | 'platform' };

const DAY_FIELDS: { key: DayKey; label: string; help: string }[] = [
  { key: 'breachCorrectionDays', label: 'Breach correction period', help: 'Days a customer has to put a breach right after a warning or final warning. Sets the correction and final deadlines on the Breach pipeline.' },
  { key: 'paymentCurePeriodDays', label: 'Payment cure period', help: 'Days to pay after a formal payment reminder (legal). Sets the notice deadline on an unpaid-rent case.' },
  { key: 'breachRemedyPeriodDays', label: 'Breach remedy period', help: 'Days to fix a breach after a fix-it notice. Sets the notice deadline on a breach case.' },
  { key: 'renewalTermsNoticeDays', label: 'Renewal terms notice', help: 'Notice the landlord must give before renewal to change rent or terms. Sets the deadline on a renewal terms notice.' },
  { key: 'nonRenewalNoticeDays', label: 'Non-renewal notice', help: 'Notice to end the tenancy at expiry. Sets the deadline on a move-out notice.' },
  { key: 'appealWindowDays', label: 'Appeal window', help: 'Days after a decision during which the other side may appeal. When it passes with no appeal, the case moves to enforcement on its own.' },
];

const field = 'w-full text-sm px-3 py-2 border border-[#e8e6e0] rounded-xl bg-white focus:outline-none focus:border-[#2e9f82]';

export function JurisdictionSettingsForm({ scope, load, save, reset }: {
  scope: 'platform' | 'landlord';
  load: () => Promise<ConfigWithSource>;
  save: (body: Partial<Omit<JurisdictionConfig, 'id' | 'updatedAt'>>) => Promise<ConfigWithSource>;
  /** Landlord only: drop the own row and go back to the platform default. */
  reset?: () => Promise<ConfigWithSource>;
}) {
  const [cfg, setCfg] = useState<ConfigWithSource | null>(null);
  const [days, setDays] = useState<Record<DayKey, string>>({ breachCorrectionDays: '', paymentCurePeriodDays: '', breachRemedyPeriodDays: '', renewalTermsNoticeDays: '', nonRenewalNoticeDays: '', appealWindowDays: '' });
  const [mediation, setMediation] = useState(false);
  const [registration, setRegistration] = useState(false);
  const [authority, setAuthority] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hydrate = (c: ConfigWithSource) => {
    setCfg(c);
    setDays({
      breachCorrectionDays: String(c.breachCorrectionDays), paymentCurePeriodDays: String(c.paymentCurePeriodDays), breachRemedyPeriodDays: String(c.breachRemedyPeriodDays),
      renewalTermsNoticeDays: String(c.renewalTermsNoticeDays), nonRenewalNoticeDays: String(c.nonRenewalNoticeDays), appealWindowDays: String(c.appealWindowDays),
    });
    setMediation(!!c.mediationRequired); setRegistration(!!c.registrationRequiredToFile); setAuthority(c.authorityDisplayName ?? '');
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load().then(hydrate).catch(e => setError((e as Error)?.message || 'Could not load the settings.')).finally(() => setLoading(false)); }, []);

  const dirty = () => { setSaved(false); setError(null); };

  async function onSave() {
    setError(null); setSaving(true);
    try {
      for (const f of DAY_FIELDS) {
        const v = days[f.key];
        if (v.trim() === '' || !Number.isInteger(Number(v)) || Number(v) < 0) { setError(`${f.label}: enter a whole number of days (0 or more).`); setSaving(false); return; }
      }
      const updated = await save({
        breachCorrectionDays: Number(days.breachCorrectionDays), paymentCurePeriodDays: Number(days.paymentCurePeriodDays), breachRemedyPeriodDays: Number(days.breachRemedyPeriodDays),
        renewalTermsNoticeDays: Number(days.renewalTermsNoticeDays), nonRenewalNoticeDays: Number(days.nonRenewalNoticeDays), appealWindowDays: Number(days.appealWindowDays),
        mediationRequired: mediation, registrationRequiredToFile: registration, authorityDisplayName: authority.trim() || 'Rental authority',
      });
      hydrate(updated); setSaved(true);
    } catch (e) { setError((e as Error)?.message || 'Could not save the settings.'); }
    finally { setSaving(false); }
  }

  async function onReset() {
    if (!reset) return;
    setError(null); setSaving(true);
    try { hydrate(await reset()); setSaved(true); }
    catch (e) { setError((e as Error)?.message || 'Could not reset the settings.'); }
    finally { setSaving(false); }
  }

  if (loading) {
    return <div className="flex items-center gap-3 py-16 justify-center text-[#6b7a74]"><Loader2 size={16} className="animate-spin" /><span className="text-sm">Loading…</span></div>;
  }

  return (
    <div className="max-w-3xl space-y-4">
      {scope === 'landlord' && (
        <div className="px-4 py-3 rounded-[12px] border text-[12px]" style={cfg?.source === 'own' ? { background: '#e6f4ef', borderColor: '#bfe3d3', color: '#125a3c' } : { background: '#fbfbf8', borderColor: '#e8e6e0', color: '#6b6860' }}>
          {cfg?.source === 'own'
            ? <>These are <b>your own</b> periods — every warning deadline, notice deadline and appeal window on your cases uses them. Fees live in the fee book below.</>
            : <>You are on the <b>platform defaults</b>. Change anything and save to keep your own set; the platform values stay as the fallback. Fees live in the fee book below.</>}
        </div>
      )}

      {/* authority + rules */}
      <div className="p-5 rounded-[14px] border border-[#e8e6e0] bg-white">
        <div className="flex items-center gap-2 mb-3"><Scale size={15} className="text-[#2e9f82]" /><h3 className="text-[13px] font-semibold text-[#1a1916]">Rental authority</h3></div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr] gap-4">
          <div>
            <label className="text-xs font-medium text-[#6b6860] mb-1 block" htmlFor="authority">Authority display name</label>
            <input id="authority" className={field} value={authority} onChange={e => { setAuthority(e.target.value); dirty(); }} placeholder="Rental authority" />
            <p className="text-[11px] text-[#9b9890] mt-1">Free text for tooltips, help lines and the notice template — e.g. the name of the tribunal or committee. The UI otherwise says “rental authority”.</p>
          </div>
          <div className="space-y-3">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" className="mt-[3px] accent-[#2e9f82]" checked={mediation} onChange={e => { setMediation(e.target.checked); dirty(); }} />
              <span><span className="text-[13px] font-medium text-[#1a1916]">Mediation required</span><span className="block text-[11px] text-[#9b9890]">A filed case must pass through “Settlement talks” before a decision can be recorded.</span></span>
            </label>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" className="mt-[3px] accent-[#2e9f82]" checked={registration} onChange={e => { setRegistration(e.target.checked); dirty(); }} />
              <span><span className="text-[13px] font-medium text-[#1a1916]">Registration required to file</span><span className="block text-[11px] text-[#9b9890]">A lease needs a registration number before its case can move to “Case filed”.</span></span>
            </label>
          </div>
        </div>
      </div>

      {/* periods */}
      <div className="p-5 rounded-[14px] border border-[#e8e6e0] bg-white">
        <h3 className="text-[13px] font-semibold text-[#1a1916] mb-1">Periods (days)</h3>
        <p className="text-[11px] text-[#6b6860] mb-3">Every deadline in both pipelines is the event date plus one of these.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          {DAY_FIELDS.map(f => (
            <div key={f.key} className="p-3.5 rounded-[12px] border border-[#eee] bg-[#fbfbf8]">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor={f.key} className="text-[13px] font-semibold text-[#1a1916]">{f.label}</label>
                <div className="relative shrink-0">
                  <input id={f.key} type="number" min={0} step={1} value={days[f.key]} onChange={e => { setDays(dv => ({ ...dv, [f.key]: e.target.value })); dirty(); }}
                    className="w-24 text-sm pl-3 pr-10 py-2 border border-[#e8e6e0] rounded-xl bg-white focus:outline-none focus:border-[#2e9f82]" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#9b9890]">days</span>
                </div>
              </div>
              <p className="text-[11px] text-[#6b6860] mt-1 leading-snug">{f.help}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[11px] text-[#9b9890]">{cfg?.updatedAt && cfg?.source !== 'platform' ? `Last saved ${new Date(cfg.updatedAt).toLocaleString('en-AE', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}</span>
        <div className="flex items-center gap-3">
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          {saved && !saving && <p className="text-[11px] text-[#2e9f82]">Saved.</p>}
          {reset && cfg?.source === 'own' && (
            <button type="button" onClick={() => void onReset()} disabled={saving} className="px-3 py-2 rounded-xl text-xs font-medium border border-[#e8e6e0] bg-white text-[#6b6860] cursor-pointer disabled:opacity-50">Use platform defaults</button>
          )}
          <button type="button" onClick={() => void onSave()} disabled={saving} className="px-4 py-2 rounded-xl text-xs font-medium text-white cursor-pointer disabled:opacity-50" style={{ background: '#2e9f82' }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
