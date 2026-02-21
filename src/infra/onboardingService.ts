/**
 * OnboardingService - Orquestra o cadastro de credenciais de um cliente
 *
 * Fluxo:
 *   1. Recebe dados brutos do endpoint
 *   2. Valida campos obrigatórios por fonte
 *   3. Salva secrets no Key Vault (sensíveis)
 *   4. Salva config no ClientConfig (não-sensíveis)
 *   5. Testa conexão de cada fonte
 *   6. Retorna checklist com status
 */

import { Client, ClientConfig, ClientStatus } from '../../shared/types';
import { getClientById, upsertClient } from '../../shared/storage/clientStorage';
import { setTenantSecret, hasTenantSecret, SECRET_NAMES } from './keyVaultHelper';
import { createLogger } from '../../shared/utils';

const logger = createLogger('OnboardingService');

// ============================================================================
// TIPOS
// ============================================================================

/** Dados de entrada para onboarding */
export interface OnboardingInput {
  clientId: string;

  omie?: {
    appKey: string;
    appSecret: string;
  };

  santander?: {
    clientId: string;
    clientSecret: string;
    agencia: string;
    conta: string;
    contaDigito?: string;
    convenio?: string;
    certBase64?: string;
    keyBase64?: string;
  };

  getnet?: {
    user: string;
    password: string;
    estabelecimento: string;
  };

  notificacoes?: {
    emailDestino?: string;
    whatsappNumero?: string;
  };
}

/** Status de uma fonte individual */
export interface SourceStatus {
  configured: boolean;
  secretsSaved: boolean;
  tested: boolean;
  error?: string;
  fields: { name: string; status: 'ok' | 'missing' | 'saved_to_kv' }[];
}

/** Resultado do onboarding */
export interface OnboardingResult {
  clientId: string;
  tenantId: string;
  nome: string;

  sources: {
    omie?: SourceStatus;
    santander?: SourceStatus;
    getnet?: SourceStatus;
  };

  ready: boolean;
  status: ClientStatus;
  nextSteps: string[];
}

// ============================================================================
// CAMPOS OBRIGATÓRIOS POR FONTE
// ============================================================================

interface FieldDef {
  field: string;
  label: string;
  sensitive: boolean;
  kvName?: string;
  optional?: boolean;
}

const REQUIRED_FIELDS: Record<string, FieldDef[]> = {
  omie: [
    { field: 'appKey', label: 'Omie App Key', sensitive: true, kvName: SECRET_NAMES.omie.APP_KEY },
    { field: 'appSecret', label: 'Omie App Secret', sensitive: true, kvName: SECRET_NAMES.omie.APP_SECRET },
  ],
  santander: [
    { field: 'clientId', label: 'Santander Client ID (OAuth)', sensitive: true, kvName: SECRET_NAMES.santander.CLIENT_ID },
    { field: 'clientSecret', label: 'Santander Client Secret (OAuth)', sensitive: true, kvName: SECRET_NAMES.santander.CLIENT_SECRET },
    { field: 'agencia', label: 'Agência', sensitive: false },
    { field: 'conta', label: 'Conta corrente', sensitive: false },
    { field: 'contaDigito', label: 'Dígito da conta', sensitive: false, optional: true },
    { field: 'convenio', label: 'Convênio', sensitive: false, optional: true },
    { field: 'certBase64', label: 'Certificado mTLS (Base64)', sensitive: true, kvName: SECRET_NAMES.santander.CERT_BASE64, optional: true },
    { field: 'keyBase64', label: 'Chave mTLS (Base64)', sensitive: true, kvName: SECRET_NAMES.santander.KEY_BASE64, optional: true },
  ],
  getnet: [
    { field: 'user', label: 'Usuário SFTP Getnet', sensitive: false },
    { field: 'password', label: 'Senha SFTP Getnet', sensitive: true, kvName: SECRET_NAMES.getnet.PASSWORD },
    { field: 'estabelecimento', label: 'Código do estabelecimento', sensitive: false },
  ],
};

// ============================================================================
// SERVICE
// ============================================================================

