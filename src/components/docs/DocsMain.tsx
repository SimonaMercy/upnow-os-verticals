import type { EndpointEntry, OpenAPISpec } from '@/types/openapi';
import { EndpointDetail } from './EndpointDetail';

function EmptyState() {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#9b9890',
      textAlign: 'center',
      padding: 48,
      userSelect: 'none',
    }}>
      <div style={{ fontSize: 44, marginBottom: 14 }}>📄</div>
      <p style={{ fontSize: 16, fontWeight: 700, color: '#3d3b35', margin: '0 0 8px' }}>
        Select an endpoint
      </p>
      <p style={{ fontSize: 13, margin: 0, maxWidth: 260, lineHeight: 1.6 }}>
        Pick any endpoint from the sidebar or use the search bar to find what you need.
      </p>
      <p style={{ fontSize: 12, marginTop: 16, color: '#c4c2bc' }}>
        Press <kbd style={{ backgroundColor: '#f4f3ef', border: '1px solid #e8e6e0', borderRadius: 4, padding: '1px 6px', fontFamily: 'monospace', fontSize: 11 }}>⌘K</kbd> to search
      </p>
    </div>
  );
}

interface Props {
  endpoint: EndpointEntry | null;
  spec: OpenAPISpec;
  swaggerBaseUrl: string;
}

export function DocsMain({ endpoint, spec, swaggerBaseUrl }: Props) {
  return (
    <main style={{
      flex: 1,
      overflowY: 'auto',
      backgroundColor: '#fafaf8',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {endpoint
        ? <EndpointDetail endpoint={endpoint} spec={spec} swaggerBaseUrl={swaggerBaseUrl} />
        : <EmptyState />
      }
    </main>
  );
}
