import { ArrowLeftRight, CalendarDays, MapPin, Search } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '../ui/Button';

export interface SearchValues {
  from: string;
  to: string;
  date: string;
}

function Box({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: typeof MapPin;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="min-w-0 flex-1">
      <label
        htmlFor={id}
        className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-500"
      >
        <Icon aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
        {label}
      </label>
      {children(id)}
    </div>
  );
}

const input =
  'block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-[15px] text-slate-900 placeholder:text-slate-400 focus:border-brand-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

/** From, to and date: the search card used on the home page and above the results. */
export function SearchBar({
  initial,
  onSearch,
  compact = false,
}: {
  initial: SearchValues;
  onSearch: (v: SearchValues) => void;
  compact?: boolean;
}) {
  const [v, setV] = useState(initial);
  return (
    <form
      aria-label="Search trips"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.date) onSearch({ from: v.from.trim(), to: v.to.trim(), date: v.date });
      }}
      className={`rounded-xl border border-slate-200 bg-white shadow-level2 dark:border-slate-700 dark:bg-slate-900 dark:shadow-none ${
        compact ? 'p-3 sm:p-4' : 'p-4 sm:p-5'
      }`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <Box label="From (city)" icon={MapPin}>
          {(id) => (
            <input
              id={id}
              className={input}
              placeholder="Freetown"
              value={v.from}
              onChange={(e) => setV({ ...v, from: e.target.value })}
            />
          )}
        </Box>
        <button
          type="button"
          aria-label="Swap from and to"
          onClick={() => setV({ ...v, from: v.to, to: v.from })}
          className="grid size-11 shrink-0 place-items-center self-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 md:self-end dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <ArrowLeftRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
        </button>
        <Box label="To (city)" icon={MapPin}>
          {(id) => (
            <input
              id={id}
              className={input}
              placeholder="Bo"
              value={v.to}
              onChange={(e) => setV({ ...v, to: e.target.value })}
            />
          )}
        </Box>
        <Box label="Date" icon={CalendarDays}>
          {(id) => (
            <input
              id={id}
              type="date"
              className={input}
              value={v.date}
              onChange={(e) => setV({ ...v, date: e.target.value })}
            />
          )}
        </Box>
        <Button type="submit" disabled={!v.date} className="md:min-w-36">
          <Search aria-hidden="true" className="size-4" strokeWidth={1.8} />
          Search trips
        </Button>
      </div>
    </form>
  );
}
