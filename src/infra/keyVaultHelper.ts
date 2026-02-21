/**
 * Key Vault Helper - Per-Client Secret Management
 *
 * REGRA: Só secrets (senhas/chaves) vão para o Key Vault.
 *        Logins/identificadores ficam no ClientConfig (Table Storage).
 *
 * Convenção de nomes:
 *   {tenantId}-{SECRET_NAME}
 *
 * Exemplos:
 *   oticas-rey-OMIE-APP-SECRET
 *   oticas-rey-SANTANDER-CLIENT-SECRET
 *   GETNET-PASS                          (compartilhado)
 *
 * Cache em memória com TTL de 15 min para evitar chamadas repetidas.
 */

import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import { createLogger } from '../../shared/utils';

const logger = createLogger('KeyVaultHelper');

const KV_URL = process.env.KEY_VAULT_URL || 'https://kv-wf-core.vault.azure.net';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutos

let kvClient: SecretClient | null = null;

function getKvClient(): SecretClient {
  if (!kvClient) {
    kvClient = new SecretClient(KV_URL, new DefaultAzureCredential());
  }
  return kvClient;
}

// ============================================================================
// CACHE
// ============================================================================

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const secretCache = new Map<string, CacheEntry>();

function getCached(name: string): string | null {
  const entry = secretCache.get(name);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.value;
  }
  if (entry) secretCache.delete(name);
  return null;
}

function setCache(name: string, value: string): void {
  secretCache.set(name, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function invalidateSecretCache(tenantId?: string): void {
  if (!tenantId) {
    secretCache.clear();
    return;
  }
  for (const key of secretCache.keys()) {
    if (key.startsWith(tenantId)) secretCache.delete(key);
  }
}

// ============================================================================
// CRUD
// ============================================================================

/**
 * Monta o nome do secret: {tenantId}-{secretName}
 * Se tenantId vazio, usa só secretName (ex: GETNET-PASS compartilhado).
 */
function buildSecretName(tenantId: string, secretName: string): string {
  return tenantId ? `${tenantId}-${secretName}` : secretName;
}

/**
 * Salva um secret no Key Vault para um tenant.
 * Invalida o cache local.
 */
export async function setTenantSecret(
  tenantId: string,
  secretName: string,
  value: string
): Promise<void> {
  const name = buildSecretName(tenantId, secretName);
  try {
    await getKvClient().setSecret(name, value, {
      tags: { tenantId: tenantId || 'shared', source: 'onboarding' },
    });
    setCache(name, value); // atualiza cache local
    logger.info(`Secret saved: ${name}`);
  } catch (error: any) {
    logger.error(`Failed to save secret ${name}: ${error.message}`);
    throw new Error(`Falha ao salvar ${secretName} no Key Vault: ${error.message}`);
  }
}

/**
 * Lê um secret do Key Vault para um tenant.
 * Usa cache em memória (TTL 15 min).
 * Retorna string vazia se não encontrar.
 */
export async function getTenantSecret(
  tenantId: string,
  secretName: string
): Promise<string> {
  const name = buildSecretName(tenantId, secretName);

  // 1. Tentar cache
  const cached = getCached(name);
  if (cached !== null) return cached;

  // 2. Buscar no Key Vault
  try {
    const secret = await getKvClient().getSecret(name);
    const value = secret.value || '';
    if (value) setCache(name, value);
    return value;
  } catch (error: any) {
    if (error.code === 'SecretNotFound' || error.statusCode === 404) {
      return '';
    }
    logger.error(`Failed to read secret ${name}: ${error.message}`);
    return '';
  }
}

/**
 * Verifica se um secret existe no Key Vault (usa cache).
 */
export async function hasTenantSecret(
  tenantId: string,
  secretName: string
): Promise<boolean> {
  const value = await getTenantSecret(tenantId, secretName);
  return value.length > 0;
}

/**
 * Remove um secret do Key Vault.
 */
export async function deleteTenantSecret(
  tenantId: string,
  secretName: string
): Promise<void> {
  const name = buildSecretName(tenantId, secretName);
  try {
    await getKvClient().beginDeleteSecret(name);
    secretCache.delete(name);
    logger.info(`Secret deleted: ${name}`);
  } catch (error: any) {
    logger.warn(`Failed to delete secret ${name}: ${error.message}`);
  }
}

// ============================================================================
// NOMES PADRÃO — SÓ SECRETS (senhas/chaves)
// Logins/identificadores ficam no ClientConfig (Table Storage)
// ============================================================================

export const SECRET_NAMES = {
  omie: {
    APP_SECRET: 'OMIE-APP-SECRET',       // senha — login (appKey) fica no ClientConfig
  },
  santander: {
    CLIENT_SECRET: 'SANTANDER-CLIENT-SECRET', // senha OAuth — login (clientId) fica no ClientConfig
    CERT_BASE64: 'SANTANDER-CERT-BASE64',     // certificado mTLS
    KEY_BASE64: 'SANTANDER-KEY-BASE64',       // chave privada mTLS
  },
  getnet: {
    PASSWORD: 'GETNET-PASS',              // senha SFTP — login (user) fica no ClientConfig
  },
} as const;
