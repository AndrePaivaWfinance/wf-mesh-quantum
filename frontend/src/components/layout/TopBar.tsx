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
    <header className="topbar h-16 flex items-center justify-between px-8 bg-nav-900 border-b border-white/[0.06]">
      {/* Search */}
      <div className="relative w-80">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
        <input
          type="text"
          placeholder="Buscar..."
          className="w-full pl-10 pr-4 py-2 rounded-xl bg-white/[0.06] border border-white/[0.08] text-sm text-white/80 placeholder:text-white/25 focus:outline-none focus:bg-white/[0.1] focus:border-primary-500/40 transition-all"
        />
      </div>

      <div className="flex items-center gap-1.5">
        {/* Sync button */}
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-primary-500/20 text-primary-300 text-xs font-medium hover:bg-primary-500/30 transition-colors disabled:opacity-50"
          title="Iniciar Ciclo"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          <span>Sincronizar</span>
        </button>

        {/* Notifications */}
        <button className="relative p-2.5 rounded-xl text-white/40 hover:text-white/70 hover:bg-white/[0.06] transition-colors">
          <Bell className="w-[18px] h-[18px]" />
          <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-primary-400 rounded-full" />
        </button>
      </div>
    </header>
  );
}
