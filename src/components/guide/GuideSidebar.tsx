'use client';

import type { GuideCategory, GuideSection } from '@/data/guide';

interface Props {
  categories: GuideCategory[];
  selectedId: string | null;
  searchQuery: string;
  onSelect: (sectionId: string) => void;
}

export function GuideSidebar({ categories, selectedId, searchQuery, onSelect }: Props) {
  const isSearching = searchQuery.trim().length > 0;

  // Flat list of all matching sections when searching
  const flatMatches: { cat: GuideCategory; sec: GuideSection }[] = [];
  if (isSearching) {
    const q = searchQuery.toLowerCase();
    for (const cat of categories) {
      for (const sec of cat.sections) {
        const match =
          sec.title.toLowerCase().includes(q) ||
          sec.description.toLowerCase().includes(q) ||
          (sec.tags ?? []).some(t => t.includes(q)) ||
          cat.label.toLowerCase().includes(q);
        if (match) flatMatches.push({ cat, sec });
      }
    }
  }

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
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid #e8e6e0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#6b6860', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Contents
        </span>
        {isSearching && (
          <span style={{
            fontSize: 10, backgroundColor: '#f0faf6', color: '#2e9f82',
            padding: '1px 7px', borderRadius: 99, fontWeight: 600,
          }}>
            {flatMatches.length}
          </span>
        )}
      </div>

      {/* Search results — flat */}
      {isSearching && flatMatches.length === 0 && (
        <div style={{ padding: '24px 16px', textAlign: 'center', color: '#9b9890', fontSize: 13 }}>
          No sections match &quot;{searchQuery}&quot;
        </div>
      )}

      {isSearching ? (
        <div style={{ paddingBlock: 4 }}>
          {flatMatches.map(({ cat, sec }) => (
            <SidebarRow
              key={sec.id}
              icon={cat.icon}
              label={sec.title}
              sub={cat.label}
              isSelected={selectedId === sec.id}
              onSelect={() => onSelect(sec.id)}
            />
          ))}
        </div>
      ) : (
        categories.map(cat => (
          <CategoryGroup
            key={cat.id}
            category={cat}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))
      )}
    </aside>
  );
}

// ── category group ──────────────────────────────────────────────
function CategoryGroup({
  category,
  selectedId,
  onSelect,
}: {
  category: GuideCategory;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const hasSelected = category.sections.some(s => s.id === selectedId);

  return (
    <div>
      <div style={{
        padding: '10px 14px 6px',
        borderBottom: '1px solid #f4f3ef',
        display: 'flex',
        alignItems: 'center',
        gap: 7,
      }}>
        <span style={{ fontSize: 14 }}>{category.icon}</span>
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          color: hasSelected ? '#2e9f82' : '#6b6860',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          {category.label}
        </span>
      </div>
      <div style={{ paddingBlock: 4 }}>
        {category.sections.map(sec => (
          <SidebarRow
            key={sec.id}
            label={sec.title}
            isSelected={selectedId === sec.id}
            onSelect={() => onSelect(sec.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ── single row ──────────────────────────────────────────────────
function SidebarRow({
  icon,
  label,
  sub,
  isSelected,
  onSelect,
}: {
  icon?: string;
  label: string;
  sub?: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '7px 14px',
        display: 'flex',
        alignItems: sub ? 'flex-start' : 'center',
        flexDirection: sub ? 'column' : 'row',
        gap: sub ? 2 : 6,
        backgroundColor: isSelected ? '#f0faf6' : 'transparent',
        borderLeft: 'none',
        borderLeftStyle: 'solid',
        borderLeftWidth: 2,
        borderLeftColor: isSelected ? '#2e9f82' : 'transparent',
        border: 'none',
        cursor: 'pointer',
        paddingLeft: sub ? 14 : 20,
        transition: 'background-color 0.1s',
      }}
      onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = '#f9f8f6'; }}
      onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon && <span style={{ fontSize: 12 }}>{icon}</span>}
        <span style={{
          fontSize: 12,
          fontWeight: isSelected ? 600 : 400,
          color: isSelected ? '#1a5a4a' : '#3d3b35',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {label}
        </span>
      </div>
      {sub && (
        <span style={{ fontSize: 10, color: '#9b9890', paddingLeft: icon ? 18 : 0 }}>
          {sub}
        </span>
      )}
    </button>
  );
}
