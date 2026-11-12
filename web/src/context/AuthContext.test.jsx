import { describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';

const calls = vi.hoisted(() => []);
const mockUser = vi.hoisted(() => ({
  email: 'a@example.com',
  emailVerified: false,
  reload: vi.fn(async () => { calls.push('reload'); mockUser.emailVerified = true; }),
  getIdToken: vi.fn(async (force) => { calls.push(force ? 'getIdToken(true)' : 'getIdToken'); return 't'; }),
}));
const mockAuth = vi.hoisted(() => ({ currentUser: mockUser }));

vi.mock('../../../../inventory-ui/src/firebase', () => ({ auth: mockAuth, firebaseConfigured: true }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (auth, cb) => { cb(mockUser); return () => {}; },
  signOut: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  updateProfile: vi.fn(),
  sendEmailVerification: vi.fn(),
}));
vi.mock('../../../../inventory-ui/src/services/services', () => ({
  authService: { me: vi.fn(async () => { calls.push('me'); return { id: 1, role: 'USER' }; }) },
}));

import { AuthProvider, useAuth } from '../../../../inventory-ui/src/context/AuthContext';

describe('AuthContext', () => {
  it('reloads the user and forces a token refresh before calling /api/auth/me', async () => {
    let ctx;
    function Probe() { ctx = useAuth(); return null; }
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(ctx.profile).not.toBeNull());

    calls.length = 0;
    await act(() => ctx.refreshVerification());

    expect(calls).toEqual(['reload', 'getIdToken(true)', 'me']);
    expect(ctx.emailVerified).toBe(true);
  });
});
