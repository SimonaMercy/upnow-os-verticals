'use client';

import { useState } from 'react';
import type { EndpointEntry, GroupSection, TagSection } from '@/types/openapi';
import { MethodBadge } from './MethodBadge';

// ── single endpoint row ─────────────────────────────────────────
function EndpointRow({
  endpoint,
  isSelected,
  onSelect,
  indent = 0,
}: {
  endpoint: EndpointEntry;
  isSelected: boolean;
  onSelect: () => void;
  indent?: number;
}) {
  return (
    <button
      onClick={onSelect}
      title={`${endpoint.method.toUpperCase()} ${endpoint.path}`}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '7px 12px',
        paddingInlineStart: 14 + indent,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        backgroundColor: isSelected ? '#f0faf6' : 'transparent',
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

// ── collapsible tag section ─────────────────────────────────────
function TagGroup({
  section,
  selectedId,
  onSelect,
}: {
  section: TagSection;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const hasSelected = section.endpoints.some(e => `${e.method}:${e.path}` === selectedId);
  const [open, setOpen] = useState(false);

  // Keep the selected endpoint's section open even if the user collapsed it
  // before selecting from search.
  const expanded = open || hasSelected;

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        title={section.description ?? section.tag}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '7px 14px 7px 22px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        <span style={{
          fontSize: 12,
          fontWeight: hasSelected ? 700 : 500,
          color: hasSelected ? '#2e9f82' : '#3d3b35',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {section.label}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: '#9b9890', fontWeight: 600 }}>
            {section.endpoints.length}
          </span>
          <span style={{ fontSize: 9, color: '#c4c2bc' }}>{expanded ? '▾' : '▸'}</span>
        </div>
      </button>

      {expanded && (
        <div style={{ paddingBottom: 4 }}>
          {section.endpoints.map(ep => {
            const id = `${ep.method}:${ep.path}`;
            return (
              <EndpointRow
                key={id}
                endpoint={ep}
                indent={12}
                isSelected={selectedId === id}
                onSelect={() => onSelect(id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── product group ───────────────────────────────────────────────
function ProductGroup({
  group,
  selectedId,
  onSelect,
}: {
  group: GroupSection;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const hasSelected = group.tags.some(t =>
    t.endpoints.some(e => `${e.method}:${e.path}` === selectedId),
  );
  const [open, setOpen] = useState(true);
  const expanded = open || hasSelected;

  return (
    <div style={{ borderBottom: '1px solid #f0efeb' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#fafaf8',
          border: 'none',
          borderBottom: expanded ? '1px solid #f4f3ef' : 'none',
          cursor: 'pointer',
        }}
      >
        <span style={{
          fontSize: 11,
          fontWeight: 800,
          color: hasSelected ? '#2e9f82' : '#6b6860',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          {group.name}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: 10, backgroundColor: '#f0faf6', color: '#2e9f82',
            padding: '1px 6px', borderRadius: 99, fontWeight: 700,
          }}>
            {group.endpointCount}
          </span>
          <span style={{ fontSize: 9, color: '#9b9890' }}>{expanded ? '▾' : '▸'}</span>
        </div>
      </button>

      {expanded && (
        <div style={{ paddingBlock: 2 }}>
          {group.tags.map(section => (
            <TagGroup
              key={section.tag}
              section={section}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── sidebar ──────────────────────────────────────────────────────
interface Props {
  groups: GroupSection[];
  selectedId: string | null;
  searchQuery: string;
  onSelect: (id: string) => void;
}

export function DocsSidebar({ groups, selectedId, searchQuery, onSelect }: Props) {
  const isSearching = searchQuery.trim().length > 0;
  const totalFiltered = groups.reduce((n, g) => n + g.endpointCount, 0);

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
        position: 'sticky',
        top: 0,
        backgroundColor: '#ffffff',
        zIndex: 1,
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
          {isSearching ? `No endpoints match “${searchQuery}”` : 'No endpoints'}
        </div>
      )}

      {isSearching ? (
        // Flat list when searching — the group tree just gets in the way
        <div>
          {groups.flatMap(g =>
            g.tags.flatMap(section =>
              section.endpoints.map(ep => {
                const id = `${ep.method}:${ep.path}`;
                return (
                  <EndpointRow
                    key={id}
                    endpoint={ep}
                    isSelected={selectedId === id}
                    onSelect={() => onSelect(id)}
                  />
                );
              }),
            ),
          )}
        </div>
      ) : (
        groups.map(group => (
          <ProductGroup
            key={group.name}
            group={group}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))
      )}
    </aside>
  );
}
