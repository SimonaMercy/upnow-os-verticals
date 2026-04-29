'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { GUIDE_CATEGORIES, type GuideSection, type GuideCategory } from '@/data/guide';
import { GuideSidebar } from './GuideSidebar';
import { GuideMain } from './GuideMain';

// ── topbar ───────────────────────────────────────────────────────
function GuideTopbar({
  searchQuery,
  onSearchChange,
  totalSections,
  filteredCount,
}: {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  totalSections: number;
  filteredCount: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isFiltered = searchQuery.trim().length > 0;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        onSearchChange('');
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSearchChange]);

  return (
    <header style={{
      height: 56,
      flexShrink: 0,
      backgroundColor: '#ffffff',
      borderBottom: '1px solid #e8e6e0',
      display: 'flex',
      alignItems: 'center',
      paddingInline: 20,
      gap: 16,
      zIndex: 10,
    }}>
      {/* Brand */}
      <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'baseline', gap: 6, flexShrink: 0 }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: '#2e9f82' }}>UpNow</span>
        <span style={{ fontSize: 12, color: '#9b9890', fontWeight: 500 }}>Platform Guide</span>
      </Link>

      <div style={{ width: 1, height: 20, backgroundColor: '#e8e6e0', flexShrink: 0 }} />

      {/* Search */}
      <div style={{ flex: 1, maxWidth: 520, position: 'relative' }}>
        <span style={{
          position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)',
          fontSize: 13, color: '#9b9890', pointerEvents: 'none',
        }}>⌕</span>
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search features, workflows, roles…"
          style={{
            width: '100%',
            paddingBlock: 7,
            paddingInlineStart: 30,
            paddingInlineEnd: isFiltered ? 88 : 56,
            borderRadius: 8,
            border: `1.5px solid ${isFiltered ? '#2e9f82' : '#e8e6e0'}`,
            fontSize: 13,
            outline: 'none',
            backgroundColor: isFiltered ? '#f0faf6' : '#fafaf8',
            color: '#1a1916',
            boxSizing: 'border-box',
            transition: 'border-color 0.15s, background-color 0.15s',
          }}
        />
        {isFiltered ? (
          <button
            onClick={() => onSearchChange('')}
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 11, color: '#6b6860', padding: '2px 4px',
            }}
          >
            <span style={{ color: '#2e9f82', fontWeight: 700 }}>{filteredCount}/{totalSections}</span>
            <span style={{ color: '#9b9890' }}>✕</span>
          </button>
        ) : (
          <kbd style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            fontSize: 10, color: '#9b9890', backgroundColor: '#f6f8fa',
            border: '1px solid #e8e6e0', borderRadius: 4, padding: '2px 6px',
            fontFamily: 'monospace', pointerEvents: 'none',
          }}>⌘K</kbd>
        )}
      </div>

      <div style={{ flex: 1 }} />

      {/* Link to API docs */}
      <Link
        href="/docs"
        style={{
          fontSize: 12, color: '#6b6860', textDecoration: 'none',
          padding: '5px 10px', border: '1px solid #e8e6e0', borderRadius: 6,
          fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0,
        }}
      >
        API Docs ↗
      </Link>
    </header>
  );
}

// ── shell ─────────────────────────────────────────────────────────
export function GuideShell() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Flatten all sections
  const allSections = useMemo(() =>
    GUIDE_CATEGORIES.flatMap(cat => cat.sections.map(sec => ({ cat, sec }))),
    []
  );

  // Filter based on search
  const filteredCategories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return GUIDE_CATEGORIES;
    return GUIDE_CATEGORIES.map(cat => ({
      ...cat,
      sections: cat.sections.filter(sec =>
        sec.title.toLowerCase().includes(q) ||
        sec.description.toLowerCase().includes(q) ||
        (sec.tags ?? []).some(t => t.includes(q)) ||
        cat.label.toLowerCase().includes(q)
      ),
    })).filter(cat => cat.sections.length > 0);
  }, [searchQuery]);

  const filteredCount = filteredCategories.reduce((n, c) => n + c.sections.length, 0);

  // Auto-select first result when searching
  useEffect(() => {
    if (searchQuery.trim() && filteredCount > 0) {
      setSelectedId(filteredCategories[0].sections[0].id);
    }
  }, [searchQuery, filteredCount, filteredCategories]);

  // Auto-select first section on mount
  useEffect(() => {
    if (!selectedId && allSections.length > 0) {
      setSelectedId(allSections[0].sec.id);
    }
  }, [selectedId, allSections]);

  // Resolve selected section + its category
  const resolved = useMemo((): { sec: GuideSection; cat: GuideCategory } | null => {
    if (!selectedId) return null;
    const found = allSections.find(({ sec }) => sec.id === selectedId);
    return found ? { sec: found.sec, cat: found.cat } : null;
  }, [selectedId, allSections]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <GuideTopbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        totalSections={allSections.length}
        filteredCount={filteredCount}
      />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <GuideSidebar
          categories={filteredCategories}
          selectedId={selectedId}
          searchQuery={searchQuery}
          onSelect={setSelectedId}
        />
        <GuideMain
          section={resolved?.sec ?? null}
          categoryLabel={resolved?.cat.label}
          categoryIcon={resolved?.cat.icon}
        />
      </div>
    </div>
  );
}
