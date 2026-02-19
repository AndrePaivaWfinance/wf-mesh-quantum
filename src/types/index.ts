/**
 * Types - operacao-head
 *
 * Re-exporta tipos compartilhados e define tipos específicos do head.
 */

// Re-export shared types
export * from '../../shared/types';
export * from '../../shared/queues/contracts';

// ============================================================================
// HEAD-SPECIFIC TYPES
// ============================================================================

/** Contexto do ciclo para orquestrador */
export interface CycleContext {
  cycleId: string;
  date: string;
  clients: string[];
  startedAt: string;
}

/** Resultado de um cliente no ciclo */
export interface ClientCycleResult {
  clientId: string;
  status: 'success' | 'partial' | 'failed';
  captures: {
    source: string;
    status: 'success' | 'error';
    count: number;
    error?: string;
  }[];
  classified: number;
  synced: number;
  review: number;
  errors: string[];
  durationMs: number;
}

/** Input para activity de captura */
export interface CaptureActivityInput {
  clientId: string;
  cycleId: string;
  source: 'nibo' | 'santander' | 'getnet' | 'ofx';
}

/** Output da activity de captura */
export interface CaptureActivityOutput {
  success: boolean;
  clientId: string;
  source: string;
  transactionsCount: number;
  newCount: number;
  updatedCount: number;
  error?: string;
  durationMs: number;
}

/** Input para activity de classificação */
export interface ClassifyActivityInput {
  transactionId: string;
  clientId: string;
  cycleId: string;
  descricao: string;
  valor: number;
  tipo: 'pagar' | 'receber';
  contraparte?: string;
}

/** Output da activity de classificação */
export interface ClassifyActivityOutput {
  success: boolean;
  transactionId: string;
  categoria?: {
    id: string;
    nome: string;
    confianca: number;
  };
  needsReview: boolean;
  durationMs: number;
}

/** Input para activity de sync */
export interface SyncActivityInput {
  transactionId: string;
  clientId: string;
  cycleId: string;
  destination: 'nibo' | 'omie';
  action: 'create' | 'update';
}

/** Output da activity de sync */
export interface SyncActivityOutput {
  success: boolean;
  transactionId: string;
  destination: string;
  action: 'created' | 'updated' | 'skipped';
  externalId?: string;
  error?: string;
  durationMs: number;
}

/** Configuração do classificador IA */
export interface ClassifierConfig {
  model: string;
  temperature: number;
  confidenceThreshold: number;
  categories: Array<{
    id: string;
    nome: string;
    keywords: string[];
  }>;
}
