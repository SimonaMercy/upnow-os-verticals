/**
 * Open every document together in ONE new browser tab as a simple gallery.
 *
 * Why not `docs.forEach(d => window.open(d.fileUrl))`? Browsers' pop-up blockers
 * only allow the FIRST window.open() per user gesture, so a loop opens at most
 * one tab (usually zero). Instead we open a single tab and render all docs into
 * it — images inline, everything else (PDFs) in an iframe.
 */
export interface ViewableDoc {
  fileUrl?: string | null;
  displayName?: string | null;
  documentKey?: string | null;
}

export function openDocsTogether(docs: ViewableDoc[]): void {
  const list = docs.filter((d) => d.fileUrl);
  if (!list.length) return;

  const w = window.open('', '_blank');
  if (!w) {
    alert('Please allow pop-ups for this site to view all documents together.');
    return;
  }

  const esc = (s: unknown) =>
    String(s ?? '').replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string),
    );

  const body = list
    .map((d) => {
      const url = esc(d.fileUrl);
      const name = esc(d.displayName ?? d.documentKey?.replace(/_/g, ' ') ?? 'Document');
      const isImg = /\.(jpe?g|png|gif|webp)(\?|$)/i.test(d.fileUrl ?? '');
      const viewer = isImg
        ? `<img src="${url}" style="max-width:100%;display:block" />`
        : `<iframe src="${url}" style="width:100%;height:88vh;border:0" loading="lazy"></iframe>`;
      return `<section style="margin:0 0 20px"><h3 style="margin:0;padding:10px 14px;font:600 14px system-ui;background:#fff;border-bottom:1px solid #eee">${name}</h3>${viewer}</section>`;
    })
    .join('');

  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>Documents (${list.length})</title></head>` +
      `<body style="margin:0;background:#f4f4f5">${body}</body></html>`,
  );
  w.document.close();
}
