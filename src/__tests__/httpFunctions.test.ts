/**
 * Tests for HTTP Functions
 *
 * Tests the handler functions directly by providing mock request/context objects.
 * Storage is mocked to return controlled data.
 */

// Mock all Azure/external dependencies
jest.mock('@azure/data-tables', () => ({
  TableClient: {
    fromConnectionString: jest.fn(() => ({
      createTable: jest.fn().mockResolvedValue(undefined),
      listEntities: jest.fn(() => ({
        [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true }) }),
      })),
      getEntity: jest.fn().mockRejectedValue({ statusCode: 404 }),
      createEntity: jest.fn().mockResolvedValue(undefined),
      upsertEntity: jest.fn().mockResolvedValue(undefined),
      updateEntity: jest.fn().mockResolvedValue(undefined),
    })),
  },
}));

jest.mock('@azure/storage-queue', () => ({
  QueueServiceClient: {
    fromConnectionString: jest.fn(() => ({
      getQueueClient: jest.fn(() => ({
        getProperties: jest.fn().mockResolvedValue({ approximateMessagesCount: 0 }),
      })),
    })),
  },
}));

jest.mock('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn(),
}));

jest.mock('@azure/keyvault-secrets', () => ({
  SecretClient: jest.fn(),
}));

jest.mock('durable-functions', () => ({
  input: { durableClient: jest.fn(() => ({ type: 'durableClient' })) },
  getClient: jest.fn(() => ({
    startNew: jest.fn().mockResolvedValue('test-instance-id'),
    getStatus: jest.fn().mockResolvedValue(null),
  })),
  app: {
    orchestration: jest.fn(),
    activity: jest.fn(),
    entity: jest.fn(),
  },
}));

jest.mock('openai', () => {
  const mock = jest.fn(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: '{"transactions":[]}' } }],
        }),
      },
    },
  }));
  (mock as any).default = mock;
  return mock;
});

// Capture registered routes
const registeredRoutes: Record<string, any> = {};
jest.mock('@azure/functions', () => ({
  app: {
    http: (name: string, options: any) => {
      registeredRoutes[name] = options;
    },
    timer: jest.fn(),
  },
  HttpRequest: jest.fn(),
  InvocationContext: jest.fn(),
}));

// Helper to create mock request
function mockRequest(options: {
  method?: string;
  query?: Record<string, string>;
  params?: Record<string, string>;
  body?: any;
}) {
  const queryMap = new URLSearchParams(options.query || {});
  return {
    method: options.method || 'GET',
    query: queryMap,
    params: options.params || {},
    json: async () => options.body || {},
    text: async () => JSON.stringify(options.body || {}),
    headers: new Map(),
  };
}

// Helper to create mock context
function mockContext(name = 'test') {
  return {
    functionName: name,
    invocationId: 'test-id',
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
    extraInputs: { get: jest.fn() },
    extraOutputs: { set: jest.fn() },
  };
}

// ============================================================================
// LOAD ALL FUNCTIONS (registers routes)
// ============================================================================

beforeAll(() => {
  // Set env for health check
  process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';

  // Import all functions to trigger registration
  require('../functions/health');
  require('../functions/bpoDashboard');
  require('../functions/bpoAutorizacoes');
  require('../functions/bpoDuvidas');
  require('../functions/bpoHistorico');
  require('../functions/bpoFilas');
  require('../functions/bpoCycle');
  require('../functions/bpoClientes');
  require('../functions/bpoSimulation');
  require('../functions/bpoMetrics');
});

// ============================================================================
// TESTS
// ============================================================================

describe('Function Registration', () => {
  test('health function is registered', () => {
    expect(registeredRoutes['health']).toBeDefined();
    expect(registeredRoutes['health'].methods).toContain('GET');
    expect(registeredRoutes['health'].route).toBe('health');
  });

  test('all dashboard/BPO functions are registered', () => {
    expect(registeredRoutes['bpoDashboard']).toBeDefined();
    expect(registeredRoutes['bpoAutorizacoesList']).toBeDefined();
    expect(registeredRoutes['bpoAutorizacoesAprovar']).toBeDefined();
    expect(registeredRoutes['bpoAutorizacoesRejeitar']).toBeDefined();
    expect(registeredRoutes['bpoDuvidasList']).toBeDefined();
    expect(registeredRoutes['bpoDuvidasResolver']).toBeDefined();
    expect(registeredRoutes['bpoDuvidasPular']).toBeDefined();
    expect(registeredRoutes['bpoHistorico']).toBeDefined();
    expect(registeredRoutes['bpoFilas']).toBeDefined();
    expect(registeredRoutes['bpoCycleStart']).toBeDefined();
    expect(registeredRoutes['bpoCycleStatus']).toBeDefined();
    expect(registeredRoutes['bpoClientesList']).toBeDefined();
    expect(registeredRoutes['bpoClientesDetail']).toBeDefined();
    expect(registeredRoutes['bpoClientesCreate']).toBeDefined();
    expect(registeredRoutes['bpoClientesUpdate']).toBeDefined();
    expect(registeredRoutes['bpoSimulate']).toBeDefined();
    expect(registeredRoutes['bpoWorkspace']).toBeDefined();
    expect(registeredRoutes['bpoMetrics']).toBeDefined();
  });
});

