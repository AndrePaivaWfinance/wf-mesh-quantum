import { useState, useEffect } from 'react';
import {
  History,
  CheckCircle2,
  XCircle,
  Tag,
  RefreshCw,
  AlertTriangle,
  UserCircle,
  ArrowUpDown,
  Search,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { PageLoader } from '../components/ui/LoadingSpinner';
import { api } from '../api/client';
import { mockHistorico } from '../data/mock';
import type { LucideIcon } from 'lucide-react';

const tipoConfig: Record<string, { icon: LucideIcon; color: string; label: string; variant: 'success' | 'danger' | 'info' | 'warning' | 'primary' | 'default' }> = {
  aprovacao: { icon: CheckCircle2, color: 'text-green-500', label: 'Aprovação', variant: 'success' },
  rejeicao: { icon: XCircle, color: 'text-red-500', label: 'Rejeição', variant: 'danger' },
  classificacao: { icon: Tag, color: 'text-blue-500', label: 'Classificação', variant: 'info' },
  ciclo: { icon: RefreshCw, color: 'text-purple-500', label: 'Ciclo', variant: 'primary' },
  alerta: { icon: AlertTriangle, color: 'text-orange-500', label: 'Alerta', variant: 'warning' },
  cliente: { icon: UserCircle, color: 'text-cyan-500', label: 'Cliente', variant: 'info' },
  sync: { icon: ArrowUpDown, color: 'text-green-500', label: 'Sync', variant: 'success' },
};

export function Historico() {
  const [items, setItems] = useState(mockHistorico);
  const [loading, setLoading] = useState(true);
  const [filterTipo, setFilterTipo] = useState<string>('todos');
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const res = await api.getHistorico();
        if (Array.isArray(res) && res.length > 0) setItems(res);
      } catch { /* use mock */ }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const filtered = items.filter((item) => {
    if (filterTipo !== 'todos' && item.tipo !== filterTipo) return false;
    if (search && !item.descricao.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Histórico</h1>
        <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
          Log de todas as ações e eventos do sistema
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
          <input
            type="text"
            placeholder="Buscar ações..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-lg text-sm text-surface-900 dark:text-white placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => setFilterTipo('todos')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filterTipo === 'todos'
                ? 'bg-primary-600 text-white'
                : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
            }`}
          >
            Todos
          </button>
          {Object.entries(tipoConfig).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => setFilterTipo(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filterTipo === key
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
              }`}
            >
              {cfg.label}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={History}
          title="Nenhuma ação encontrada"
          description="Ajuste seus filtros para ver o histórico."
        />
      ) : (
        <Card padding={false}>
          <div className="divide-y divide-surface-100 dark:divide-surface-800">
            {filtered.map((item) => {
              const cfg = tipoConfig[item.tipo] || tipoConfig.ciclo;
              const Icon = cfg.icon;
              return (
                <div
                  key={item.id}
                  className="flex items-start gap-4 p-4 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors"
                >
                  <div className={`mt-0.5 ${cfg.color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-surface-900 dark:text-white">{item.descricao}</p>
                    <div className="flex items-center gap-3 mt-1.5">
                      <Badge variant={cfg.variant}>{cfg.label}</Badge>
                      {item.clientName && (
                        <span className="text-xs text-surface-500">{item.clientName}</span>
                      )}
                      <span className="text-xs text-surface-400">
                        por <strong>{item.usuario}</strong>
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-surface-400 whitespace-nowrap">
                    {new Date(item.criadoEm).toLocaleString('pt-BR')}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
