import { DocsShell } from '@/components/docs/DocsShell';

export const metadata = {
  title: 'API Documentation — UpNow',
  description:
    'UpNow REST API reference — search endpoints, read request and response samples, and browse schemas.',
};

export default function DocsPage() {
  const apiOrigin = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api').replace(/\/api$/, '');
  // The spec comes through a same-origin proxy — the backend's /docs* routes are
  // behind HTTP Basic auth, which a cross-origin fetch cannot negotiate.
  // `apiOrigin` is still needed for the "open in Swagger UI" links.
  return <DocsShell specUrl="/docs/spec" apiOrigin={apiOrigin} />;
}
