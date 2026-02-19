import { useState, useEffect } from 'react';
import { Users, Plus, Search, Building2, CreditCard, Settings2, X } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { PageLoader } from '../components/ui/LoadingSpinner';
import { api } from '../api/client';
import { mockClientes } from '../data/mock';

const statusVariant: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
  ativo: 'success',
  onboarding: 'warning',
  suspenso: 'danger',
  inativo: 'default',
};

const statusLabel: Record<string, string> = {
  ativo: 'Ativo',
  onboarding: 'Onboarding',
  suspenso: 'Suspenso',
  inativo: 'Inativo',
};

const planoVariant: Record<string, 'primary' | 'info' | 'default'> = {
  Premium: 'primary',
  'Avançado': 'info',
  Essencial: 'default',
};

export function Clientes() {
  const [clientes, setClientes] = useState(mockClientes);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ nome: '', cnpj: '', sistema: 'nibo', plano: 'Essencial', fontes: ['nibo'] });

  useEffect(() => {
    async function load() {
      try {
        const res = await api.getClientes();
        if (Array.isArray(res) && res.length > 0) setClientes(res);
      } catch { /* use mock */ }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const filtered = clientes.filter((c) =>
    c.nome.toLowerCase().includes(search.toLowerCase()) ||
    c.cnpj.includes(search)
  );

  const handleSave = async () => {
    try {
      if (editingId) {
        await api.updateCliente(editingId, form);
      } else {
        await api.createCliente(form);
      }
    } catch { /* silent */ }
    setShowModal(false);
    setEditingId(null);
    setForm({ nome: '', cnpj: '', sistema: 'nibo', plano: 'Essencial', fontes: ['nibo'] });
  };

  const openEdit = (c: any) => {
    setForm({ nome: c.nome, cnpj: c.cnpj, sistema: c.sistema, plano: c.plano, fontes: c.fontes });
    setEditingId(c.id);
    setShowModal(true);
  };

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Clientes</h1>
          <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
            Gestão de clientes BPO
          </p>
        </div>
        <button
          onClick={() => { setEditingId(null); setForm({ nome: '', cnpj: '', sistema: 'nibo', plano: 'Essencial', fontes: ['nibo'] }); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Novo Cliente
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
        <input
          type="text"
          placeholder="Buscar por nome ou CNPJ..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-lg text-sm text-surface-900 dark:text-white placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>

      {/* Client cards */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nenhum cliente encontrado"
          description="Adicione seu primeiro cliente para começar."
          action={{ label: 'Novo Cliente', onClick: () => setShowModal(true) }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <Card key={c.id} className="hover:shadow-md transition-shadow cursor-pointer" padding={false}>
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-surface-900 dark:text-white">{c.nome}</h3>
                      <p className="text-xs text-surface-500">{c.cnpj}</p>
                    </div>
                  </div>
                  <Badge variant={statusVariant[c.status]}>{statusLabel[c.status]}</Badge>
                </div>

                <div className="flex items-center gap-4 text-xs text-surface-500 dark:text-surface-400 mb-4">
                  <span className="flex items-center gap-1">
                    <CreditCard className="w-3.5 h-3.5" /> {c.sistema.toUpperCase()}
                  </span>
                  <Badge variant={planoVariant[c.plano] || 'default'}>{c.plano}</Badge>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-4">
                  {c.fontes.map((f: string) => (
                    <span
                      key={f}
                      className="px-2 py-0.5 rounded text-xs bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400"
                    >
                      {f}
                    </span>
                  ))}
                </div>

                <button
                  onClick={() => openEdit(c)}
                  className="w-full py-2 rounded-lg border border-surface-200 dark:border-surface-700 text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors flex items-center justify-center gap-2"
                >
                  <Settings2 className="w-4 h-4" /> Editar
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-700 shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-surface-900 dark:text-white">
                {editingId ? 'Editar Cliente' : 'Novo Cliente'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800"
              >
                <X className="w-5 h-5 text-surface-400" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Nome</label>
                <input
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  className="w-full px-3 py-2 bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg text-sm text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Nome da empresa"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">CNPJ</label>
                <input
                  value={form.cnpj}
                  onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                  className="w-full px-3 py-2 bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg text-sm text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="00.000.000/0001-00"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Sistema</label>
                  <select
                    value={form.sistema}
                    onChange={(e) => setForm({ ...form, sistema: e.target.value })}
                    className="w-full px-3 py-2 bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg text-sm text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="nibo">Nibo</option>
                    <option value="omie">Omie</option>
                    <option value="controlle">Controlle</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Plano</label>
                  <select
                    value={form.plano}
                    onChange={(e) => setForm({ ...form, plano: e.target.value })}
                    className="w-full px-3 py-2 bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg text-sm text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="Essencial">Essencial</option>
                    <option value="Avançado">Avançado</option>
                    <option value="Premium">Premium</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 rounded-lg border border-surface-200 dark:border-surface-700 text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                className="flex-1 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
              >
                {editingId ? 'Salvar' : 'Criar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
