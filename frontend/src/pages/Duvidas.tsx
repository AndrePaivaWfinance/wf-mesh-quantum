import { useState, useEffect } from 'react';
import { HelpCircle, Check, SkipForward, Tag } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { PageLoader } from '../components/ui/LoadingSpinner';
import { api } from '../api/client';
import { mockDuvidas } from '../data/mock';
import clsx from 'clsx';

export function Duvidas() {
  const [items, setItems] = useState(mockDuvidas);
  const [loading, setLoading] = useState(true);
  const [selectedCategoria, setSelectedCategoria] = useState<Record<string, string>>({});

  useEffect(() => {
    async function load() {
      try {
        const res = await api.getDuvidas();
        if (Array.isArray(res) && res.length > 0) setItems(res);
      } catch { /* use mock */ }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const handleResolver = async (id: string) => {
    const cat = selectedCategoria[id];
    if (!cat) return;
    try { await api.resolverDuvida(id, cat); } catch { /* silent */ }
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handlePular = async (id: string) => {
    try { await api.pularDuvida(id); } catch { /* silent */ }
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const pendentes = items.filter((i) => i.status === 'pendente');

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Dúvidas de Classificação</h1>
        <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
          Transações com baixa confiança que precisam de revisão manual
        </p>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2 text-sm">
          <div className="w-3 h-3 rounded-full bg-orange-500" />
          <span className="text-surface-600 dark:text-surface-400">
            <strong className="text-surface-900 dark:text-white">{pendentes.length}</strong> pendentes
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <div className="w-3 h-3 rounded-full bg-green-500" />
          <span className="text-surface-600 dark:text-surface-400">
            <strong className="text-surface-900 dark:text-white">{items.length - pendentes.length}</strong> resolvidas
          </span>
        </div>
      </div>

      {/* Doubt cards */}
      {pendentes.length === 0 ? (
        <EmptyState
          icon={HelpCircle}
          title="Sem dúvidas pendentes"
          description="Todas as classificações foram resolvidas pelo modelo AI."
        />
      ) : (
        <div className="space-y-4">
          {pendentes.map((item) => (
            <Card key={item.id} padding={false}>
              <div className="p-5">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-surface-900 dark:text-white">
                        {item.descricao}
                      </h3>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-surface-500">
                      <span>{item.clientName}</span>
                      <span>R$ {item.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                  <span className="text-xs text-surface-400">
                    {new Date(item.criadoEm).toLocaleString('pt-BR')}
                  </span>
                </div>

                {/* Category suggestions */}
                <div className="mb-4">
                  <p className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-2 flex items-center gap-1">
                    <Tag className="w-3.5 h-3.5" /> Categorias sugeridas pela AI
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {item.categoriasSugeridas.map((s) => (
                      <button
                        key={s.categoria}
                        onClick={() => setSelectedCategoria((prev) => ({ ...prev, [item.id]: s.categoria }))}
                        className={clsx(
                          'p-3 rounded-lg border text-left transition-all',
                          selectedCategoria[item.id] === s.categoria
                            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 ring-1 ring-primary-500'
                            : 'border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600'
                        )}
                      >
                        <p className="text-sm font-medium text-surface-900 dark:text-white">
                          {s.categoria}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
                            <div
                              className={clsx(
                                'h-full rounded-full',
                                s.confianca > 0.5 ? 'bg-green-500' : s.confianca > 0.3 ? 'bg-yellow-500' : 'bg-red-500'
                              )}
                              style={{ width: `${s.confianca * 100}%` }}
                            />
                          </div>
                          <span className="text-xs text-surface-500 tabular-nums">
                            {(s.confianca * 100).toFixed(0)}%
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 pt-3 border-t border-surface-200 dark:border-surface-700">
                  <button
                    onClick={() => handleResolver(item.id)}
                    disabled={!selectedCategoria[item.id]}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Check className="w-4 h-4" /> Confirmar Categoria
                  </button>
                  <button
                    onClick={() => handlePular(item.id)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-surface-200 dark:border-surface-700 text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                  >
                    <SkipForward className="w-4 h-4" /> Pular
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
