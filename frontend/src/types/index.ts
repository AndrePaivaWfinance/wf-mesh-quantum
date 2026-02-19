export interface Client {
  id: string;
  nome: string;
  cnpj: string;
  sistema: 'nibo' | 'omie' | 'controlle';
  status: 'ativo' | 'inativo' | 'onboarding' | 'suspenso';
  plano: 'Essencial' | 'Avançado' | 'Premium';
  fontes: string[];
  config?: Record<string, unknown>;
  criadoEm: string;
  atualizadoEm: string;
}

export interface Transaction {
  id: string;
  clientId: string;
  tipo: string;
  descricao: string;
  valor: number;
  data: string;
  categoria?: string;
  status: string;
  confianca?: number;
  fonte: string;
}

export interface PendingAuthorization {
  id: string;
  clientId: string;
  clientName: string;
  tipo: string;
  descricao: string;
  valor: number;
  data: string;
  status: 'pendente' | 'aprovado' | 'rejeitado';
  motivo?: string;
  criadoEm: string;
}

export interface EnrichmentDoubt {
  id: string;
  clientId: string;
  clientName: string;
  transactionId: string;
  descricao: string;
  valor: number;
  categoriasSugeridas: { categoria: string; confianca: number }[];
  status: 'pendente' | 'resolvido' | 'pulado';
  criadoEm: string;
}

export interface DashboardData {
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
  pipeline: {
    status: string;
    etapa: string;
    progresso: number;
  };
  alertas: Alert[];
  metricas: MetricPoint[];
}

export interface Alert {
  id: string;
  tipo: 'info' | 'warning' | 'error' | 'success';
  mensagem: string;
  criadoEm: string;
}

export interface MetricPoint {
  data: string;
  transacoes: number;
  classificadas: number;
  anomalias: number;
}

export interface QueueStatus {
  nome: string;
  pendentes: number;
  processando: number;
  concluidos: number;
  erros: number;
}

export interface HistoryAction {
  id: string;
  tipo: string;
  descricao: string;
  usuario: string;
  clientId?: string;
  clientName?: string;
  detalhes?: Record<string, unknown>;
  criadoEm: string;
}

export interface CycleSummary {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'partial';
  inicio: string;
  fim?: string;
  clientesProcessados: number;
  totalTransacoes: number;
  totalClassificadas: number;
  totalAnomalias: number;
}
