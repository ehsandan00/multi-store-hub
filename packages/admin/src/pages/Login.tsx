import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../lib/auth-store';
import { authApi, toApiError } from '../lib/api';
import { useToast } from '../lib/toast';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Field';

export function Login() {
  const { setSession } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: string } | null)?.from ?? '/';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await authApi.login(email.trim().toLowerCase(), password);
      setSession(res.user, res.accessToken, res.refreshToken);
      toast.success(`Welcome back, ${res.user.email}`);
      navigate(from, { replace: true });
    } catch (err) {
      const apiErr = toApiError(err);
      const msg =
        apiErr.statusCode === 401
          ? 'Invalid email or password.'
          : apiErr.statusCode === 429
            ? 'Too many attempts. Please wait a moment and try again.'
            : apiErr.message;
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-slate-50 to-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white">
            <span className="text-lg font-bold">H</span>
          </div>
          <div className="leading-tight">
            <p className="text-base font-semibold text-slate-900">Multi-Store Hub</p>
            <p className="text-xs text-slate-500">Sign in to your admin account</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4 p-6">
          <Input
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@hub.local"
          />
          <Input
            id="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          <Button type="submit" loading={loading} className="w-full">
            Sign in
          </Button>
          {error && (
            <p role="alert" className="text-center text-xs text-rose-600">
              {error}
            </p>
          )}
        </form>

        <details className="mt-4 rounded-lg border border-slate-200 bg-white/70 p-3 text-xs text-slate-500">
          <summary className="cursor-pointer font-medium text-slate-600">
            Seeded test accounts
          </summary>
          <ul className="mt-2 space-y-1">
            <li>admin@hub.local / Admin@123</li>
            <li>warehouse@hub.local / Warehouse@123</li>
            <li>viewer@hub.local / Viewer@123</li>
          </ul>
        </details>
      </div>
    </div>
  );
}
