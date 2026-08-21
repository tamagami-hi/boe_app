import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import FaqsPage from './FaqsPage.jsx';

const collection = { rows: [], isLoading: false, error: null, refresh: vi.fn() };
vi.mock('../../data/adminResources.js', () => ({ useAdminFaqs: () => collection }));

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
  Object.assign(collection, { rows: [FAQ], isLoading: false, error: null, refresh: vi.fn() });
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
    const refresh = vi.fn();
    Object.assign(collection, { rows: [], error: new Error('Read failed'), refresh });
    render(<FaqsPage />);
    expect(screen.getByRole('alert').textContent).toContain('Read failed');
    expect(screen.queryByText('No FAQs yet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('an empty list teaches the workflow', () => {
    Object.assign(collection, { rows: [], error: null });
    render(<FaqsPage />);
    expect(screen.getByText('No FAQs yet')).toBeTruthy();
    expect(screen.getByText(/FAQs start as drafts/u)).toBeTruthy();
  });
});
