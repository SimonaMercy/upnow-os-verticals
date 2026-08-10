'use client';

import { useState } from 'react';
import type { EndpointEntry, OpenAPISpec } from '@/types/openapi';
import { MethodBadge } from './MethodBadge';
import { ParamTable } from './ParamTable';
import { RequestBodyPanel } from './RequestBodyPanel';
import { ResponsesPanel } from './ResponsesPanel';
import { groupOf, tagLabel } from './tagNames';
import { Markdown } from './Markdown';

function SectionCard({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <div style={{
      backgroundColor: '#ffffff',
      border: '1px solid #e8e6e0',
      borderRadius: 12,
      overflow: 'hidden',
      marginBottom: 16,
    }}>
      <div style={{
        padding: '11px 20px',
        borderBottom: '1px solid #f0f0f0',
        backgroundColor: '#fafaf8',
        fontWeight: 700,
        fontSize: 12,
        color: '#3d3b35',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        {title}
        {badge && (
          <span style={{
            backgroundColor: '#f0faf6', color: '#2e9f82',
            fontSize: 10, padding: '1px 6px', borderRadius: 99, fontWeight: 600,
            textTransform: 'none', letterSpacing: 0,
          }}>
            {badge}
          </span>
        )}
      </div>
      <div style={{ padding: '16px 20px' }}>
        {children}
      </div>
    </div>
  );
}

interface Props {
  endpoint: EndpointEntry;
  spec: OpenAPISpec;
  swaggerBaseUrl: string;
}

export function EndpointDetail({ endpoint, spec, swaggerBaseUrl }: Props) {
  const { path, method, operation } = endpoint;
  const [copied, setCopied] = useState(false);

  const copyPath = () => {
    navigator.clipboard.writeText(path).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const params = operation.parameters ?? [];
  const hasSecurity = !!operation.security?.length;
  const responseCount = Object.keys(operation.responses).length;
  const group = groupOf(endpoint.tag);
  const tagDescription = spec.tags?.find(t => t.name === endpoint.tag)?.description;

  return (
    <div style={{ maxWidth: 840, paddingBlock: 32, paddingInline: 32 }}>
      {/* Breadcrumb — product group › tag › operation */}
      <div style={{ fontSize: 12, color: '#9b9890', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {group && (
          <>
            <span style={{ fontWeight: 700, color: '#6b6860' }}>{group}</span>
            <span>›</span>
          </>
        )}
        <span>{tagLabel(endpoint.tag)}</span>
        <span>›</span>
        <span style={{ color: '#6b6860' }}>{operation.operationId ?? path}</span>
      </div>

      {/* What this tag covers, straight from the spec's tag description */}
      {tagDescription && (
        <p style={{ fontSize: 12.5, color: '#9b9890', margin: '0 0 10px', lineHeight: 1.6 }}>
          {tagDescription}
        </p>
      )}

      {/* Title */}
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1a1916', margin: '0 0 14px', lineHeight: 1.2 }}>
        {operation.summary ?? path}
      </h1>

      {/* Method + path bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        backgroundColor: '#f6f8fa', border: '1px solid #e8e6e0',
        borderRadius: 9, padding: '9px 14px', marginBottom: 16,
      }}>
        <MethodBadge method={method} size="lg" />
        <code style={{
          fontSize: 14, fontFamily: 'monospace', color: '#1a1916',
          flex: 1, wordBreak: 'break-all', lineHeight: 1.5,
        }}>
          {path}
        </code>
        <button
          onClick={copyPath}
          style={{
            background: 'none', border: '1px solid #e8e6e0', borderRadius: 6,
            padding: '4px 10px', cursor: 'pointer', fontSize: 11,
            color: copied ? '#15803d' : '#6b6860', fontWeight: 600,
            transition: 'color 0.1s',
          }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>

      {/* Deprecated warning */}
      {operation.deprecated && (
        <div style={{
          backgroundColor: '#fef3c7', border: '1px solid #fde68a',
          borderRadius: 8, padding: '10px 16px', marginBottom: 14,
          fontSize: 13, color: '#b45309', fontWeight: 600, display: 'flex', gap: 8,
        }}>
          ⚠️ This endpoint is deprecated and may be removed in a future version.
        </div>
      )}

      {/* Auth requirement */}
      {hasSecurity && (
        <div style={{
          backgroundColor: '#ede9fe', border: '1px solid #c4b5fd',
          borderRadius: 8, padding: '10px 16px', marginBottom: 14,
          fontSize: 13, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          🔒 <span><strong>Requires authentication</strong> — pass a Bearer token in the <code style={{ backgroundColor: '#ddd6fe', padding: '1px 5px', borderRadius: 3 }}>Authorization</code> header.</span>
        </div>
      )}

      {/* Description */}
      {operation.description && (
        <Markdown
          text={operation.description}
          style={{ fontSize: 15, color: '#3d3b35', lineHeight: 1.75, marginBottom: 20 }}
        />
      )}

      {/* Parameters */}
      {params.length > 0 && (
        <SectionCard title="Parameters" badge={String(params.length)}>
          <ParamTable parameters={params} spec={spec} />
        </SectionCard>
      )}

      {/* Request body */}
      {operation.requestBody && (
        <SectionCard title="Request Body">
          <RequestBodyPanel body={operation.requestBody} spec={spec} />
        </SectionCard>
      )}

      {/* Responses */}
      {responseCount > 0 && (
        <SectionCard title="Responses" badge={String(responseCount)}>
          <ResponsesPanel responses={operation.responses} spec={spec} />
        </SectionCard>
      )}

      {/* Footer */}
      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #e8e6e0', display: 'flex', gap: 16, alignItems: 'center' }}>
        <a
          // The backend serves one Swagger document per product group, slugged
          // off the group name (`/docs/rental-provider`, …).
          href={group ? `${swaggerBaseUrl}/docs/${group.toLowerCase().replace(/\s+/g, '-')}` : `${swaggerBaseUrl}/docs`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 13, color: '#2e9f82', textDecoration: 'none', fontWeight: 600 }}
        >
          Open in Swagger UI →
        </a>
        {operation.operationId && (
          <span style={{ fontSize: 12, color: '#9b9890', fontFamily: 'monospace' }}>
            {operation.operationId}
          </span>
        )}
      </div>
    </div>
  );
}
