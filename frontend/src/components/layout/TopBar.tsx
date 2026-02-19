import { Bell, RefreshCw, Search } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api/client';

export function TopBar() {
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.startCycle();
    } catch {
      // silent
    } finally {
      setTimeout(() => setSyncing(false), 2000);
    }
  };

  return (
    <header className="topbar sticky top-0 z-30 h-16 flex items-center justify-between px-8 bg-white/80 backdrop-blur-md border-b border-surface-200/60">
      {/* Search */}
      <div className="relative w-80">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
        <input
          type="text"
          placeholder="Buscar..."
          className="w-full pl-10 pr-4 py-2 rounded-xl bg-surface-100 border border-surface-200/60 text-sm text-surface-700 placeholder:text-surface-400 focus:outline-none focus:bg-white focus:border-primary-500/40 focus:ring-2 focus:ring-primary-500/10 transition-all"
        />
      </div>

      <div className="flex items-center gap-1.5">
        {/* Sync button */}
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-primary-500 text-white text-xs font-medium hover:bg-primary-600 transition-colors disabled:opacity-50 shadow-sm"
          title="Iniciar Ciclo"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          <span>Sincronizar</span>
        </button>

        {/* Notifications */}
        <button className="relative p-2.5 rounded-xl text-surface-400 hover:text-surface-600 hover:bg-surface-100 transition-colors">
          <Bell className="w-[18px] h-[18px]" />
          <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-primary-500 rounded-full" />
        </button>
      </div>
    </header>
  );
}
