export interface Dashboard {
  kpis: {
    totalClientes: number;
    clientesAtivos: number;
    transacoesHoje: number;
    transacoesMes: number;
    taxaClassificacao: number;
    taxaAprovacao: number;
    anomaliasDetectadas: number;
    ciclosCompletos: number;
  };
  pipeline: { status: string; etapa: string; progresso: number };
  alertas: Array<{ id: string; tipo: 'warning' | 'error' | 'success' | 'info'; mensagem: string; criadoEm: string }>;
  metricas: Array<{ data: string; transacoes: number; classificadas: number; anomalias: number }>;
}

export interface Cliente {
  id: string;
  nome: string;
  cnpj: string;
  sistema: string;
  status: string;
  plano: string;
  fontes: string[];
  criadoEm: string;
  atualizadoEm: string;
}

export interface ClienteForm {
  nome: string;
  cnpj: string;
  sistema: string;
  plano: string;
  fontes: string[];
}

export interface Autorizacao {
  id: string;
  clientId: string;
  clientName: string;
  tipo: string;
  descricao: string;
  valor: number;
  data: string;
  status: string;
  criadoEm: string;
}

export interface Duvida {
  id: string;
  clientId: string;
  clientName: string;
  transactionId: string;
  descricao: string;
  valor: number;
  categoriasSugeridas: Array<{ categoria: string; confianca: number }>;
  status: string;
  criadoEm: string;
}

export interface Fila {
  nome: string;
  pendentes: number;
  processando: number;
  concluidos: number;
  erros: number;
}

export interface HistoricoItem {
  id: string;
  tipo: string;
  descricao: string;
  usuario: string;
  clientId?: string;
  clientName?: string;
  criadoEm: string;
}

export interface Metrics {
  classificacao: { total: number; precisao: number; tempoMedio: number };
  anomalias: { total: number; falsoPositivo: number; verdadeiroPositivo: number };
  matching: { total: number; taxa: number; divergencias: number };
  performance: Array<{ hora: string; latencia: number; throughput: number }>;
}

export interface CycleResult {
  id?: string;
  status?: string;
}

export interface HealthResult {
  status: string;
}

const BASE_URL = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`API Error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  // Dashboard
  getDashboard: () => request<Dashboard>('/bpo/dashboard'),
  getHealth: () => request<HealthResult>('/health'),

  // Clientes
  getClientes: () => request<Cliente[]>('/bpo/clientes'),
  getCliente: (id: string) => request<Cliente>(`/bpo/clientes/${id}`),
  createCliente: (data: ClienteForm) => request<Cliente>('/bpo/clientes', { method: 'POST', body: JSON.stringify(data) }),
  updateCliente: (id: string, data: ClienteForm) => request<Cliente>(`/bpo/clientes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Autorizações
  getAutorizacoes: () => request<Autorizacao[]>('/bpo/autorizacoes'),
  aprovarAutorizacao: (id: string, motivo?: string) =>
    request<Autorizacao>(`/bpo/autorizacoes/${id}/aprovar`, { method: 'POST', body: JSON.stringify({ motivo }) }),
  rejeitarAutorizacao: (id: string, motivo: string) =>
    request<Autorizacao>(`/bpo/autorizacoes/${id}/rejeitar`, { method: 'POST', body: JSON.stringify({ motivo }) }),

  // Dúvidas
  getDuvidas: () => request<Duvida[]>('/bpo/duvidas'),
  resolverDuvida: (id: string, categoria: string) =>
    request<Duvida>(`/bpo/duvidas/${id}/resolver`, { method: 'POST', body: JSON.stringify({ categoria }) }),
  pularDuvida: (id: string) =>
    request<Duvida>(`/bpo/duvidas/${id}/pular`, { method: 'POST' }),

  // Filas & Métricas
  getFilas: () => request<Fila[]>('/bpo/filas'),
  getMetrics: (clientId?: string) => request<Metrics>(clientId ? `/bpo/metrics/${clientId}` : '/bpo/metrics'),

  // Histórico
  getHistorico: () => request<HistoricoItem[]>('/bpo/historico'),

  // Ciclo
  startCycle: () => request<CycleResult>('/bpo/cycle', { method: 'POST' }),
  getCycle: (id: string) => request<CycleResult>(`/bpo/cycle/${id}`),

  // Simulação
  simulate: (params?: Record<string, unknown>) => request<CycleResult>('/bpo/simulate', { method: 'POST', body: JSON.stringify(params || {}) }),
};
