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
  Category,
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
  CATEGORIES: 'OperacaoCategories',
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
// TRANSACTIONS
// ============================================================================

/** Criar transações em batch (retorna IDs criados) */
export async function createTransactions(
  transactions: Transaction[]
): Promise<string[]> {
  const client = getTableClient(TABLES.TRANSACTIONS);
  const ids: string[] = [];

  for (const tx of transactions) {
    const entity: TableEntity = {
      partitionKey: tx.clientId,
      rowKey: tx.id,
      ...transactionToEntity(tx),
    };

    try {
      await client.createEntity(entity);
      ids.push(tx.id);
    } catch (error: any) {
      if (error.statusCode === 409) {
        // Already exists, update instead
        await client.updateEntity(entity, 'Merge');
        ids.push(tx.id);
      } else {
        logger.error(`Erro ao criar transação ${tx.id}`, error);
      }
    }
  }

  return ids;
}

/** Buscar transações existentes por source (para idempotência) */
export async function getExistingSourceIds(
  clientId: string,
  source: string
): Promise<Map<string, { id: string; status: string }>> {
  const client = getTableClient(TABLES.TRANSACTIONS);
  const existing = new Map<string, { id: string; status: string }>();

  try {
    const entities = client.listEntities<TableEntity>({
      queryOptions: {
        filter: `PartitionKey eq '${clientId}' and source eq '${source}'`,
        select: ['RowKey', 'sourceId', 'status'],
      },
    });

    for await (const entity of entities) {
      const sourceId = entity.sourceId as string;
      if (sourceId) {
        existing.set(sourceId, {
          id: entity.rowKey as string,
          status: entity.status as string,
        });
      }
    }
  } catch (error) {
    logger.error('Erro ao buscar sourceIds existentes', error);
  }

  return existing;
}

/**
 * Criar transações com idempotência.
 * - Novas: cria normalmente
 * - Existentes com status 'capturado': atualiza rawData + updatedAt
 * - Existentes com status avançado: skip (preserva classificação/sync)
 *
 * Retorna { created, updated, skipped }
 */
export async function upsertTransactionsIdempotent(
  transactions: Transaction[],
  existingSourceIds: Map<string, { id: string; status: string }>
): Promise<{ created: string[]; updated: string[]; skipped: string[] }> {
  const client = getTableClient(TABLES.TRANSACTIONS);
  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];

  for (const tx of transactions) {
    const sourceId = (tx as any).sourceId as string;
    const existing = sourceId ? existingSourceIds.get(sourceId) : undefined;

    if (existing) {
      if (existing.status === TransactionStatus.CAPTURADO) {
        // Ainda não classificado: atualizar rawData e valores
        try {
          await client.updateEntity(
            {
              partitionKey: tx.clientId,
              rowKey: existing.id,
              rawData: JSON.stringify((tx as any).rawData),
              valor: tx.valor,
              valorOriginal: (tx as any).valorOriginal,
              dataVencimento: (tx as any).dataVencimento,
              updatedAt: nowISO(),
            },
            'Merge'
          );
          updated.push(existing.id);
        } catch (error) {
          logger.error(`Erro ao atualizar transação ${existing.id}`, error);
        }
      } else {
        // Já classificado/sincronizado: preservar
        skipped.push(existing.id);
      }
    } else {
      // Nova transação
      const entity: TableEntity = {
        partitionKey: tx.clientId,
        rowKey: tx.id,
        ...transactionToEntity(tx),
      };

      try {
        await client.createEntity(entity);
        created.push(tx.id);
      } catch (error: any) {
        if (error.statusCode === 409) {
          // Race condition: criada entre a query e o insert
          skipped.push(tx.id);
        } else {
          logger.error(`Erro ao criar transação ${tx.id}`, error);
        }
      }
    }
  }

  return { created, updated, skipped };
}

/** Buscar transação por ID */
export async function getTransaction(
  clientId: string,
  transactionId: string
): Promise<Transaction | null> {
  const client = getTableClient(TABLES.TRANSACTIONS);

  try {
    const entity = await client.getEntity<TableEntity>(clientId, transactionId);
    return entityToTransaction(entity);
  } catch (error: any) {
    if (error.statusCode === 404) return null;
    throw error;
  }
}

