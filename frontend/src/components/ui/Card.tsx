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
        'card bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-700 shadow-sm',
        padding && 'p-5',
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
    <div className="flex items-center justify-between mb-4">
      <div>
        <h3 className="text-base font-semibold text-surface-900 dark:text-white">{title}</h3>
        {subtitle && (
          <p className="text-sm text-surface-500 dark:text-surface-400 mt-0.5">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}
