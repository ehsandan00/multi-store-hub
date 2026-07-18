import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/utils';

interface FieldProps {
  label?: ReactNode;
  error?: string;
  hint?: string;
  required?: boolean;
}

function FieldShell({
  label,
  error,
  hint,
  required,
  htmlFor,
  children,
}: FieldProps & { htmlFor?: string; children: ReactNode }) {
  return (
    <div>
      {label && (
        <label htmlFor={htmlFor} className="label">
          {label}
          {required && <span className="ms-0.5 text-rose-600">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & FieldProps
>(function Input({ label, error, hint, required, className, id, ...rest }, ref) {
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} htmlFor={id}>
      <input
        ref={ref}
        id={id}
        className={cn('input', error && 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/30', className)}
        required={required}
        {...rest}
      />
    </FieldShell>
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps
>(function Textarea({ label, error, hint, required, className, id, ...rest }, ref) {
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} htmlFor={id}>
      <textarea
        ref={ref}
        id={id}
        className={cn('input', error && 'border-rose-400', className)}
        required={required}
        {...rest}
      />
    </FieldShell>
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & FieldProps
>(function Select({ label, error, hint, required, className, id, children, ...rest }, ref) {
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} htmlFor={id}>
      <select
        ref={ref}
        id={id}
        className={cn('input', error && 'border-rose-400', className)}
        required={required}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
});
