import { useState, useEffect } from 'react';
import { BarChart3, Target, Gauge, GitCompare } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { Card, CardHeader } from '../components/ui/Card';
import { KPICard } from '../components/ui/KPICard';
import { PageLoader } from '../components/ui/LoadingSpinner';
import { api } from '../api/client';
import { mockFilas, mockMetrics } from '../data/mock';

const COLORS = ['#7c3aed', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];

const tooltipStyle = {
  backgroundColor: '#fff',
  border: '1px solid #e5e7ee',
  borderRadius: '12px',
  color: '#111827',
  boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
};

const axisTick = { fill: '#9ca3b4', fontSize: 12 };

export function Metricas() {
  const [filas, setFilas] = useState(mockFilas);
  const [metrics, setMetrics] = useState(mockMetrics);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [filasRes, metricsRes] = await Promise.allSettled([
          api.getFilas(),
          api.getMetrics(),
        ]);
        if (filasRes.status === 'fulfilled' && Array.isArray(filasRes.value) && filasRes.value.length > 0) setFilas(filasRes.value);
        if (metricsRes.status === 'fulfilled' && metricsRes.value?.classificacao) setMetrics(metricsRes.value);
      } catch { /* use mock */ }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const pieData = filas.map((f) => ({
    name: f.nome,
    value: f.concluidos,
  }));

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-surface-900">Métricas & Filas</h1>
        <p className="text-sm text-surface-400 mt-1">
          Monitoramento de performance e filas de processamento
        </p>
      </div>

      {/* AI Performance KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Precisão Classificação"
          value={`${metrics.classificacao.precisao}%`}
          subtitle={`${metrics.classificacao.total.toLocaleString('pt-BR')} classificadas`}
          icon={Target}
          color="purple"
        />
        <KPICard
          title="Tempo Médio AI"
          value={`${metrics.classificacao.tempoMedio}s`}
          subtitle="Por transação"
          icon={Gauge}
          color="cyan"
        />
        <KPICard
          title="Taxa Matching"
          value={`${metrics.matching.taxa}%`}
          subtitle={`${metrics.matching.divergencias} divergências`}
          icon={GitCompare}
          color="green"
        />
        <KPICard
          title="Anomalias Reais"
          value={`${metrics.anomalias.verdadeiroPositivo}`}
          subtitle={`${metrics.anomalias.falsoPositivo} falso positivo`}
          icon={BarChart3}
          color="orange"
        />
      </div>

      {/* Performance chart */}
      <Card>
        <CardHeader
          title="Performance do Sistema"
          subtitle="Latência e throughput ao longo do dia"
          action={
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[#7c3aed]" /> Latência (ms)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[#10b981]" /> Throughput (tx/min)
              </span>
            </div>
          }
        />
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={metrics.performance}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7ee" opacity={0.6} />
              <XAxis dataKey="hora" tick={axisTick} />
              <YAxis yAxisId="left" tick={axisTick} />
              <YAxis yAxisId="right" orientation="right" tick={axisTick} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="latencia"
                stroke="#7c3aed"
                strokeWidth={2}
                dot={{ fill: '#7c3aed', r: 4 }}
                name="Latência (ms)"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="throughput"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ fill: '#10b981', r: 4 }}
                name="Throughput (tx/min)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Queues */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Queue Table */}
        <Card className="lg:col-span-2">
          <CardHeader title="Status das Filas" subtitle="Processamento em tempo real" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-100">
                  <th className="text-left py-3 px-4 text-surface-400 text-xs uppercase tracking-wide font-medium">Fila</th>
                  <th className="text-center py-3 px-4 text-surface-400 text-xs uppercase tracking-wide font-medium">Pendentes</th>
                  <th className="text-center py-3 px-4 text-surface-400 text-xs uppercase tracking-wide font-medium">Processando</th>
                  <th className="text-center py-3 px-4 text-surface-400 text-xs uppercase tracking-wide font-medium">Concluídos</th>
                  <th className="text-center py-3 px-4 text-surface-400 text-xs uppercase tracking-wide font-medium">Erros</th>
                  <th className="text-left py-3 px-4 text-surface-400 text-xs uppercase tracking-wide font-medium">Progresso</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const total = f.pendentes + f.processando + f.concluidos + f.erros;
                  const pct = total > 0 ? Math.round((f.concluidos / total) * 100) : 0;
                  return (
                    <tr
                      key={f.nome}
                      className="border-b border-surface-100 hover:bg-surface-50/80 transition-colors"
                    >
                      <td className="py-3 px-4 font-medium text-surface-900">{f.nome}</td>
                      <td className="py-3 px-4 text-center">
                        <span className="inline-flex items-center justify-center w-8 h-6 rounded bg-amber-50 text-amber-600 text-xs font-semibold">
                          {f.pendentes}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="inline-flex items-center justify-center w-8 h-6 rounded bg-sky-50 text-sky-600 text-xs font-semibold">
                          {f.processando}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="inline-flex items-center justify-center min-w-8 h-6 px-1 rounded bg-emerald-50 text-emerald-600 text-xs font-semibold">
                          {f.concluidos}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="inline-flex items-center justify-center w-8 h-6 rounded bg-red-50 text-red-500 text-xs font-semibold">
                          {f.erros}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-surface-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-surface-500 tabular-nums w-8">{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Pie chart */}
        <Card>
          <CardHeader title="Distribuição" subtitle="Transações concluídas por etapa" />
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2 mt-2">
            {pieData.map((d, i) => (
              <div key={d.name} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  <span className="text-surface-500">{d.name}</span>
                </span>
                <span className="text-surface-900 font-semibold">{d.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
