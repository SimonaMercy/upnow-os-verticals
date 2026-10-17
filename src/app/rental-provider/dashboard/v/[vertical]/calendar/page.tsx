'use client';

/**
 * Operations › Calendar for a vertical — PREVIEW data only. New page — no previous page to keep parity with.
 * Preview board items carry no real dates, so they are placed deterministically on the current week
 * (Mon–Sun, Asia/Dubai) by hashing the item id. Week grid or list view; model filter pills; item drawer.
 *
 * Spaces runs on the PREVIEW booking engine instead (real dates, blocks) — see <SpacesCalendar/>.
 */
import { useMemo, useState } from 'react';
import {
  Btn, EmptyRow, OsPage, PageHead, Pill, PreviewBanner, PreviewPill, ScopeStrip, Seg, TableWrap,
} from '@/components/os/kit';
import { MODEL_INFO, MODELS_OF, usePreview, type BoardItem, type ModelId } from '@/lib/os/preview';
import { SpacesCalendar } from '@/components/os/bookings/SpacesCalendar';
import type { MsVertical } from '@/lib/catalog';
import { Gate2Lock, ItemDrawer, TagPill, useGate2, useVerticalParam } from '../../_parts';

const SLOTS = ['09:00', '11:00', '13:00', '15:00', '17:00', '19:00'];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Monday of the current week (Asia/Dubai) as a UTC-midnight Date, plus today's index 0–6. */
function currentWeek(): { days: Date[]; todayIdx: number } {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m, d] = ymd.split('-').map(Number);
  const today = new Date(Date.UTC(y, m - 1, d));
  const todayIdx = (today.getUTCDay() + 6) % 7;
  const monday = new Date(today.getTime() - todayIdx * 86400000);
  return { days: Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * 86400000)), todayIdx };
}

const evClass = (m: ModelId) => {
  const t = MODEL_INFO[m].tone;
  return t === 'booking' || t === 'res' || t === 'court' ? t : t === 'charter' ? 'job' : 'lease';
};

interface Placed { item: BoardItem; day: number; slot: number }

export default function VerticalCalendarPage() {
  const vertical = useVerticalParam();
  if (vertical.id === 'spaces') return <SpacesCalendar />;
  return <VerticalCalendar vertical={vertical} />;
}

function VerticalCalendar({ vertical }: { vertical: MsVertical }) {
  const { locked } = useGate2(vertical.id);
  const { board } = usePreview();
  const models = MODELS_OF[vertical.id];
  const [filter, setFilter] = useState<ModelId | 'all'>('all');
  const [view, setView] = useState<'week' | 'list'>('week');
  const [openId, setOpenId] = useState<string | null>(null);
  const [{ days, todayIdx }] = useState(currentWeek);

  const placed = useMemo<Placed[]>(() => board
    .filter((b) => models.includes(b.model) && (filter === 'all' || b.model === filter))
    .map((item) => { const h = hash(item.id); return { item, day: h % 7, slot: Math.floor(h / 7) % SLOTS.length }; })
    .sort((a, b) => a.day - b.day || a.slot - b.slot), [board, models, filter]);
  const open = board.find((b) => b.id === openId) ?? null;
  const dayLabel = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  if (locked) {
    return (
      <OsPage>
        <PageHead eyebrow="Operations" title={`${vertical.label} calendar`} />
        <Gate2Lock vertical={vertical} />
      </OsPage>
    );
  }

  return (
    <OsPage>
      <PageHead
        eyebrow="Operations"
        title={`${vertical.label} calendar`}
        lede={`This week's ${vertical.label.toLowerCase()} bookings, sessions and appointments across every operating model.`}
      />
      <PreviewBanner>Preview records have no real dates — they are spread over the current week for illustration. Nothing here is saved.</PreviewBanner>
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Operations' },
        { label: 'Vertical', value: vertical.label },
        { label: 'Week of', value: `${dayLabel(days[0])} – ${dayLabel(days[6])}` },
        { label: 'Data', value: <PreviewPill /> },
      ]} />
      <div className="gx-btn-row" style={{ marginBottom: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="gx-chips" role="group" aria-label="Filter by operating model">
          <button type="button" className="gx-chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
          {models.map((m) => (
            <button key={m} type="button" className="gx-chip" aria-pressed={filter === m} onClick={() => setFilter(m)}>{MODEL_INFO[m].name}</button>
          ))}
        </div>
        <Seg label="View" value={view} onChange={setView} options={[{ v: 'week', l: 'Week' }, { v: 'list', l: 'List', n: placed.length }]} />
      </div>

      {view === 'week' ? (
        <div className="gx-cal">
          <div className="gx-cal-grid">
            <div className="gx-cal-h" />
            {days.map((d, i) => <div key={i} className="gx-cal-h">{DAY_NAMES[i]} {dayLabel(d)}</div>)}
            {SLOTS.map((s, si) => (
              <div key={s} style={{ display: 'contents' }}>
                <div className="gx-cal-t">{s}</div>
                {days.map((_, di) => (
                  <div key={di} className={`gx-cal-c${di === todayIdx ? ' today' : ''}`}>
                    {placed.filter((p) => p.day === di && p.slot === si).map((p) => (
                      <button key={p.item.id} type="button" className={`gx-cal-ev ${evClass(p.item.model)}`} onClick={() => setOpenId(p.item.id)}
                        title={`${p.item.t} — ${p.item.col}`}>
                        {p.item.t}<br /><span style={{ fontWeight: 500 }}>{p.item.col}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <TableWrap>
          <table className="gx-tbl">
            <thead><tr><th>When</th><th>Record</th><th>Model</th><th>Stage</th><th>Contact</th><th className="act">Action</th></tr></thead>
            {placed.length === 0 ? <EmptyRow cols={6} title="Nothing this week" text="No preview records for this filter." /> : (
              <tbody>
                {placed.map((p) => (
                  <tr key={p.item.id} className="click" onClick={() => setOpenId(p.item.id)}>
                    <td className="nowrap">{DAY_NAMES[p.day]} {dayLabel(days[p.day])} · {SLOTS[p.slot]}</td>
                    <td className="strong">{p.item.t} <TagPill tag={p.item.tag} /><div className="sub">{p.item.m}</div></td>
                    <td>{MODEL_INFO[p.item.model].name}</td>
                    <td><Pill tone="info">{p.item.col}</Pill></td>
                    <td>{p.item.contact}</td>
                    <td className="act"><Btn size="sm" onClick={() => setOpenId(p.item.id)}>Open</Btn></td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </TableWrap>
      )}

      <ItemDrawer item={open} onClose={() => setOpenId(null)} />
    </OsPage>
  );
}
