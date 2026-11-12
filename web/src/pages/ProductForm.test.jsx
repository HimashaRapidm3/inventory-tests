import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProductForm from '../../../../inventory-ui/src/pages/ProductForm';
import { ToastProvider } from '../../../../inventory-ui/src/context/ToastContext';
import { categoryService, productService, supplierService } from '../../../../inventory-ui/src/services/services';
import { ApiError } from '../../../../inventory-ui/src/services/apiClient';

vi.mock('../../../../inventory-ui/src/services/services', () => ({
  categoryService: { list: vi.fn() },
  supplierService: { list: vi.fn() },
  productService: { get: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

function renderNew() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/products/new']}>
        <Routes>
          <Route path="/products/new" element={<ProductForm />} />
          <Route path="/products" element={<p>Products list</p>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

async function fillValidProduct() {
  await screen.findByLabelText('SKU');
  await userEvent.type(screen.getByLabelText('SKU'), 'elec-001');
  await userEvent.type(screen.getByLabelText('Name'), 'Mouse');
  await userEvent.selectOptions(screen.getByLabelText('Category'), '1');
  await userEvent.type(screen.getByLabelText('Price'), '24.99');
}

describe('ProductForm', () => {
  beforeEach(() => {
    vi.mocked(categoryService.list).mockResolvedValue([{ id: 1, name: 'Electronics' }]);
    vi.mocked(supplierService.list).mockResolvedValue([]);
    vi.mocked(productService.create).mockReset();
  });

  it('shows a client-side SKU error and does not call the API', async () => {
    renderNew();
    await screen.findByLabelText('SKU');
    await userEvent.type(screen.getByLabelText('SKU'), 'AB');
    await userEvent.click(screen.getByRole('button', { name: 'Save product' }));

    expect(await screen.findByText('SKU must be 3-50 characters: letters, digits and hyphens.')).toBeInTheDocument();
    expect(productService.create).not.toHaveBeenCalled();
  });

  it('sends the trimmed body with a numeric price and navigates back on success', async () => {
    vi.mocked(productService.create).mockResolvedValue({ name: 'Mouse' });
    renderNew();
    await fillValidProduct();
    await userEvent.click(screen.getByRole('button', { name: 'Save product' }));

    await waitFor(() => expect(productService.create).toHaveBeenCalledWith({
      sku: 'elec-001', name: 'Mouse', description: null, categoryId: 1, supplierId: null, price: 24.99, reorderLevel: 0,
    }));
    expect(await screen.findByText('Products list')).toBeInTheDocument();
  });

  it('shows backend field errors next to the matching input', async () => {
    vi.mocked(productService.create).mockRejectedValue(new ApiError({
      status: 409, code: 'DUPLICATE_RESOURCE', message: 'A product with this SKU already exists.',
      fieldErrors: { sku: 'SKU already exists.' },
    }));
    renderNew();
    await fillValidProduct();
    await userEvent.click(screen.getByRole('button', { name: 'Save product' }));

    expect(await screen.findByText('SKU already exists.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('A product with this SKU already exists.');
  });
});
