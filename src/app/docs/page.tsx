'use client';

import dynamic from 'next/dynamic';
import 'swagger-ui-react/swagger-ui.css';

// Loaded client-side only — swagger-ui-react uses browser APIs
const SwaggerUI = dynamic(() => import('swagger-ui-react'), { ssr: false });

/**
 * API Documentation page — renders the live OpenAPI spec from the backend.
 * Available at: /docs
 * Spec JSON:    <API_URL>/docs-json
 */
export default function DocsPage() {
  // NEXT_PUBLIC_API_URL ends with /api — strip it to reach the docs endpoint
  const baseUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api').replace(
    /\/api$/,
    '',
  );
  const specUrl = `${baseUrl}/docs-json`;

  return (
    <SwaggerUI
      url={specUrl}
      persistAuthorization
      tryItOutEnabled
      displayRequestDuration
      defaultModelsExpandDepth={-1}
    />
  );
}
