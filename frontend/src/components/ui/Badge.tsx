import clsx from 'clsx';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const variants: Record<BadgeVariant, string> = {
  default: 'bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300',
  success: 'bg-success-50 dark:bg-green-900/30 text-success-600 dark:text-green-400',
  warning: 'bg-warning-50 dark:bg-yellow-900/30 text-warning-600 dark:text-yellow-400',
  danger: 'bg-danger-50 dark:bg-red-900/30 text-danger-600 dark:text-red-400',
  info: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  primary: 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400',
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
