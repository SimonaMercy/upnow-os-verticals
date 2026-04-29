'use client';

import { useState } from 'react';
import type { EndpointEntry } from '@/types/openapi';
import { MethodBadge } from './MethodBadge';

// ── single endpoint row ─────────────────────────────────────────
function EndpointRow({
  endpoint,
  isSelected,
  onSelect,
}: {
  endpoint: EndpointEntry;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      title={endpoint.path}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '7px 12px 7px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        backgroundColor: isSelected ? '#f0faf6' : 'transparent',
        borderLeft: `2px solid ${isSelected ? '#2e9f82' : 'transparent'}`,
        border: 'none',
        borderLeftStyle: 'solid',
        borderLeftWidth: 2,
        borderLeftColor: isSelected ? '#2e9f82' : 'transparent',
        cursor: 'pointer',
        transition: 'background-color 0.1s',
      }}
      onMouseEnter={e => {
        if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = '#f9f8f6';
      }}
      onMouseLeave={e => {
        if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
      }}
    >
      <MethodBadge method={endpoint.method} size="sm" />
      <span style={{
        fontSize: 12,
        color: isSelected ? '#1a5a4a' : '#3d3b35',
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontWeight: isSelected ? 600 : 400,
        fontFamily: endpoint.operation.summary ? 'inherit' : 'monospace',
      }}>
        {endpoint.operation.summary ?? endpoint.path}
      </span>
    </button>
  );
}

// ── collapsible tag group ────────────────────────────────────────
function TagGroup({
  tag,
  endpoints,
  selectedId,
  onSelect,
}: {
  tag: string;
  endpoints: EndpointEntry[];
  selectedId: string | null;
  onSelect: (id: string, tag: string) => void;
}) {
  const hasSelected = endpoints.some(e => `${e.method}:${e.path}` === selectedId);
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '9px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'none',
          border: 'none',
          borderBottom: '1px solid #f4f3ef',
          cursor: 'pointer',
        }}
      >
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          color: hasSelected ? '#2e9f82' : '#6b6860',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          {tag}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: 10, backgroundColor: '#f0faf6', color: '#2e9f82',
            padding: '1px 6px', borderRadius: 99, fontWeight: 700,
          }}>
            {endpoints.length}
          </span>
          <span style={{ fontSize: 9, color: '#9b9890' }}>{open ? '▾' : '▸'}</span>
        </div>
      </button>

      {open && (
        <div style={{ paddingBlock: 4 }}>
          {endpoints.map(ep => {
            const id = `${ep.method}:${ep.path}`;
            return (
              <EndpointRow
                key={id}
                endpoint={ep}
                isSelected={selectedId === id}
                onSelect={() => onSelect(id, tag)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── sidebar ──────────────────────────────────────────────────────
interface Props {
  tags: Map<string, EndpointEntry[]>;
  selectedId: string | null;
  activeTag: string | null;
  searchQuery: string;
  onSelect: (id: string, tag: string) => void;
  onTagClick: (tag: string) => void;
}

export function DocsSidebar({ tags, selectedId, searchQuery, onSelect }: Props) {
  const tagEntries = Array.from(tags.entries());
  const isSearching = searchQuery.trim().length > 0;
  const totalFiltered = tagEntries.reduce((n, [, eps]) => n + eps.length, 0);

  return (
    <aside style={{
      width: 272,
      flexShrink: 0,
      backgroundColor: '#ffffff',
      borderRight: '1px solid #e8e6e0',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Sidebar header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid #e8e6e0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#6b6860', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Endpoints
        </span>
        <span style={{
          fontSize: 10, backgroundColor: isSearching ? '#f0faf6' : '#f4f3ef',
          color: isSearching ? '#2e9f82' : '#9b9890',
          padding: '1px 7px', borderRadius: 99, fontWeight: 600,
        }}>
          {totalFiltered}
        </span>
      </div>

      {/* No results */}
      {totalFiltered === 0 && (
        <div style={{ padding: '24px 16px', textAlign: 'center', color: '#9b9890', fontSize: 13 }}>
          No endpoints match &quot;{searchQuery}&quot;
        </div>
      )}

      {/* Results */}
      {isSearching ? (
        // Flat list when searching — shows tag label inline
        <div>
          {tagEntries.map(([tag, endpoints]) =>
            endpoints.map(ep => {
              const id = `${ep.method}:${ep.path}`;
              return (
                <div key={id}>
                  <EndpointRow
                    endpoint={ep}
                    isSelected={selectedId === id}
                    onSelect={() => onSelect(id, tag)}
                  />
                </div>
              );
            })
          )}
        </div>
      ) : (
        // Grouped by tag
        tagEntries.map(([tag, endpoints]) => (
          <TagGroup
            key={tag}
            tag={tag}
            endpoints={endpoints}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))
      )}
    </aside>
  );
}
