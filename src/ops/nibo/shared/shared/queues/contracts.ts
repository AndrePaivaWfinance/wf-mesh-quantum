/**
 * Queue Contracts - Operações BPO
 *
 * Define os nomes das filas e contratos de mensagens
 * para comunicação entre Head e Ops.
 */

// ============================================================================
// QUEUE NAMES
// ============================================================================

/** Filas de captura */
export const CAPTURE_QUEUES = {
  NIBO: 'queue-capture-nibo',
  OMIE: 'queue-capture-omie',
  SANTANDER: 'queue-capture-santander',
  GETNET: 'queue-capture-getnet',
  OFX: 'queue-capture-ofx',
} as const;

/** Filas de processamento */
export const PROCESS_QUEUES = {
  CLASSIFY: 'queue-classify',
  ENRICH: 'queue-enrich',
  MATCH: 'queue-match',
} as const;

/** Filas de sync */
export const SYNC_QUEUES = {
  NIBO: 'queue-sync-nibo',
  OMIE: 'queue-sync-omie',
} as const;

/** Filas de notificação */
export const NOTIFY_QUEUES = {
  EMAIL: 'queue-notify-email',
  WHATSAPP: 'queue-notify-whatsapp',
} as const;

/** Filas de revisão */
export const REVIEW_QUEUES = {
  CLASSIFICATION: 'queue-review-classification',
  AUTHORIZATION: 'queue-review-authorization',
} as const;

/** Todas as filas */
export const ALL_QUEUES = {
  ...CAPTURE_QUEUES,
  ...PROCESS_QUEUES,
  ...SYNC_QUEUES,
  ...NOTIFY_QUEUES,
  ...REVIEW_QUEUES,
} as const;

// ============================================================================
// MESSAGE CONTRACTS
// ============================================================================

/** Base para todas as mensagens */
export interface BaseQueueMessage {
  messageId: string;
  cycleId: string;
  clientId: string;
  timestamp: string;
  retryCount?: number;
}

/** Mensagem de captura */
export interface CaptureQueueMessage extends BaseQueueMessage {
  source: 'nibo' | 'omie' | 'santander' | 'getnet' | 'ofx';
  config?: {
    startDate?: string;
    endDate?: string;
    forceRefresh?: boolean;
  };
}

/** Mensagem de classificação */
export interface ClassifyQueueMessage extends BaseQueueMessage {
  transactionId: string;
  transactionData: {
    descricao: string;
    valor: number;
    tipo: 'pagar' | 'receber';
    contraparte?: string;
  };
}

/** Mensagem de sync */
export interface SyncQueueMessage extends BaseQueueMessage {
  transactionId: string;
  destination: 'nibo' | 'omie';
  action: 'create' | 'update';
  data: {
    descricao: string;
    valor: number;
    dataVencimento: string;
    categoriaId?: string;
    contraparte?: string;
  };
}

/** Mensagem de notificação */
export interface NotifyQueueMessage extends BaseQueueMessage {
  tipo: 'resumo_diario' | 'alerta_vencimento' | 'alerta_inadimplencia';
  canal: 'email' | 'whatsapp';
  destinatario: string;
  dados: Record<string, unknown>;
}

/** Mensagem de revisão */
export interface ReviewQueueMessage extends BaseQueueMessage {
  transactionId: string;
  tipo: 'classificacao' | 'autorizacao';
  motivo: string;
  sugestao?: {
    categoriaId?: string;
    categoriaNome?: string;
    confianca?: number;
  };
}

// ============================================================================
// RESPONSE CONTRACTS
// ============================================================================

/** Resposta de captura */
export interface CaptureResponse {
  success: boolean;
  source: string;
  clientId: string;
  cycleId: string;
  transactions: {
    total: number;
    new: number;
    updated: number;
    skipped: number;
  };
  errors?: string[];
  durationMs: number;
}

/** Resposta de classificação */
export interface ClassifyResponse {
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

/** Resposta de sync */
export interface SyncResponse {
  success: boolean;
  transactionId: string;
  destination: string;
  action: 'created' | 'updated' | 'skipped';
  externalId?: string;
  error?: string;
  durationMs: number;
}

// ============================================================================
// HELPERS
// ============================================================================

/** Cria uma mensagem de captura */
export function createCaptureMessage(
  clientId: string,
  cycleId: string,
  source: CaptureQueueMessage['source'],
  config?: CaptureQueueMessage['config']
): CaptureQueueMessage {
  return {
    messageId: crypto.randomUUID(),
    cycleId,
    clientId,
    timestamp: new Date().toISOString(),
    source,
    config,
  };
}

/** Cria uma mensagem de classificação */
export function createClassifyMessage(
  clientId: string,
  cycleId: string,
  transactionId: string,
  transactionData: ClassifyQueueMessage['transactionData']
): ClassifyQueueMessage {
  return {
    messageId: crypto.randomUUID(),
    cycleId,
    clientId,
    timestamp: new Date().toISOString(),
    transactionId,
    transactionData,
  };
}

/** Cria uma mensagem de sync */
export function createSyncMessage(
  clientId: string,
  cycleId: string,
  transactionId: string,
  destination: SyncQueueMessage['destination'],
  action: SyncQueueMessage['action'],
  data: SyncQueueMessage['data']
): SyncQueueMessage {
  return {
    messageId: crypto.randomUUID(),
    cycleId,
    clientId,
    timestamp: new Date().toISOString(),
    transactionId,
    destination,
    action,
    data,
  };
}
