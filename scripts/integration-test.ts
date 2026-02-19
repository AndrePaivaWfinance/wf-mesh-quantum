#!/usr/bin/env npx ts-node
/**
 * Integration Test Suite - Azure Live Environment
 *
 * Testa todos os endpoints HTTP da API contra o ambiente real do Azure.
 *
 * Uso:
 *   npx ts-node scripts/integration-test.ts                              # usa URL padrão
 *   npx ts-node scripts/integration-test.ts https://my-app.azurewebsites.net
 *   FUNCTION_KEY=xxx npx ts-node scripts/integration-test.ts             # com function key
 *   BASE_URL=https://my-app.azurewebsites.net npm run test:integration
 *
 * Exit codes:
 *   0 = todos os testes passaram
 *   1 = algum teste falhou
 */

const BASE_URL =
  process.argv[2] ||
  process.env.BASE_URL ||
  'https://wf-operacao-mesh.azurewebsites.net';

const FUNCTION_KEY = process.env.FUNCTION_KEY || '';

// ============================================================================
// HTTP Client
// ============================================================================

interface TestResponse {
  status: number;
  body: any;
  latencyMs: number;
  ok: boolean;
}

async function request(
  method: string,
  path: string,
  body?: any
): Promise<TestResponse> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (FUNCTION_KEY) {
    headers['x-functions-key'] = FUNCTION_KEY;
  }

  const start = Date.now();

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const latencyMs = Date.now() - start;
    let responseBody: any;

    try {
      responseBody = await res.json();
    } catch {
      responseBody = await res.text();
    }

    return {
      status: res.status,
      body: responseBody,
      latencyMs,
      ok: res.ok,
    };
  } catch (error: any) {
    return {
      status: 0,
      body: { error: error.message },
      latencyMs: Date.now() - start,
      ok: false,
    };
  }
}

// ============================================================================
// Test Framework
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  latencyMs: number;
  error?: string;
  details?: string;
}

const results: TestResult[] = [];

