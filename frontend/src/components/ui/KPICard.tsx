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
  blue: { bg: 'bg-sky-50', icon: 'text-sky-500' },
  green: { bg: 'bg-emerald-50', icon: 'text-emerald-500' },
  orange: { bg: 'bg-amber-50', icon: 'text-amber-500' },
  red: { bg: 'bg-red-50', icon: 'text-red-500' },
  purple: { bg: 'bg-primary-50', icon: 'text-primary-500' },
  cyan: { bg: 'bg-cyan-50', icon: 'text-cyan-500' },
};

export function KPICard({ title, value, subtitle, icon: Icon, trend, color = 'blue' }: KPICardProps) {
  const colors = colorMap[color];

  return (
    <div className="bg-white rounded-2xl border border-surface-200/60 p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] transition-shadow duration-200">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs font-medium text-surface-400 uppercase tracking-wide">{title}</p>
          <p className="mt-2 text-[28px] font-bold text-surface-900 leading-none">{value}</p>
          {subtitle && (
            <p className="mt-1.5 text-xs text-surface-400">{subtitle}</p>
          )}
        </div>
        <div className={clsx('p-2.5 rounded-xl', colors.bg)}>
          <Icon className={clsx('w-5 h-5', colors.icon)} />
        </div>
      </div>
      {trend !== undefined && (
        <div className="mt-4 pt-4 border-t border-surface-100 flex items-center gap-1.5">
          {trend > 0 ? (
            <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
          ) : trend < 0 ? (
            <TrendingDown className="w-3.5 h-3.5 text-red-500" />
          ) : (
            <Minus className="w-3.5 h-3.5 text-surface-400" />
          )}
          <span
            className={clsx(
              'text-xs font-medium',
              trend > 0 ? 'text-emerald-600' : trend < 0 ? 'text-red-500' : 'text-surface-400'
            )}
          >
            {trend > 0 ? '+' : ''}{trend}%
          </span>
          <span className="text-xs text-surface-400">vs ontem</span>
        </div>
      )}
    </div>
  );
}
