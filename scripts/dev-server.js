/**
 * Dev Server - Local development without Azure Functions runtime
 *
 * Mocks Azure Functions SDK, Table Storage, Queue Storage, and Durable Functions
 * to allow running the HTTP API locally with in-memory data.
 *
 * Usage: node scripts/dev-server.js
 */

const http = require('http');
const Module = require('module');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 7071;

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================

const tables = {};

function getTable(name) {
  if (!tables[name]) tables[name] = [];
  return tables[name];
}

// Seed some demo data
function seedData() {
  const now = new Date().toISOString();
  const today = now.split('T')[0];

  // Seed clients
  const clientsTable = getTable('Clientes');
  clientsTable.push({
    partitionKey: 'wf-acme',
    rowKey: 'client-001',
    nome: 'ACME Tecnologia Ltda',
    cnpj: '12345678000199',
    email: 'financeiro@acme.com.br',
    telefone: '11999998888',
    plano: 'Essencial',
    sistema: 'nibo',
    status: 'ativo',
    config: JSON.stringify({
      niboTenantId: 'acme-nibo',
      banco: 'santander',
      adquirente: 'getnet',
      notificacoes: { email: true, whatsapp: false, resumoDiario: true, alertaVencimento: true },
      categoriasCustomizadas: false,
    }),
    createdAt: now,
    updatedAt: now,
  });

  clientsTable.push({
    partitionKey: 'wf-beta',
    rowKey: 'client-002',
    nome: 'Beta Serviços S.A.',
    cnpj: '98765432000188',
    email: 'contabil@beta.com.br',
    plano: 'Avançado',
    sistema: 'omie',
    status: 'ativo',
    config: JSON.stringify({
      omieAppKey: 'beta-omie-key',
      banco: 'itau',
      notificacoes: { email: true, whatsapp: true, resumoDiario: true, alertaVencimento: true },
      categoriasCustomizadas: true,
    }),
    createdAt: now,
    updatedAt: now,
  });

  // Seed a cycle
  const cyclesTable = getTable('OperacaoCycles');
  cyclesTable.push({
    partitionKey: today,
    rowKey: `${today}-${Date.now()}`,
    status: 'completed',
    clientsTotal: 2,
    clientsProcessed: 2,
    clientsFailed: 0,
    transactionsCaptured: 15,
    transactionsClassified: 12,
    transactionsSynced: 10,
    transactionsReview: 3,
    startedAt: now,
    completedAt: now,
    durationMs: 45000,
    errors: '[]',
  });

  // Seed authorizations
  const authTable = getTable('OperacaoAuthorizations');
  authTable.push({
    partitionKey: 'AUTH',
    rowKey: 'auth-001',
    clientId: 'client-001',
    transactionId: 'tx-001',
    tipo: 'pagar',
    descricao: 'PAGTO NF 4521 - ENEL SP',
    valor: 1250.00,
    vencimento: today,
    contraparte: 'ENEL São Paulo',
    categoria: 'Energia Elétrica',
    status: 'pendente',
    criadoEm: now,
  });

  authTable.push({
    partitionKey: 'AUTH',
    rowKey: 'auth-002',
    clientId: 'client-001',
    transactionId: 'tx-002',
    tipo: 'pagar',
    descricao: 'BOLETO ALUGUEL FEV/2026',
    valor: 8500.00,
    vencimento: today,
    contraparte: 'Imobiliária Central',
    categoria: 'Aluguel',
    status: 'pendente',
    criadoEm: now,
  });

  // Seed doubts
  const doubtsTable = getTable('OperacaoDoubts');
  doubtsTable.push({
    partitionKey: 'DOUBT',
    rowKey: 'doubt-001',
    clientId: 'client-001',
    transactionId: 'tx-003',
    tipo: 'classificacao',
    transacao: JSON.stringify({ id: 'tx-003', descricao: 'PIX REC MARIA S', valor: 3200.00, data: today }),
    sugestaoIA: JSON.stringify({ categoria: 'Receita de Serviços', categoriaId: 'cat-001', confianca: 0.62 }),
    opcoes: JSON.stringify([{ id: 'cat-001', nome: 'Receita de Serviços' }, { id: 'cat-002', nome: 'Empréstimo Sócio' }]),
    status: 'pendente',
    criadoEm: now,
  });

  // Seed history
  const historyTable = getTable('OperacaoHistory');
  historyTable.push({
    partitionKey: 'client-001',
    rowKey: 'hist-001',
    tipo: 'captura',
    descricao: 'Captura Santander: 8 transações',
    data: now,
    detalhes: JSON.stringify({ source: 'santander', count: 8 }),
  });

  historyTable.push({
    partitionKey: 'client-001',
    rowKey: 'hist-002',
    tipo: 'classificacao',
    descricao: 'Classificação IA: 6 automáticas, 2 para revisão',
    data: now,
    detalhes: JSON.stringify({ auto: 6, review: 2 }),
  });

  console.log('[seed] Demo data loaded: 2 clients, 1 cycle, 2 authorizations, 1 doubt, 2 history entries');
}

