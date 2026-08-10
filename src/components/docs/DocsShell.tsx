'use client';

import { useState, useEffect, useMemo } from 'react';
import type { OpenAPISpec, EndpointEntry, HttpMethod, GroupSection } from '@/types/openapi';
import { DocsTopbar } from './DocsTopbar';
import { DocsSidebar } from './DocsSidebar';
import { DocsMain } from './DocsMain';
import { groupOf, tagLabel } from './tagNames';

const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

/**
 * Nest the endpoints the way the spec declares them: product group (from
 * `x-tagGroups`) → tag → endpoints, with tags in `spec.tags` declaration order
 * rather than whatever order the paths happen to be emitted in.
 */
function buildGroups(spec: OpenAPISpec, endpoints: EndpointEntry[]): GroupSection[] {
  const byTag = new Map<string, EndpointEntry[]>();
  for (const e of endpoints) {
    if (!byTag.has(e.tag)) byTag.set(e.tag, []);
    byTag.get(e.tag)!.push(e);
  }

  const declaredOrder = new Map((spec.tags ?? []).map((t, i) => [t.name, i]));
  const descriptions = new Map((spec.tags ?? []).map(t => [t.name, t.description]));
  const sortTags = (tags: string[]) =>
    [...tags].sort(
      (a, b) =>
        (declaredOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (declaredOrder.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b),
    );

  const section = (name: string, tags: string[]): GroupSection => ({
    name,
    endpointCount: tags.reduce((n, t) => n + (byTag.get(t)?.length ?? 0), 0),
    tags: sortTags(tags).map(tag => ({
      tag,
      label: tagLabel(tag),
      description: descriptions.get(tag),
      endpoints: byTag.get(tag) ?? [],
    })),
  });

  const groups: GroupSection[] = [];
  const claimed = new Set<string>();

  for (const g of spec['x-tagGroups'] ?? []) {
    const tags = g.tags.filter(t => byTag.has(t));
    tags.forEach(t => claimed.add(t));
    if (tags.length) groups.push(section(g.name, tags));
  }

  // Anything the spec did not put in a group — fall back to the `Group · Tag`
  // prefix, then to a single trailing bucket, so nothing goes missing.
  const leftovers = [...byTag.keys()].filter(t => !claimed.has(t));
  const byPrefix = new Map<string, string[]>();
  for (const t of leftovers) {
    const key = groupOf(t) || 'Other';
    if (!byPrefix.has(key)) byPrefix.set(key, []);
    byPrefix.get(key)!.push(t);
  }
  for (const [name, tags] of byPrefix) {
    const existing = groups.find(g => g.name === name);
    if (existing) {
      const merged = section(name, [...existing.tags.map(t => t.tag), ...tags]);
      groups[groups.indexOf(existing)] = merged;
    } else {
      groups.push(section(name, tags));
    }
  }

  return groups;
}

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

// ── credentials ──────────────────────────────────────────────────
/**
 * The backend serves `/docs*` behind HTTP Basic auth, and a `fetch` gets a bare
 * 401 rather than the browser's own credentials dialog — so the viewer asks for
 * them here and sends them through the same-origin spec proxy. They are kept in
 * `sessionStorage` only: a reload keeps you signed in, closing the tab does not.
 */
const CREDS_KEY = 'upnow-docs-basic-auth';

function AuthScreen({
  onSubmit,
  rejected,
}: {
  onSubmit: (header: string) => void;
  rejected: boolean;
}) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user && !pass) return;
    onSubmit(`Basic ${btoa(`${user}:${pass}`)}`);
  };

  const field: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '9px 12px', marginBottom: 10,
    borderRadius: 8, border: '1px solid #e8e6e0', fontSize: 14,
    backgroundColor: '#fafaf8', color: '#1a1916', outline: 'none',
  };

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fafaf8' }}>
      <form onSubmit={submit} style={{ width: 340, padding: 28, backgroundColor: '#ffffff', border: '1px solid #e8e6e0', borderRadius: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: '#2e9f82' }}>UpNow</span>
          <span style={{ fontSize: 12, color: '#9b9890', fontWeight: 500 }}>API Docs</span>
        </div>
        <p style={{ fontSize: 13, color: '#6b6860', lineHeight: 1.6, margin: '0 0 16px' }}>
          The API reference is private. Sign in with the documentation credentials
          (<code style={{ fontFamily: 'monospace', fontSize: 12 }}>DOCS_BASIC_AUTH_USER</code> / <code style={{ fontFamily: 'monospace', fontSize: 12 }}>PASS</code>).
        </p>
        {rejected && (
          <div style={{
            backgroundColor: '#fee2e2', border: '1px solid #fca5a5', color: '#b91c1c',
            borderRadius: 8, padding: '8px 12px', fontSize: 12.5, marginBottom: 12,
          }}>
            Those credentials were rejected. Try again.
          </div>
        )}
        <input
          autoFocus
          value={user}
          onChange={e => setUser(e.target.value)}
          placeholder="Username"
          autoComplete="username"
          style={field}
        />
        <input
          value={pass}
          onChange={e => setPass(e.target.value)}
          placeholder="Password"
          type="password"
          autoComplete="current-password"
          style={field}
        />
        <button
          type="submit"
          style={{
            width: '100%', padding: '9px 12px', borderRadius: 8, border: 'none',
            backgroundColor: '#2e9f82', color: '#ffffff', fontWeight: 700,
            fontSize: 14, cursor: 'pointer',
          }}
        >
          View the docs
        </button>
      </form>
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
  /** Same-origin proxy that fetches the spec from the API (see app/docs/spec). */
  specUrl: string;
  /** API origin, for the "open in Swagger UI" links. */
  apiOrigin: string;
}

