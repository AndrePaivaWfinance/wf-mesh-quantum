/**
 * OpenAI Client Factory
 *
 * Detecta automaticamente se deve usar Azure OpenAI ou Standard OpenAI
 * baseado nas variáveis de ambiente configuradas.
 *
 * Azure OpenAI: AZURE_OPENAI_ENDPOINT + OPENAI_API_KEY
 * Standard OpenAI: OPENAI_API_KEY (começando com sk-)
 */

import OpenAI, { AzureOpenAI } from 'openai';
import { createLogger } from '../../shared/utils';

const logger = createLogger('OpenAIClient');

let _client: OpenAI | null = null;

/**
 * Retorna um cliente OpenAI configurado.
 * Reutiliza a mesma instância (singleton).
 */
export function getOpenAIClient(apiKeyOverride?: string): OpenAI {
  if (_client && !apiKeyOverride) return _client;

  const apiKey = apiKeyOverride || process.env.OPENAI_API_KEY || '';
  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT || '';

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY não configurada');
  }

  // Azure OpenAI: endpoint configurado ou key não começa com sk-
  if (azureEndpoint || !apiKey.startsWith('sk-')) {
    const endpoint = azureEndpoint || 'https://eastus.api.cognitive.microsoft.com/';
    logger.info('Using Azure OpenAI', { endpoint: endpoint.substring(0, 30) + '...' });

    const client = new AzureOpenAI({
      apiKey,
      endpoint,
      apiVersion: '2024-08-01-preview',
    });

    if (!apiKeyOverride) _client = client;
    return client;
  }

  // Standard OpenAI
  logger.info('Using Standard OpenAI');
  const client = new OpenAI({ apiKey });
  if (!apiKeyOverride) _client = client;
  return client;
}

/**
 * Verifica se OpenAI está configurado (sem criar instância)
 */
export function isOpenAIConfigured(): boolean {
  const apiKey = process.env.OPENAI_API_KEY || '';
  return apiKey.length > 0;
}

/**
 * Modelo padrão para classificação (deployment name no Azure)
 */
export const DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * Modelo avançado para tarefas complexas
 */
export const ADVANCED_MODEL = 'gpt-4o';
