export const metadata = {
  title: 'API Documentation — UpNow',
  description: 'UpNow Marketplace REST API reference (OpenAPI / Swagger)',
};

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, fontFamily: 'sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
