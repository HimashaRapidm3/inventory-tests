import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import TransactionTable, { movementTone, signedQuantity } from '../../../../inventory-ui/src/components/TransactionTable';

const TX = (over) => ({
  id: 1,
  type: 'IN',
  quantity: 3,
  quantityAfter: '8',
  note: null,
  product: { id: 9, sku: 'ELEC-001', name: 'Mouse' },
  user: { id: 1, displayName: 'Ann', email: 'ann@example.com' },
  createdAt: '2026-11-01T09:30:00Z',
  ...over,
});

describe('movementTone', () => {
  it('uses green for IN, red for OUT and neutral for ADJUST', () => {
    expect(movementTone('IN')).toBe('success');
    expect(movementTone('OUT')).toBe('danger');
    expect(movementTone('ADJUST')).toBe('neutral');
  });
});

describe('signedQuantity', () => {
  it('shows a plus sign only for a positive ADJUST', () => {
    expect(signedQuantity(TX({ type: 'ADJUST', quantity: 4 }))).toBe('+4');
    expect(signedQuantity(TX({ type: 'ADJUST', quantity: -3 }))).toBe('-3');
    expect(signedQuantity(TX({ type: 'IN', quantity: 3 }))).toBe('3');
    expect(signedQuantity(TX({ type: 'OUT', quantity: 2 }))).toBe('2');
  });
});

describe('TransactionTable', () => {
  it('renders product, type badge, quantity, after value, user and note', () => {
    render(<TransactionTable transactions={[TX({ note: 'Delivery' })]} />);

    expect(screen.getByText('Mouse')).toBeInTheDocument();
    expect(screen.getByText('ELEC-001')).toBeInTheDocument();
    expect(screen.getByText('IN')).toHaveClass('badge-success');
    expect(screen.getByText('Ann')).toBeInTheDocument();
    expect(screen.getByText('Delivery')).toBeInTheDocument();
  });

  it('renders an ADJUST row with a neutral badge and a signed quantity', () => {
    render(<TransactionTable transactions={[TX({ type: 'ADJUST', quantity: -3, quantityAfter: '5', note: 'Damaged' })]} />);

    expect(screen.getByText('ADJUST')).toHaveClass('badge-neutral');
    expect(screen.getByText('-3')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('marks the table as refreshing while a reload is in progress', () => {
    const { container } = render(<TransactionTable transactions={[TX()]} refreshing />);
    expect(container.querySelector('table')).toHaveClass('is-refreshing');
  });
});
