import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Dashboard, { StockByCategoryChart } from '../../../../inventory-ui/src/pages/Dashboard';
import { dashboardService } from '../../../../inventory-ui/src/services/services';
import { ApiError } from '../../../../inventory-ui/src/services/apiClient';

vi.mock('../../../../inventory-ui/src/services/services', () => ({ dashboardService: { get: vi.fn() } }));

const EMPTY = {
  totalProducts: 0, totalStockQuantity: '0', lowStockCount: 0,
  lowStockProducts: [], recentTransactions: [], stockByCategory: [],
};

function renderDashboard() {
  return render(<MemoryRouter><Dashboard /></MemoryRouter>);
}

describe('StockByCategoryChart', () => {
  it('renders empty bars without error when every category is zero', () => {
    const { container } = render(<StockByCategoryChart rows={[
      { categoryName: 'A', totalQuantity: '0' }, { categoryName: 'B', totalQuantity: '0' },
    ]} />);
    const bars = container.querySelectorAll('.bar-fill');
    expect(bars).toHaveLength(2);
    bars.forEach((bar) => expect(bar.style.width).toBe('0%'));
  });

  it('shows exact labels for totals above Long.MAX_VALUE', () => {
    render(<StockByCategoryChart rows={[{ categoryName: 'Huge', totalQuantity: '18446744073709551614' }]} />);
    expect(screen.getByText('18,446,744,073,709,551,614')).toBeInTheDocument();
  });
});

describe('Dashboard', () => {
  beforeEach(() => vi.mocked(dashboardService.get).mockReset());

  it('shows a loading state, then empty states for an empty inventory', async () => {
    vi.mocked(dashboardService.get).mockResolvedValue(EMPTY);
    renderDashboard();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(await screen.findByText('No low-stock products')).toBeInTheDocument();
    expect(screen.getByText('No stock movements yet')).toBeInTheDocument();
  });

  it('shows the backend error and retries', async () => {
    vi.mocked(dashboardService.get)
      .mockRejectedValueOnce(new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'Server exploded.' }))
      .mockResolvedValueOnce({ ...EMPTY, totalStockQuantity: '9007199254740993' });
    renderDashboard();

    expect(await screen.findByRole('alert')).toHaveTextContent('Server exploded.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('9,007,199,254,740,993')).toBeInTheDocument();
  });

  it('shows recent ADJUST movements with a neutral badge', async () => {
    vi.mocked(dashboardService.get).mockResolvedValue({
      ...EMPTY,
      recentTransactions: [{
        id: 7, type: 'ADJUST', quantity: -2, quantityAfter: '3', createdAt: '2026-11-01T09:30:00Z',
        product: { id: 9, sku: 'ELEC-001', name: 'Mouse' },
        user: { id: 1, displayName: 'Ann', email: 'ann@example.com' },
      }],
    });
    renderDashboard();

    expect(await screen.findByText('ADJUST')).toHaveClass('badge-neutral');
  });

  it('shows a positive ADJUST with a plus sign, as on the history pages', async () => {
    vi.mocked(dashboardService.get).mockResolvedValue({
      ...EMPTY,
      recentTransactions: [{
        id: 8, type: 'ADJUST', quantity: 4, quantityAfter: '9', createdAt: '2026-11-01T09:30:00Z',
        product: { id: 9, sku: 'ELEC-001', name: 'Mouse' },
        user: { id: 1, displayName: 'Ann', email: 'ann@example.com' },
      }],
    });
    renderDashboard();

    expect(await screen.findByText('+4')).toBeInTheDocument();
  });
});
