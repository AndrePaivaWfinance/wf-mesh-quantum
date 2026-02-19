/**
 * Table Storage Client - operacao-head
 *
 * Cliente para Azure Table Storage.
 * Gerencia clientes, ciclos e transações.
 */

import { TableClient, TableEntity } from '@azure/data-tables';
import {
  Client,
  DailyCycle,
  Transaction,
  PendingAuthorization,
  EnrichmentDoubt,
  HistoryAction,
  CycleStatus,
  TransactionStatus,
} from '../types';
import { createLogger, nowISO } from '../../shared/utils';

// Re-export client operations from shared storage (tabela unificada Clientes)
export {
  getClients,
  getActiveClients,
  getClientById as getClient,
  getClientByTenantId,
  getClientByEmail,
  getClientByCnpj,
  upsertClient,
  ensureClientTable,
} from '../../shared/storage/clientStorage';
import { ensureClientTable } from '../../shared/storage/clientStorage';

const logger = createLogger('TableClient');

// ============================================================================
// TABLE NAMES
// ============================================================================

const TABLES = {
  CYCLES: 'OperacaoCycles',
  TRANSACTIONS: 'OperacaoTransactions',
  AUTHORIZATIONS: 'OperacaoAuthorizations',
  DOUBTS: 'OperacaoDoubts',
  HISTORY: 'OperacaoHistory',
} as const;

// ============================================================================
// CLIENT CACHE (Lazy Initialization)
// ============================================================================

let connectionString: string | null = null;
const tableClients: Map<string, TableClient> = new Map();

function getConnectionString(): string {
  if (!connectionString) {
    connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || '';
    if (!connectionString) {
      throw new Error('AZURE_STORAGE_CONNECTION_STRING não configurada');
    }
  }
  return connectionString;
}

function getTableClient(tableName: string): TableClient {
  if (!tableClients.has(tableName)) {
    const client = TableClient.fromConnectionString(
      getConnectionString(),
      tableName
    );
    tableClients.set(tableName, client);
  }
  return tableClients.get(tableName)!;
}

/** Garante que todas as tabelas operacionais existem */
export async function ensureAllTables(): Promise<void> {
  const tables = Object.values(TABLES);
  await Promise.all(
    tables.map((t) => getTableClient(t).createTable().catch(() => {}))
  );
  await ensureClientTable();
}

// ============================================================================
// CYCLES
// ============================================================================

export async function getCycle(cycleId: string): Promise<DailyCycle | null> {
  const client = getTableClient(TABLES.CYCLES);
  const date = cycleId.split('-').slice(0, 3).join('-'); // Extract date from cycleId

  try {
    const entity = await client.getEntity<TableEntity<DailyCycle>>(
      date,
      cycleId
    );
    return entityToCycle(entity);
  } catch (error: any) {
    if (error.statusCode === 404) return null;
    throw error;
  }
}

export async function getCyclesByDate(date: string): Promise<DailyCycle[]> {
  const client = getTableClient(TABLES.CYCLES);
  const cycles: DailyCycle[] = [];

  try {
    const entities = client.listEntities<TableEntity<DailyCycle>>({
      queryOptions: { filter: `PartitionKey eq '${date}'` },
    });

    for await (const entity of entities) {
      cycles.push(entityToCycle(entity));
    }
  } catch (error) {
    logger.error('Erro ao listar ciclos', error);
    throw error;
  }

  return cycles;
}

export async function getRecentCycles(limit: number = 10): Promise<DailyCycle[]> {
  const client = getTableClient(TABLES.CYCLES);
  const cycles: DailyCycle[] = [];

  try {
    // Get last 7 days
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().split('T')[0]);
    }

    for (const date of dates) {
      const dateCycles = await getCyclesByDate(date);
      cycles.push(...dateCycles);
      if (cycles.length >= limit) break;
    }
  } catch (error) {
    logger.error('Erro ao listar ciclos recentes', error);
  }

  return cycles.slice(0, limit);
}

export async function createCycle(date: string): Promise<DailyCycle> {
  const client = getTableClient(TABLES.CYCLES);
  const cycleId = `${date}-${Date.now()}`;

  const cycle: DailyCycle = {
    id: cycleId,
    date,
    status: CycleStatus.PENDING,
    clientsTotal: 0,
    clientsProcessed: 0,
    clientsFailed: 0,
    transactionsCaptured: 0,
    transactionsClassified: 0,
    transactionsSynced: 0,
    transactionsReview: 0,
    startedAt: nowISO(),
    errors: [],
  };

  const entity: TableEntity = {
    partitionKey: date,
    rowKey: cycleId,
    ...cycleToEntity(cycle),
  };

  await client.createEntity(entity);
  return cycle;
}

