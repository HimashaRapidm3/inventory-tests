import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Login from '../../../../inventory-ui/src/pages/Login';
import { AuthContext } from '../../../../inventory-ui/src/context/AuthContext';

function renderLogin(login = vi.fn().mockResolvedValue(undefined)) {
  render(
    <AuthContext.Provider value={{ login, user: null, profile: null, error: null }}>
      <MemoryRouter><Login /></MemoryRouter>
    </AuthContext.Provider>,
  );
  return login;
}

describe('Login', () => {
  it('shows a field error for an invalid email and does not call Firebase', async () => {
    const login = renderLogin();
    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Password is required.')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('signs in with the email and password entered', async () => {
    const login = renderLogin();
    await userEvent.type(screen.getByLabelText('Email'), 'ann@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('ann@example.com', 'secret123'));
  });

  it('shows an alert when sign-in fails', async () => {
    const login = renderLogin(vi.fn().mockRejectedValue(new Error('network down')));
    await userEvent.type(screen.getByLabelText('Email'), 'ann@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(login).toHaveBeenCalledTimes(1);
  });
});
