/**
 * OnboardingService - Orquestra o cadastro de credenciais de um cliente
 *
 * REGRA:
 *   Login/identificador → ClientConfig (Table Storage, grátis)
 *   Secret/senha        → Key Vault (com cache 15 min)
 *
 * Fluxo:
 *   1. Recebe dados brutos do endpoint
 *   2. Valida campos obrigatórios por fonte
 *   3. Salva logins no ClientConfig
 *   4. Salva secrets no Key Vault
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

export interface OnboardingInput {
  clientId: string;

  omie?: {
    appKey: string;     // login → Table
    appSecret: string;  // secret → KV
  };

  santander?: {
    clientId: string;     // login → Table
    clientSecret: string; // secret → KV
    agencia: string;      // dado bancário → Table
    conta: string;        // dado bancário → Table
    contaDigito?: string; // dado bancário → Table
    convenio?: string;
    certBase64?: string;  // secret → KV
    keyBase64?: string;   // secret → KV
  };

  getnet?: {
    user: string;           // login → Table
    password: string;       // secret → KV (compartilhado)
    estabelecimento: string; // config → Table
  };

  notificacoes?: {
    emailDestino?: string;
    whatsappNumero?: string;
  };
}

export interface SourceStatus {
  configured: boolean;
  secretsSaved: boolean;
  tested: boolean;
  error?: string;
  fields: { name: string; status: 'ok' | 'missing' | 'saved_to_kv' | 'saved_to_table' }[];
}

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
// SERVICE
// ============================================================================

export async function executeOnboarding(input: OnboardingInput): Promise<OnboardingResult> {
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

  // Processar cada fonte
  if (client.sistema === 'omie') {
    result.sources.omie = await processOmie(client, input.omie, configUpdates);
  }

  if (client.config.banco === 'santander') {
    result.sources.santander = await processSantander(client, input.santander, configUpdates);
  }

  if (client.config.adquirente === 'getnet') {
    result.sources.getnet = await processGetnet(client, input.getnet, configUpdates);
  }

  // Notificações
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

  // Salvar config atualizada (logins + dados bancários)
  const updatedClient: Client = {
    ...client,
    config: { ...client.config, ...configUpdates },
    updatedAt: new Date().toISOString(),
  };
  await upsertClient(updatedClient);

  // Avaliar se está pronto
  const allSources = Object.values(result.sources);
  const allConfigured = allSources.length > 0 && allSources.every((s) => s.configured);
  const allTested = allSources.every((s) => s.tested);
  result.ready = allConfigured && allTested;

  // Montar próximos passos
  result.nextSteps = buildNextSteps(result);

  if (result.ready && client.status === ClientStatus.ONBOARDING) {
    result.nextSteps.push(
      'Todas as fontes configuradas e testadas! Use PUT /api/bpo/clientes/{id} com status:"ativo" para ativar.'
    );
  }

  logger.info(`Onboarding completed for ${client.nome}: ready=${result.ready}`);
  return result;
}

/**
 * Checklist sem novos dados — verifica estado atual.
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
  if (!data) return checkOmieStatus(client);

  const fields: SourceStatus['fields'] = [];
  let configured = true;

  // Login → Table Storage
  if (data.appKey) {
    configUpdates.omieAppKey = data.appKey;
    fields.push({ name: 'Omie App Key (login)', status: 'saved_to_table' });
  } else {
    fields.push({ name: 'Omie App Key (login)', status: 'missing' });
    configured = false;
  }

  // Secret → Key Vault
  if (data.appSecret) {
    await setTenantSecret(client.tenantId, SECRET_NAMES.omie.APP_SECRET, data.appSecret);
    fields.push({ name: 'Omie App Secret (senha)', status: 'saved_to_kv' });
  } else {
    fields.push({ name: 'Omie App Secret (senha)', status: 'missing' });
    configured = false;
  }

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
  if (!data) return checkSantanderStatus(client);

  const fields: SourceStatus['fields'] = [];
  let configured = true;

  // Login → Table Storage
  if (data.clientId) {
    configUpdates.santanderClientId = data.clientId;
    fields.push({ name: 'Santander Client ID (login)', status: 'saved_to_table' });
  } else {
    fields.push({ name: 'Santander Client ID (login)', status: 'missing' });
    configured = false;
  }

  // Dados bancários → Table Storage
  if (data.agencia) {
    configUpdates.bancoAgencia = data.agencia;
    fields.push({ name: 'Agência', status: 'saved_to_table' });
  } else {
    fields.push({ name: 'Agência', status: 'missing' });
    configured = false;
  }

  if (data.conta) {
    configUpdates.bancoConta = data.conta;
    fields.push({ name: 'Conta corrente', status: 'saved_to_table' });
  } else {
    fields.push({ name: 'Conta corrente', status: 'missing' });
    configured = false;
  }

  if (data.contaDigito) {
    configUpdates.bancoContaDigito = data.contaDigito;
  }
  configUpdates.banco = 'santander';

  // Secret → Key Vault
  if (data.clientSecret) {
    await setTenantSecret(client.tenantId, SECRET_NAMES.santander.CLIENT_SECRET, data.clientSecret);
    fields.push({ name: 'Santander Client Secret (senha)', status: 'saved_to_kv' });
  } else {
    fields.push({ name: 'Santander Client Secret (senha)', status: 'missing' });
    configured = false;
  }

  // Certs mTLS (opcionais) → Key Vault
  if (data.certBase64) {
    await setTenantSecret(client.tenantId, SECRET_NAMES.santander.CERT_BASE64, data.certBase64);
    fields.push({ name: 'Certificado mTLS', status: 'saved_to_kv' });
  }
  if (data.keyBase64) {
    await setTenantSecret(client.tenantId, SECRET_NAMES.santander.KEY_BASE64, data.keyBase64);
    fields.push({ name: 'Chave mTLS', status: 'saved_to_kv' });
  }

  // Testar conexão
  let tested = false;
  let error: string | undefined;
  if (configured) {
    try {
      const { SantanderClient } = await import('../ops/santander/adapters/client');
      const santanderClient = new SantanderClient({
        clientId: data.clientId,
        clientSecret: data.clientSecret,
        environment: 'sandbox' as const,
        agencia: data.agencia,
        conta: data.conta,
        contaDigito: data.contaDigito,
        convenio: data.convenio,
        certBase64: data.certBase64,
        keyBase64: data.keyBase64,
      });
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
  if (!data) return checkGetnetStatus(client);

  const fields: SourceStatus['fields'] = [];
  let configured = true;

  // Login → Table Storage
  if (data.user) {
    configUpdates.getnetUser = data.user;
    fields.push({ name: 'Usuário SFTP (login)', status: 'saved_to_table' });
  } else {
    fields.push({ name: 'Usuário SFTP (login)', status: 'missing' });
    configured = false;
  }

  if (data.estabelecimento) {
    configUpdates.getnetEstabelecimento = data.estabelecimento;
    configUpdates.adquirente = 'getnet';
    fields.push({ name: 'Estabelecimento', status: 'saved_to_table' });
  } else {
    fields.push({ name: 'Estabelecimento', status: 'missing' });
    configured = false;
  }

  // Secret → Key Vault (compartilhado)
  if (data.password) {
    await setTenantSecret('', SECRET_NAMES.getnet.PASSWORD, data.password);
    fields.push({ name: 'Senha SFTP (senha)', status: 'saved_to_kv' });
  } else {
    fields.push({ name: 'Senha SFTP (senha)', status: 'missing' });
    configured = false;
  }

  return { configured, secretsSaved: true, tested: false, fields };
}

// ============================================================================
// CHECKERS (verificação sem novos dados)
// ============================================================================

async function checkOmieStatus(client: Client): Promise<SourceStatus> {
  const fields: SourceStatus['fields'] = [];

  const hasLogin = !!client.config.omieAppKey;
  const hasSecret = await hasTenantSecret(client.tenantId, SECRET_NAMES.omie.APP_SECRET);

  fields.push({ name: 'Omie App Key (login)', status: hasLogin ? 'ok' : 'missing' });
  fields.push({ name: 'Omie App Secret (senha)', status: hasSecret ? 'ok' : 'missing' });

  return { configured: hasLogin && hasSecret, secretsSaved: hasSecret, tested: false, fields };
}

async function checkSantanderStatus(client: Client): Promise<SourceStatus> {
  const fields: SourceStatus['fields'] = [];

  const hasLogin = !!client.config.santanderClientId;
  const hasSecret = await hasTenantSecret(client.tenantId, SECRET_NAMES.santander.CLIENT_SECRET);
  const hasAgencia = !!client.config.bancoAgencia;
  const hasConta = !!client.config.bancoConta;

  fields.push({ name: 'Santander Client ID (login)', status: hasLogin ? 'ok' : 'missing' });
  fields.push({ name: 'Santander Client Secret (senha)', status: hasSecret ? 'ok' : 'missing' });
  fields.push({ name: 'Agência', status: hasAgencia ? 'ok' : 'missing' });
  fields.push({ name: 'Conta corrente', status: hasConta ? 'ok' : 'missing' });

  return { configured: hasLogin && hasSecret && hasAgencia && hasConta, secretsSaved: hasSecret, tested: false, fields };
}

async function checkGetnetStatus(client: Client): Promise<SourceStatus> {
  const fields: SourceStatus['fields'] = [];

  const hasUser = !!client.config.getnetUser || !!process.env.GETNET_USER;
  const hasPassword = await hasTenantSecret('', SECRET_NAMES.getnet.PASSWORD);
  const hasEstabelecimento = !!client.config.getnetEstabelecimento;

  fields.push({ name: 'Usuário SFTP (login)', status: hasUser ? 'ok' : 'missing' });
  fields.push({ name: 'Senha SFTP (senha)', status: hasPassword ? 'ok' : 'missing' });
  fields.push({ name: 'Estabelecimento', status: hasEstabelecimento ? 'ok' : 'missing' });

  return { configured: hasUser && hasPassword && hasEstabelecimento, secretsSaved: hasPassword, tested: false, fields };
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
      steps.push(`${sourceName}: preencher ${missing.map((f) => f.name).join(', ')}`);
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
