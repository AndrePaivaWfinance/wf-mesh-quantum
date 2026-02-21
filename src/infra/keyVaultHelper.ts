/**
 * Key Vault Helper - Per-Client Secret Management
 *
 * Convenção de nomes:
 *   {tenantId}-{SECRET_NAME}
 *
 * Exemplos:
 *   oticas-rey-OMIE-APP-KEY
 *   oticas-rey-OMIE-APP-SECRET
 *   oticas-rey-SANTANDER-CLIENT-ID
 *   GETNET-PASS                      (compartilhado)
 */

import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import { createLogger } from '../../shared/utils';

const logger = createLogger('KeyVaultHelper');

const KV_URL = process.env.KEY_VAULT_URL || 'https://kv-wf-core.vault.azure.net';

let kvClient: SecretClient | null = null;

function getKvClient(): SecretClient {
  if (!kvClient) {
    kvClient = new SecretClient(KV_URL, new DefaultAzureCredential());
  }
  return kvClient;
}

/**
 * Monta o nome do secret: {tenantId}-{secretName}
 * Ex: "oticas-rey" + "OMIE-APP-KEY" → "oticas-rey-OMIE-APP-KEY"
 */
function buildSecretName(tenantId: string, secretName: string): string {
  return `${tenantId}-${secretName}`;
}

/**
 * Salva um secret no Key Vault para um tenant.
 */
export async function setTenantSecret(
  tenantId: string,
  secretName: string,
  value: string
): Promise<void> {
  const name = buildSecretName(tenantId, secretName);
  try {
    await getKvClient().setSecret(name, value, {
      tags: { tenantId, source: 'onboarding' },
    });
    logger.info(`Secret saved: ${name}`);
  } catch (error: any) {
    logger.error(`Failed to save secret ${name}: ${error.message}`);
    throw new Error(`Falha ao salvar ${secretName} no Key Vault: ${error.message}`);
  }
}

/**
 * Lê um secret do Key Vault para um tenant.
 * Retorna string vazia se não encontrar.
 */
export async function getTenantSecret(
  tenantId: string,
  secretName: string
): Promise<string> {
  const name = buildSecretName(tenantId, secretName);
  try {
    const secret = await getKvClient().getSecret(name);
    return secret.value || '';
  } catch (error: any) {
    if (error.code === 'SecretNotFound' || error.statusCode === 404) {
      return '';
    }
    logger.error(`Failed to read secret ${name}: ${error.message}`);
    return '';
  }
}

/**
 * Verifica se um secret existe no Key Vault.
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
    logger.info(`Secret deleted: ${name}`);
  } catch (error: any) {
    logger.warn(`Failed to delete secret ${name}: ${error.message}`);
  }
}

// ============================================================================
// NOMES PADRÃO DOS SECRETS POR FONTE
// ============================================================================

export const SECRET_NAMES = {
  omie: {
    APP_KEY: 'OMIE-APP-KEY',
    APP_SECRET: 'OMIE-APP-SECRET',
  },
  santander: {
    CLIENT_ID: 'SANTANDER-CLIENT-ID',
    CLIENT_SECRET: 'SANTANDER-CLIENT-SECRET',
    CERT_BASE64: 'SANTANDER-CERT-BASE64',
    KEY_BASE64: 'SANTANDER-KEY-BASE64',
  },
  getnet: {
    PASSWORD: 'GETNET-PASS', // compartilhado (sem tenantId prefix)
  },
} as const;