export function DocsShell({ specUrl, apiOrigin }: Props) {
  const [spec, setSpec] = useState<OpenAPISpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Read on the first render, not from an effect: a stored credential must be
  // on the very first request, or every reload would flash the sign-in screen.
  const [authHeader, setAuthHeader] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : window.sessionStorage.getItem(CREDS_KEY),
  );
  const [needsAuth, setNeedsAuth] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Mirrors Swagger UI's spec selector (/docs/common, /docs/rental-provider, …)
  const [groupFilter, setGroupFilter] = useState<string | null>(null);

  const swaggerBaseUrl = apiOrigin;

  useEffect(() => {
    let cancelled = false;
    fetch(specUrl, {
      headers: authHeader ? { authorization: authHeader } : {},
      cache: 'no-store',
    })
      .then(async r => {
        if (r.status === 401) {
          // A stored credential that stopped working must not be retried
          // silently on the next load.
          sessionStorage.removeItem(CREDS_KEY);
          if (cancelled) return;
          setRejected(!!authHeader);
          setNeedsAuth(true);
          setLoading(false);
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status} from ${specUrl}`);
        const data = (await r.json()) as OpenAPISpec;
        if (cancelled) return;
        setSpec(data);
        setNeedsAuth(false);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [specUrl, authHeader]);

  const endpoints = useMemo(() => (spec ? flattenEndpoints(spec) : []), [spec]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const inGroup = (e: EndpointEntry) => !groupFilter || groupOf(e.tag) === groupFilter;
    if (!q) return endpoints.filter(inGroup);
    return endpoints.filter(e =>
      inGroup(e) && (
        e.path.toLowerCase().includes(q) ||
        e.method.includes(q) ||
        e.tag.toLowerCase().includes(q) ||
        (e.operation.summary?.toLowerCase().includes(q) ?? false) ||
        (e.operation.description?.toLowerCase().includes(q) ?? false) ||
        (e.operation.operationId?.toLowerCase().includes(q) ?? false)
      )
    );
  }, [endpoints, searchQuery, groupFilter]);

  const groups = useMemo(
    () => (spec ? buildGroups(spec, filtered) : []),
    [spec, filtered],
  );

  // Every group in the spec, regardless of the current filter — the picker must
  // not shrink to whatever is on screen.
  const allGroupNames = useMemo(
    () => (spec ? buildGroups(spec, endpoints).map(g => g.name) : []),
    [spec, endpoints],
  );

  // What the detail pane shows. Derived rather than pushed into state from an
  // effect: an explicit click wins, but only while that endpoint survives the
  // current search and product filter — otherwise a search falls through to its
  // first hit, and narrowing to one product drops a selection from another
  // instead of stranding it in the detail pane.
  const selectedEndpoint = useMemo(() => {
    if (selectedId) {
      const colon = selectedId.indexOf(':');
      const method = selectedId.slice(0, colon) as HttpMethod;
      const path = selectedId.slice(colon + 1);
      const match = filtered.find(e => e.method === method && e.path === path);
      if (match) return match;
    }
    return searchQuery.trim() ? filtered[0] ?? null : null;
  }, [selectedId, filtered, searchQuery]);

  // Keep the sidebar highlight on whatever is actually being shown.
  const shownId = selectedEndpoint
    ? `${selectedEndpoint.method}:${selectedEndpoint.path}`
    : null;

  if (loading) return <LoadingScreen />;
  if (needsAuth) {
    return (
      <AuthScreen
        rejected={rejected}
        onSubmit={header => {
          window.sessionStorage.setItem(CREDS_KEY, header);
          setRejected(false);
          setNeedsAuth(false);
          setLoading(true);
          setAuthHeader(header);
        }}
      />
    );
  }
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
        groupNames={allGroupNames}
        groupFilter={groupFilter}
        onGroupFilterChange={setGroupFilter}
        swaggerBaseUrl={swaggerBaseUrl}
      />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <DocsSidebar
          groups={groups}
          selectedId={shownId}
          searchQuery={searchQuery}
          onSelect={setSelectedId}
        />
        <DocsMain
          endpoint={selectedEndpoint}
          spec={spec}
          groups={groups}
          swaggerBaseUrl={swaggerBaseUrl}
          onSelectGroup={setGroupFilter}
        />
      </div>
    </div>
  );
}
