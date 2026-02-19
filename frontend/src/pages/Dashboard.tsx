import { useState, useEffect } from 'react';
import {
  Users,
  ArrowUpDown,
  Brain,
  CheckCircle2,
  AlertTriangle,
  Activity,
  TrendingUp,
  Zap,
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
  Legend,
} from 'recharts';
import { KPICard } from '../components/ui/KPICard';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { PageLoader } from '../components/ui/LoadingSpinner';
import { api } from '../api/client';
import { mockDashboard } from '../data/mock';

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
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Dashboard</h1>
        <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
          Visão geral das operações BPO
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Clientes Ativos"
          value={kpis.clientesAtivos}
          subtitle={`${kpis.totalClientes} total`}
          icon={Users}
          color="blue"
          trend={5.2}
        />
        <KPICard
          title="Transações Hoje"
          value={kpis.transacoesHoje.toLocaleString('pt-BR')}
          subtitle={`${kpis.transacoesMes.toLocaleString('pt-BR')} no mês`}
          icon={ArrowUpDown}
          color="green"
          trend={12.4}
        />
        <KPICard
          title="Taxa Classificação"
          value={`${kpis.taxaClassificacao}%`}
          subtitle="Precisão do modelo AI"
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Taxa Aprovação"
          value={`${kpis.taxaAprovacao}%`}
          subtitle="Aprovações automáticas"
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
        <Card className="md:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-surface-500 dark:text-surface-400">Pipeline Atual</p>
              <p className="mt-1 text-lg font-semibold text-surface-900 dark:text-white">{pipeline.etapa}</p>
            </div>
            <Badge variant={pipeline.status === 'running' ? 'success' : 'default'}>
              {pipeline.status === 'running' ? 'Em execução' : pipeline.status}
            </Badge>
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-surface-500 mb-1.5">
              <span>Progresso</span>
              <span>{pipeline.progresso}%</span>
            </div>
            <div className="h-2 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
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
        <Card className="lg:col-span-2">
          <CardHeader
            title="Transações (7 dias)"
            subtitle="Volume de processamento diário"
            action={
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-primary-500" /> Transações
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-green-500" /> Classificadas
                </span>
              </div>
            }
          />
          <div className="h-[280px] -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metricas}>
                <defs>
                  <linearGradient id="gradientTransacoes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradientClassificadas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                <XAxis dataKey="data" tick={{ fontSize: 12, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    color: '#f1f5f9',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="transacoes"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="url(#gradientTransacoes)"
                  name="Transações"
                />
                <Area
                  type="monotone"
                  dataKey="classificadas"
                  stroke="#22c55e"
                  strokeWidth={2}
                  fill="url(#gradientClassificadas)"
                  name="Classificadas"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Anomalies Bar Chart */}
        <Card>
          <CardHeader title="Anomalias" subtitle="Por dia da semana" />
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metricas}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                <XAxis dataKey="data" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    color: '#f1f5f9',
                  }}
                />
                <Bar dataKey="anomalias" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Anomalias" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Alerts */}
      <Card>
        <CardHeader title="Alertas Recentes" subtitle="Últimas notificações do sistema" />
        <div className="space-y-3">
          {alertas.map((alerta) => (
            <div
              key={alerta.id}
              className="flex items-start gap-3 p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50"
            >
              <Badge variant={alertVariant(alerta.tipo)}>
                {alerta.tipo === 'error' ? 'Erro' : alerta.tipo === 'warning' ? 'Aviso' : alerta.tipo === 'success' ? 'OK' : 'Info'}
              </Badge>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-surface-700 dark:text-surface-300">{alerta.mensagem}</p>
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