async function test(
  name: string,
  fn: () => Promise<void>
): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({
      name,
      passed: true,
      latencyMs: Date.now() - start,
    });
    console.log(`  ✓ ${name} (${Date.now() - start}ms)`);
  } catch (error: any) {
    results.push({
      name,
      passed: false,
      latencyMs: Date.now() - start,
      error: error.message,
    });
    console.log(`  ✗ ${name} (${Date.now() - start}ms)`);
    console.log(`    → ${error.message}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertStatus(res: TestResponse, expected: number): void {
  assert(
    res.status === expected,
    `Expected status ${expected}, got ${res.status}: ${JSON.stringify(res.body).substring(0, 200)}`
  );
}

function assertHasField(obj: any, field: string): void {
  assert(
    obj && obj[field] !== undefined,
    `Missing field: ${field} in ${JSON.stringify(obj).substring(0, 200)}`
  );
}

// ============================================================================
// Tests
// ============================================================================

async function runTests(): Promise<void> {
  console.log('');
  console.log('═'.repeat(60));
  console.log('  Integration Tests - Azure Live Environment');
  console.log('═'.repeat(60));
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Auth:   ${FUNCTION_KEY ? 'Function Key' : 'None (anonymous)'}`);
  console.log('═'.repeat(60));
  console.log('');

  // ------------------------------------------------------------------
  // 1. CONNECTIVITY
  // ------------------------------------------------------------------
  console.log('  [Connectivity]');

  await test('API is reachable', async () => {
    const res = await request('GET', '/api/health');
    assert(res.status !== 0, `Cannot connect to ${BASE_URL}: ${res.body?.error}`);
  });

  // ------------------------------------------------------------------
  // 2. HEALTH
  // ------------------------------------------------------------------
  console.log('\n  [Health]');

  await test('GET /api/health returns 200', async () => {
    const res = await request('GET', '/api/health');
    assertStatus(res, 200);
    assertHasField(res.body, 'status');
    assertHasField(res.body, 'version');
    assertHasField(res.body, 'service');
    assertHasField(res.body, 'services');
    assertHasField(res.body, 'ai');
    assert(
      res.body.service === 'wf-operacao-head',
      `Unexpected service name: ${res.body.service}`
    );
  });

  await test('Health check latency < 5s', async () => {
    const res = await request('GET', '/api/health');
    assert(res.latencyMs < 5000, `Latency too high: ${res.latencyMs}ms`);
  });

  await test('Storage service is connected', async () => {
    const res = await request('GET', '/api/health');
    assertStatus(res, 200);
    assert(
      res.body.services?.storage === 'connected',
      `Storage not connected: ${res.body.services?.storage}`
    );
  });

  // ------------------------------------------------------------------
  // 3. DASHBOARD
  // ------------------------------------------------------------------
  console.log('\n  [Dashboard]');

  await test('GET /api/bpo/dashboard returns 200 with KPIs', async () => {
    const res = await request('GET', '/api/bpo/dashboard');
    assertStatus(res, 200);
    assertHasField(res.body, 'kpis');
    assertHasField(res.body, 'pipeline');
    assertHasField(res.body, 'ultimosCiclos');
    assertHasField(res.body, 'alertas');
    assertHasField(res.body.kpis, 'pendentes');
    assertHasField(res.body.kpis, 'concluidosHoje');
  });

  // ------------------------------------------------------------------
  // 4. CLIENTES
  // ------------------------------------------------------------------
  console.log('\n  [Clientes]');

  let createdClientId: string | null = null;

  await test('GET /api/bpo/clientes returns list', async () => {
    const res = await request('GET', '/api/bpo/clientes');
    assertStatus(res, 200);
    assertHasField(res.body, 'items');
    assertHasField(res.body, 'total');
    assert(Array.isArray(res.body.items), 'items should be array');
  });

  await test('POST /api/bpo/clientes validates required fields', async () => {
    const res = await request('POST', '/api/bpo/clientes', {
      nome: 'Test Only',
    });
    assertStatus(res, 400);
  });

  await test('POST /api/bpo/clientes creates client', async () => {
    const res = await request('POST', '/api/bpo/clientes', {
      nome: `Integration Test ${Date.now()}`,
      cnpj: '11222333000181',
      email: 'integration-test@wfinance.com.br',
      sistema: 'nibo',
    });
    assertStatus(res, 201);
    assertHasField(res.body, 'id');
    createdClientId = res.body.id;
  });

  await test('GET /api/bpo/clientes/:id returns created client', async () => {
    if (!createdClientId) throw new Error('No client created in previous test');
    const res = await request('GET', `/api/bpo/clientes/${createdClientId}`);
    assertStatus(res, 200);
    assertHasField(res.body, 'nome');
    assert(
      res.body.email === 'integration-test@wfinance.com.br',
      `Unexpected email: ${res.body.email}`
    );
  });

  await test('PUT /api/bpo/clientes/:id updates client', async () => {
    if (!createdClientId) throw new Error('No client created');
    const res = await request('PUT', `/api/bpo/clientes/${createdClientId}`, {
      plano: 'Avançado',
    });
    assertStatus(res, 200);
  });

  await test('GET /api/bpo/clientes/unknown returns 404', async () => {
    const res = await request(
      'GET',
      '/api/bpo/clientes/nonexistent-client-99999'
    );
    assertStatus(res, 404);
  });

  // ------------------------------------------------------------------
  // 5. AUTORIZAÇÕES
  // ------------------------------------------------------------------
  console.log('\n  [Autorizações]');

  await test('GET /api/bpo/autorizacoes returns list', async () => {
    const res = await request('GET', '/api/bpo/autorizacoes');
    assertStatus(res, 200);
    assertHasField(res.body, 'items');
    assertHasField(res.body, 'total');
  });

  await test('POST /api/bpo/autorizacoes/:id/rejeitar requires motivo', async () => {
    const res = await request(
      'POST',
      '/api/bpo/autorizacoes/fake-id/rejeitar',
      {}
    );
    assertStatus(res, 400);
    assert(
      res.body.message?.includes('obrigatório'),
      `Expected validation error: ${res.body.message}`
    );
  });

  // ------------------------------------------------------------------
  // 6. DÚVIDAS
  // ------------------------------------------------------------------
  console.log('\n  [Dúvidas]');

  await test('GET /api/bpo/duvidas returns list', async () => {
    const res = await request('GET', '/api/bpo/duvidas');
    assertStatus(res, 200);
    assertHasField(res.body, 'items');
    assertHasField(res.body, 'total');
  });

  await test('POST /api/bpo/duvidas/:id/resolver requires resolucao', async () => {
    const res = await request('POST', '/api/bpo/duvidas/fake-id/resolver', {});
    assertStatus(res, 400);
  });

  // ------------------------------------------------------------------
  // 7. HISTÓRICO
  // ------------------------------------------------------------------
  console.log('\n  [Histórico]');

  await test('GET /api/bpo/historico returns paginated results', async () => {
    const res = await request('GET', '/api/bpo/historico');
    assertStatus(res, 200);
    assertHasField(res.body, 'items');
    assertHasField(res.body, 'total');
    assertHasField(res.body, 'limit');
    assertHasField(res.body, 'offset');
  });

  await test('GET /api/bpo/historico?limit=5 respects limit', async () => {
    const res = await request('GET', '/api/bpo/historico?limit=5');
    assertStatus(res, 200);
    assert(
      res.body.items.length <= 5,
      `Expected max 5 items, got ${res.body.items.length}`
    );
  });

  // ------------------------------------------------------------------
  // 8. FILAS
  // ------------------------------------------------------------------
  console.log('\n  [Filas]');

  await test('GET /api/bpo/filas returns queue status', async () => {
    const res = await request('GET', '/api/bpo/filas');
    assertStatus(res, 200);
    assertHasField(res.body, 'filas');
    assert(Array.isArray(res.body.filas), 'filas should be array');
    if (res.body.filas.length > 0) {
      assertHasField(res.body.filas[0], 'nome');
      assertHasField(res.body.filas[0], 'status');
    }
  });

  // ------------------------------------------------------------------
  // 9. METRICS
  // ------------------------------------------------------------------
  console.log('\n  [Metrics]');

  await test('GET /api/bpo/metrics returns global metrics', async () => {
    const res = await request('GET', '/api/bpo/metrics');
    assertStatus(res, 200);
    assertHasField(res.body, 'scope');
    assert(res.body.scope === 'global', `Expected global scope: ${res.body.scope}`);
    assertHasField(res.body, 'transactions');
  });

  await test('GET /api/bpo/metrics/:clientId returns tenant metrics', async () => {
    if (!createdClientId) throw new Error('No client created');
    const res = await request('GET', `/api/bpo/metrics/${createdClientId}`);
    assertStatus(res, 200);
    assertHasField(res.body, 'clientId');
    assertHasField(res.body, 'operational');
    assertHasField(res.body, 'aiModel');
  });

  // ------------------------------------------------------------------
  // 10. CYCLE (Smoke test - don't actually start a full cycle)
  // ------------------------------------------------------------------
  console.log('\n  [Cycle]');

  await test('GET /api/bpo/cycle/:id returns cycle status', async () => {
    const res = await request('GET', '/api/bpo/cycle/nonexistent-id');
    // Should return 404 or a "not found" response, not crash
    assert(
      res.status === 404 || res.status === 200,
      `Unexpected status: ${res.status}`
    );
  });

  // ------------------------------------------------------------------
  // 11. WORKSPACE
  // ------------------------------------------------------------------
  console.log('\n  [Workspace]');

  await test('GET /api/bpo/workspace/:clientId returns workspace', async () => {
    if (!createdClientId) throw new Error('No client created');
    const res = await request(
      'GET',
      `/api/bpo/workspace/${createdClientId}`
    );
    assertStatus(res, 200);
    assertHasField(res.body, 'client');
    assertHasField(res.body, 'operational');
  });

  // ------------------------------------------------------------------
  // 12. LATENCY CHECK
  // ------------------------------------------------------------------
  console.log('\n  [Performance]');

  await test('All GET endpoints respond within 10s', async () => {
    const endpoints = [
      '/api/health',
      '/api/bpo/dashboard',
      '/api/bpo/autorizacoes',
      '/api/bpo/duvidas',
      '/api/bpo/historico',
      '/api/bpo/filas',
      '/api/bpo/metrics',
    ];

    for (const endpoint of endpoints) {
      const res = await request('GET', endpoint);
      assert(
        res.latencyMs < 10000,
        `${endpoint} too slow: ${res.latencyMs}ms`
      );
    }
  });
}

