import { useState, useEffect } from 'react';
import { ShieldCheck, Check, X, Clock, DollarSign, AlertCircle } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { PageLoader } from '../components/ui/LoadingSpinner';
import { api } from '../api/client';
import { mockAutorizacoes } from '../data/mock';
import clsx from 'clsx';

export function Autorizacoes() {
  const [items, setItems] = useState(mockAutorizacoes);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectMotivo, setRejectMotivo] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const res = await api.getAutorizacoes();
        if (Array.isArray(res) && res.length > 0) setItems(res);
      } catch { /* use mock */ }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const handleAprovar = async (id: string) => {
    setActionLoading(id);
    try {
      await api.aprovarAutorizacao(id);
    } catch { /* silent */ }
    setItems((prev) => prev.filter((i) => i.id !== id));
    setActionLoading(null);
  };

  const handleRejeitar = async () => {
    if (!rejectId) return;
    setActionLoading(rejectId);
    try {
      await api.rejeitarAutorizacao(rejectId, rejectMotivo);
    } catch { /* silent */ }
    setItems((prev) => prev.filter((i) => i.id !== rejectId));
    setRejectId(null);
    setRejectMotivo('');
    setActionLoading(null);
  };

  const pendentes = items.filter((i) => i.status === 'pendente');
  const totalValor = pendentes.reduce((sum, i) => sum + i.valor, 0);

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Autorizações</h1>
        <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
          Aprovação de pagamentos e transferências
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-orange-50 dark:bg-orange-900/20">
              <Clock className="w-5 h-5 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-surface-900 dark:text-white">{pendentes.length}</p>
              <p className="text-sm text-surface-500">Pendentes</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-green-50 dark:bg-green-900/20">
              <DollarSign className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-surface-900 dark:text-white">
                R$ {totalValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-sm text-surface-500">Valor total pendente</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-900/20">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-surface-900 dark:text-white">
                {pendentes.filter((p) => p.valor > 10000).length}
              </p>
              <p className="text-sm text-surface-500">Alto valor ({'>'}R$10k)</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Authorization list */}
      {pendentes.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="Sem autorizações pendentes"
          description="Todas as autorizações foram processadas."
        />
      ) : (
        <div className="space-y-3">
          {pendentes.map((item) => (
            <Card key={item.id} padding={false}>
              <div className="p-5 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-surface-900 dark:text-white truncate">
                      {item.descricao}
                    </h3>
                    <Badge variant="warning">{item.tipo}</Badge>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-surface-500 dark:text-surface-400">
                    <span>{item.clientName}</span>
                    <span>Vencimento: {new Date(item.data).toLocaleDateString('pt-BR')}</span>
                  </div>
                </div>

                <div className="text-right mr-4">
                  <p className={clsx(
                    'text-xl font-bold',
                    item.valor > 10000 ? 'text-red-600 dark:text-red-400' : 'text-surface-900 dark:text-white'
                  )}>
                    R$ {item.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAprovar(item.id)}
                    disabled={actionLoading === item.id}
                    className="p-2.5 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors disabled:opacity-50"
                    title="Aprovar"
                  >
                    <Check className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setRejectId(item.id)}
                    disabled={actionLoading === item.id}
                    className="p-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors disabled:opacity-50"
                    title="Rejeitar"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Reject modal */}
      {rejectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-700 shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-surface-900 dark:text-white mb-4">Rejeitar Autorização</h2>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
                Motivo da rejeição
              </label>
              <textarea
                value={rejectMotivo}
                onChange={(e) => setRejectMotivo(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg text-sm text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                placeholder="Descreva o motivo..."
              />
            </div>
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => { setRejectId(null); setRejectMotivo(''); }}
                className="flex-1 py-2.5 rounded-lg border border-surface-200 dark:border-surface-700 text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleRejeitar}
                className="flex-1 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors"
              >
                Rejeitar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
