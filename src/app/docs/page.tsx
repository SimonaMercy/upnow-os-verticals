import { DocsShell } from '@/components/docs/DocsShell';

export const metadata = {
  title: 'API Documentation — UpNow',
  description:
    'UpNow REST API reference — search endpoints, read request and response samples, and browse schemas.',
};

/**
 * The spec is served from our own origin by `app/docs-json/route.ts`, which
 * fetches it from the backend server-side. Pointing the browser at the backend
 * directly would put its host in the page — and would be blocked as mixed
 * content anyway, since that origin is plain http.
 */
const SPEC_URL = '/docs-json';

export default function DocsPage() {
  return <DocsShell specUrl={SPEC_URL} />;
}
