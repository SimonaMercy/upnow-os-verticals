/**
 * A nested layout must not render its own <html>/<body> — the root layout owns
 * those, and duplicating them made React hydrate a tree that did not match the
 * server HTML. The full-height, non-scrolling frame the docs viewer needs is a
 * plain wrapper instead; the page font comes from the root layout like
 * everywhere else in the app.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: '100vh', overflow: 'hidden' }}>
      {children}
    </div>
  );
}