// ============================================================================
// MOCK: @azure/data-tables
// ============================================================================

function createMockTableClient(connectionString, tableName) {
  return {
    createTable: async () => {},
    getEntity: async (partitionKey, rowKey) => {
      const table = getTable(tableName);
      const entity = table.find(e => e.partitionKey === partitionKey && e.rowKey === rowKey);
      if (!entity) {
        const err = new Error('Not Found');
        err.statusCode = 404;
        throw err;
      }
      return entity;
    },
    listEntities: (options) => {
      const table = getTable(tableName);
      let filtered = [...table];

      // Basic filter support
      if (options && options.queryOptions && options.queryOptions.filter) {
        const filter = options.queryOptions.filter;
        // Parse simple OData filters: "field eq 'value'" with optional " and "
        const conditions = filter.split(' and ').map(c => c.trim());
        filtered = filtered.filter(entity => {
          return conditions.every(cond => {
            const match = cond.match(/^(\w+)\s+eq\s+'([^']*)'$/);
            if (!match) return true;
            const [, field, value] = match;
            if (field === 'PartitionKey') return entity.partitionKey === value;
            if (field === 'RowKey') return entity.rowKey === value;
            return String(entity[field]) === value;
          });
        });
      }

      // Return async iterable
      return {
        [Symbol.asyncIterator]() {
          let i = 0;
          return {
            async next() {
              if (i < filtered.length) return { value: filtered[i++], done: false };
              return { done: true };
            }
          };
        }
      };
    },
    createEntity: async (entity) => {
      const table = getTable(tableName);
      table.push(entity);
    },
    upsertEntity: async (entity, mode) => {
      const table = getTable(tableName);
      const idx = table.findIndex(e => e.partitionKey === entity.partitionKey && e.rowKey === entity.rowKey);
      if (idx >= 0) {
        if (mode === 'Merge') {
          table[idx] = { ...table[idx], ...entity };
        } else {
          table[idx] = entity;
        }
      } else {
        table.push(entity);
      }
    },
    updateEntity: async (entity, mode) => {
      const table = getTable(tableName);
      const idx = table.findIndex(e => e.partitionKey === entity.partitionKey && e.rowKey === entity.rowKey);
      if (idx >= 0) {
        if (mode === 'Merge') {
          table[idx] = { ...table[idx], ...entity };
        } else {
          table[idx] = entity;
        }
      }
    },
    deleteEntity: async (partitionKey, rowKey) => {
      const table = getTable(tableName);
      const idx = table.findIndex(e => e.partitionKey === partitionKey && e.rowKey === rowKey);
      if (idx >= 0) table.splice(idx, 1);
    },
  };
}

const mockDataTables = {
  TableClient: {
    fromConnectionString: (connStr, tableName) => createMockTableClient(connStr, tableName),
  },
};

// ============================================================================
// MOCK: @azure/storage-queue
// ============================================================================

const mockStorageQueue = {
  QueueServiceClient: {
    fromConnectionString: () => ({
      getQueueClient: (name) => ({
        getProperties: async () => ({ approximateMessagesCount: 0 }),
      }),
    }),
  },
};

// ============================================================================
// MOCK: @azure/identity, @azure/keyvault-secrets
// ============================================================================

const mockIdentity = {
  DefaultAzureCredential: class {},
};

