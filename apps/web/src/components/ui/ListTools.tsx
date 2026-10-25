import { Download, FileSpreadsheet, FileText, Search, Sheet } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { exportRows, type ExportFormat } from '../../lib/export';

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** The rows of a listing: table rows, or the cards of a list (never the lists nested inside a card). */
function itemsOf(root: HTMLElement): HTMLElement[] {
  const all = Array.from(
    root.querySelectorAll<HTMLElement>('tbody > tr, ul > li, ol > li, [data-list-item]'),
  );
  return all.filter((el) => {
    if (el.closest('dialog')) return false;
    const parentItem = el.parentElement?.closest('li');
    return !(parentItem && root.contains(parentItem));
  });
}

/**
 * A search box, a status filter and an export menu for any listing placed inside it. It works on
 * what is on screen (the table rows or list cards), so every listing in the system gets the same
 * tools without each page re-implementing them. Search looks at all the text of a row; the filter
 * offers the status labels found in the rows; export (CSV, Excel, PDF) takes the rows that are
 * showing.
 */
export function ListTools({
  title,
  children,
  className = '',
  search = true,
}: {
  /** Names the export file and the printed page. */
  title: string;
  children: ReactNode;
  className?: string;
  /** Hide the search box when the page already has its own. */
  search?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [shown, setShown] = useState<{ total: number; visible: number }>({ total: 0, visible: 0 });
  const [menu, setMenu] = useState(false);

  const apply = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const needle = clean(q).toLowerCase();
    const found = new Set<string>();
    let total = 0;
    let visible = 0;
    for (const item of itemsOf(el)) {
      const badges = Array.from(item.querySelectorAll<HTMLElement>('[data-badge]')).map((b) =>
        clean(b.textContent),
      );
      badges.forEach((b) => b && found.add(b));
      const okText = !needle || clean(item.textContent).toLowerCase().includes(needle);
      const okStatus = !status || badges.includes(status);
      const show = okText && okStatus;
      item.style.display = show ? '' : 'none';
      total += 1;
      if (show) visible += 1;
    }
    const list = Array.from(found).sort();
    setStatuses((cur) => (cur.join('|') === list.join('|') ? cur : list));
    setShown((cur) => (cur.total === total && cur.visible === visible ? cur : { total, visible }));
  }, [q, status]);

  useEffect(() => {
    apply();
    const el = root.current;
    if (!el) return;
    let frame = 0;
    const obs = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    });
    obs.observe(el, { childList: true, subtree: true });
    return () => {
      obs.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [apply]);

  const run = (format: ExportFormat) => {
    setMenu(false);
    const el = root.current;
    if (!el) return;
    const table = el.querySelector('table');
    let headers: string[];
    let rows: string[][];
    if (table) {
      const heads = Array.from(table.querySelectorAll<HTMLElement>('thead th'));
      const keep = heads.map(
        (h) => !h.hasAttribute('data-skip-export') && !/^(actions?)?$/i.test(clean(h.textContent)),
      );
      headers = heads.filter((_, i) => keep[i]).map((h) => clean(h.textContent));
      rows = Array.from(table.querySelectorAll<HTMLElement>('tbody > tr'))
        .filter((tr) => tr.style.display !== 'none')
        .map((tr) =>
          Array.from(tr.children)
            .filter((_, i) => keep[i])
            .map((td) => clean(td.textContent)),
        );
    } else {
      headers = ['Details'];
      rows = itemsOf(el)
        .filter((li) => li.style.display !== 'none')
        .map((li) => [
          clean((li.innerText || li.textContent || '').replace(/\n+/g, ' · ')).replace(
            /( · )+/g,
            ' · ',
          ),
        ]);
    }
    exportRows(format, title, headers, rows);
  };

  const hasItems = shown.total > 0;
  return (
    <div ref={root} className={`min-w-0 space-y-3 ${className}`}>
      {hasItems && (
        <div className="flex flex-wrap items-center gap-2" data-list-tools>
          {search ? (
            <div className="relative min-w-0 flex-1 basis-48">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500"
                strokeWidth={1.8}
              />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Search ${title.toLowerCase()}`}
                aria-label={`Search ${title}`}
                className="block min-h-11 w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-500 dark:border-slate-600 dark:bg-slate-900"
              />
            </div>
          ) : (
            <div className="flex-1" />
          )}
          {statuses.length > 1 && (
            <select
              aria-label={`Filter ${title}`}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="min-h-11 max-w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900"
            >
              <option value="">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          <div className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((v) => !v)}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-white px-3 text-sm font-semibold shadow-[var(--shadow-field)] hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700"
            >
              <Download aria-hidden="true" className="size-4" strokeWidth={1.8} />
              Export
            </button>
            {menu && (
              <div
                role="menu"
                className="absolute right-0 top-12 z-30 w-44 rounded-xl bg-white p-1.5 shadow-level3 dark:bg-slate-900"
              >
                {(
                  [
                    ['csv', 'CSV file', FileText],
                    ['excel', 'Excel file', FileSpreadsheet],
                    ['pdf', 'PDF (print)', Sheet],
                  ] as const
                ).map(([f, label, Icon]) => (
                  <button
                    key={f}
                    type="button"
                    role="menuitem"
                    onClick={() => run(f)}
                    className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Icon aria-hidden="true" className="size-4" strokeWidth={1.8} />
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {children}
      {hasItems && shown.visible === 0 && (
        <p
          role="status"
          className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300"
        >
          Nothing matches your search.
        </p>
      )}
    </div>
  );
}
