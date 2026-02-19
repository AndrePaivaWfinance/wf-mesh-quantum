import { Sun, Moon, Bell, RefreshCw } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { useState } from 'react';
import { api } from '../../api/client';

export function TopBar() {
  const { theme, toggleTheme } = useTheme();
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
    <header className="topbar h-16 flex items-center justify-between px-6 bg-white dark:bg-surface-900 border-b border-surface-200 dark:border-surface-700">
      <div>
        <h2 className="text-sm font-medium text-surface-500 dark:text-surface-400">
          BPO Operations Center
        </h2>
      </div>

      <div className="flex items-center gap-2">
        {/* Sync button */}
        <button
          onClick={handleSync}
          disabled={syncing}
          className="p-2 rounded-lg text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-white hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors disabled:opacity-50"
          title="Iniciar Ciclo"
        >
          <RefreshCw className={`w-5 h-5 ${syncing ? 'animate-spin' : ''}`} />
        </button>

        {/* Notifications */}
        <button className="relative p-2 rounded-lg text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-white hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-danger-500 rounded-full" />
        </button>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-white hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>

        {/* User avatar */}
        <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center ml-2">
          <span className="text-xs font-bold text-white">WF</span>
        </div>
      </div>
    </header>
  );
}
