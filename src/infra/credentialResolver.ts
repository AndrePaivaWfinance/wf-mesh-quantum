/**
 * CredentialResolver - Resolução de credenciais per-client
 *
 * Estratégia (em ordem de prioridade):
 *   1. Key Vault per-client (prefix "kv:" no ClientConfig → busca no KV)
 *   2. ClientConfig direto (valor literal no campo)
 *   3. Env vars globais (fallback para setup legado / cliente único)
 *
 * Isso permite que N clientes coexistam, cada um com suas credenciais,
 * sem quebrar o fluxo de quem ainda usa env vars globais.
 */

import { Client, ClientConfig } from '../../shared/types';
import { getClientById } from '../../shared/storage/clientStorage';
import { createLogger } from '../../shared/utils';
import { getTenantSecret, SECRET_NAMES } from './keyVaultHelper';

const logger = createLogger('CredentialResolver');

// ============================================================================
// TIPOS DE CREDENCIAIS RESOLVIDAS
// ============================================================================

export interface OmieCredentials {
  appKey: string;
  appSecret: string;
}

export interface SantanderCredentials {
  clientId: string;
  clientSecret: string;
  environment: 'sandbox' | 'production';
  workspaceId?: string;
  convenio?: string;
  agencia?: string;
  conta?: string;
  contaDigito?: string;
  certBase64?: string;
  keyBase64?: string;
}

export interface GetnetCredentials {
  user: string;
  estabelecimento?: string;
  // password vem do Key Vault, não do ClientConfig
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Resolve um valor que pode ser:
 *   - "kv:secret-name" → busca no Key Vault
 *   - valor literal    → retorna direto
 *   - undefined/empty  → retorna fallback
 */
async function resolveValue(
  configValue: string | undefined,
  envFallback: string | undefined,
  tenantId?: string,
  kvSecretName?: string
): Promise<string> {
  // 1. Se ClientConfig tem prefixo "kv:" → buscar no Key Vault
  if (configValue?.startsWith('kv:')) {
    const secretName = configValue.slice(3); // remove "kv:"
    const value = await getTenantSecret('', secretName); // nome completo já inclui tenantId
    if (value) return value;
    logger.warn(`Key Vault secret not found: ${secretName}, falling back to env`);
  }

  // 2. Se ClientConfig tem valor literal → usar direto
  if (configValue && !configValue.startsWith('kv:')) {
    return configValue;
  }

  // 3. Se tem tenantId + kvSecretName → tentar Key Vault per-tenant
  if (tenantId && kvSecretName) {
    const value = await getTenantSecret(tenantId, kvSecretName);
    if (value) return value;
  }

  // 4. Fallback para env var
  return envFallback || '';
}

// ============================================================================
// RESOLVERS
// ============================================================================

/**
 * Resolve credenciais Omie para um cliente.
 * Key Vault → ClientConfig → env vars.
 */
export async function resolveOmieCredentials(
  config: ClientConfig,
  tenantId?: string
): Promise<OmieCredentials> {
  const appKey = await resolveValue(
    config.omieAppKey,
    process.env.OMIE_APP_KEY,
    tenantId,
    SECRET_NAMES.omie.APP_KEY
  );

  const appSecret = await resolveValue(
    config.omieAppSecret,
    process.env.OMIE_APP_SECRET,
    tenantId,
    SECRET_NAMES.omie.APP_SECRET
  );

  if (!appKey || !appSecret) {
    throw new Error('Omie credentials not found (Key Vault, ClientConfig, nor env vars)');
  }

  logger.info('Omie credentials resolved', { tenantId, fromKv: config.omieAppKey?.startsWith('kv:') });
  return { appKey, appSecret };
}

/**
 * Resolve credenciais Santander para um cliente.
 * Key Vault per-client → env vars.
 */
export async function resolveSantanderCredentials(
  config: ClientConfig,
  tenantId?: string
): Promise<SantanderCredentials> {
  // OAuth — Key Vault per-tenant ou env vars
  const clientId = tenantId
    ? await resolveValue(undefined, process.env.SANTANDER_CLIENT_ID, tenantId, SECRET_NAMES.santander.CLIENT_ID)
    : process.env.SANTANDER_CLIENT_ID || '';

  const clientSecret = tenantId
    ? await resolveValue(undefined, process.env.SANTANDER_CLIENT_SECRET, tenantId, SECRET_NAMES.santander.CLIENT_SECRET)
    : process.env.SANTANDER_CLIENT_SECRET || '';

  // mTLS — Key Vault per-tenant ou env vars
  const certBase64 = tenantId
    ? await resolveValue(undefined, process.env.SANTANDER_CERT_BASE64, tenantId, SECRET_NAMES.santander.CERT_BASE64)
    : process.env.SANTANDER_CERT_BASE64;

  const keyBase64 = tenantId
    ? await resolveValue(undefined, process.env.SANTANDER_KEY_BASE64, tenantId, SECRET_NAMES.santander.KEY_BASE64)
    : process.env.SANTANDER_KEY_BASE64;

  return {
    clientId,
    clientSecret,
    environment: (process.env.SANTANDER_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
    workspaceId: process.env.SANTANDER_WORKSPACE_ID,
    convenio: process.env.SANTANDER_CONVENIO,

    // Dados bancários — per-client (ClientConfig) com fallback para env vars
    agencia: config.bancoAgencia || process.env.SANTANDER_AGENCIA,
    conta: config.bancoConta || process.env.SANTANDER_CONTA,
    contaDigito: process.env.SANTANDER_CONTA_DIGITO,

    certBase64,
    keyBase64,
  };
}

/**
 * Resolve credenciais Getnet para um cliente.
 */
export function resolveGetnetCredentials(config: ClientConfig): GetnetCredentials {
  return {
    user: process.env.GETNET_USER || '',
    estabelecimento: config.getnetEstabelecimento,
    // password vem do Key Vault (kv-wf-core / GETNET-PASS)
  };
}

/**
 * Resolve todas as credenciais de um cliente a partir do seu ID.
 * Busca o client no storage e retorna as credenciais resoltas.
 */
export async function resolveClientCredentials(clientId: string): Promise<{
  client: Client;
  omie?: OmieCredentials;
  santander?: SantanderCredentials;
  getnet?: GetnetCredentials;
}> {
  const client = await getClientById(clientId);

  if (!client) {
    throw new Error(`Client ${clientId} not found`);
  }

  const result: {
    client: Client;
    omie?: OmieCredentials;
    santander?: SantanderCredentials;
    getnet?: GetnetCredentials;
  } = { client };

  // Resolve por sistema ERP
  if (client.sistema === 'omie') {
    result.omie = await resolveOmieCredentials(client.config, client.tenantId);
  }

  // Resolve por banco
  if (client.config.banco === 'santander') {
    result.santander = await resolveSantanderCredentials(client.config, client.tenantId);
  }

  // Resolve por adquirente
  if (client.config.adquirente === 'getnet') {
    result.getnet = resolveGetnetCredentials(client.config);
  }

  return result;
}
