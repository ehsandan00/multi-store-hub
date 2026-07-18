import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Login } from '../src/pages/Login';
import { ToastProvider } from '../src/lib/toast';
import { useAuthStore } from '../src/lib/auth-store';
import * as apiModule from '../src/lib/api';

function renderLogin() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <Login />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('Login page', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    vi.restoreAllMocks();
  });

  it('renders email + password fields and a submit button', () => {
    renderLogin();
    expect(screen.getByLabelText(/ایمیل/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/رمز عبور/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ورود/ })).toBeInTheDocument();
  });

  it('calls authApi.login with lowercased email and stores session on success', async () => {
    const user = userEvent.setup();
    const fake = {
      user: { id: 'u1', email: 'admin@hub.local', role: 'ADMIN' as const },
      accessToken: 'access-tok',
      refreshToken: 'refresh-tok',
      expiresIn: '15m',
    };
    const loginSpy = vi.spyOn(apiModule.authApi, 'login').mockResolvedValue(fake);

    renderLogin();

    await user.type(screen.getByLabelText(/ایمیل/i), 'ADMIN@HUB.LOCAL');
    await user.type(screen.getByLabelText(/رمز عبور/i), 'Admin@123');
    await user.click(screen.getByRole('button', { name: /ورود/ }));

    expect(loginSpy).toHaveBeenCalledWith('admin@hub.local', 'Admin@123');
    expect(useAuthStore.getState().accessToken).toBe('access-tok');
    expect(useAuthStore.getState().user?.email).toBe('admin@hub.local');
  });

  it('shows an invalid-credentials message on 401', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiModule.authApi, 'login').mockRejectedValue({
      response: { status: 401, data: { statusCode: 401, message: 'Invalid credentials' } },
      isAxiosError: true,
    });

    renderLogin();

    await user.type(screen.getByLabelText(/ایمیل/i), 'x@y.z');
    await user.type(screen.getByLabelText(/رمز عبور/i), 'wrongpwd');
    await user.click(screen.getByRole('button', { name: /ورود/ }));

    expect(await screen.findByText(/ایمیل یا رمز عبور نادرست/i)).toBeInTheDocument();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});
