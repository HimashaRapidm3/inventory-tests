import { describe, expect, it } from 'vitest';
import { validateAdjustment, validateProduct, validateRegister, validateStock, validateSupplier } from '../../../../inventory-ui/src/utils/validation';

const product = { sku: 'elec-001', name: 'Mouse', description: '', categoryId: '1', supplierId: '', price: '24.99', reorderLevel: '5' };

describe('validateRegister', () => {
  const ok = { email: 'a@example.com', displayName: 'Ann', password: 'secret123', confirmPassword: 'secret123' };

  it('accepts valid input', () => {
    expect(validateRegister(ok)).toEqual({});
  });

  it('requires a display name of at most 100 characters', () => {
    expect(validateRegister({ ...ok, displayName: '   ' }).displayName).toBe('Display name is required.');
    expect(validateRegister({ ...ok, displayName: 'a'.repeat(101) }).displayName).toBe('Display name must be at most 100 characters.');
  });

  it('requires 8+ character matching passwords', () => {
    expect(validateRegister({ ...ok, password: 'short', confirmPassword: 'short' }).password).toBeDefined();
    expect(validateRegister({ ...ok, confirmPassword: 'different1' }).confirmPassword).toBe('Passwords do not match.');
  });
});

describe('validateProduct', () => {
  it('accepts a padded lowercase SKU (the backend normalises it)', () => {
    expect(validateProduct({ ...product, sku: ' elec-001 ' })).toEqual({});
  });

  it('rejects SKUs outside 3-50 letters, digits and hyphens', () => {
    expect(validateProduct({ ...product, sku: 'AB' }).sku).toBeDefined();
    expect(validateProduct({ ...product, sku: 'A'.repeat(51) }).sku).toBeDefined();
    expect(validateProduct({ ...product, sku: 'EL EC' }).sku).toBeDefined();
  });

  it('rejects negative prices and more than two decimals', () => {
    expect(validateProduct({ ...product, price: '-1' }).price).toBeDefined();
    expect(validateProduct({ ...product, price: '1.005' }).price).toBeDefined();
    expect(validateProduct({ ...product, price: '0' })).toEqual({});
  });

  it('requires a category and a non-negative whole reorder level', () => {
    expect(validateProduct({ ...product, categoryId: '' }).categoryId).toBeDefined();
    expect(validateProduct({ ...product, reorderLevel: '1.5' }).reorderLevel).toBeDefined();
  });
});

describe('validateStock', () => {
  it('requires a whole quantity from 1 to 1,000,000', () => {
    expect(validateStock({ productId: '1', quantity: '0', note: '' }).quantity).toBeDefined();
    expect(validateStock({ productId: '1', quantity: '1000001', note: '' }).quantity).toBeDefined();
    expect(validateStock({ productId: '1', quantity: '1000000', note: '' })).toEqual({});
  });

  it('limits notes to 255 characters', () => {
    expect(validateStock({ productId: '1', quantity: '1', note: 'n'.repeat(256) }).note).toBeDefined();
  });
});

describe('validateAdjustment', () => {
  const ok = { productId: '1', quantity: '5', note: 'Found in count' };

  it('accepts a positive or negative whole change with a reason', () => {
    expect(validateAdjustment(ok)).toEqual({});
    expect(validateAdjustment({ ...ok, quantity: '-3' })).toEqual({});
    expect(validateAdjustment({ ...ok, quantity: '+2' })).toEqual({});
  });

  it('rejects a zero change with a clear message', () => {
    expect(validateAdjustment({ ...ok, quantity: '0' }).quantity).toBe('Change cannot be zero.');
  });

  it('rejects changes beyond ±1,000,000 and non-whole values', () => {
    expect(validateAdjustment({ ...ok, quantity: '1000001' }).quantity).toBeDefined();
    expect(validateAdjustment({ ...ok, quantity: '-1000001' }).quantity).toBeDefined();
    expect(validateAdjustment({ ...ok, quantity: '1.5' }).quantity).toBeDefined();
    expect(validateAdjustment({ ...ok, quantity: 'abc' }).quantity).toBeDefined();
    expect(validateAdjustment({ ...ok, quantity: '' }).quantity).toBeDefined();
  });

  it('requires a non-blank reason of at most 255 characters', () => {
    expect(validateAdjustment({ ...ok, note: '' }).note).toBe('A reason is required.');
    expect(validateAdjustment({ ...ok, note: '   ' }).note).toBe('A reason is required.');
    expect(validateAdjustment({ ...ok, note: 'n'.repeat(256) }).note).toBeDefined();
  });

  it('requires a product', () => {
    expect(validateAdjustment({ ...ok, productId: '' }).productId).toBeDefined();
  });
});

describe('validateSupplier', () => {
  it('checks the email format only when provided', () => {
    expect(validateSupplier({ name: 'Acme', email: '' })).toEqual({});
    expect(validateSupplier({ name: 'Acme', email: 'not-an-email' }).email).toBeDefined();
  });
});
