import { useState, useEffect } from 'react';
import { ShieldCheck, Check, X, Clock, DollarSign, AlertCircle } from 'lucide-react';
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
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-surface-900">Autorizacoes</h1>
        <p className="text-sm text-surface-400 mt-1">
          Aprovacao de pagamentos e transferencias
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-surface-200/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-50">
              <Clock className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-surface-900">{pendentes.length}</p>
              <p className="text-sm text-surface-400">Pendentes</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-surface-200/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-50">
              <DollarSign className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-surface-900">
                R$ {totalValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-sm text-surface-400">Valor total pendente</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-surface-200/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-red-50">
              <AlertCircle className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-surface-900">
                {pendentes.filter((p) => p.valor > 10000).length}
              </p>
              <p className="text-sm text-surface-400">Alto valor ({'>'}R$10k)</p>
            </div>
          </div>
        </div>
      </div>

      {/* Authorization list */}
      {pendentes.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="Sem autorizacoes pendentes"
          description="Todas as autorizacoes foram processadas."
        />
      ) : (
        <div className="space-y-3">
          {pendentes.map((item) => (
            <div
              key={item.id}
              className="bg-white rounded-2xl border border-surface-200/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
            >
              <div className="p-5 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-surface-900 truncate">
                      {item.descricao}
                    </h3>
                    <Badge variant="warning">{item.tipo}</Badge>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-surface-400">
                    <span>{item.clientName}</span>
                    <span>Vencimento: {new Date(item.data).toLocaleDateString('pt-BR')}</span>
                  </div>
                </div>

                <div className="text-right mr-4">
                  <p className={clsx(
                    'text-xl font-bold',
                    item.valor > 10000 ? 'text-red-500' : 'text-surface-900'
                  )}>
                    R$ {item.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAprovar(item.id)}
                    disabled={actionLoading === item.id}
                    className="p-2.5 bg-emerald-50 text-emerald-500 hover:bg-emerald-100 rounded-xl transition-colors disabled:opacity-50"
                    title="Aprovar"
                  >
                    <Check className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setRejectId(item.id)}
                    disabled={actionLoading === item.id}
                    className="p-2.5 bg-red-50 text-red-500 hover:bg-red-100 rounded-xl transition-colors disabled:opacity-50"
                    title="Rejeitar"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reject modal */}
      {rejectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl border border-surface-200/60 w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-surface-900 mb-4">Rejeitar Autorizacao</h2>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">
                Motivo da rejeicao
              </label>
              <textarea
                value={rejectMotivo}
                onChange={(e) => setRejectMotivo(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-surface-50 border border-surface-200 rounded-xl text-sm text-surface-900 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                placeholder="Descreva o motivo..."
              />
            </div>
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => { setRejectId(null); setRejectMotivo(''); }}
                className="flex-1 py-2.5 rounded-xl border border-surface-200 text-sm font-medium text-surface-400 hover:bg-surface-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleRejeitar}
                className="flex-1 py-2.5 rounded-xl bg-red-50 text-red-500 hover:bg-red-100 text-sm font-medium transition-colors"
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
