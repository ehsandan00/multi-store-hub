import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './lib/toast';
import { Layout } from './components/Layout';
import { ProtectedRoute, markAuthBootDone } from './components/ProtectedRoute';
import { useAuthStore } from './lib/auth-store';
import { authApi } from './lib/api';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { ProductsList } from './pages/Products/List';
import { ProductDetail } from './pages/Products/Detail';
import { SitesList } from './pages/Sites/List';
import { ImportExportPage } from './pages/ImportExport';
import { SyncPage } from './pages/Sync';
import { OrdersList } from './pages/Orders/List';
import { UsersPage } from './pages/Users';
import { NotFound } from './pages/NotFound';
import { Forbidden } from './pages/Forbidden';

function AuthBootstrap() {
  const { accessToken, refreshToken, user, setUser, clear } = useAuthStore();

  useEffect(() => {
    // If we have tokens but no user (e.g. after a reload), fetch /auth/me.
    let cancelled = false;
    async function run() {
      if (!accessToken) {
        markAuthBootDone();
        return;
      }
      if (user) {
        markAuthBootDone();
        return;
      }
      try {
        const me = await authApi.me();
        if (!cancelled) setUser(me);
      } catch {
        if (!cancelled) clear();
      } finally {
        if (!cancelled) markAuthBootDone();
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, refreshToken]);

  return null;
}

export default function App() {
  return (
    <ToastProvider>
      <AuthBootstrap />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/products" element={<ProductsList />} />
          <Route path="/products/:id" element={<ProductDetail />} />
          <Route path="/sites" element={<SitesList />} />
          <Route path="/import-export" element={<ImportExportPage />} />
          <Route path="/sync" element={<SyncPage />} />
          <Route path="/orders" element={<OrdersList />} />
          <Route
            path="/users"
            element={
              <ProtectedRoute roles={['ADMIN']}>
                <UsersPage />
              </ProtectedRoute>
            }
          />
        </Route>
        <Route path="/403" element={<Forbidden />} />
        <Route path="/404" element={<NotFound />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Routes>
    </ToastProvider>
  );
}