/** Buscar transações por clientId e status */
export async function getTransactionsByStatus(
  clientId: string,
  status: TransactionStatus
): Promise<Transaction[]> {
  const client = getTableClient(TABLES.TRANSACTIONS);
  const txs: Transaction[] = [];

  try {
    const entities = client.listEntities<TableEntity>({
      queryOptions: {
        filter: `PartitionKey eq '${clientId}' and status eq '${status}'`,
      },
    });

    for await (const entity of entities) {
      txs.push(entityToTransaction(entity));
    }
  } catch (error) {
    logger.error('Erro ao listar transações por status', error);
  }

  return txs;
}

/** Buscar transações por clientId e cycleId */
export async function getTransactionsByCycle(
  clientId: string,
  cycleId: string
): Promise<Transaction[]> {
  const client = getTableClient(TABLES.TRANSACTIONS);
  const txs: Transaction[] = [];

  try {
    const filter = `PartitionKey eq '${clientId}' and cycleId eq '${cycleId}'`;
    const entities = client.listEntities<TableEntity>({
      queryOptions: { filter },
    });

    for await (const entity of entities) {
      txs.push(entityToTransaction(entity));
    }
  } catch (error) {
    logger.error('Erro ao listar transações por ciclo', error);
  }

  return txs;
}

/** Buscar transações recentes de um cliente (para history/anomaly detection) */
export async function getTransactionHistory(
  clientId: string,
  limit: number = 100
): Promise<Transaction[]> {
  const client = getTableClient(TABLES.TRANSACTIONS);
  const txs: Transaction[] = [];

  try {
    const entities = client.listEntities<TableEntity>({
      queryOptions: {
        filter: `PartitionKey eq '${clientId}'`,
      },
    });

    for await (const entity of entities) {
      txs.push(entityToTransaction(entity));
      if (txs.length >= limit * 2) break; // Over-fetch for sorting
    }
  } catch (error) {
    logger.error('Erro ao buscar histórico de transações', error);
  }

  // Sort by createdAt descending and limit
  txs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return txs.slice(0, limit);
}

/** Atualizar transação (merge parcial) */
export async function updateTransaction(
  clientId: string,
  transactionId: string,
  updates: Partial<Transaction>
): Promise<void> {
  const client = getTableClient(TABLES.TRANSACTIONS);

  const entity: TableEntity = {
    partitionKey: clientId,
    rowKey: transactionId,
    ...transactionToEntity({ ...updates, updatedAt: nowISO() } as Transaction),
  };

  await client.updateEntity(entity, 'Merge');
}

/** Contar transações por clientId (para métricas) */
export async function countTransactions(
  clientId?: string,
  status?: TransactionStatus
): Promise<number> {
  const client = getTableClient(TABLES.TRANSACTIONS);
  let count = 0;

  try {
    let filter = '';
    if (clientId) filter = `PartitionKey eq '${clientId}'`;
    if (status) {
      filter = filter
        ? `${filter} and status eq '${status}'`
        : `status eq '${status}'`;
    }

    const entities = client.listEntities<TableEntity>({
      queryOptions: filter ? { filter } : undefined,
    });

    for await (const _ of entities) {
      count++;
    }
  } catch (error) {
    logger.error('Erro ao contar transações', error);
  }

  return count;
}

/** Criar autorização pendente */
export async function createAuthorization(
  auth: PendingAuthorization
): Promise<void> {
  const client = getTableClient(TABLES.AUTHORIZATIONS);

  const entity: TableEntity = {
    partitionKey: 'AUTH',
    rowKey: auth.id,
    clientId: auth.clientId,
    transactionId: auth.transactionId,
    tipo: auth.tipo,
    descricao: auth.descricao,
    valor: auth.valor,
    vencimento: auth.vencimento,
    contraparte: auth.contraparte,
    categoria: auth.categoria,
    documento: auth.documento || '',
    status: auth.status,
    criadoEm: auth.criadoEm,
  };

  await client.createEntity(entity);
}

/** Criar dúvida de enriquecimento */
export async function createDoubt(doubt: EnrichmentDoubt): Promise<void> {
  const client = getTableClient(TABLES.DOUBTS);

  const entity: TableEntity = {
    partitionKey: 'DOUBT',
    rowKey: doubt.id,
    clientId: doubt.clientId,
    transactionId: doubt.transactionId,
    tipo: doubt.tipo,
    transacao: JSON.stringify(doubt.transacao),
    sugestaoIA: JSON.stringify(doubt.sugestaoIA || null),
    opcoes: JSON.stringify(doubt.opcoes || []),
    status: doubt.status,
    criadoEm: doubt.criadoEm,
  };

  await client.createEntity(entity);
}

// ============================================================================
// CATEGORIES
// ============================================================================

