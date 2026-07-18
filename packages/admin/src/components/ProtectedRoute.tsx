import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../lib/auth-store';
import type { Role } from '../lib/types';
import { FullPageSpinner } from './ui/Spinner';

interface ProtectedRouteProps {
  children: ReactNode;
  // When provided, only these roles may render. Others redirect to /403.
  roles?: Role[];
}

// Boot gate: while we have persisted tokens but no in-memory user yet, the
// App's AuthBootstrap will refresh /me. Until then, render a spinner.
let bootDone = false;
export function markAuthBootDone() {
  bootDone = true;
}

export function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const { t } = useTranslation();
  const { isAuthenticated, user } = useAuthStore();
  const location = useLocation();

  if (!isAuthenticated()) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (!user) {
    // We have tokens but user not yet loaded — App.AuthBootstrap is in flight.
    return bootDone ? (
      <Navigate to="/login" replace />
    ) : (
      <FullPageSpinner label={t('protectedRoute.loadingSession')} />
    );
  }

  if (roles && roles.length > 0 && !roles.includes(user.role)) {
    return <Navigate to="/403" replace />;
  }

  return <>{children}</>;
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  return <ProtectedRoute roles={roles}>{children}</ProtectedRoute>;
}
