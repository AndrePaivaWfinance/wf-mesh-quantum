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
  getDashboard: () => request<any>('/bpo/dashboard'),
  getHealth: () => request<any>('/health'),

  // Clientes
  getClientes: () => request<any[]>('/bpo/clientes'),
  getCliente: (id: string) => request<any>(`/bpo/clientes/${id}`),
  createCliente: (data: any) => request<any>('/bpo/clientes', { method: 'POST', body: JSON.stringify(data) }),
  updateCliente: (id: string, data: any) => request<any>(`/bpo/clientes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Autorizações
  getAutorizacoes: () => request<any[]>('/bpo/autorizacoes'),
  aprovarAutorizacao: (id: string, motivo?: string) =>
    request<any>(`/bpo/autorizacoes/${id}/aprovar`, { method: 'POST', body: JSON.stringify({ motivo }) }),
  rejeitarAutorizacao: (id: string, motivo: string) =>
    request<any>(`/bpo/autorizacoes/${id}/rejeitar`, { method: 'POST', body: JSON.stringify({ motivo }) }),

  // Dúvidas
  getDuvidas: () => request<any[]>('/bpo/duvidas'),
  resolverDuvida: (id: string, categoria: string) =>
    request<any>(`/bpo/duvidas/${id}/resolver`, { method: 'POST', body: JSON.stringify({ categoria }) }),
  pularDuvida: (id: string) =>
    request<any>(`/bpo/duvidas/${id}/pular`, { method: 'POST' }),

  // Filas & Métricas
  getFilas: () => request<any[]>('/bpo/filas'),
  getMetrics: (clientId?: string) => request<any>(clientId ? `/bpo/metrics/${clientId}` : '/bpo/metrics'),

  // Histórico
  getHistorico: () => request<any[]>('/bpo/historico'),

  // Ciclo
  startCycle: () => request<any>('/bpo/cycle', { method: 'POST' }),
  getCycle: (id: string) => request<any>(`/bpo/cycle/${id}`),

  // Simulação
  simulate: (params?: any) => request<any>('/bpo/simulate', { method: 'POST', body: JSON.stringify(params || {}) }),
};
