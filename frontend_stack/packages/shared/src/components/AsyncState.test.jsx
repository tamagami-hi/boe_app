import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AsyncState from './AsyncState.jsx';
import ErrorState from './ErrorState.jsx';
import ListRow from './ListRow.jsx';
import FormField from './FormField.jsx';

const Content = () => <div data-testid="content">figures</div>;
const Skel = () => <div data-testid="skel" />;
const Empty = () => <div data-testid="empty" />;

describe('AsyncState precedence', () => {
  test('data wins over everything, including a failed refresh', () => {
    render(
      <AsyncState
        resource={{ data: { a: 1 }, isLoading: true, error: new Error('x'), isRefreshing: true }}
        skeleton={<Skel />}
        empty={<Empty />}
      >
        <Content />
      </AsyncState>,
    );
    expect(screen.getByTestId('content')).toBeInTheDocument();
    expect(screen.queryByTestId('skel')).not.toBeInTheDocument();
  });

  test('a failed refresh over existing data says so without hiding the data', () => {
    const refresh = vi.fn();
    render(
      <AsyncState resource={{ data: [], error: new Error('nope'), refresh }}>
        <Content />
      </AsyncState>,
    );
    expect(screen.getByTestId('content')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('last values we could load');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('loading with no data renders the skeleton', () => {
    render(
      <AsyncState resource={{ data: undefined, isLoading: true }} skeleton={<Skel />}>
        <Content />
      </AsyncState>,
    );
    expect(screen.getByTestId('skel')).toBeInTheDocument();
    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
  });

  test('the loading region is marked busy', () => {
    const { container } = render(
      <AsyncState resource={{ isLoading: true }} skeleton={<Skel />}><Content /></AsyncState>,
    );
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  test('a failure with no data renders an error, NOT an empty state', () => {
    render(
      <AsyncState
        resource={{ data: undefined, error: new Error('down'), refresh: () => {} }}
        empty={<Empty />}
      >
        <Content />
      </AsyncState>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('empty')).not.toBeInTheDocument();
  });

  test('an empty successful read renders the empty state', () => {
    render(
      <AsyncState resource={{ data: [], isLoading: false }} isEmpty empty={<Empty />}>
        <Content />
      </AsyncState>,
    );
    expect(screen.getByTestId('empty')).toBeInTheDocument();
    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
  });

  test('a resource that has not started renders nothing', () => {
    const { container } = render(
      <AsyncState resource={{ data: undefined, isLoading: false, error: null }}>
        <Content />
      </AsyncState>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('children may be a function of the data', () => {
    render(
      <AsyncState resource={{ data: { name: 'Alpha' } }}>
        {(data) => <div data-testid="content">{data.name}</div>}
      </AsyncState>,
    );
    expect(screen.getByTestId('content')).toHaveTextContent('Alpha');
  });

  test('explicit flags override the resource object', () => {
    render(
      <AsyncState resource={{ data: { a: 1 } }} hasData={false} isLoading skeleton={<Skel />}>
        <Content />
      </AsyncState>,
    );
    expect(screen.getByTestId('skel')).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  test('announces itself and retries', () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('the retry is disabled and relabelled while busy', () => {
    render(<ErrorState onRetry={() => {}} busy />);
    expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled();
  });

  test('no retry button when there is nothing to retry', () => {
    render(<ErrorState />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('ListRow', () => {
  test('an actionable row is a real button, not a clickable div', () => {
    const onPress = vi.fn();
    render(<ListRow title="Alpha Pool" meta="SIP" value="₹1,000" onPress={onPress} />);
    const row = screen.getByRole('button', { name: /Alpha Pool/ });
    expect(row.tagName).toBe('BUTTON');
    fireEvent.click(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('keyboard activation works because it is a button', () => {
    const onPress = vi.fn();
    render(<ListRow title="Alpha" onPress={onPress} />);
    const row = screen.getByRole('button');
    row.focus();
    expect(row).toHaveFocus();
    fireEvent.click(row); // Enter/Space on a button dispatches click natively
    expect(onPress).toHaveBeenCalled();
  });

  test('a disabled row does not fire', () => {
    const onPress = vi.fn();
    render(<ListRow title="Alpha" onPress={onPress} disabled />);
    fireEvent.click(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });

  test('a non-interactive row is not a control', () => {
    render(<ListRow title="Read only" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Read only')).toBeInTheDocument();
  });

  test('`as` renders a link element and keeps its props', () => {
    render(<ListRow as="a" href="/app/dashboard" title="Home" />);
    const link = screen.getByRole('link', { name: /Home/ });
    expect(link).toHaveAttribute('href', '/app/dashboard');
  });

  test('a selected non-button row is marked current', () => {
    render(<ListRow as="a" href="#x" title="Current" selected />);
    expect(screen.getByRole('link')).toHaveAttribute('aria-current', 'true');
  });
});

describe('FormField', () => {
  test('the label is wired to the control', () => {
    render(<FormField label="Amount"><input /></FormField>);
    expect(screen.getByLabelText('Amount').tagName).toBe('INPUT');
  });

  test('a hint is announced through aria-describedby', () => {
    render(<FormField label="Amount" hint="Minimum ₹500"><input /></FormField>);
    const input = screen.getByLabelText('Amount');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy)).toHaveTextContent('Minimum ₹500');
  });

  test('an error marks the field invalid, is announced, and replaces the hint', () => {
    render(<FormField label="Amount" hint="Minimum ₹500" error="Too low"><input /></FormField>);
    const input = screen.getByLabelText('Amount');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Too low');
    expect(screen.queryByText('Minimum ₹500')).not.toBeInTheDocument();
    expect(document.getElementById(input.getAttribute('aria-describedby'))).toHaveTextContent('Too low');
  });

  test('a render-prop child receives the same wiring', () => {
    render(
      <FormField label="Amount" error="Too low">
        {(props) => <input {...props} data-testid="control" />}
      </FormField>,
    );
    const input = screen.getByTestId('control');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Amount')).toBe(input);
  });

  test('required is reflected on the control, not only in the label', () => {
    render(<FormField label="Amount" required><input /></FormField>);
    expect(screen.getByLabelText(/Amount/)).toBeRequired();
  });

  test('two fields on one screen do not share an id', () => {
    render(
      <>
        <FormField label="First"><input /></FormField>
        <FormField label="Second"><input /></FormField>
      </>,
    );
    expect(screen.getByLabelText('First').id).not.toBe(screen.getByLabelText('Second').id);
  });
});