export async function updateCycle(
  cycle: Partial<DailyCycle> & { id: string; date: string }
): Promise<void> {
  const client = getTableClient(TABLES.CYCLES);

  const entity: TableEntity = {
    partitionKey: cycle.date,
    rowKey: cycle.id,
    ...cycleToEntity(cycle as DailyCycle),
  };

  await client.updateEntity(entity, 'Merge');
}

// ============================================================================
// AUTHORIZATIONS
// ============================================================================

export async function getPendingAuthorizations(
  clientId?: string,
  tipo?: 'pagar' | 'receber'
): Promise<PendingAuthorization[]> {
  const client = getTableClient(TABLES.AUTHORIZATIONS);
  const authorizations: PendingAuthorization[] = [];

  try {
    let filter = `status eq 'pendente'`;
    if (clientId) filter += ` and clientId eq '${clientId}'`;
    if (tipo) filter += ` and tipo eq '${tipo}'`;

    const entities = client.listEntities<TableEntity<PendingAuthorization>>({
      queryOptions: { filter },
    });

    for await (const entity of entities) {
      authorizations.push(entityToAuthorization(entity));
    }
  } catch (error) {
    logger.error('Erro ao listar autorizações', error);
  }

  return authorizations;
}

export async function approveAuthorization(
  id: string,
  notas?: string
): Promise<void> {
  const client = getTableClient(TABLES.AUTHORIZATIONS);

  await client.updateEntity(
    {
      partitionKey: 'AUTH',
      rowKey: id,
      status: 'aprovado',
      resolvidoEm: nowISO(),
      notas: notas || '',
    },
    'Merge'
  );
}

export async function rejectAuthorization(
  id: string,
  motivo: string
): Promise<void> {
  const client = getTableClient(TABLES.AUTHORIZATIONS);

  await client.updateEntity(
    {
      partitionKey: 'AUTH',
      rowKey: id,
      status: 'rejeitado',
      resolvidoEm: nowISO(),
      notas: motivo,
    },
    'Merge'
  );
}

// ============================================================================
// DOUBTS
// ============================================================================

export async function getPendingDoubts(
  clientId?: string,
  tipo?: string
): Promise<EnrichmentDoubt[]> {
  const client = getTableClient(TABLES.DOUBTS);
  const doubts: EnrichmentDoubt[] = [];

  try {
    let filter = `status eq 'pendente'`;
    if (clientId) filter += ` and clientId eq '${clientId}'`;
    if (tipo) filter += ` and tipo eq '${tipo}'`;

    const entities = client.listEntities<TableEntity<EnrichmentDoubt>>({
      queryOptions: { filter },
    });

    for await (const entity of entities) {
      doubts.push(entityToDoubt(entity));
    }
  } catch (error) {
    logger.error('Erro ao listar dúvidas', error);
  }

  return doubts;
}

export async function resolveDoubt(
  id: string,
  resolucao: Record<string, unknown>,
  notas?: string
): Promise<void> {
  const client = getTableClient(TABLES.DOUBTS);

  await client.updateEntity(
    {
      partitionKey: 'DOUBT',
      rowKey: id,
      status: 'resolvido',
      resolvidoEm: nowISO(),
      resolucao: JSON.stringify(resolucao),
      notas: notas || '',
    },
    'Merge'
  );
}

export async function skipDoubt(id: string, motivo: string): Promise<void> {
  const client = getTableClient(TABLES.DOUBTS);

  await client.updateEntity(
    {
      partitionKey: 'DOUBT',
      rowKey: id,
      status: 'pulado',
      resolvidoEm: nowISO(),
      notas: motivo,
    },
    'Merge'
  );
}

// ============================================================================
// HISTORY
// ============================================================================

