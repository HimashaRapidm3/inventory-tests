import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, setTokenProvider, setUnauthorizedHandler } from '../../../../inventory-ui/src/services/apiClient';

function jsonResponse(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiClient', () => {
  beforeEach(() => {
    setTokenProvider(async () => 'token-123');
    setUnauthorizedHandler(null);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('sends the Firebase ID token as a Bearer header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/auth/me');

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer token-123');
  });

  it('drops empty query parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/products', { params: { search: '', categoryId: undefined, page: 0, size: 20 } });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/products?page=0&size=20');
  });

  it('converts a ProblemDetail body into an ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(400, {
      status: 400, code: 'VALIDATION_FAILED', detail: 'Request validation failed.',
      fieldErrors: [{ field: 'sku', message: 'must be 3-50 characters' }],
    })));

    const error = await apiRequest('/api/products', { method: 'POST', body: {} }).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.fieldErrors).toEqual({ sku: 'must be 3-50 characters' });
  });

  it('calls the unauthorized handler on 401', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { code: 'UNAUTHENTICATED', detail: 'x' })));

    await expect(apiRequest('/api/auth/me')).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('keeps the user signed in on 503 and reports a readable message', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(503, { code: 'AUTH_SERVICE_UNAVAILABLE', detail: 'Auth down' })));

    await expect(apiRequest('/api/auth/me')).rejects.toMatchObject({ status: 503, message: 'Auth down' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('reports network failures as ApiError status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(apiRequest('/api/auth/me')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('returns null for 204 No Content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(apiRequest('/api/products/1', { method: 'DELETE' })).resolves.toBeNull();
  });
});
