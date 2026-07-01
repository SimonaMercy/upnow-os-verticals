/**
 * Minimal CSV helpers — build a CSV string from headers + pre-formatted rows
 * and trigger a browser download. The backend already formats every cell
 * (dates, money, Yes/No, blanks), so these are pure string writers.
 */

/** Escape a single cell: wrap in quotes if it contains a comma, quote, or newline. */
export function toCsvCell(value: string): string {
  const s = value ?? '';
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Join headers + rows into a CSV string (with a UTF-8 BOM for Excel). */
export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(toCsvCell).join(','));
  return '﻿' + lines.join('\r\n');
}

/** Build the CSV and trigger a client-side download. */
export function downloadCsv(filename: string, headers: string[], rows: string[][]): void {
  const blob = new Blob([toCsv(headers, rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