export async function getHistory(
  clientId?: string,
  limit: number = 50,
  offset: number = 0
): Promise<{ items: HistoryAction[]; total: number }> {
  const client = getTableClient(TABLES.HISTORY);
  const actions: HistoryAction[] = [];

  try {
    let filter = '';
    if (clientId) filter = `clientId eq '${clientId}'`;

    const entities = client.listEntities<TableEntity<HistoryAction>>({
      queryOptions: filter ? { filter } : undefined,
    });

    for await (const entity of entities) {
      actions.push(entityToHistory(entity));
    }
  } catch (error) {
    logger.error('Erro ao listar histórico', error);
  }

  // Sort by date descending
  actions.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());

  return {
    items: actions.slice(offset, offset + limit),
    total: actions.length,
  };
}

export async function addHistoryAction(action: HistoryAction): Promise<void> {
  const client = getTableClient(TABLES.HISTORY);

  const entity: TableEntity = {
    partitionKey: action.clientId,
    rowKey: action.id,
    ...action,
    detalhes: action.detalhes ? JSON.stringify(action.detalhes) : '',
  };

  await client.createEntity(entity);
}

// ============================================================================
// ENTITY MAPPERS
// ============================================================================

function entityToCycle(entity: TableEntity<DailyCycle>): DailyCycle {
  return {
    id: entity.rowKey as string,
    date: entity.partitionKey as string,
    status: entity.status as CycleStatus,
    clientsTotal: entity.clientsTotal as number,
    clientsProcessed: entity.clientsProcessed as number,
    clientsFailed: entity.clientsFailed as number,
    transactionsCaptured: entity.transactionsCaptured as number,
    transactionsClassified: entity.transactionsClassified as number,
    transactionsSynced: entity.transactionsSynced as number,
    transactionsReview: entity.transactionsReview as number,
    startedAt: entity.startedAt as string,
    completedAt: entity.completedAt as string | undefined,
    durationMs: entity.durationMs as number | undefined,
    errors: JSON.parse((entity.errors as unknown as string) || '[]'),
  };
}

function cycleToEntity(cycle: DailyCycle): Record<string, unknown> {
  return {
    status: cycle.status,
    clientsTotal: cycle.clientsTotal,
    clientsProcessed: cycle.clientsProcessed,
    clientsFailed: cycle.clientsFailed,
    transactionsCaptured: cycle.transactionsCaptured,
    transactionsClassified: cycle.transactionsClassified,
    transactionsSynced: cycle.transactionsSynced,
    transactionsReview: cycle.transactionsReview,
    startedAt: cycle.startedAt,
    completedAt: cycle.completedAt || '',
    durationMs: cycle.durationMs || 0,
    errors: JSON.stringify(cycle.errors),
  };
}

function entityToAuthorization(
  entity: TableEntity<PendingAuthorization>
): PendingAuthorization {
  return {
    id: entity.rowKey as string,
    clientId: entity.clientId as string,
    transactionId: entity.transactionId as string,
    tipo: entity.tipo as 'pagar' | 'receber',
    descricao: entity.descricao as string,
    valor: entity.valor as number,
    vencimento: entity.vencimento as string,
    contraparte: entity.contraparte as string,
    categoria: entity.categoria as string,
    documento: entity.documento as string | undefined,
    status: entity.status as any,
    criadoEm: entity.criadoEm as string,
    resolvidoEm: entity.resolvidoEm as string | undefined,
    resolvidoPor: entity.resolvidoPor as string | undefined,
    notas: entity.notas as string | undefined,
  };
}

function entityToDoubt(entity: TableEntity<EnrichmentDoubt>): EnrichmentDoubt {
  return {
    id: entity.rowKey as string,
    clientId: entity.clientId as string,
    transactionId: entity.transactionId as string,
    tipo: entity.tipo as any,
    transacao: JSON.parse((entity.transacao as unknown as string) || '{}'),
    sugestaoIA: JSON.parse((entity.sugestaoIA as unknown as string) || 'null'),
    opcoes: JSON.parse((entity.opcoes as unknown as string) || '[]'),
    status: entity.status as any,
    criadoEm: entity.criadoEm as string,
    resolvidoEm: entity.resolvidoEm as string | undefined,
    resolucao: JSON.parse((entity.resolucao as unknown as string) || 'null'),
    notas: entity.notas as string | undefined,
  };
}

function entityToHistory(entity: TableEntity<HistoryAction>): HistoryAction {
  return {
    id: entity.rowKey as string,
    clientId: entity.partitionKey as string,
    tipo: entity.tipo as any,
    descricao: entity.descricao as string,
    usuario: entity.usuario as string | undefined,
    data: entity.data as string,
    detalhes: JSON.parse((entity.detalhes as unknown as string) || 'null'),
  };
}
