import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '../../../../inventory-ui/src/context/AuthContext';
import ProtectedRoute from '../../../../inventory-ui/src/components/ProtectedRoute';

function renderAt(path, auth, { adminOnly = false } = {}) {
  const value = { loading: false, error: null, retryProfile: vi.fn(), logout: vi.fn(), ...auth };
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<p>Login page</p>} />
          <Route path="/products/new" element={<ProtectedRoute adminOnly={adminOnly}><p>Admin form</p></ProtectedRoute>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('ProtectedRoute', () => {
  it('redirects to /login when signed out', () => {
    renderAt('/products/new', { user: null, profile: null });
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('shows Forbidden to a USER on an admin route', () => {
    renderAt('/products/new', { user: {}, profile: { role: 'USER' } }, { adminOnly: true });
    expect(screen.getByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(screen.queryByText('Admin form')).not.toBeInTheDocument();
  });

  it('renders the page for an ADMIN', () => {
    renderAt('/products/new', { user: {}, profile: { role: 'ADMIN' } }, { adminOnly: true });
    expect(screen.getByText('Admin form')).toBeInTheDocument();
  });

  it('shows a loading state while the session is restored', () => {
    renderAt('/products/new', { loading: true, user: null, profile: null });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows the profile error with a retry when /api/auth/me fails', () => {
    renderAt('/products/new', { user: {}, profile: null, error: new Error('The authentication service is temporarily unavailable.') });
    expect(screen.getByRole('alert')).toHaveTextContent('temporarily unavailable');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
