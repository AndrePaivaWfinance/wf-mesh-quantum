/**
 * CredentialResolver - Resolução de credenciais per-client
 *
 * Estratégia:
 *   1. Lê do ClientConfig (Table Storage) — per-client
 *   2. Fallback para env vars (global) — compatibilidade com cliente único
 *
 * Isso permite que N clientes coexistam, cada um com suas credenciais,
 * sem quebrar o fluxo de quem ainda usa env vars globais.
 */

import { Client, ClientConfig } from '../../shared/types';
import { getClientById } from '../../shared/storage/clientStorage';
import { createLogger } from '../../shared/utils';

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
// RESOLVER
// ============================================================================

/**
 * Resolve credenciais Omie para um cliente.
 * ClientConfig first, env vars fallback.
 */
export function resolveOmieCredentials(config: ClientConfig): OmieCredentials {
  const appKey = config.omieAppKey || process.env.OMIE_APP_KEY || '';
  const appSecret = config.omieAppSecret || process.env.OMIE_APP_SECRET || '';

  if (!appKey || !appSecret) {
    throw new Error('Omie credentials not found (neither in ClientConfig nor env vars)');
  }

  const source = config.omieAppKey ? 'ClientConfig' : 'env';
  logger.info(`Omie credentials resolved from ${source}`);

  return { appKey, appSecret };
}

/**
 * Resolve credenciais Santander para um cliente.
 * ClientConfig first, env vars fallback.
 *
 * Nota: Santander tem muitos campos. Os campos de OAuth (clientId/clientSecret)
 * ainda ficam em env vars ou Key Vault por segurança. Dados bancários (agência/conta)
 * ficam no ClientConfig.
 */
export function resolveSantanderCredentials(config: ClientConfig): SantanderCredentials {
  return {
    // OAuth — env vars (sensíveis, compartilhados ou per-client via Key Vault no futuro)
    clientId: process.env.SANTANDER_CLIENT_ID || '',
    clientSecret: process.env.SANTANDER_CLIENT_SECRET || '',
    environment: (process.env.SANTANDER_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
    workspaceId: process.env.SANTANDER_WORKSPACE_ID,
    convenio: process.env.SANTANDER_CONVENIO,

    // Dados bancários — per-client (ClientConfig) com fallback para env vars
    agencia: config.bancoAgencia || process.env.SANTANDER_AGENCIA,
    conta: config.bancoConta || process.env.SANTANDER_CONTA,
    contaDigito: process.env.SANTANDER_CONTA_DIGITO,

    // mTLS — env vars (certificados ficam seguros no App Settings / Key Vault)
    certBase64: process.env.SANTANDER_CERT_BASE64,
    keyBase64: process.env.SANTANDER_KEY_BASE64,
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
    result.omie = resolveOmieCredentials(client.config);
  }

  // Resolve por banco
  if (client.config.banco === 'santander') {
    result.santander = resolveSantanderCredentials(client.config);
  }

  // Resolve por adquirente
  if (client.config.adquirente === 'getnet') {
    result.getnet = resolveGetnetCredentials(client.config);
  }

  return result;
}
