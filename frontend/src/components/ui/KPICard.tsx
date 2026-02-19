import clsx from 'clsx';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: number;
  color?: 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'cyan';
}

const colorMap = {
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    icon: 'text-blue-600 dark:text-blue-400',
    ring: 'ring-blue-100 dark:ring-blue-900/40',
  },
  green: {
    bg: 'bg-green-50 dark:bg-green-900/20',
    icon: 'text-green-600 dark:text-green-400',
    ring: 'ring-green-100 dark:ring-green-900/40',
  },
  orange: {
    bg: 'bg-orange-50 dark:bg-orange-900/20',
    icon: 'text-orange-600 dark:text-orange-400',
    ring: 'ring-orange-100 dark:ring-orange-900/40',
  },
  red: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    icon: 'text-red-600 dark:text-red-400',
    ring: 'ring-red-100 dark:ring-red-900/40',
  },
  purple: {
    bg: 'bg-purple-50 dark:bg-purple-900/20',
    icon: 'text-purple-600 dark:text-purple-400',
    ring: 'ring-purple-100 dark:ring-purple-900/40',
  },
  cyan: {
    bg: 'bg-cyan-50 dark:bg-cyan-900/20',
    icon: 'text-cyan-600 dark:text-cyan-400',
    ring: 'ring-cyan-100 dark:ring-cyan-900/40',
  },
};

export function KPICard({ title, value, subtitle, icon: Icon, trend, color = 'blue' }: KPICardProps) {
  const colors = colorMap[color];

  return (
    <div className="bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-700 p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-surface-500 dark:text-surface-400">{title}</p>
          <p className="mt-2 text-2xl font-bold text-surface-900 dark:text-white">{value}</p>
          {subtitle && (
            <p className="mt-1 text-xs text-surface-400 dark:text-surface-500">{subtitle}</p>
          )}
        </div>
        <div className={clsx('p-2.5 rounded-xl ring-1', colors.bg, colors.ring)}>
          <Icon className={clsx('w-5 h-5', colors.icon)} />
        </div>
      </div>
      {trend !== undefined && (
        <div className="mt-3 flex items-center gap-1">
          {trend > 0 ? (
            <TrendingUp className="w-4 h-4 text-green-500" />
          ) : trend < 0 ? (
            <TrendingDown className="w-4 h-4 text-red-500" />
          ) : (
            <Minus className="w-4 h-4 text-surface-400" />
          )}
          <span
            className={clsx(
              'text-xs font-medium',
              trend > 0 ? 'text-green-600 dark:text-green-400' : trend < 0 ? 'text-red-600 dark:text-red-400' : 'text-surface-500'
            )}
          >
            {trend > 0 ? '+' : ''}{trend}% vs ontem
          </span>
        </div>
      )}
    </div>
  );
}
