import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransactionHistory from '../../../../inventory-ui/src/pages/TransactionHistory';
import { stockService } from '../../../../inventory-ui/src/services/services';

vi.mock('../../../../inventory-ui/src/services/services', () => ({ stockService: { history: vi.fn() } }));

const ROW = (over) => ({
  id: 1, type: 'IN', quantity: 3, quantityAfter: '8', note: null,
  product: { id: 9, sku: 'ELEC-001', name: 'Mouse' },
  user: { id: 1, displayName: 'Ann', email: 'ann@example.com' },
  createdAt: '2026-11-01T09:30:00Z',
  ...over,
});

const PAGE = (content) => ({ content, page: 0, totalPages: 1, totalElements: content.length });

describe('TransactionHistory', () => {
  beforeEach(() => {
    vi.mocked(stockService.history).mockReset();
    vi.mocked(stockService.history).mockResolvedValue(PAGE([]));
  });

  it('offers an Adjustment type filter and sends it to the API', async () => {
    render(<TransactionHistory />);
    await screen.findByText('No transactions found');

    await userEvent.selectOptions(screen.getByLabelText('Type'), 'ADJUST');

    await waitFor(() => expect(stockService.history).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'ADJUST' })));
  });

  it('shows ADJUST rows with a neutral badge and a signed quantity', async () => {
    vi.mocked(stockService.history).mockResolvedValue(PAGE([
      ROW({ id: 2, type: 'ADJUST', quantity: -3, quantityAfter: '5', note: 'Damaged' }),
    ]));
    render(<TransactionHistory />);

    expect(await screen.findByText('ADJUST')).toHaveClass('badge-neutral');
    expect(screen.getByText('-3')).toBeInTheDocument();
    expect(screen.getByText('Damaged')).toBeInTheDocument();
  });

  it('blocks a "from" date after "to" without calling the API', async () => {
    render(<TransactionHistory />);
    await screen.findByText('No transactions found');
    const [from, to] = document.querySelectorAll('input[type="date"]');

    // A valid "from" alone is a valid range, so it may fetch once. Count only after that.
    await userEvent.type(from, '2026-02-01');
    const callsBeforeInvalid = vi.mocked(stockService.history).mock.calls.length;
    await userEvent.type(to, '2026-01-01');

    expect(await screen.findByText('The "from" date must not be after the "to" date.')).toBeInTheDocument();
    expect(vi.mocked(stockService.history).mock.calls.length).toBe(callsBeforeInvalid);
  });
});
