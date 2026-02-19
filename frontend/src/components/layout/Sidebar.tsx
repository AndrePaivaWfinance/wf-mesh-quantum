import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  HelpCircle,
  BarChart3,
  History,
  Zap,
} from 'lucide-react';
import clsx from 'clsx';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/clientes', icon: Users, label: 'Clientes' },
  { to: '/autorizacoes', icon: ShieldCheck, label: 'Autorizações' },
  { to: '/duvidas', icon: HelpCircle, label: 'Dúvidas' },
  { to: '/metricas', icon: BarChart3, label: 'Métricas' },
  { to: '/historico', icon: History, label: 'Histórico' },
];

export function Sidebar() {
  return (
    <aside className="sidebar fixed left-0 top-0 h-screen w-[260px] flex flex-col z-40 bg-nav-900">
      {/* Logo */}
      <div className="h-16 flex items-center px-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary-500 flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-bold text-[15px] text-white tracking-tight">WF Mesh</span>
            <span className="block text-[10px] text-primary-300 font-medium tracking-widest uppercase">Quantum</span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 pt-6 space-y-1 overflow-y-auto">
        <p className="px-3 mb-3 text-[10px] font-semibold uppercase tracking-widest text-nav-600">Menu</p>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-150',
                isActive
                  ? 'bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'
              )
            }
          >
            <item.icon className="w-[18px] h-[18px] flex-shrink-0" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Bottom — user area */}
      <div className="p-4 mx-3 mb-3 rounded-xl bg-white/[0.05] border border-white/[0.06]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary-500/30 flex items-center justify-center">
            <span className="text-xs font-bold text-primary-300">WF</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white/80 truncate">WFinance</p>
            <p className="text-[10px] text-white/40">admin@wf.com</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
