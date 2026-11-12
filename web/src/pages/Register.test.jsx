import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Register from '../../../../inventory-ui/src/pages/Register';
import { AuthContext } from '../../../../inventory-ui/src/context/AuthContext';

function renderRegister(register = vi.fn().mockResolvedValue(undefined)) {
  render(
    <AuthContext.Provider value={{ register }}>
      <MemoryRouter><Register /></MemoryRouter>
    </AuthContext.Provider>,
  );
  return register;
}

async function fill({ email = 'ann@example.com', name = 'Ann', password = 'secret123', confirm = 'secret123' } = {}) {
  await userEvent.type(screen.getByLabelText('Email'), email);
  await userEvent.type(screen.getByLabelText('Display name'), name);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.type(screen.getByLabelText('Confirm password'), confirm);
}

describe('Register', () => {
  it('rejects mismatched passwords without calling Firebase', async () => {
    const register = renderRegister();
    await fill({ confirm: 'different1' });
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });

  it('requires a password of at least 8 characters', async () => {
    const register = renderRegister();
    await fill({ password: 'short', confirm: 'short' });
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });

  it('registers with the email, display name and password', async () => {
    const register = renderRegister();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(register).toHaveBeenCalledWith('ann@example.com', 'Ann', 'secret123'));
  });
});
