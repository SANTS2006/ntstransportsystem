const BOM = String.fromCharCode(0xfeff);

export type ExportFormat = 'csv' | 'excel' | 'pdf';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A value written into a spreadsheet must never be read as a formula. */
const safeCell = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

function fileName(title: string, ext: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'export';
  return `${slug}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

function download(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const tableHtml = (headers: string[], rows: string[][]) =>
  `<table border="1" cellspacing="0" cellpadding="6"><thead><tr>${headers
    .map((h) => `<th>${esc(h)}</th>`)
    .join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;

/**
 * Saves the rows as CSV (opens in Excel), as an Excel sheet, or opens a print view whose "Save as
 * PDF" gives a PDF. No file leaves the browser.
 */
export function exportRows(
  format: ExportFormat,
  title: string,
  headers: string[],
  rows: string[][],
): void {
  if (format === 'csv') {
    const line = (cells: string[]) =>
      cells.map((c) => `"${safeCell(c).replace(/"/g, '""')}"`).join(',');
    const csv = [line(headers), ...rows.map(line)].join('\r\n');
    download(fileName(title, 'csv'), 'text/csv;charset=utf-8', `${BOM}${csv}`);
    return;
  }
  const safeRows = rows.map((r) => r.map(safeCell));
  if (format === 'excel') {
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>${tableHtml(headers, safeRows)}</body></html>`;
    download(fileName(title, 'xls'), 'application/vnd.ms-excel;charset=utf-8', html);
    return;
  }
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return;
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Arial,sans-serif;margin:24px;color:#0f172a}h1{font-size:18px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f1f5f9}p{font-size:11px;color:#64748b}</style></head><body><h1>${esc(title)}</h1><p>${esc(new Date().toLocaleString())}</p>${tableHtml(headers, rows)}</body></html>`,
  );
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}
