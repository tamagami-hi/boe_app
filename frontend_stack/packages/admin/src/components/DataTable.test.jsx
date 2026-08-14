// DataTable's row action. The row used to become the button:
// `<tr role="button" aria-label={`Open row ${index + 1}`} tabIndex={0}>`, which
// announces a position rather than a thing and puts every row in the tab order.
import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import DataTable from './DataTable.jsx';

const columns = [{ key: 'name', title: 'Name', renderCell: (row) => row.name }];
const rows = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];

describe('DataTable', () => {
  test('with no row action the rows carry no interactive semantics', () => {
    const { container } = render(<DataTable columns={columns} rows={rows} />);
    expect(container.querySelectorAll('tr[role="button"]').length).toBe(0);
    expect(container.querySelectorAll('tr[tabindex]').length).toBe(0);
    expect(container.querySelectorAll('button').length).toBe(0);
  });

  test('a row action is an explicit button named after its row', () => {
    const onRowClick = vi.fn();
    const { container } = render(
      <DataTable
        columns={columns}
        rows={rows}
        onRowClick={onRowClick}
        rowAction={{ label: 'Edit', describe: (row) => row.name }}
      />,
    );
    expect(container.querySelectorAll('tr[role="button"]').length).toBe(0);
    const edit = screen.getByRole('button', { name: 'Edit Alpha' });
    expect(edit.getAttribute('type')).toBe('button');
    fireEvent.click(edit);
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  test('the header gains a cell for the action column so the columns still line up', () => {
    const { container } = render(
      <DataTable columns={columns} rows={rows} onRowClick={() => {}} />,
    );
    const headerCells = container.querySelectorAll('thead th').length;
    const bodyCells = container.querySelectorAll('tbody tr:first-child td').length;
    expect(headerCells).toBe(bodyCells);
  });

  test('an empty result still reads as empty, and a loading one does not', () => {
    const { rerender } = render(
      <DataTable columns={columns} rows={[]} empty="Nothing recorded yet." />,
    );
    expect(screen.getByText('Nothing recorded yet.')).toBeTruthy();
    rerender(<DataTable columns={columns} rows={[]} loading empty="Nothing recorded yet." />);
    expect(screen.queryByText('Nothing recorded yet.')).toBeNull();
  });

  test('rows already loaded survive the next fetch', () => {
    const { container } = render(<DataTable columns={columns} rows={rows} loading />);
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(container.querySelectorAll('.ash-skel').length).toBe(0);
  });
});
