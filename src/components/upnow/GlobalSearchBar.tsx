'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Home, Wrench, ChevronDown } from 'lucide-react';

type SearchMode = 'properties' | 'services';

const MODE_CONFIG: Record<SearchMode, { label: string; icon: React.ElementType; placeholder: string; route: string }> = {
  properties: {
    label: 'Properties',
    icon: Home,
    placeholder: 'Search properties, areas...',
    route: '/listings',
  },
  services: {
    label: 'Services',
    icon: Wrench,
    placeholder: 'Search services, e.g. plumbing...',
    route: '/services',
  },
};

export function GlobalSearchBar() {
  const router = useRouter();
  const [mode, setMode] = useState<SearchMode>('properties');
  const [query, setQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cfg = MODE_CONFIG[mode];
    const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
    router.push(`${cfg.route}${qs}`);
    setQuery('');
  }

  const cfg = MODE_CONFIG[mode];
  const Icon = cfg.icon;

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center rounded-full border overflow-hidden"
      style={{
        borderColor: 'var(--base-200)',
        backgroundColor: 'var(--base-100)',
        height: 40,
        minWidth: 280,
        maxWidth: 400,
      }}
    >
      {/* Mode selector */}
      <div className="relative flex-shrink-0" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setDropdownOpen((o) => !o)}
          className="flex items-center gap-1.5 px-3 h-10 text-sm font-medium border-r transition-colors hover:bg-[#eef1ef] cursor-pointer"
          style={{
            borderColor: 'var(--base-200)',
            color: 'var(--neutral-700)',
          }}
        >
          <Icon size={14} style={{ color: 'var(--primary)' }} />
          <span className="hidden sm:inline">{cfg.label}</span>
          <ChevronDown size={12} style={{ color: 'var(--neutral-500)' }} />
        </button>

        {dropdownOpen && (
          <div
            className="absolute top-full left-0 mt-1 w-44 bg-white rounded-xl py-1 z-50"
            style={{ boxShadow: '0 8px 24px -4px rgba(0,0,0,0.14)' }}
          >
            {(Object.keys(MODE_CONFIG) as SearchMode[]).map((m) => {
              const c = MODE_CONFIG[m];
              const MIcon = c.icon;
              const active = m === mode;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setDropdownOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-gray-50 cursor-pointer"
                  style={{ color: active ? 'var(--primary)' : 'var(--neutral-700)', fontWeight: active ? 500 : 400 }}
                >
                  <MIcon size={15} style={{ color: active ? 'var(--primary)' : 'var(--neutral-400)' }} />
                  {c.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Text input */}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={cfg.placeholder}
        className="flex-1 px-3 text-sm bg-transparent outline-none min-w-0"
        style={{ color: 'var(--neutral-900)' }}
      />

      {/* Submit */}
      <button
        type="submit"
        className="flex-shrink-0 grid place-items-center w-10 h-10 transition-opacity hover:opacity-80 cursor-pointer"
        style={{ backgroundColor: 'var(--primary)' }}
        aria-label="Search"
      >
        <Search size={16} color="white" />
      </button>
    </form>
  );
}
