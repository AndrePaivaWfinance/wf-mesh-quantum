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
// HTTP Client (uses curl for proxy compatibility)
// ============================================================================

import { execSync } from 'child_process';

interface TestResponse {
  status: number;
  body: any;
  latencyMs: number;
  ok: boolean;
}

function parseResponse(raw: string, latencyMs: number): TestResponse {
  const separator = '---HTTP_STATUS---';
  const sepIdx = raw.lastIndexOf(separator);
  const bodyStr = sepIdx >= 0 ? raw.substring(0, sepIdx) : raw;
  const statusCode = sepIdx >= 0
    ? parseInt(raw.substring(sepIdx + separator.length).trim(), 10)
    : 0;

  let responseBody: any;
  try {
    responseBody = JSON.parse(bodyStr);
  } catch {
    responseBody = bodyStr;
  }

  return {
    status: statusCode,
    body: responseBody,
    latencyMs,
    ok: statusCode >= 200 && statusCode < 300,
  };
}

async function request(
  method: string,
  path: string,
  body?: any
): Promise<TestResponse> {
  const url = `${BASE_URL}${path}`;
  const start = Date.now();

  const separator = '---HTTP_STATUS---';
  try {
    const curlArgs = [
      `curl -s -w '${separator}%{http_code}'`,
      `-X ${method}`,
      `-H 'Content-Type: application/json'`,
    ];

    if (FUNCTION_KEY) {
      curlArgs.push(`-H 'x-functions-key: ${FUNCTION_KEY}'`);
    }

    if (body) {
      const escaped = JSON.stringify(body).replace(/'/g, "'\\''");
      curlArgs.push(`-d '${escaped}'`);
    }

    curlArgs.push(`'${url}'`);
    curlArgs.push('--max-time 30');

    const raw = execSync(curlArgs.join(' '), {
      encoding: 'utf-8',
      timeout: 35000,
      shell: '/bin/bash',
    });

    return parseResponse(raw, Date.now() - start);
  } catch (error: any) {
    // execSync throws on non-zero exit codes; try to parse stdout from the error
    const raw: string = error.stdout ? error.stdout.toString() : '';
    if (raw && raw.includes(separator)) {
      return parseResponse(raw, Date.now() - start);
    }
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

async function check(
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

  await check('API is reachable', async () => {
    const res = await request('GET', '/api/health');
    assert(res.status !== 0, `Cannot connect to ${BASE_URL}: ${res.body?.error}`);
  });

  // ------------------------------------------------------------------
  // 2. HEALTH
  // ------------------------------------------------------------------
  console.log('\n  [Health]');

  await check('GET /api/health returns valid response', async () => {
    const res = await request('GET', '/api/health');
    assert(
      res.status === 200 || res.status === 503,
      `Expected status 200 or 503, got ${res.status}: ${JSON.stringify(res.body).substring(0, 200)}`
    );
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

  await check('Health check latency < 5s', async () => {
    const res = await request('GET', '/api/health');
    assert(res.latencyMs < 5000, `Latency too high: ${res.latencyMs}ms`);
  });

  await check('Storage service is connected', async () => {
    const res = await request('GET', '/api/health');
    assert(
      res.status === 200 || res.status === 503,
      `Expected status 200 or 503, got ${res.status}`
    );
    assert(
      res.body.services?.storage === 'connected',
      `Storage not connected: ${res.body.services?.storage}`
    );
  });

  // ------------------------------------------------------------------
  // 3. DASHBOARD
  // ------------------------------------------------------------------
  console.log('\n  [Dashboard]');

  await check('GET /api/bpo/dashboard returns 200 with KPIs', async () => {
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

  await check('GET /api/bpo/clientes returns list', async () => {
    const res = await request('GET', '/api/bpo/clientes');
    assertStatus(res, 200);
    assertHasField(res.body, 'items');
    assertHasField(res.body, 'total');
    assert(Array.isArray(res.body.items), 'items should be array');
  });

  await check('POST /api/bpo/clientes validates required fields', async () => {
    const res = await request('POST', '/api/bpo/clientes', {
      nome: 'Test Only',
    });
    assertStatus(res, 400);
  });

  await check('POST /api/bpo/clientes creates client', async () => {
    const res = await request('POST', '/api/bpo/clientes', {
      nome: `Integration Test ${Date.now()}`,
      cnpj: '11222333000181',
      email: 'integration-test@wfinance.com.br',
      sistema: 'nibo',
    });
    assertStatus(res, 201);
    assertHasField(res.body, 'client');
    assertHasField(res.body.client, 'id');
    createdClientId = res.body.client.id;
  });

  await check('GET /api/bpo/clientes/:id returns created client', async () => {
    if (!createdClientId) throw new Error('No client created in previous test');
    const res = await request('GET', `/api/bpo/clientes/${createdClientId}`);
    assertStatus(res, 200);
    assertHasField(res.body, 'nome');
    assert(
      res.body.email === 'integration-test@wfinance.com.br',
      `Unexpected email: ${res.body.email}`
    );
  });

  await check('PUT /api/bpo/clientes/:id updates client', async () => {
    if (!createdClientId) throw new Error('No client created');
    const res = await request('PUT', `/api/bpo/clientes/${createdClientId}`, {
      plano: 'Avançado',
    });
    assertStatus(res, 200);
  });

  await check('GET /api/bpo/clientes/unknown returns 404', async () => {
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

  await check('GET /api/bpo/autorizacoes returns list', async () => {
    const res = await request('GET', '/api/bpo/autorizacoes');
    assertStatus(res, 200);
    assertHasField(res.body, 'items');
    assertHasField(res.body, 'total');
  });

  await check('POST /api/bpo/autorizacoes/:id/rejeitar requires motivo', async () => {
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

  await check('GET /api/bpo/duvidas returns list', async () => {
    const res = await request('GET', '/api/bpo/duvidas');
    assertStatus(res, 200);
    assertHasField(res.body, 'items');
    assertHasField(res.body, 'total');
  });

  await check('POST /api/bpo/duvidas/:id/resolver requires resolucao', async () => {
    const res = await request('POST', '/api/bpo/duvidas/fake-id/resolver', {});
    assertStatus(res, 400);
  });

  // ------------------------------------------------------------------
  // 7. HISTÓRICO
  // ------------------------------------------------------------------
  console.log('\n  [Histórico]');

  await check('GET /api/bpo/historico returns paginated results', async () => {
    const res = await request('GET', '/api/bpo/historico');
    assertStatus(res, 200);
    assertHasField(res.body, 'items');
    assertHasField(res.body, 'total');
    assertHasField(res.body, 'limit');
    assertHasField(res.body, 'offset');
  });

  await check('GET /api/bpo/historico?limit=5 respects limit', async () => {
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

  await check('GET /api/bpo/filas returns queue status', async () => {
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

  await check('GET /api/bpo/metrics returns global metrics', async () => {
    const res = await request('GET', '/api/bpo/metrics');
    assertStatus(res, 200);
    assertHasField(res.body, 'scope');
    assert(res.body.scope === 'global', `Expected global scope: ${res.body.scope}`);
    assertHasField(res.body, 'transactions');
  });

  await check('GET /api/bpo/metrics/:clientId returns tenant metrics', async () => {
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

  await check('GET /api/bpo/cycle/:id returns cycle status', async () => {
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

  await check('GET /api/bpo/workspace/:clientId returns workspace', async () => {
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

  await check('All GET endpoints respond within 10s', async () => {
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