const mockKeyvault = {
  SecretClient: class {
    constructor() {}
    getSecret() { return Promise.resolve({ value: 'mock-secret' }); }
  },
};

// ============================================================================
// MOCK: openai
// ============================================================================

class MockOpenAI {
  constructor() {
    this.chat = {
      completions: {
        create: async (params) => ({
          choices: [{
            message: {
              content: JSON.stringify({
                transactions: [
                  { descricao: 'PAGTO NF 9821 - COPEL PR', valor: -890.50, data: new Date().toISOString().split('T')[0], type: 'saida' },
                  { descricao: 'TED REC CLIENTE XYZ LTDA', valor: 15000.00, data: new Date().toISOString().split('T')[0], type: 'entrada' },
                  { descricao: 'DEB AUTO SEGURO EMPRESARIAL', valor: -2340.00, data: new Date().toISOString().split('T')[0], type: 'saida' },
                ]
              })
            }
          }]
        })
      }
    };
  }
}
MockOpenAI.default = MockOpenAI;

// ============================================================================
// MOCK: @azure/functions (capture route registrations)
// ============================================================================

const registeredRoutes = [];

const mockApp = {
  http: (name, options) => {
    const methods = options.methods || ['GET'];
    const route = options.route || name;
    registeredRoutes.push({
      name,
      methods: methods.map(m => m.toUpperCase()),
      route: 'api/' + route,
      handler: options.handler,
      hasExtraInputs: !!(options.extraInputs && options.extraInputs.length),
    });
  },
  timer: (name, options) => {
    // Timers are ignored in dev server
  },
};

function createMockContext(functionName) {
  return {
    functionName,
    invocationId: crypto.randomUUID(),
    log: (...args) => console.log(`[${functionName}]`, ...args),
    warn: (...args) => console.warn(`[${functionName}]`, ...args),
    error: (...args) => console.error(`[${functionName}]`, ...args),
    trace: (...args) => console.log(`[${functionName}][trace]`, ...args),
    extraInputs: {
      get: () => null,
    },
    extraOutputs: {
      set: () => {},
    },
  };
}

function createMockRequest(method, url, headers, body) {
  const parsedUrl = new URL(url, `http://localhost:${PORT}`);
  const params = {};

  return {
    method,
    url: parsedUrl.toString(),
    headers: new Map(Object.entries(headers || {})),
    query: parsedUrl.searchParams,
    params,
    json: async () => {
      try {
        return body ? JSON.parse(body) : {};
      } catch {
        return {};
      }
    },
    text: async () => body || '',
  };
}

// ============================================================================
// MOCK: durable-functions
// ============================================================================

const mockDurableFunctions = {
  input: {
    durableClient: () => ({ type: 'durableClient' }),
  },
  getClient: (context) => ({
    startNew: async (name, options) => {
      const id = `dev-${Date.now()}`;
      console.log(`[durable] Mock orchestrator "${name}" started: ${id}`);
      return id;
    },
    getStatus: async (id) => ({
      runtimeStatus: 'Completed',
      output: { message: 'Mock completed' },
      lastUpdatedTime: new Date(),
    }),
  }),
  app: {
    orchestration: (name, handler) => {
      console.log(`[durable] Registered orchestrator: ${name}`);
    },
    activity: (name, options) => {
      console.log(`[durable] Registered activity: ${name}`);
    },
    entity: (name, options) => {
      console.log(`[durable] Registered entity: ${name}`);
    },
  },
};

// ============================================================================
// MODULE INTERCEPTION
// ============================================================================

