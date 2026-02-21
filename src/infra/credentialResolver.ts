/**
 * CredentialResolver - Resolução de credenciais per-client
 *
 * REGRA SIMPLES:
 *   - Login/identificador → ClientConfig (Table Storage, grátis)
 *   - Secret/senha         → Key Vault (com cache de 15 min)
 *   - Fallback             → env vars globais (compatibilidade legado)
 *
 * Nenhum secret é armazenado no Table Storage para novos clientes.
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
  password?: string;
}

// ============================================================================
// RESOLVERS
// ============================================================================

/**
 * Resolve credenciais Omie para um cliente.
 *
 * Login (appKey)   → ClientConfig.omieAppKey → env OMIE_APP_KEY
 * Secret (appSecret) → Key Vault {tenantId}-OMIE-APP-SECRET → env OMIE_APP_SECRET
 */
export async function resolveOmieCredentials(
  config: ClientConfig,
  tenantId?: string
): Promise<OmieCredentials> {
  // Login — Table Storage ou env
  const appKey = config.omieAppKey || process.env.OMIE_APP_KEY || '';

  // Secret — Key Vault ou env
  let appSecret = '';
  if (tenantId) {
    appSecret = await getTenantSecret(tenantId, SECRET_NAMES.omie.APP_SECRET);
  }
  if (!appSecret) {
    appSecret = process.env.OMIE_APP_SECRET || '';
  }

  if (!appKey || !appSecret) {
    throw new Error('Omie credentials not found (appKey via ClientConfig, appSecret via Key Vault ou env)');
  }

  logger.info('Omie credentials resolved', { tenantId, loginFrom: config.omieAppKey ? 'ClientConfig' : 'env' });
  return { appKey, appSecret };
}

/**
 * Resolve credenciais Santander para um cliente.
 *
 * Login (clientId)    → ClientConfig.santanderClientId → env SANTANDER_CLIENT_ID
 * Agência/Conta       → ClientConfig.bancoAgencia/bancoConta → env
 * Secret (clientSecret) → Key Vault {tenantId}-SANTANDER-CLIENT-SECRET → env
 * Certs (mTLS)        → Key Vault {tenantId}-SANTANDER-CERT-BASE64 → env
 */
export async function resolveSantanderCredentials(
  config: ClientConfig,
  tenantId?: string
): Promise<SantanderCredentials> {
  // Login — Table Storage ou env
  const clientId = config.santanderClientId || process.env.SANTANDER_CLIENT_ID || '';

  // Secrets — Key Vault ou env
  let clientSecret = '';
  let certBase64: string | undefined;
  let keyBase64: string | undefined;

  if (tenantId) {
    clientSecret = await getTenantSecret(tenantId, SECRET_NAMES.santander.CLIENT_SECRET);
    certBase64 = (await getTenantSecret(tenantId, SECRET_NAMES.santander.CERT_BASE64)) || undefined;
    keyBase64 = (await getTenantSecret(tenantId, SECRET_NAMES.santander.KEY_BASE64)) || undefined;
  }

  if (!clientSecret) clientSecret = process.env.SANTANDER_CLIENT_SECRET || '';
  if (!certBase64) certBase64 = process.env.SANTANDER_CERT_BASE64;
  if (!keyBase64) keyBase64 = process.env.SANTANDER_KEY_BASE64;

  return {
    clientId,
    clientSecret,
    environment: (process.env.SANTANDER_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
    workspaceId: process.env.SANTANDER_WORKSPACE_ID,
    convenio: process.env.SANTANDER_CONVENIO,

    // Dados bancários — per-client (Table Storage) com fallback env
    agencia: config.bancoAgencia || process.env.SANTANDER_AGENCIA,
    conta: config.bancoConta || process.env.SANTANDER_CONTA,
    contaDigito: config.bancoContaDigito || process.env.SANTANDER_CONTA_DIGITO,

    certBase64,
    keyBase64,
  };
}

/**
 * Resolve credenciais Getnet para um cliente.
 *
 * Login (user)        → ClientConfig.getnetUser → env GETNET_USER
 * Estabelecimento     → ClientConfig.getnetEstabelecimento
 * Secret (password)   → Key Vault GETNET-PASS (compartilhado)
 */
export async function resolveGetnetCredentials(
  config: ClientConfig
): Promise<GetnetCredentials> {
  // Login — Table Storage ou env
  const user = config.getnetUser || process.env.GETNET_USER || '';

  // Secret — Key Vault (compartilhado, sem tenantId)
  const password = await getTenantSecret('', SECRET_NAMES.getnet.PASSWORD);

  return {
    user,
    estabelecimento: config.getnetEstabelecimento,
    password: password || undefined,
  };
}

/**
 * Resolve todas as credenciais de um cliente a partir do seu ID.
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

  if (client.sistema === 'omie') {
    result.omie = await resolveOmieCredentials(client.config, client.tenantId);
  }

  if (client.config.banco === 'santander') {
    result.santander = await resolveSantanderCredentials(client.config, client.tenantId);
  }

  if (client.config.adquirente === 'getnet') {
    result.getnet = await resolveGetnetCredentials(client.config);
  }

  return result;
}
