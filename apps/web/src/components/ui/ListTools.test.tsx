import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Badge } from './Card';
import { DataTable } from './DataTable';
import { ListTools } from './ListTools';

const rows = [
  { id: '1', name: 'Alpha Coach', state: 'Active' },
  { id: '2', name: 'Bravo Bus', state: 'Retired' },
  { id: '3', name: 'Charlie Van', state: 'Active' },
];

afterEach(() => vi.restoreAllMocks());

describe('ListTools', () => {
  it('searches and filters the rows of a table', async () => {
    render(
      <DataTable
        name="Vehicles"
        rows={rows}
        rowKey={(r) => r.id}
        columns={[
          { key: 'name', header: 'Name', kind: 'title', cell: (r) => r.name },
          { key: 'state', header: 'State', cell: (r) => <Badge>{r.state}</Badge> },
        ]}
      />,
    );
    const visible = () =>
      Array.from(document.querySelectorAll<HTMLElement>('tbody > tr')).filter(
        (tr) => tr.style.display !== 'none',
      ).length;
    expect(visible()).toBe(3);
    await userEvent.type(screen.getByLabelText('Search Vehicles'), 'bravo');
    expect(visible()).toBe(1);
    await userEvent.clear(screen.getByLabelText('Search Vehicles'));
    await userEvent.selectOptions(screen.getByLabelText('Filter Vehicles'), 'Active');
    expect(visible()).toBe(2);
    await userEvent.type(screen.getByLabelText('Search Vehicles'), 'zzz');
    expect(await screen.findByText('Nothing matches your search.')).toBeInTheDocument();
  });

  it('searches a plain list and exports the visible rows as CSV', async () => {
    let saved = '';
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      void (b as Blob).text().then((t) => (saved = t));
      return 'blob:x';
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(
      <ListTools title="Trips">
        <ul>
          <li>Freetown to Bo</li>
          <li>Freetown to Kenema</li>
          <li>=cmd|calc</li>
        </ul>
      </ListTools>,
    );
    await userEvent.type(screen.getByLabelText('Search Trips'), 'kenema');
    await userEvent.click(screen.getByRole('button', { name: /export/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /csv/i }));
    await vi.waitFor(() => expect(saved).toContain('Freetown to Kenema'));
    expect(saved).not.toContain('Freetown to Bo');
  });

  it('never lets a cell be read as a spreadsheet formula', async () => {
    let saved = '';
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      void (b as Blob).text().then((t) => (saved = t));
      return 'blob:x';
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(
      <ListTools title="Notes">
        <ul>
          <li>=cmd|calc</li>
        </ul>
      </ListTools>,
    );
    await userEvent.click(screen.getByRole('button', { name: /export/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /csv/i }));
    await vi.waitFor(() => expect(saved).toContain("'=cmd|calc"));
  });
});
