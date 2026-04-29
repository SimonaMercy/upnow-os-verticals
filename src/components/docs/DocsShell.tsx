'use client';

import { useState, useEffect, useMemo } from 'react';
import type { OpenAPISpec, EndpointEntry, HttpMethod } from '@/types/openapi';
import { DocsTopbar } from './DocsTopbar';
import { DocsSidebar } from './DocsSidebar';
import { DocsMain } from './DocsMain';

const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

function flattenEndpoints(spec: OpenAPISpec): EndpointEntry[] {
  const entries: EndpointEntry[] = [];
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = (pathItem as Record<string, unknown>)[method];
      if (!op || typeof op !== 'object') continue;
      const operation = op as EndpointEntry['operation'];
      const tag = operation.tags?.[0] ?? 'default';
      entries.push({ path, method, operation, tag });
    }
  }
  return entries;
}

// ── loading ─────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fafaf8' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          border: '3px solid #e8e6e0', borderTopColor: '#2e9f82',
          animation: 'spin 0.7s linear infinite',
          margin: '0 auto 14px',
        }} />
        <p style={{ color: '#6b6860', fontSize: 14 }}>Loading API documentation…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

// ── error ────────────────────────────────────────────────────────
function ErrorScreen({ error, specUrl }: { error: string; specUrl: string }) {
  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fafaf8' }}>
      <div style={{ textAlign: 'center', maxWidth: 420, padding: 32 }}>
        <div style={{ fontSize: 40, marginBottom: 14 }}>⚠️</div>
        <h2 style={{ color: '#1a1916', marginBottom: 8, fontSize: 18 }}>Could not load API spec</h2>
        <p style={{ color: '#6b6860', fontSize: 14, marginBottom: 12, lineHeight: 1.6 }}>
          Make sure the backend is running and reachable at{' '}
          <code style={{ backgroundColor: '#f6f8fa', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>
            {specUrl}
          </code>
        </p>
        <code style={{ color: '#b91c1c', fontSize: 12, fontFamily: 'monospace' }}>{error}</code>
      </div>
    </div>
  );
}

// ── main shell ───────────────────────────────────────────────────
interface Props {
  specUrl: string;
}

export function DocsShell({ specUrl }: Props) {
  const [spec, setSpec] = useState<OpenAPISpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // Derive base URL for "open swagger" links
  const swaggerBaseUrl = specUrl.replace(/\/docs-json$/, '');

  useEffect(() => {
    fetch(specUrl)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status} from ${specUrl}`); return r.json(); })
      .then((data: OpenAPISpec) => { setSpec(data); setLoading(false); })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, [specUrl]);

  const endpoints = useMemo(() => (spec ? flattenEndpoints(spec) : []), [spec]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return endpoints;
    return endpoints.filter(e =>
      e.path.toLowerCase().includes(q) ||
      e.method.includes(q) ||
      e.tag.toLowerCase().includes(q) ||
      (e.operation.summary?.toLowerCase().includes(q) ?? false) ||
      (e.operation.description?.toLowerCase().includes(q) ?? false) ||
      (e.operation.operationId?.toLowerCase().includes(q) ?? false)
    );
  }, [endpoints, searchQuery]);

  const tags = useMemo(() => {
    const map = new Map<string, EndpointEntry[]>();
    for (const e of filtered) {
      if (!map.has(e.tag)) map.set(e.tag, []);
      map.get(e.tag)!.push(e);
    }
    return map;
  }, [filtered]);

  // Auto-select first result while searching
  useEffect(() => {
    if (searchQuery.trim() && filtered.length > 0) {
      const first = filtered[0];
      setSelectedId(`${first.method}:${first.path}`);
      setActiveTag(first.tag);
    }
  }, [searchQuery, filtered]);

  const selectedEndpoint = useMemo(() => {
    if (!selectedId) return null;
    const colon = selectedId.indexOf(':');
    const method = selectedId.slice(0, colon) as HttpMethod;
    const path = selectedId.slice(colon + 1);
    return endpoints.find(e => e.method === method && e.path === path) ?? null;
  }, [selectedId, endpoints]);

  if (loading) return <LoadingScreen />;
  if (error || !spec) return <ErrorScreen error={error ?? 'Failed to load spec'} specUrl={specUrl} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <DocsTopbar
        title={spec.info.title}
        version={spec.info.version}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        totalEndpoints={endpoints.length}
        filteredCount={filtered.length}
      />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <DocsSidebar
          tags={tags}
          selectedId={selectedId}
          activeTag={activeTag}
          searchQuery={searchQuery}
          onSelect={(id, tag) => { setSelectedId(id); setActiveTag(tag); }}
          onTagClick={setActiveTag}
        />
        <DocsMain
          endpoint={selectedEndpoint}
          spec={spec}
          swaggerBaseUrl={swaggerBaseUrl}
        />
      </div>
    </div>
  );
}