export async function executeOnboarding(input: OnboardingInput): Promise<OnboardingResult> {
  // 1. Buscar cliente existente
  const client = await getClientById(input.clientId);
  if (!client) {
    throw new Error(`Cliente ${input.clientId} não encontrado`);
  }

  logger.info(`Starting onboarding for ${client.nome} (${client.tenantId})`);

  const result: OnboardingResult = {
    clientId: client.id,
    tenantId: client.tenantId,
    nome: client.nome,
    sources: {},
    ready: false,
    status: client.status,
    nextSteps: [],
  };

  const configUpdates: Partial<ClientConfig> = {};

  // 2. Processar cada fonte
  if (client.sistema === 'omie') {
    result.sources.omie = await processOmie(client, input.omie, configUpdates);
  }

  if (client.config.banco === 'santander') {
    result.sources.santander = await processSantander(client, input.santander, configUpdates);
  }

  if (client.config.adquirente === 'getnet') {
    result.sources.getnet = await processGetnet(client, input.getnet, configUpdates);
  }

  // 3. Processar notificações
  if (input.notificacoes) {
    if (input.notificacoes.emailDestino) {
      configUpdates.notificacoes = {
        ...client.config.notificacoes,
        emailDestino: input.notificacoes.emailDestino,
      };
    }
    if (input.notificacoes.whatsappNumero) {
      configUpdates.notificacoes = {
        ...(configUpdates.notificacoes || client.config.notificacoes),
        whatsappNumero: input.notificacoes.whatsappNumero,
        whatsapp: true,
      };
    }
  }

  // 4. Salvar config atualizada
  const updatedClient: Client = {
    ...client,
    config: { ...client.config, ...configUpdates },
    updatedAt: new Date().toISOString(),
  };
  await upsertClient(updatedClient);

  // 5. Avaliar se está pronto
  const allSources = Object.values(result.sources);
  const allConfigured = allSources.length > 0 && allSources.every((s) => s.configured);
  const allTested = allSources.every((s) => s.tested);

  result.ready = allConfigured && allTested;

  // 6. Montar próximos passos
  result.nextSteps = buildNextSteps(result);

  // 7. Se tudo ok e status é onboarding, sugerir ativação
  if (result.ready && client.status === ClientStatus.ONBOARDING) {
    result.nextSteps.push(
      'Todas as fontes configuradas e testadas! Use PUT /api/bpo/clientes/{id} com status:"ativo" para ativar.'
    );
  }

  logger.info(`Onboarding completed for ${client.nome}: ready=${result.ready}`);
  return result;
}

/**
 * Retorna checklist de um cliente SEM processar novos dados.
 * Útil para ver o que falta.
 */
export async function getOnboardingChecklist(clientId: string): Promise<OnboardingResult> {
  const client = await getClientById(clientId);
  if (!client) {
    throw new Error(`Cliente ${clientId} não encontrado`);
  }

  const result: OnboardingResult = {
    clientId: client.id,
    tenantId: client.tenantId,
    nome: client.nome,
    sources: {},
    ready: false,
    status: client.status,
    nextSteps: [],
  };

  // Verificar cada fonte
  if (client.sistema === 'omie') {
    result.sources.omie = await checkOmieStatus(client);
  }

  if (client.config.banco === 'santander') {
    result.sources.santander = await checkSantanderStatus(client);
  }

  if (client.config.adquirente === 'getnet') {
    result.sources.getnet = await checkGetnetStatus(client);
  }

  const allSources = Object.values(result.sources);
  result.ready = allSources.length > 0 && allSources.every((s) => s.configured);
  result.nextSteps = buildNextSteps(result);

  return result;
}

// ============================================================================
// PROCESSADORES POR FONTE
// ============================================================================

