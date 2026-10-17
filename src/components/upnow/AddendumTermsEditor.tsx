'use client';

/**
 * Bilingual, document-style addendum editor — the friendly replacement for the
 * download-a-.docx-edit-in-Word-reupload flow. The RP writes the whole addendum
 * freely in a big text area (one term per line, an ALL-CAPS line = a section
 * heading), with a LIVE layout preview beside it showing the exact rendered page
 * incl. the system-managed (non-editable) signature block.
 *
 * Controlled: owns no terms state, edits via `onChange(next)`. Data model is a
 * line array per language (en/ar); the editor just splits/joins on newlines.
 */
import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Lock, Loader2, Eye } from 'lucide-react';
import type { AddendumTerms } from '@/lib/addendumTerms';
import { hasAddendumTerms } from '@/lib/addendumTerms';

const AddendumTermsPreview = dynamic(() => import('@/components/contract/AddendumTermsPreview'), {
  ssr: false,
  loading: () => (
    <div className="h-full grid place-items-center text-[#cfcfcf] text-sm">
      <span className="inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Preparing preview…</span>
    </div>
  ),
});

const FIELD = 'px-2.5 py-1.5 rounded-lg border border-[#e4e9e5] text-sm focus:outline-none focus:border-[#b45309]';

const EN_PLACEHOLDER = `Write your addendum here — one term per line.\nType a line in CAPITALS to make it a section heading; leave a blank line between sections.\n\nADDENDUM TO TENANCY CONTRACT\nBoth parties have mutually agreed upon the following terms:\n\nRENEWAL TERMS\nThis contract shall be renewable for the same period and on the same terms unless either party gives three months' notice before expiry.\nIn case of late renewal, the Landlord may charge 5% of the annual rent as a late penalty.\n\nPAYMENT TERMS\nThe Landlord will only accept cheques issued by the Tenant.`;

export default function AddendumTermsEditor({ value, onChange, height = 560 }: {
  value: AddendumTerms;
  onChange: (next: AddendumTerms) => void;
  height?: number;
}) {
  const [lang, setLang] = useState<'en' | 'ar'>('en');

  // Debounce the preview so typing stays snappy (the PDF re-renders on pause).
  const [previewTerms, setPreviewTerms] = useState<AddendumTerms>(value);
  useEffect(() => {
    const t = setTimeout(() => setPreviewTerms(value), 500);
    return () => clearTimeout(t);
  }, [value]);
  const canPreview = hasAddendumTerms(value);

  const patch = (p: Partial<AddendumTerms>) => onChange({ ...value, ...p });
  const text = lang === 'en' ? value.en.join('\n') : value.ar.join('\n');
  const setText = (v: string) => patch(lang === 'en' ? { en: v.split('\n') } : { ar: v.split('\n') });
  const count = (a: string[]) => a.filter(l => l.trim()).length;

  return (
    <div className="flex flex-col lg:flex-row gap-3" style={{ height }}>
      {/* ── WRITE ─────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col">
        <input value={value.name ?? ''} onChange={e => patch({ name: e.target.value })}
          placeholder="Addendum title — e.g. Addendum to Tenancy Contract"
          className={`${FIELD} w-full mb-2 font-semibold`} />

        {/* Language tabs + (Arabic title) */}
        <div className="flex items-center gap-1.5 mb-2">
          {(['en', 'ar'] as const).map(l => (
            <button key={l} type="button" onClick={() => setLang(l)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer ${lang === l ? 'bg-[#b45309] text-white' : 'bg-[#eef1ef] text-[#5f6b63] hover:bg-[#ece9e2]'}`}>
              {l === 'en' ? `English${count(value.en) ? ` · ${count(value.en)}` : ''}` : `العربية${count(value.ar) ? ` · ${count(value.ar)}` : ''}`}
            </button>
          ))}
          {lang === 'ar' && (
            <input value={value.nameAr ?? ''} onChange={e => patch({ nameAr: e.target.value })}
              placeholder="العنوان بالعربية" dir="rtl"
              className={`${FIELD} flex-1 ml-1`} style={{ textAlign: 'right' }} />
          )}
        </div>

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          dir={lang === 'ar' ? 'rtl' : 'ltr'}
          placeholder={lang === 'en' ? EN_PLACEHOLDER : 'اكتب الملحق هنا — بنداً واحداً في كل سطر. اكتب سطراً بأحرف كبيرة ليصبح عنوان قسم.'}
          spellCheck
          className="flex-1 w-full rounded-xl border border-[#e4e9e5] p-3 text-sm leading-relaxed focus:outline-none focus:border-[#b45309] resize-none"
          style={lang === 'ar' ? { textAlign: 'right' } : undefined}
        />

        <p className="text-[10px] text-[#a16207] mt-1.5">
          One term per line · a line in <b>ALL CAPITALS</b> is a section heading · blank line = new section.
        </p>
        <div className="mt-1.5 rounded-lg border border-dashed border-[#d6d3cc] bg-[#faf9f6] px-3 py-1.5 flex items-center gap-2">
          <Lock size={13} className="text-[#8a948d] shrink-0" />
          <p className="text-[10px] text-[#8a948d]">A Tenant &amp; Landlord signature block is added automatically at the end — it can’t be edited or removed.</p>
        </div>
      </div>

      {/* ── PREVIEW ───────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-1.5 mb-2 text-[11px] font-bold uppercase tracking-wide text-[#5f6b63]">
          <Eye size={13} /> Live preview
        </div>
        <div className="flex-1 min-h-0 rounded-xl border border-[#e4e9e5] overflow-hidden bg-[#52555a]">
          {canPreview
            ? <AddendumTermsPreview terms={previewTerms} height={Math.max(280, height - 34)} />
            : <div className="h-full grid place-items-center text-[#cfcfcf] text-xs px-6 text-center">
                Start writing on the left — your addendum, with the signature block, previews here.
              </div>}
        </div>
      </div>
    </div>
  );
}
