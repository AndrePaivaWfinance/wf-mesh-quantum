/**
 * Client Storage - Tabela Unificada
 *
 * Fonte de verdade UNICA para dados de cliente.
 * Tabela: Clientes (storage account wfoperacaostrg)
 * PartitionKey: tenantId | RowKey: id
 *
 * Usado por: operacao-head, portal-api, webstatics API
 */

import { TableClient, TableEntity } from '@azure/data-tables';
import {
  Client,
  ClientConfig,
  ClientStatus,
  ClientSystem,
  ClientPlano,
} from '../types';

const TABLE_NAME = 'Clientes';

// ============================================================================
// LAZY INIT (evita crash no import se env var não existe)
// ============================================================================

let _tableClient: TableClient | null = null;

function getTableClient(connectionString?: string): TableClient {
  if (!_tableClient) {
    const connStr =
      connectionString ||
      process.env.OPERACOES_STORAGE_CONNECTION_STRING ||
      process.env.AZURE_STORAGE_CONNECTION_STRING ||
      '';
    if (!connStr) {
      throw new Error(
        'Connection string não configurada (OPERACOES_STORAGE_CONNECTION_STRING ou AZURE_STORAGE_CONNECTION_STRING)'
      );
    }
    _tableClient = TableClient.fromConnectionString(connStr, TABLE_NAME);
  }
  return _tableClient;
}

/** Permite injetar connection string diferente (para portal-api, webstatics, etc.) */
export function initClientStorage(connectionString: string): void {
  _tableClient = TableClient.fromConnectionString(
    connectionString,
    TABLE_NAME
  );
}

/** Garante que a tabela existe */
export async function ensureClientTable(): Promise<void> {
  const client = getTableClient();
  await client.createTable().catch(() => {});
}

// ============================================================================
// CRUD
// ============================================================================

export async function getClients(): Promise<Client[]> {
  const client = getTableClient();
  const clients: Client[] = [];

  const entities = client.listEntities<TableEntity>();
  for await (const entity of entities) {
    clients.push(entityToClient(entity));
  }

  return clients;
}

export async function getActiveClients(): Promise<Client[]> {
  const clients = await getClients();
  return clients.filter((c) => c.status === ClientStatus.ATIVO);
}

export async function getClientById(
  clientId: string,
  tenantId?: string
): Promise<Client | null> {
  const client = getTableClient();

  // Se temos o tenantId, busca direta (O(1))
  if (tenantId) {
    try {
      const entity = await client.getEntity<TableEntity>(tenantId, clientId);
      return entityToClient(entity);
    } catch (error: any) {
      if (error.statusCode === 404) return null;
      throw error;
    }
  }

  // Sem tenantId, precisa scanear (raro, fallback)
  const entities = client.listEntities<TableEntity>();
  for await (const entity of entities) {
    if (entity.rowKey === clientId) {
      return entityToClient(entity);
    }
  }
  return null;
}

export async function getClientByTenantId(
  tenantId: string
): Promise<Client | null> {
  const client = getTableClient();

  const entities = client.listEntities<TableEntity>({
    queryOptions: { filter: `PartitionKey eq '${tenantId}'` },
  });

  for await (const entity of entities) {
    return entityToClient(entity);
  }
  return null;
}

export async function getClientByEmail(
  email: string
): Promise<Client | null> {
  const client = getTableClient();
  const normalizedEmail = email.toLowerCase().trim();

  const entities = client.listEntities<TableEntity>({
    queryOptions: { filter: `email eq '${normalizedEmail}'` },
  });

  for await (const entity of entities) {
    return entityToClient(entity);
  }
  return null;
}

export async function getClientByCnpj(
  cnpj: string
): Promise<Client | null> {
  const client = getTableClient();
  const cleanCnpj = cnpj.replace(/\D/g, '');

  const entities = client.listEntities<TableEntity>({
    queryOptions: { filter: `cnpj eq '${cleanCnpj}'` },
  });

  for await (const entity of entities) {
    return entityToClient(entity);
  }
  return null;
}

export async function upsertClient(clientData: Client): Promise<void> {
  const client = getTableClient();

  const entity: TableEntity = {
    partitionKey: clientData.tenantId,
    rowKey: clientData.id,
    ...clientToEntity(clientData),
  };

  await client.upsertEntity(entity, 'Merge');
}

export async function deleteClient(
  clientId: string,
  tenantId: string
): Promise<void> {
  const client = getTableClient();
  await client.deleteEntity(tenantId, clientId);
}

// ============================================================================
// ENTITY MAPPERS
// ============================================================================

function entityToClient(entity: TableEntity): Client {
  const config = parseJSON<ClientConfig>(entity.config as string, {
    notificacoes: {
      email: true,
      whatsapp: false,
      resumoDiario: true,
      alertaVencimento: true,
    },
    categoriasCustomizadas: false,
  });

  return {
    id: entity.rowKey as string,
    tenantId: entity.partitionKey as string,
    nome: (entity.nome as string) || '',
    cnpj: (entity.cnpj as string) || '',
    email: (entity.email as string) || '',
    telefone: entity.telefone as string | undefined,
    plano: (entity.plano as ClientPlano) || ClientPlano.ESSENCIAL,
    sistema: (entity.sistema as ClientSystem) || ClientSystem.NIBO,
    status: (entity.status as ClientStatus) || ClientStatus.ONBOARDING,
    config,
    leadId: entity.leadId as string | undefined,
    contratoId: entity.contratoId as string | undefined,
    createdAt: (entity.createdAt as string) || '',
    updatedAt: (entity.updatedAt as string) || '',
  };
}

function clientToEntity(client: Client): Record<string, unknown> {
  return {
    nome: client.nome,
    cnpj: client.cnpj,
    email: client.email,
    telefone: client.telefone || '',
    plano: client.plano,
    sistema: client.sistema,
    status: client.status,
    config: JSON.stringify(client.config),
    leadId: client.leadId || '',
    contratoId: client.contratoId || '',
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}

function parseJSON<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