const MOCKED_MODULES = {
  '@azure/functions': { app: mockApp, HttpRequest: class {}, InvocationContext: class {} },
  '@azure/data-tables': mockDataTables,
  '@azure/storage-queue': mockStorageQueue,
  '@azure/identity': mockIdentity,
  '@azure/keyvault-secrets': mockKeyvault,
  'durable-functions': mockDurableFunctions,
  'openai': (() => { const m = MockOpenAI; m.default = MockOpenAI; return m; })(),
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (MOCKED_MODULES[request]) {
    // Return the mock key as-is; _load will intercept
    return request;
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (MOCKED_MODULES[request]) {
    return MOCKED_MODULES[request];
  }
  return originalLoad.call(this, request, parent, isMain);
};

// ============================================================================
// ROUTE MATCHING
// ============================================================================

function matchRoute(registeredRoute, requestPath) {
  // Convert "api/bpo/clientes/{id}" to regex
  const parts = registeredRoute.split('/');
  const reqParts = requestPath.split('/');

  // Handle optional params like {clientId?}
  const minParts = parts.filter(p => !p.endsWith('?}')).length;
  const maxParts = parts.length;

  if (reqParts.length < minParts || reqParts.length > maxParts) return null;

  const params = {};
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isOptional = part.endsWith('?}');
    const isParam = part.startsWith('{');

    if (isParam) {
      const paramName = part.replace(/[{}?]/g, '');
      if (i < reqParts.length) {
        params[paramName] = reqParts[i];
      } else if (!isOptional) {
        return null;
      }
    } else {
      if (i >= reqParts.length || parts[i] !== reqParts[i]) return null;
    }
  }

  return params;
}

// ============================================================================
// HTTP SERVER
// ============================================================================

function startServer() {
  const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = parsedUrl.pathname.replace(/^\//, '').replace(/\/$/, '');

    // Find matching route
    let matchedRoute = null;
    let matchedParams = null;

    for (const route of registeredRoutes) {
      if (!route.methods.includes(req.method)) continue;

      const params = matchRoute(route.route, pathname);
      if (params !== null) {
        matchedRoute = route;
        matchedParams = params;
        break;
      }
    }

    if (!matchedRoute) {
      // List routes on root
      if (pathname === '' || pathname === 'api') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          service: 'wf-mesh-quantum (dev server)',
          version: '2.0.0-local',
          endpoints: registeredRoutes.map(r => ({
            name: r.name,
            methods: r.methods,
            url: `http://localhost:${PORT}/${r.route}`,
          })),
        }, null, 2));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Route not found', path: pathname }));
      return;
    }

    // Read body
    let body = '';
    await new Promise((resolve) => {
      req.on('data', chunk => body += chunk);
      req.on('end', resolve);
    });

    // Create mock request & context
    const mockReq = createMockRequest(req.method, req.url, req.headers, body);
    mockReq.params = matchedParams;

    const context = createMockContext(matchedRoute.name);

    try {
      console.log(`${req.method} /${matchedRoute.route} -> ${matchedRoute.name}`);
      const result = await matchedRoute.handler(mockReq, context);

      const statusCode = result.status || 200;
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.jsonBody || result.body || {}, null, 2));
    } catch (error) {
      console.error(`[ERROR] ${matchedRoute.name}:`, error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message, stack: error.stack }));
    }
  });

  server.listen(PORT, () => {
    console.log('');
    console.log('='.repeat(60));
    console.log('  Mesh Quantum - Dev Server');
    console.log('='.repeat(60));
    console.log(`  URL: http://localhost:${PORT}`);
    console.log(`  Routes: ${registeredRoutes.length}`);
    console.log('');
    console.log('  Endpoints:');
    registeredRoutes.forEach(r => {
      r.methods.forEach(m => {
        console.log(`    ${m.padEnd(6)} http://localhost:${PORT}/${r.route}`);
      });
    });
    console.log('');
    console.log('  Storage: In-memory (seeded with demo data)');
    console.log('  AI: Mock (returns simulated transactions)');
    console.log('  Durable Functions: Mock (no-op orchestrators)');
    console.log('='.repeat(60));
    console.log('');
  });
}

// ============================================================================
// BOOTSTRAP
// ============================================================================

console.log('[boot] Setting up environment...');

// Set env vars
process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
process.env.FUNCTIONS_WORKER_RUNTIME = 'node';
process.env.BUILD_VERSION = '2.0.0-local';

// Seed demo data
seedData();

// Load the compiled application (which will register routes via our mocked app.http)
console.log('[boot] Loading application modules...');
const distPath = path.join(__dirname, '..', 'dist', 'src', 'index.js');
try {
  require(distPath);
} catch (error) {
  console.error('[boot] Error loading application:', error.message);
  console.error(error.stack);
  process.exit(1);
}

console.log(`[boot] ${registeredRoutes.length} HTTP routes registered`);

// Start the server
startServer();