async function processOmie(
  client: Client,
  data: OnboardingInput['omie'],
  configUpdates: Partial<ClientConfig>
): Promise<SourceStatus> {
  const fields: SourceStatus['fields'] = [];
  let configured = true;

  if (!data) {
    // Verificar se já foi configurado antes
    return checkOmieStatus(client);
  }

  // Salvar secrets no Key Vault
  for (const def of REQUIRED_FIELDS.omie) {
    const value = (data as any)[def.field] as string;
    if (!value) {
      fields.push({ name: def.label, status: 'missing' });
      configured = false;
      continue;
    }

    if (def.sensitive && def.kvName) {
      await setTenantSecret(client.tenantId, def.kvName, value);
      fields.push({ name: def.label, status: 'saved_to_kv' });
    } else {
      fields.push({ name: def.label, status: 'ok' });
    }
  }

  // Salvar referência no ClientConfig (sem o valor real, só flag de que existe)
  configUpdates.omieAppKey = `kv:${client.tenantId}-${SECRET_NAMES.omie.APP_KEY}`;
  configUpdates.omieAppSecret = `kv:${client.tenantId}-${SECRET_NAMES.omie.APP_SECRET}`;

  // Testar conexão
  let tested = false;
  let error: string | undefined;
  if (configured) {
    try {
      const { OmieClient } = await import('../ops/omie/adapters/client');
      const omieClient = new OmieClient(data.appKey, data.appSecret);
      const testResult = await omieClient.testConnection();
      tested = testResult.connected;
      if (!tested) error = testResult.error;
    } catch (e: any) {
      error = `Teste de conexão falhou: ${e.message}`;
    }
  }

  return { configured, secretsSaved: true, tested, error, fields };
}

async function processSantander(
  client: Client,
  data: OnboardingInput['santander'],
  configUpdates: Partial<ClientConfig>
): Promise<SourceStatus> {
  const fields: SourceStatus['fields'] = [];
  let configured = true;

  if (!data) {
    return checkSantanderStatus(client);
  }

  // Salvar secrets no Key Vault
  for (const def of REQUIRED_FIELDS.santander) {
    const value = (data as any)[def.field] as string;
    if (!value && !def.optional) {
      fields.push({ name: def.label, status: 'missing' });
      configured = false;
      continue;
    }
    if (!value && def.optional) continue;

    if (def.sensitive && def.kvName) {
      await setTenantSecret(client.tenantId, def.kvName, value);
      fields.push({ name: def.label, status: 'saved_to_kv' });
    } else {
      fields.push({ name: def.label, status: 'ok' });
    }
  }

  // Salvar dados não-sensíveis no ClientConfig
  configUpdates.banco = 'santander';
  configUpdates.bancoAgencia = data.agencia;
  configUpdates.bancoConta = data.conta;

  // Testar conexão
  let tested = false;
  let error: string | undefined;
  if (configured) {
    try {
      const { SantanderClient } = await import('../ops/santander/adapters/client');
      const santanderConfig = {
        clientId: data.clientId,
        clientSecret: data.clientSecret,
        environment: 'sandbox' as const,
        agencia: data.agencia,
        conta: data.conta,
        contaDigito: data.contaDigito,
        convenio: data.convenio,
        certBase64: data.certBase64,
        keyBase64: data.keyBase64,
      };
      const santanderClient = new SantanderClient(santanderConfig);
      // Testar obtendo token OAuth (valida clientId/clientSecret)
      await santanderClient.getToken();
      tested = true;
      santanderClient.cleanup();
    } catch (e: any) {
      error = `Teste de conexão falhou: ${e.message}`;
    }
  }

  return { configured, secretsSaved: true, tested, error, fields };
}

async function processGetnet(
  client: Client,
  data: OnboardingInput['getnet'],
  configUpdates: Partial<ClientConfig>
): Promise<SourceStatus> {
  const fields: SourceStatus['fields'] = [];
  let configured = true;

  if (!data) {
    return checkGetnetStatus(client);
  }

  // Getnet: password é compartilhado (mesmo SFTP para todos)
  for (const def of REQUIRED_FIELDS.getnet) {
    const value = (data as any)[def.field] as string;
    if (!value) {
      fields.push({ name: def.label, status: 'missing' });
      configured = false;
      continue;
    }

    if (def.sensitive && def.kvName) {
      // Getnet password é compartilhado — salva sem prefixo de tenant
      await setTenantSecret('', def.kvName, value);
      fields.push({ name: def.label, status: 'saved_to_kv' });
    } else {
      fields.push({ name: def.label, status: 'ok' });
    }
  }

  // Salvar dados não-sensíveis no ClientConfig
  configUpdates.adquirente = 'getnet';
  configUpdates.getnetEstabelecimento = data.estabelecimento;

  return { configured, secretsSaved: true, tested: false, fields };
}

