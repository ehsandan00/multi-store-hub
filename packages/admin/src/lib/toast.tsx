import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cn } from './utils';

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastContextValue {
  push: (t: Omit<Toast, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((cur) => [...cur, { ...t, id }]);
      window.setTimeout(() => remove(id), 5000);
    },
    [remove],
  );

  const value: ToastContextValue = {
    push,
    success: (title, description) => push({ kind: 'success', title, description }),
    error: (title, description) => push({ kind: 'error', title, description }),
    info: (title, description) => push({ kind: 'info', title, description }),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3 sm:items-end sm:px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto w-full max-w-sm rounded-lg border p-3 shadow-md',
              t.kind === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
              t.kind === 'error' && 'border-rose-200 bg-rose-50 text-rose-900',
              t.kind === 'info' && 'border-slate-200 bg-white text-slate-900',
            )}
            onClick={() => remove(t.id)}
          >
            <p className="text-sm font-semibold">{t.title}</p>
            {t.description && <p className="mt-0.5 text-xs opacity-90">{t.description}</p>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
