import { useState, useEffect } from 'react';
import {
  Users,
  ArrowUpDown,
  Brain,
  CheckCircle2,
  AlertTriangle,
  Activity,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';
import { KPICard } from '../components/ui/KPICard';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { PageLoader } from '../components/ui/LoadingSpinner';
import { api } from '../api/client';
import { mockDashboard } from '../data/mock';

const tooltipStyle = {
  backgroundColor: '#fff',
  border: '1px solid #e5e7ee',
  borderRadius: '12px',
  color: '#111827',
  fontSize: 12,
  boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
};

export function Dashboard() {
  const [data, setData] = useState(mockDashboard);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await api.getDashboard();
        if (res?.kpis) setData(res);
      } catch {
        // Use mock data as fallback
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <PageLoader />;

  const { kpis, pipeline, alertas, metricas } = data;

  const alertVariant = (tipo: string) => {
    const map: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
      success: 'success', warning: 'warning', error: 'danger', info: 'info',
    };
    return map[tipo] || 'info';
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-surface-900">Dashboard</h1>
        <p className="text-sm text-surface-400 mt-1">
          Visao geral das operacoes BPO
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <KPICard
          title="Clientes Ativos"
          value={kpis.clientesAtivos}
          subtitle={`${kpis.totalClientes} total`}
          icon={Users}
          color="blue"
          trend={5.2}
        />
        <KPICard
          title="Transacoes Hoje"
          value={kpis.transacoesHoje.toLocaleString('pt-BR')}
          subtitle={`${kpis.transacoesMes.toLocaleString('pt-BR')} no mes`}
          icon={ArrowUpDown}
          color="green"
          trend={12.4}
        />
        <KPICard
          title="Taxa Classificacao"
          value={`${kpis.taxaClassificacao}%`}
          subtitle="Precisao do modelo AI"
          icon={Brain}
          color="purple"
          trend={1.8}
        />
        <KPICard
          title="Anomalias"
          value={kpis.anomaliasDetectadas}
          subtitle="Detectadas hoje"
          icon={AlertTriangle}
          color="orange"
          trend={-8.3}
        />
      </div>

      {/* Second row KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <KPICard
          title="Taxa Aprovacao"
          value={`${kpis.taxaAprovacao}%`}
          subtitle="Aprovacoes automaticas"
          icon={CheckCircle2}
          color="green"
          trend={3.1}
        />
        <KPICard
          title="Ciclos Completos"
          value={kpis.ciclosCompletos}
          subtitle="Total processados"
          icon={Activity}
          color="cyan"
          trend={2.5}
        />
        <Card className="md:col-span-2 bg-white rounded-2xl border border-surface-200/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-surface-400 tracking-wide">Pipeline Atual</p>
              <p className="mt-1.5 text-lg font-semibold text-surface-900">{pipeline.etapa}</p>
            </div>
            <Badge variant={pipeline.status === 'running' ? 'success' : 'default'}>
              {pipeline.status === 'running' ? 'Em execucao' : pipeline.status}
            </Badge>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-surface-400 mb-2">
              <span>Progresso</span>
              <span>{pipeline.progresso}%</span>
            </div>
            <div className="h-2 bg-surface-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-500 rounded-full transition-all duration-500"
                style={{ width: `${pipeline.progresso}%` }}
              />
            </div>
          </div>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Area Chart */}
        <Card className="lg:col-span-2 bg-white rounded-2xl border border-surface-200/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <CardHeader
            title="Transacoes (7 dias)"
            subtitle="Volume de processamento diario"
            action={
              <div className="flex items-center gap-4 text-xs text-surface-600">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-primary-500" /> Transacoes
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Classificadas
                </span>
              </div>
            }
          />
          <div className="h-[280px] -mx-2 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metricas}>
                <defs>
                  <linearGradient id="gradientTransacoes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradientClassificadas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7ee" opacity={0.6} />
                <XAxis dataKey="data" tick={{ fontSize: 11, fill: '#9ca3b4' }} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3b4' }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area
                  type="monotone"
                  dataKey="transacoes"
                  stroke="#7c3aed"
                  strokeWidth={2}
                  fill="url(#gradientTransacoes)"
                  name="Transacoes"
                />
                <Area
                  type="monotone"
                  dataKey="classificadas"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#gradientClassificadas)"
                  name="Classificadas"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Anomalies Bar Chart */}
        <Card className="bg-white rounded-2xl border border-surface-200/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <CardHeader title="Anomalias" subtitle="Por dia da semana" />
          <div className="h-[280px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metricas}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7ee" opacity={0.6} />
                <XAxis dataKey="data" tick={{ fontSize: 11, fill: '#9ca3b4' }} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3b4' }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="anomalias" fill="#f59e0b" radius={[6, 6, 0, 0]} name="Anomalias" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Alerts */}
      <Card className="bg-white rounded-2xl border border-surface-200/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader title="Alertas Recentes" subtitle="Ultimas notificacoes do sistema" />
        <div className="space-y-3 mt-1">
          {alertas.map((alerta) => (
            <div
              key={alerta.id}
              className="flex items-start gap-3 p-3.5 bg-surface-50 rounded-xl"
            >
              <Badge variant={alertVariant(alerta.tipo)}>
                {alerta.tipo === 'error' ? 'Erro' : alerta.tipo === 'warning' ? 'Aviso' : alerta.tipo === 'success' ? 'OK' : 'Info'}
              </Badge>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-surface-600">{alerta.mensagem}</p>
                <p className="text-xs text-surface-400 mt-1">
                  {new Date(alerta.criadoEm).toLocaleString('pt-BR')}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
