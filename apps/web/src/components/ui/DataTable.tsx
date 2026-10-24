import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** The first column is the row's title on phones; "actions" columns sit at the foot of the card. */
  kind?: 'title' | 'actions';
  className?: string;
}

/**
 * A list as a table on wide screens and as cards on phones. The same columns drive both, so a
 * list never has two layouts to keep in step.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty = 'Nothing to show yet.',
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300">
        {empty}
      </p>
    );
  }
  const title = columns.find((c) => c.kind === 'title') ?? columns[0]!;
  const actions = columns.filter((c) => c.kind === 'actions');
  const facts = columns.filter((c) => c !== title && c.kind !== 'actions');
  return (
    <>
      <div className="hidden overflow-x-auto rounded-2xl bg-white shadow-[var(--shadow-field)] md:block dark:bg-slate-900">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={`px-4 py-3 ${c.className ?? ''}`}>
                  {c.kind === 'actions' ? <span className="sr-only">{c.header}</span> : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => (
              <tr key={rowKey(r)} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-4 py-3 align-middle ${c.kind === 'actions' ? 'text-right' : ''} ${c.className ?? ''}`}
                  >
                    {c.kind === 'actions' ? (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {c.cell(r)}
                      </div>
                    ) : (
                      c.cell(r)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden">
        {rows.map((r) => (
          <li
            key={rowKey(r)}
            className="space-y-3 rounded-2xl bg-white p-4 shadow-[var(--shadow-field)] dark:bg-slate-900"
          >
            <div className="min-w-0 text-sm font-semibold">{title.cell(r)}</div>
            {facts.length > 0 && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {facts.map((c) => (
                  <div key={c.key} className="min-w-0">
                    <dt className="text-xs text-slate-600 dark:text-slate-400">{c.header}</dt>
                    <dd>{c.cell(r)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {actions.map((c) => (
              <div key={c.key} className="flex flex-wrap items-center gap-2">
                {c.cell(r)}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}
