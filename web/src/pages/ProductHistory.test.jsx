import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import ProductHistory from '../../../../inventory-ui/src/pages/ProductHistory';
import { stockService } from '../../../../inventory-ui/src/services/services';
import { ApiError } from '../../../../inventory-ui/src/services/apiClient';

vi.mock('../../../../inventory-ui/src/services/services', () => ({ stockService: { history: vi.fn() } }));

const ROW = (over) => ({
  id: 1, type: 'IN', quantity: 3, quantityAfter: '8', note: null,
  product: { id: 9, sku: 'ELEC-001', name: 'Mouse' },
  user: { id: 1, displayName: 'Ann', email: 'ann@example.com' },
  createdAt: '2026-11-01T09:30:00Z',
  ...over,
});

const PAGE = (content) => ({ content, page: 0, totalPages: 1, totalElements: content.length });

function renderAt(path = '/products/9/history') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/products/:id/history" element={<ProductHistory />} />
        <Route path="/products" element={<p>Products list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProductHistory', () => {
  beforeEach(() => {
    vi.mocked(stockService.history).mockReset();
  });

  it('requests only this product\'s movements from the API', async () => {
    vi.mocked(stockService.history).mockResolvedValue(PAGE([ROW()]));
    renderAt('/products/9/history');

    await screen.findByRole('heading', { name: 'Stock history — Mouse' });
    expect(stockService.history).toHaveBeenCalledWith(expect.objectContaining({ productId: 9 }));
  });

  it('shows the product name and its movements, including ADJUST rows', async () => {
    vi.mocked(stockService.history).mockResolvedValue(PAGE([
      ROW({ id: 2, type: 'ADJUST', quantity: 4, quantityAfter: '12', note: 'Stocktake' }),
      ROW({ id: 1, type: 'IN', quantity: 8, quantityAfter: '8', note: 'Delivery' }),
    ]));
    renderAt();

    expect(await screen.findByRole('heading', { name: 'Stock history — Mouse' })).toBeInTheDocument();
    expect(screen.getByText('+4')).toBeInTheDocument();
    expect(screen.getByText('Stocktake')).toBeInTheDocument();
    expect(screen.getByText('Delivery')).toBeInTheDocument();
  });

  it('shows an empty state when the product has no movements', async () => {
    vi.mocked(stockService.history).mockResolvedValue(PAGE([]));
    renderAt();

    expect(await screen.findByText('No movements for this product yet')).toBeInTheDocument();
  });

  it('shows the backend error and retries', async () => {
    vi.mocked(stockService.history)
      .mockRejectedValueOnce(new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'Server exploded.' }))
      .mockResolvedValueOnce(PAGE([ROW()]));
    renderAt();

    expect(await screen.findByRole('alert')).toHaveTextContent('Server exploded.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Stock history — Mouse' })).toBeInTheDocument();
  });

  it('links back to the products list', async () => {
    vi.mocked(stockService.history).mockResolvedValue(PAGE([]));
    renderAt();

    await screen.findByText('No movements for this product yet');
    await userEvent.click(screen.getByRole('link', { name: 'Back to products' }));
    expect(screen.getByText('Products list')).toBeInTheDocument();
  });

  it('rejects a malformed product id without calling the API', async () => {
    renderAt('/products/abc/history');

    expect(await screen.findByText('Invalid product link')).toBeInTheDocument();
    expect(stockService.history).not.toHaveBeenCalled();
  });

  it('starts another product unfiltered instead of carrying over the previous filter', async () => {
    vi.mocked(stockService.history).mockResolvedValue(PAGE([ROW()]));
    render(
      <MemoryRouter initialEntries={['/products/9/history']}>
        <Link to="/products/10/history">next product</Link>
        <Routes>
          <Route path="/products/:id/history" element={<ProductHistory />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Stock history — Mouse' });
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'ADJUST');
    await userEvent.click(screen.getByRole('link', { name: 'next product' }));

    await waitFor(() => expect(stockService.history).toHaveBeenLastCalledWith(
      expect.objectContaining({ productId: 10, type: '', page: 0 })));
  });
});