// ============================================================================
// CHECKERS (verificação sem novos dados)
// ============================================================================

async function checkOmieStatus(client: Client): Promise<SourceStatus> {
  const fields: SourceStatus['fields'] = [];

  const hasKey = await hasTenantSecret(client.tenantId, SECRET_NAMES.omie.APP_KEY);
  const hasSecret = await hasTenantSecret(client.tenantId, SECRET_NAMES.omie.APP_SECRET);

  // Também aceita se o ClientConfig tem valor direto (legado)
  const hasKeyLegacy = !!client.config.omieAppKey && !client.config.omieAppKey.startsWith('kv:');
  const hasSecretLegacy = !!client.config.omieAppSecret && !client.config.omieAppSecret.startsWith('kv:');

  fields.push({ name: 'Omie App Key', status: (hasKey || hasKeyLegacy) ? 'ok' : 'missing' });
  fields.push({ name: 'Omie App Secret', status: (hasSecret || hasSecretLegacy) ? 'ok' : 'missing' });

  const configured = (hasKey || hasKeyLegacy) && (hasSecret || hasSecretLegacy);
  return { configured, secretsSaved: hasKey && hasSecret, tested: false, fields };
}

async function checkSantanderStatus(client: Client): Promise<SourceStatus> {
  const fields: SourceStatus['fields'] = [];

  const hasClientId = await hasTenantSecret(client.tenantId, SECRET_NAMES.santander.CLIENT_ID);
  const hasClientSecret = await hasTenantSecret(client.tenantId, SECRET_NAMES.santander.CLIENT_SECRET);
  const hasAgencia = !!client.config.bancoAgencia;
  const hasConta = !!client.config.bancoConta;

  fields.push({ name: 'Santander Client ID', status: hasClientId ? 'ok' : 'missing' });
  fields.push({ name: 'Santander Client Secret', status: hasClientSecret ? 'ok' : 'missing' });
  fields.push({ name: 'Agência', status: hasAgencia ? 'ok' : 'missing' });
  fields.push({ name: 'Conta corrente', status: hasConta ? 'ok' : 'missing' });

  const configured = hasClientId && hasClientSecret && hasAgencia && hasConta;
  return { configured, secretsSaved: hasClientId && hasClientSecret, tested: false, fields };
}

async function checkGetnetStatus(client: Client): Promise<SourceStatus> {
  const fields: SourceStatus['fields'] = [];

  // Getnet password é compartilhado
  const hasPassword = await hasTenantSecret('', SECRET_NAMES.getnet.PASSWORD);
  const hasEstabelecimento = !!client.config.getnetEstabelecimento;
  const hasUser = !!process.env.GETNET_USER;

  fields.push({ name: 'Usuário SFTP', status: hasUser ? 'ok' : 'missing' });
  fields.push({ name: 'Senha SFTP', status: hasPassword ? 'ok' : 'missing' });
  fields.push({ name: 'Estabelecimento', status: hasEstabelecimento ? 'ok' : 'missing' });

  const configured = hasPassword && hasEstabelecimento && hasUser;
  return { configured, secretsSaved: hasPassword, tested: false, fields };
}

// ============================================================================
// HELPERS
// ============================================================================

function buildNextSteps(result: OnboardingResult): string[] {
  const steps: string[] = [];

  for (const [sourceName, status] of Object.entries(result.sources)) {
    if (!status) continue;
    const missing = status.fields.filter((f) => f.status === 'missing');
    if (missing.length > 0) {
      steps.push(
        `${sourceName}: preencher ${missing.map((f) => f.name).join(', ')}`
      );
    }
    if (status.configured && !status.tested) {
      steps.push(`${sourceName}: testar conexão`);
    }
    if (status.error) {
      steps.push(`${sourceName}: corrigir erro — ${status.error}`);
    }
  }

  return steps;
}
