import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';

export function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
      <p className="text-5xl font-bold text-slate-300">404</p>
      <p className="text-lg font-semibold text-slate-900">Page not found</p>
      <p className="max-w-sm text-sm text-slate-500">
        The page you were looking for doesn’t exist or has moved.
      </p>
      <Link to="/">
        <Button type="button">Back to dashboard</Button>
      </Link>
    </div>
  );
}
