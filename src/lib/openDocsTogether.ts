/**
 * Open every document together in ONE new browser tab as a clean, continuous
 * feed — no per-file PDF-viewer chrome (toolbar / thumbnail sidebar / filename
 * bar), just the pages stacked like one scrollable document.
 *
 * Why one tab? Looping `window.open(d.fileUrl)` is blocked by browser pop-up
 * blockers (only the first per user gesture opens). So we open a single tab and
 * render all docs into it — images inline, PDFs in chrome-less iframes
 * (`#toolbar=0&navpanes=0` hides the Chromium PDF UI; `view=FitH` fits width).
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

  const card = (caption: string, inner: string) =>
    `<figure class="doc">
       <figcaption>${caption}</figcaption>
       ${inner}
     </figure>`;

  const body = list
    .map((d) => {
      const url = esc(d.fileUrl);
      const name = esc(d.displayName ?? d.documentKey?.replace(/_/g, ' ') ?? 'Document');
      const isImg = /\.(jpe?g|png|gif|webp)(\?|$)/i.test(d.fileUrl ?? '');
      if (isImg) {
        return card(name, `<img src="${url}" alt="${name}" />`);
      }
      // PDF — strip the native viewer chrome so it reads like a printed page.
      return card(
        name,
        `<iframe src="${url}#toolbar=0&navpanes=0&statusbar=0&view=FitH"
                 loading="lazy" title="${name}"></iframe>`,
      );
    })
    .join('');

  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8">
     <title>Documents (${list.length})</title>
     <style>
       :root { color-scheme: light; }
       * { box-sizing: border-box; }
       body { margin: 0; background: #e9e9ec; font-family: system-ui, -apple-system, sans-serif; padding: 28px 16px; }
       .doc { max-width: 920px; margin: 0 auto 28px; background: #fff;
              border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,.08); overflow: hidden; }
       .doc figcaption { padding: 12px 18px; font-size: 13px; font-weight: 600; color: #2b2b2b;
                         border-bottom: 1px solid #efefef; position: sticky; top: 0; background: #fff; z-index: 1; }
       .doc img { width: 100%; display: block; }
       .doc iframe { width: 100%; height: 92vh; border: 0; display: block; background: #fff; }
     </style></head>
     <body>${body}</body></html>`,
  );
  w.document.close();
}
