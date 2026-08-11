'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';

interface Props {
  title: string;
  version: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  totalEndpoints: number;
  filteredCount: number;
  groupNames: string[];
  groupFilter: string | null;
  onGroupFilterChange: (g: string | null) => void;
}

export function DocsTopbar({
  version,
  searchQuery,
  onSearchChange,
  totalEndpoints,
  filteredCount,
  groupNames,
  groupFilter,
  onGroupFilterChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isFiltered = searchQuery.trim().length > 0;

  // Cmd+K / Ctrl+K focuses search
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
      boxShadow: '0 1px 0 #e8e6e0',
      zIndex: 10,
    }}>
      {/* Brand */}
      <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'baseline', gap: 6, flexShrink: 0 }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: '#2e9f82' }}>UpNow</span>
        <span style={{ fontSize: 12, color: '#9b9890', fontWeight: 500 }}>API Docs</span>
      </Link>

      <div style={{ width: 1, height: 20, backgroundColor: '#e8e6e0', flexShrink: 0 }} />

      {/* Search bar */}
      <div style={{ flex: 1, maxWidth: 520, position: 'relative' }}>
        <span style={{
          position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)',
          fontSize: 13, color: '#9b9890', pointerEvents: 'none', lineHeight: 1,
        }}>
          ⌕
        </span>
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search endpoints, methods, tags…"
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
            title="Clear search (Esc)"
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 11, color: '#6b6860', fontWeight: 500, padding: '2px 4px',
            }}
          >
            <span style={{ color: '#2e9f82', fontWeight: 700 }}>{filteredCount}/{totalEndpoints}</span>
            <span style={{ color: '#9b9890' }}>✕</span>
          </button>
        ) : (
          <kbd style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            fontSize: 10, color: '#9b9890', backgroundColor: '#f6f8fa',
            border: '1px solid #e8e6e0', borderRadius: 4, padding: '2px 6px',
            fontFamily: 'monospace', pointerEvents: 'none',
          }}>
            ⌘K
          </kbd>
        )}
      </div>

      <div style={{ flex: 1 }} />

      {/* Product filter — the counterpart of Swagger UI's spec selector */}
      {groupNames.length > 1 && (
        <select
          value={groupFilter ?? ''}
          onChange={e => onGroupFilterChange(e.target.value || null)}
          title="Show only one product's API"
          style={{
            fontSize: 12,
            padding: '5px 8px',
            borderRadius: 6,
            border: `1px solid ${groupFilter ? '#a7e0cd' : '#e8e6e0'}`,
            backgroundColor: groupFilter ? '#f0faf6' : '#ffffff',
            color: groupFilter ? '#1a5a4a' : '#6b6860',
            fontWeight: groupFilter ? 700 : 500,
            cursor: 'pointer',
            flexShrink: 0,
            maxWidth: 190,
          }}
        >
          <option value="">All products</option>
          {groupNames.map(g => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      )}

      {/* Version badge */}
      <span style={{
        fontSize: 11, backgroundColor: '#f0faf6', color: '#1a5a4a',
        padding: '3px 10px', borderRadius: 99, fontWeight: 700,
        border: '1px solid #d8f2e8', flexShrink: 0, fontFamily: 'monospace',
      }}>
        {version}
      </span>

      {/* Raw spec — same-origin. This is a client component, so referencing
          NEXT_PUBLIC_API_URL here would inline the backend host (a bare IP in
          prod) into the browser bundle for anyone to read. */}
      <a
        href="/docs-json"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontSize: 12, color: '#6b6860', textDecoration: 'none',
          padding: '5px 10px', border: '1px solid #e8e6e0', borderRadius: 6,
          fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0,
        }}
      >
        Raw spec ↗
      </a>
    </header>
  );
}
