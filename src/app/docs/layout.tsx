export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, fontFamily: "'DM Sans', sans-serif", overflow: 'hidden' }}>
        {children}
      </body>
    </html>
  );
}
