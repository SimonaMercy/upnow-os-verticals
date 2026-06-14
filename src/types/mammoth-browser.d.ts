// mammoth ships a browser build without bundled types; declare it so the
// dynamic import type-checks. Used by addendum validation + contract DOCX print.
declare module 'mammoth/mammoth.browser';
