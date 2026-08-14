// The FAQ list. Its rows were the control: `<tr role="button" tabIndex={0}>` with a
// hand-rolled Enter/Space handler, which puts a whole table row in the tab order and
// announces a row as a button.
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import FaqsPage from './FaqsPage.jsx';

const collection = { items: [], loading: false, error: '', reload: vi.fn(), source: 'http' };
vi.mock('../../hooks/useAdminCollection.js', () => ({ default: () => collection }));

// The editor drawer opens on its own route-less state and is not what this covers.
vi.mock('./FaqEditorDrawer.jsx', () => ({
  default: ({ open }) => (open ? <div data-testid="faq-editor" /> : null),
}));

const FAQ = {
  id: 'f1',
  question: 'How do I start a SIP?',
  answer: 'Open a fund and choose Start SIP.',
  category: 'investing',
  order: 1,
  status: 'published',
};

beforeEach(() => {
  Object.assign(collection, { items: [FAQ], loading: false, error: '', reload: vi.fn() });
});

describe('FaqsPage rows', () => {
  test('no row is a button, and none is in the tab order', () => {
    const { container } = render(<FaqsPage />);
    expect(container.querySelectorAll('tr[role="button"]').length).toBe(0);
    expect(container.querySelectorAll('tr[tabindex]').length).toBe(0);
  });

  test('editing is an explicit button that names the FAQ it edits', () => {
    render(<FaqsPage />);
    const edit = screen.getByRole('button', { name: /Edit How do I start a SIP\?/u });
    expect(edit.getAttribute('type')).toBe('button');
    fireEvent.click(edit);
    expect(screen.getByTestId('faq-editor')).toBeTruthy();
  });

  test('a failed read is announced and does not read as an empty list', () => {
    const reload = vi.fn();
    Object.assign(collection, { items: [], error: 'Read failed', reload });
    render(<FaqsPage />);
    expect(screen.getByRole('alert').textContent).toContain('Read failed');
    expect(screen.queryByText('No FAQs yet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('an empty list teaches the workflow', () => {
    Object.assign(collection, { items: [] });
    render(<FaqsPage />);
    expect(screen.getByText('No FAQs yet')).toBeTruthy();
    expect(screen.getByText(/FAQs start as drafts/u)).toBeTruthy();
  });
});
