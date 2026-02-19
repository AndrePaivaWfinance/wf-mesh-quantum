import clsx from 'clsx';
import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}

export function Card({ children, className, padding = true }: CardProps) {
  return (
    <div
      className={clsx(
        'card bg-white rounded-2xl border border-surface-200/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)]',
        padding && 'p-6',
        className
      )}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function CardHeader({ title, subtitle, action }: CardHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-5">
      <div>
        <h3 className="text-[15px] font-semibold text-surface-900">{title}</h3>
        {subtitle && (
          <p className="text-xs text-surface-400 mt-0.5">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}
