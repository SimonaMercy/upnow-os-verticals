import { DocsShell } from '@/components/docs/DocsShell';

export const metadata = {
  title: 'API Documentation — UpNow',
  description: 'UpNow REST API reference — search endpoints, view schemas, and try requests.',
};

export default function DocsPage() {
  const baseUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api').replace(/\/api$/, '');
  const specUrl = `${baseUrl}/docs-json`;
  return <DocsShell specUrl={specUrl} />;
}