describe('Health Endpoint', () => {
  test('returns health status', async () => {
    const handler = registeredRoutes['health'].handler;
    const req = mockRequest({});
    const ctx = mockContext('health');

    const result = await handler(req, ctx);

    expect(result.status).toBeDefined();
    expect(result.jsonBody).toBeDefined();
    expect(result.jsonBody.service).toBe('wf-operacao-head');
    expect(result.jsonBody.version).toBeDefined();
    expect(result.jsonBody.services).toBeDefined();
    expect(result.jsonBody.ai).toBeDefined();
  });

  test('reports storage as connected when env var set', async () => {
    const handler = registeredRoutes['health'].handler;
    const result = await handler(mockRequest({}), mockContext('health'));

    expect(result.jsonBody.services.storage).toBe('connected');
  });
});

describe('BPO Dashboard', () => {
  test('returns dashboard structure', async () => {
    const handler = registeredRoutes['bpoDashboard'].handler;
    const result = await handler(mockRequest({}), mockContext('dashboard'));

    expect(result.status).toBe(200);
    expect(result.jsonBody).toBeDefined();
    expect(result.jsonBody.kpis).toBeDefined();
    expect(result.jsonBody.pipeline).toBeDefined();
    expect(result.jsonBody.ultimosCiclos).toBeDefined();
    expect(result.jsonBody.alertas).toBeDefined();
  });
});

describe('BPO Clientes', () => {
  test('list returns items array', async () => {
    const handler = registeredRoutes['bpoClientesList'].handler;
    const result = await handler(mockRequest({}), mockContext('clientes'));

    expect(result.status).toBe(200);
    expect(result.jsonBody.items).toBeDefined();
    expect(Array.isArray(result.jsonBody.items)).toBe(true);
    expect(result.jsonBody.total).toBeDefined();
  });

  test('detail returns 404 for unknown client', async () => {
    const handler = registeredRoutes['bpoClientesDetail'].handler;
    const result = await handler(
      mockRequest({ params: { id: 'unknown' } }),
      mockContext('clientes')
    );

    expect(result.status).toBe(404);
  });

  test('create requires mandatory fields', async () => {
    const handler = registeredRoutes['bpoClientesCreate'].handler;
    const result = await handler(
      mockRequest({ method: 'POST', body: { nome: 'Test' } }),
      mockContext('clientes')
    );

    expect(result.status).toBe(400);
    expect(result.jsonBody.error).toContain('obrigatórios');
  });
});

describe('BPO Autorizacoes', () => {
  test('list returns items array', async () => {
    const handler = registeredRoutes['bpoAutorizacoesList'].handler;
    const result = await handler(mockRequest({}), mockContext('auth'));

    expect(result.status).toBe(200);
    expect(result.jsonBody.items).toBeDefined();
  });

  test('reject requires motivo', async () => {
    const handler = registeredRoutes['bpoAutorizacoesRejeitar'].handler;
    const result = await handler(
      mockRequest({ method: 'POST', params: { id: 'auth-1' }, body: {} }),
      mockContext('auth')
    );

    expect(result.status).toBe(400);
    expect(result.jsonBody.message).toContain('obrigatório');
  });
});

describe('BPO Historico', () => {
  test('returns paginated results', async () => {
    const handler = registeredRoutes['bpoHistorico'].handler;
    const result = await handler(mockRequest({}), mockContext('historico'));

    expect(result.status).toBe(200);
    expect(result.jsonBody.items).toBeDefined();
    expect(result.jsonBody.total).toBeDefined();
    expect(result.jsonBody.limit).toBeDefined();
    expect(result.jsonBody.offset).toBeDefined();
  });
});

describe('BPO Metrics', () => {
  test('returns global metrics', async () => {
    const handler = registeredRoutes['bpoMetrics'].handler;
    const result = await handler(
      mockRequest({ params: {} }),
      mockContext('metrics')
    );

    expect(result.status).toBe(200);
    expect(result.jsonBody.scope).toBe('global');
    expect(result.jsonBody.transactions).toBeDefined();
  });
});