// ============================================================================
// Report
// ============================================================================

async function main(): Promise<void> {
  await runTests();

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;
  const avgLatency = Math.round(
    results.reduce((s, r) => s + r.latencyMs, 0) / total
  );

  console.log('');
  console.log('═'.repeat(60));
  console.log('  RESULTS');
  console.log('═'.repeat(60));
  console.log(`  Total:    ${total}`);
  console.log(`  Passed:   ${passed}`);
  console.log(`  Failed:   ${failed}`);
  console.log(`  Avg latency: ${avgLatency}ms`);
  console.log('');

  if (failed > 0) {
    console.log('  FAILED TESTS:');
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        console.log(`    ✗ ${r.name}`);
        console.log(`      → ${r.error}`);
      });
    console.log('');
  }

  console.log(`  Status: ${failed === 0 ? 'ALL PASSED' : 'FAILURES DETECTED'}`);
  console.log('═'.repeat(60));
  console.log('');

  // Output JSON for CI/CD parsing
  if (process.env.CI) {
    const report = {
      timestamp: new Date().toISOString(),
      baseUrl: BASE_URL,
      total,
      passed,
      failed,
      avgLatencyMs: avgLatency,
      tests: results,
    };
    console.log('::group::Integration Test Report (JSON)');
    console.log(JSON.stringify(report, null, 2));
    console.log('::endgroup::');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