const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cat-001', clientId: 'DEFAULT', codigo: '1.1', nome: 'Fornecedores', tipo: 'despesa', nivel: 1, ativo: true },
  { id: 'cat-002', clientId: 'DEFAULT', codigo: '1.2', nome: 'Impostos', tipo: 'despesa', nivel: 1, ativo: true },
  { id: 'cat-003', clientId: 'DEFAULT', codigo: '1.3', nome: 'Folha de Pagamento', tipo: 'despesa', nivel: 1, ativo: true },
  { id: 'cat-004', clientId: 'DEFAULT', codigo: '1.4', nome: 'Aluguel', tipo: 'despesa', nivel: 1, ativo: true },
  { id: 'cat-005', clientId: 'DEFAULT', codigo: '1.5', nome: 'Servicos', tipo: 'despesa', nivel: 1, ativo: true },
  { id: 'cat-006', clientId: 'DEFAULT', codigo: '1.6', nome: 'Marketing', tipo: 'despesa', nivel: 1, ativo: true },
  { id: 'cat-007', clientId: 'DEFAULT', codigo: '1.7', nome: 'Despesas Financeiras', tipo: 'despesa', nivel: 1, ativo: true },
  { id: 'cat-008', clientId: 'DEFAULT', codigo: '1.8', nome: 'Tecnologia', tipo: 'despesa', nivel: 1, ativo: true },
  { id: 'cat-009', clientId: 'DEFAULT', codigo: '2.1', nome: 'Receita de Vendas', tipo: 'receita', nivel: 1, ativo: true },
  { id: 'cat-010', clientId: 'DEFAULT', codigo: '2.2', nome: 'Receita de Servicos', tipo: 'receita', nivel: 1, ativo: true },
  { id: 'cat-011', clientId: 'DEFAULT', codigo: '2.3', nome: 'Outras Receitas', tipo: 'receita', nivel: 1, ativo: true },
  { id: 'cat-012', clientId: 'DEFAULT', codigo: '3.1', nome: 'Transferencias', tipo: 'transferencia', nivel: 1, ativo: true },
];

/** Buscar categorias por clientId, com fallback para DEFAULT */
export async function getCategories(clientId: string): Promise<Category[]> {
  try {
    const client = getTableClient(TABLES.CATEGORIES);
    const categories: Category[] = [];

    // Buscar categorias do cliente
    const entities = client.listEntities<TableEntity>({
      queryOptions: { filter: `PartitionKey eq '${clientId}'` },
    });

    for await (const entity of entities) {
      categories.push(entityToCategory(entity));
    }

    // Se não tem customizadas, buscar DEFAULT
    if (categories.length === 0) {
      const defaultEntities = client.listEntities<TableEntity>({
        queryOptions: { filter: `PartitionKey eq 'DEFAULT'` },
      });

      for await (const entity of defaultEntities) {
        categories.push(entityToCategory(entity));
      }
    }

    // Se não tem nada no storage, retornar hardcoded
    if (categories.length === 0) {
      return DEFAULT_CATEGORIES;
    }

    return categories.filter(c => c.ativo);
  } catch {
    // Fallback para categorias default em memória
    return DEFAULT_CATEGORIES;
  }
}

/** Upsert categoria */
export async function upsertCategory(category: Category): Promise<void> {
  const client = getTableClient(TABLES.CATEGORIES);

  const entity: TableEntity = {
    partitionKey: category.clientId,
    rowKey: category.id,
    codigo: category.codigo,
    nome: category.nome,
    tipo: category.tipo,
    pai: category.pai || '',
    nivel: category.nivel,
    ativo: category.ativo,
  };

  await client.upsertEntity(entity, 'Merge');
}

