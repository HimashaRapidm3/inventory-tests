import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Products from '../../../../inventory-ui/src/pages/Products';
import { AuthContext } from '../../../../inventory-ui/src/context/AuthContext';
import { ToastProvider } from '../../../../inventory-ui/src/context/ToastContext';
import { categoryService, productService } from '../../../../inventory-ui/src/services/services';

vi.mock('../../../../inventory-ui/src/services/services', () => ({
  categoryService: { list: vi.fn() },
  productService: { search: vi.fn(), archive: vi.fn() },
}));

const PRODUCT = {
  id: 9, sku: 'ELEC-001', name: 'Mouse', category: { id: 1, name: 'Electronics' },
  supplier: null, price: '24.99', quantity: '5', reorderLevel: 10, lowStock: true,
};
const PAGE = { content: [PRODUCT], page: 0, totalPages: 1, totalElements: 1 };

function renderPage({ isAdmin }) {
  return render(
    <AuthContext.Provider value={{ isAdmin }}>
      <ToastProvider>
        <MemoryRouter><Products /></MemoryRouter>
      </ToastProvider>
    </AuthContext.Provider>,
  );
}

describe('Products', () => {
  beforeEach(() => {
    vi.mocked(categoryService.list).mockResolvedValue([]);
    vi.mocked(productService.search).mockResolvedValue(PAGE);
    vi.mocked(productService.archive).mockReset();
  });

  it('gives every signed-in user a History link to the product\'s movements', async () => {
    renderPage({ isAdmin: false });

    const link = await screen.findByRole('link', { name: 'History for Mouse' });
    expect(link).toHaveAttribute('href', '/products/9/history');
  });

  it('hides the Add product button and the edit and archive buttons from USERs', async () => {
    renderPage({ isAdmin: false });
    await screen.findByText('Mouse');

    expect(screen.queryByRole('link', { name: 'Add product' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit Mouse' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive Mouse' })).not.toBeInTheDocument();
  });

  it('shows the admin actions to ADMINs alongside the History link', async () => {
    renderPage({ isAdmin: true });

    expect(await screen.findByRole('link', { name: 'Add product' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit Mouse' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive Mouse' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'History for Mouse' })).toBeInTheDocument();
  });

  it('sends the low-stock filter to the API when ticked', async () => {
    renderPage({ isAdmin: false });
    await screen.findByText('Mouse');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Low stock only' }));

    await waitFor(() => expect(productService.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ lowStock: true })));
  });
});
