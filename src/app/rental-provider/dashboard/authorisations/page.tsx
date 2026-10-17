'use client';

/**
 * Business › Vertical authorisations (Gate 2) — PREVIEW (Gate 2 has no backend yet; records live in
 * the preview store). New page — no previous page to keep parity with.
 */
import { useRouter } from 'next/navigation';
import {
  Btn, Callout, OsPage, PageHead, Pill, PreviewBanner, PreviewPill, ScopeStrip, TableWrap, type Tone,
} from '@/components/os/kit';
import { VERTICALS, type MsVerticalId } from '@/lib/catalog';
import { licenceNeeded, usePreview, type AuthState } from '@/lib/os/preview';
import { useOsScope, verticalHome } from '@/lib/os/scope';
import { VICON } from '../v/_parts';

const STATE: Record<AuthState, { l: string; tone: Tone }> = {
  granted: { l: 'Authorised', tone: 'primary' },
  pending: { l: 'Under review', tone: 'amber' },
  refused: { l: 'Refused', tone: 'danger' },
  none: { l: 'Not requested', tone: 'neutral' },
};

export default function AuthorisationsPage() {
  const router = useRouter();
  const { authOf, requestVertical } = usePreview();
  const { setVertical } = useOsScope();
  const granted = VERTICALS.filter((v) => authOf(v.id).state === 'granted').length;
  const pending = VERTICALS.filter((v) => authOf(v.id).state === 'pending').length;

  const open = (v: MsVerticalId) => { setVertical(v); router.push(verticalHome(v)); };

  return (
    <OsPage>
      <PageHead
        eyebrow="Business"
        title="Vertical authorisations"
        lede="Which verticals your business may operate, on what licence. Each vertical is requested and authorised separately."
      />
      <PreviewBanner>Vertical authorisation has no backend yet. Requests and decisions here are demonstration data held in this browser tab.</PreviewBanner>
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Business' },
        { label: 'Gate', value: 'Gate 2 · Vertical authorisation' },
        { label: 'Authorised', value: `${granted} of ${VERTICALS.length}` },
        { label: 'Under review', value: pending },
        { label: 'Data', value: <PreviewPill /> },
      ]} />
      <div style={{ marginBottom: 14 }}>
        <Callout tone="info" title="Gate 2, per vertical.">
          Business verification (Gate 1) proves who you are. Authorisation proves you hold the licence for a specific vertical — a trade licence for letting does not
          cover clinics, schools or insurance. Approving one vertical unlocks only that vertical&apos;s Operations and Catalogue.
        </Callout>
      </div>
      <TableWrap>
        <table className="gx-tbl">
          <thead><tr><th>Vertical</th><th>Status</th><th>Licence relied on</th><th>Subcategories</th><th className="act">Action</th></tr></thead>
          <tbody>
            {VERTICALS.map((v) => {
              const a = authOf(v.id);
              const Ic = VICON[v.id];
              const s = STATE[a.state];
              const subLine = a.state === 'granted' ? (a.since ? `Since ${a.since}` : null)
                : a.state === 'pending' ? (a.requested ? `Requested ${a.requested}` : null)
                : a.state === 'refused' ? a.reason ?? null : null;
              return (
                <tr key={v.id}>
                  <td className="strong"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Ic size={15} aria-hidden /> {v.label}</span></td>
                  <td><Pill tone={s.tone}>{s.l}</Pill>{subLine && <div className="sub">{subLine}</div>}</td>
                  <td>{a.licence ?? licenceNeeded(v.id)}{a.state === 'pending' && a.note && <div className="sub">{a.note}</div>}</td>
                  <td>{a.state === 'granted' ? `${v.offers.length} subcategories` : <span style={{ color: 'var(--ms-ink-3)' }}>— locked</span>}</td>
                  <td className="act">
                    {a.state === 'granted' && <Btn size="sm" onClick={() => open(v.id)}>Open</Btn>}
                    {a.state === 'pending' && <Pill tone="amber">Awaiting Admin</Pill>}
                    {a.state === 'refused' && <Btn size="sm" onClick={() => requestVertical(v.id)}>Request again</Btn>}
                    {a.state === 'none' && <Btn size="sm" variant="primary" onClick={() => requestVertical(v.id)}>Request access</Btn>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
      <div style={{ marginTop: 14 }}>
        <Callout tone="warn" title="About the Services row.">
          Services bookings are real today, but they run through a separate service-provider account. This Services authorisation is a preview of the
          per-vertical model — it does not change what your rental-provider account can do with live services.
        </Callout>
      </div>
    </OsPage>
  );
}