function entityToCategory(entity: TableEntity): Category {
  return {
    id: entity.rowKey as string,
    clientId: entity.partitionKey as string,
    codigo: (entity.codigo as string) || '',
    nome: (entity.nome as string) || '',
    tipo: (entity.tipo as 'receita' | 'despesa' | 'transferencia') || 'despesa',
    pai: entity.pai as string | undefined,
    nivel: (entity.nivel as number) || 1,
    ativo: entity.ativo !== false,
  };
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

function transactionToEntity(tx: Partial<Transaction>): Record<string, unknown> {
  const entity: Record<string, unknown> = {};
  if (tx.type !== undefined) entity.type = tx.type;
  if (tx.status !== undefined) entity.status = tx.status;
  if (tx.source !== undefined) entity.source = tx.source;
  if (tx.valor !== undefined) entity.valor = tx.valor;
  if (tx.valorOriginal !== undefined) entity.valorOriginal = tx.valorOriginal;
  if (tx.dataVencimento !== undefined) entity.dataVencimento = tx.dataVencimento;
  if (tx.dataEmissao !== undefined) entity.dataEmissao = tx.dataEmissao;
  if (tx.dataRealizacao !== undefined) entity.dataRealizacao = tx.dataRealizacao;
  if (tx.descricao !== undefined) entity.descricao = tx.descricao;
  if (tx.descricaoOriginal !== undefined) entity.descricaoOriginal = tx.descricaoOriginal;
  if (tx.contraparte !== undefined) entity.contraparte = tx.contraparte;
  if (tx.contraparteCnpj !== undefined) entity.contraparteCnpj = tx.contraparteCnpj;
  if (tx.categoriaId !== undefined) entity.categoriaId = tx.categoriaId;
  if (tx.categoriaNome !== undefined) entity.categoriaNome = tx.categoriaNome;
  if (tx.categoriaConfianca !== undefined) entity.categoriaConfianca = tx.categoriaConfianca;
  if (tx.sourceId !== undefined) entity.sourceId = tx.sourceId;
  if (tx.sourceName !== undefined) entity.sourceName = tx.sourceName;
  if (tx.niboId !== undefined) entity.niboId = tx.niboId;
  if (tx.omieId !== undefined) entity.omieId = tx.omieId;
  if (tx.codigoBarras !== undefined) entity.codigoBarras = tx.codigoBarras;
  if (tx.nossoNumero !== undefined) entity.nossoNumero = tx.nossoNumero;
  if (tx.numeroDocumento !== undefined) entity.numeroDocumento = tx.numeroDocumento;
  if (tx.vinculadoA !== undefined) entity.vinculadoA = tx.vinculadoA;
  if (tx.vinculacaoTipo !== undefined) entity.vinculacaoTipo = tx.vinculacaoTipo;
  if (tx.rawData !== undefined) entity.rawData = JSON.stringify(tx.rawData);
  if (tx.metadata !== undefined) entity.metadata = JSON.stringify(tx.metadata);
  if (tx.createdAt !== undefined) entity.createdAt = tx.createdAt;
  if (tx.updatedAt !== undefined) entity.updatedAt = tx.updatedAt;
  if (tx.capturedAt !== undefined) entity.capturedAt = tx.capturedAt;
  if (tx.processedAt !== undefined) entity.processedAt = tx.processedAt;
  // Store cycleId for querying
  if ((tx as any).cycleId !== undefined) entity.cycleId = (tx as any).cycleId;
  return entity;
}

function entityToTransaction(entity: TableEntity): Transaction {
  return {
    id: entity.rowKey as string,
    clientId: entity.partitionKey as string,
    type: (entity.type as string) as any,
    status: (entity.status as string) as any,
    source: (entity.source as string) as any,
    valor: entity.valor as number,
    valorOriginal: entity.valorOriginal as number | undefined,
    dataVencimento: entity.dataVencimento as string | undefined,
    dataEmissao: entity.dataEmissao as string | undefined,
    dataRealizacao: entity.dataRealizacao as string | undefined,
    descricao: entity.descricao as string,
    descricaoOriginal: entity.descricaoOriginal as string | undefined,
    contraparte: entity.contraparte as string | undefined,
    contraparteCnpj: entity.contraparteCnpj as string | undefined,
    categoriaId: entity.categoriaId as string | undefined,
    categoriaNome: entity.categoriaNome as string | undefined,
    categoriaConfianca: entity.categoriaConfianca as number | undefined,
    sourceId: entity.sourceId as string | undefined,
    sourceName: entity.sourceName as string | undefined,
    niboId: entity.niboId as string | undefined,
    omieId: entity.omieId as string | undefined,
    codigoBarras: entity.codigoBarras as string | undefined,
    nossoNumero: entity.nossoNumero as string | undefined,
    numeroDocumento: entity.numeroDocumento as string | undefined,
    vinculadoA: entity.vinculadoA as string | undefined,
    vinculacaoTipo: entity.vinculacaoTipo as 'automatico' | 'manual' | undefined,
    rawData: entity.rawData ? JSON.parse(entity.rawData as string) : undefined,
    metadata: entity.metadata ? JSON.parse(entity.metadata as string) : undefined,
    createdAt: entity.createdAt as string,
    updatedAt: entity.updatedAt as string,
    capturedAt: entity.capturedAt as string,
    processedAt: entity.processedAt as string | undefined,
  };
}
