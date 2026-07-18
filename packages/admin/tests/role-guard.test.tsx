import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from '../src/components/ProtectedRoute';
import { useAuthStore } from '../src/lib/auth-store';
import type { AuthenticatedUser } from '../src/lib/types';

function renderAt(path: string, roles?: AuthenticatedUser['role'][]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/"
          element={
            <ProtectedRoute roles={roles}>
              <div>secret</div>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<div>login page</div>} />
        <Route path="/403" element={<div>forbidden</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute role guard', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
  });

  it('redirects unauthenticated users to /login', () => {
    renderAt('/');
    expect(screen.getByText('login page')).toBeInTheDocument();
    expect(screen.queryByText('secret')).toBeNull();
  });

  it('renders content for an authenticated user with a permitted role', () => {
    useAuthStore.setState({
      user: { id: 'u1', email: 'a@b.c', role: 'ADMIN' },
      accessToken: 'tok',
      refreshToken: 'rtok',
    });
    renderAt('/', ['ADMIN']);
    expect(screen.getByText('secret')).toBeInTheDocument();
  });

  it('redirects to /403 when the role is not permitted', () => {
    useAuthStore.setState({
      user: { id: 'u2', email: 'v@b.c', role: 'VIEWER' },
      accessToken: 'tok',
      refreshToken: 'rtok',
    });
    renderAt('/', ['ADMIN']);
    expect(screen.getByText('forbidden')).toBeInTheDocument();
    expect(screen.queryByText('secret')).toBeNull();
  });
});
