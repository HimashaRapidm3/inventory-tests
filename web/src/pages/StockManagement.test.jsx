import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StockManagement from '../../../../inventory-ui/src/pages/StockManagement';
import { AuthContext } from '../../../../inventory-ui/src/context/AuthContext';
import { ToastProvider } from '../../../../inventory-ui/src/context/ToastContext';
import { productService, stockService } from '../../../../inventory-ui/src/services/services';
import { ApiError } from '../../../../inventory-ui/src/services/apiClient';

vi.mock('../../../../inventory-ui/src/services/services', () => ({
  productService: { search: vi.fn() },
  stockService: { stockIn: vi.fn(), stockOut: vi.fn(), adjust: vi.fn() },
}));

const PRODUCTS = {
  content: [{ id: 9, sku: 'ELEC-001', name: 'Mouse', quantity: '5' }],
  totalElements: 1, page: 0, totalPages: 1,
};

function renderPage({ isAdmin }) {
  return render(
    <AuthContext.Provider value={{ isAdmin }}>
      <ToastProvider><StockManagement /></ToastProvider>
    </AuthContext.Provider>,
  );
}

async function pickProduct() {
  await screen.findByLabelText('Product');
  await userEvent.selectOptions(screen.getByLabelText('Product'), '9');
}

describe('StockManagement', () => {
  beforeEach(() => {
    vi.mocked(productService.search).mockResolvedValue(PRODUCTS);
    vi.mocked(stockService.stockIn).mockReset();
    vi.mocked(stockService.adjust).mockReset();
  });

  it('hides the Adjust tab from USERs', async () => {
    renderPage({ isAdmin: false });
    await screen.findByLabelText('Product');
    expect(screen.queryByRole('tab', { name: 'Adjust' })).not.toBeInTheDocument();
  });

  it('lets an ADMIN record a negative adjustment with a reason', async () => {
    vi.mocked(stockService.adjust).mockResolvedValue({ type: 'ADJUST', product: { name: 'Mouse' }, quantityAfter: '2' });
    renderPage({ isAdmin: true });
    await pickProduct();
    await userEvent.click(screen.getByRole('tab', { name: 'Adjust' }));
    await userEvent.type(screen.getByLabelText('Change'), '-3');
    await userEvent.type(screen.getByLabelText('Reason (required)'), 'Damaged in transit');
    await userEvent.click(screen.getByRole('button', { name: 'Record adjustment' }));

    await waitFor(() => expect(stockService.adjust).toHaveBeenCalledWith({
      productId: 9, delta: -3, note: 'Damaged in transit',
    }));
    expect(stockService.stockIn).not.toHaveBeenCalled();
  });

  it('blocks a zero change and a missing reason before calling the API', async () => {
    renderPage({ isAdmin: true });
    await pickProduct();
    await userEvent.click(screen.getByRole('tab', { name: 'Adjust' }));
    await userEvent.type(screen.getByLabelText('Change'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Record adjustment' }));

    expect(await screen.findByText('Change cannot be zero.')).toBeInTheDocument();
    expect(screen.getByText('A reason is required.')).toBeInTheDocument();
    expect(stockService.adjust).not.toHaveBeenCalled();
  });

  it('shows the backend 409 for an adjustment that would make stock negative', async () => {
    vi.mocked(stockService.adjust).mockRejectedValue(new ApiError({
      status: 409, code: 'INSUFFICIENT_STOCK',
      message: 'Insufficient stock for adjustment: requested decrease 6, available 5',
    }));
    renderPage({ isAdmin: true });
    await pickProduct();
    await userEvent.click(screen.getByRole('tab', { name: 'Adjust' }));
    await userEvent.type(screen.getByLabelText('Change'), '-6');
    await userEvent.type(screen.getByLabelText('Reason (required)'), 'Count error');
    await userEvent.click(screen.getByRole('button', { name: 'Record adjustment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Insufficient stock for adjustment: requested decrease 6, available 5');
  });

  it('shows a backend delta field error on the Change field', async () => {
    vi.mocked(stockService.adjust).mockRejectedValue(new ApiError({
      status: 400, code: 'VALIDATION_FAILED', message: 'Validation failed.',
      fieldErrors: { delta: 'must be between -1000000 and 1000000' },
    }));
    renderPage({ isAdmin: true });
    await pickProduct();
    await userEvent.click(screen.getByRole('tab', { name: 'Adjust' }));
    await userEvent.type(screen.getByLabelText('Change'), '5');
    await userEvent.type(screen.getByLabelText('Reason (required)'), 'Recount');
    await userEvent.click(screen.getByRole('button', { name: 'Record adjustment' }));

    expect(await screen.findByText('must be between -1000000 and 1000000')).toBeInTheDocument();
  });

  it('keeps Stock In working for USERs', async () => {
    vi.mocked(stockService.stockIn).mockResolvedValue({ type: 'IN', product: { name: 'Mouse' }, quantityAfter: '7' });
    renderPage({ isAdmin: false });
    await pickProduct();
    await userEvent.type(screen.getByLabelText('Quantity'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Record Stock In' }));

    await waitFor(() => expect(stockService.stockIn).toHaveBeenCalledWith({ productId: 9, quantity: 2, note: null }));
  });

  it('clears the entered amount and note when switching tabs, so nothing carries into Adjust', async () => {
    renderPage({ isAdmin: true });
    await pickProduct();
    await userEvent.type(screen.getByLabelText('Quantity'), '5');
    await userEvent.type(screen.getByLabelText('Note (optional)'), 'Delivery from supplier');
    await userEvent.click(screen.getByRole('tab', { name: 'Adjust' }));

    expect(screen.getByLabelText('Change')).toHaveValue('');
    expect(screen.getByLabelText('Reason (required)')).toHaveValue('');
    expect(stockService.adjust).not.toHaveBeenCalled();
  });
});
