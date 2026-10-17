'use client';

/**
 * Operations › <model> board — PREVIEW data only (short stays, venues, courts, charters and the
 * non-Spaces vertical boards have no backend yet). New page — no previous page to keep parity with.
 * Board / Table views, item drawer with move actions, "New" form, declared lifecycle card.
 *
 * Spaces models (shortstay | venue | court | charter) run on the PREVIEW booking engine instead
 * (src/lib/os/bookings) — see <SpacesBoard/>. Other verticals keep the static preview data.
 */
import { useMemo, useState } from 'react';
import { notFound, useParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import {
  Board, BoardCard, BoardCol, Btn, EmptyRow, OsPage, PageHead, Pill, PreviewBanner, PreviewPill, ScopeStrip, Seg, TableWrap,
} from '@/components/os/kit';
import type { MsVertical } from '@/lib/catalog';
import { MODEL_INFO, MODELS_OF, usePreview, type BoardItem, type ModelId } from '@/lib/os/preview';
import { SpacesBoard } from '@/components/os/bookings/SpacesBoard';
import { isEngineModel } from '@/components/os/bookings/shared';
import { DeclaredLifecycleCard, Gate2Lock, ItemDrawer, NewItemModal, TagPill, modelOffer, useGate2, useVerticalParam } from '../../_parts';

export default function ModelBoardPage() {
  const vertical = useVerticalParam();
  const params = useParams<{ model: string }>();
  const modelId = String(params?.model ?? '');
  if (!(modelId in MODEL_INFO) || !MODELS_OF[vertical.id].includes(modelId as ModelId)) notFound();
  const model = modelId as ModelId;
  if (vertical.id === 'spaces' && isEngineModel(model)) return <SpacesBoard model={model} />;
  return <ModelBoard vertical={vertical} model={model} />;
}

function ModelBoard({ vertical, model }: { vertical: MsVertical; model: ModelId }) {
  const verticalLabel = vertical.label;
  const { locked } = useGate2(vertical.id);
  const { board } = usePreview();
  const info = MODEL_INFO[model];
  const offer = modelOffer(model);
  const [view, setView] = useState<'board' | 'table'>('board');
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const items = useMemo(() => board.filter((b) => b.model === model), [board, model]);
  const open: BoardItem | null = items.find((b) => b.id === openId) ?? null;

  if (locked) {
    return (
      <OsPage>
        <PageHead eyebrow="Operations" title={info.name} />
        <Gate2Lock vertical={vertical} />
      </OsPage>
    );
  }

  return (
    <OsPage>
      <PageHead
        eyebrow="Operations"
        title={info.name}
        lede={`${offer?.label ?? verticalLabel} records from first enquiry to completion. Open a card to see its record and move it to the next stage.`}
        actions={<Btn variant="primary" onClick={() => setAdding(true)}><Plus size={14} aria-hidden /> New</Btn>}
      />
      <PreviewBanner />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Operations' },
        { label: 'Vertical', value: verticalLabel },
        { label: 'Subcategory', value: offer?.label ?? '—' },
        { label: 'Data', value: <PreviewPill /> },
      ]} />
      <div style={{ marginBottom: 12 }}>
        <Seg label="View" value={view} onChange={setView} options={[{ v: 'board', l: 'Board', n: items.length }, { v: 'table', l: 'Table' }]} />
      </div>

      {view === 'board' ? (
        <Board>
          {info.cols.map((c) => {
            const col = items.filter((b) => b.col === c);
            return (
              <BoardCol key={c} title={c} count={col.length} tone={info.tone}>
                {col.map((b) => (
                  <BoardCard key={b.id} t={b.t} m={b.m} amt={b.amt} tag={<TagPill tag={b.tag} />} onClick={() => setOpenId(b.id)} />
                ))}
              </BoardCol>
            );
          })}
        </Board>
      ) : (
        <TableWrap>
          <table className="gx-tbl">
            <thead><tr><th>Record</th><th>Stage</th><th>Contact</th><th>Detail</th><th className="num">Value</th><th className="act">Action</th></tr></thead>
            {items.length === 0 ? <EmptyRow cols={6} title="No records yet" text="Use New to add the first one." /> : (
              <tbody>
                {items.map((b) => (
                  <tr key={b.id} className="click" onClick={() => setOpenId(b.id)}>
                    <td className="strong">{b.t} <TagPill tag={b.tag} /><div className="sub mono">{b.id}</div></td>
                    <td><Pill tone="info">{b.col}</Pill></td>
                    <td>{b.contact}</td>
                    <td>{b.m}</td>
                    <td className="num nowrap">{b.amt}</td>
                    <td className="act"><Btn size="sm" onClick={() => setOpenId(b.id)}>Open</Btn></td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </TableWrap>
      )}

      <div style={{ marginTop: 14 }}>
        <DeclaredLifecycleCard offer={offer} />
      </div>

      <ItemDrawer item={open} onClose={() => setOpenId(null)} />
      <NewItemModal model={model} open={adding} onClose={() => setAdding(false)} />
    </OsPage>
  );
}
