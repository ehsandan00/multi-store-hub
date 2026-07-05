import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type Tone = 'gray' | 'green' | 'red' | 'amber' | 'blue';

const toneClass: Record<Tone, string> = {
  gray: 'bg-slate-100 text-slate-700',
  green: 'bg-emerald-100 text-emerald-800',
  red: 'bg-rose-100 text-rose-800',
  amber: 'bg-amber-100 text-amber-800',
  blue: 'bg-brand-100 text-brand-800',
};

export function Badge({
  tone = 'gray',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn('badge', toneClass[tone], className)}>{children}</span>;
}
