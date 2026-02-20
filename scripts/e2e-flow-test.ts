#!/usr/bin/env npx ts-node
/**
 * E2E Flow Test - Teste do Fluxo Completo BPO
 *
 * Testa o ciclo completo:
 *   1. Criar cliente de teste
 *   2. Gerar transações simuladas
 *   3. Iniciar ciclo BPO
 *   4. Monitorar execução do orquestrador
 *   5. Validar resultados (dashboard, workspace, filas, métricas)
 *   6. Testar fluxos de autorização e dúvidas
 *   7. Cleanup
 *
 * Uso:
 *   FUNCTION_KEY=xxx npx ts-node scripts/e2e-flow-test.ts
 *   FUNCTION_KEY=xxx npx ts-node scripts/e2e-flow-test.ts https://my-app.azurewebsites.net
 */

import { execSync } from 'child_process';

const BASE_URL =
  process.argv[2] ||
  process.env.BASE_URL ||
  'https://wf-operacao-mesh.azurewebsites.net';

const FUNCTION_KEY = process.env.FUNCTION_KEY || '';

// ============================================================================
// HTTP Client (curl-based for proxy compatibility)
// ============================================================================

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
    curlArgs.push('--max-time 60');

    const raw = execSync(curlArgs.join(' '), {
      encoding: 'utf-8',
      timeout: 65000,
      shell: '/bin/bash',
    });

    return parseResponse(raw, Date.now() - start);
  } catch (error: any) {
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
// Helpers
// ============================================================================

function log(icon: string, msg: string): void {
  console.log(`  ${icon} ${msg}`);
}

function section(title: string): void {
  console.log('');
  console.log(`  ${'─'.repeat(56)}`);
  console.log(`  ${title}`);
  console.log(`  ${'─'.repeat(56)}`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prettyJson(obj: any): string {
  return JSON.stringify(obj, null, 2).split('\n').map(l => `    ${l}`).join('\n');
}

// ============================================================================
// E2E Flow Test
// ============================================================================

async function runE2EFlow(): Promise<void> {
  console.log('');
  console.log('═'.repeat(60));
  console.log('  E2E Flow Test - Fluxo Completo BPO');
  console.log('═'.repeat(60));
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Auth:   ${FUNCTION_KEY ? 'Function Key' : 'None'}`);
  console.log(`  Time:   ${new Date().toISOString()}`);
  console.log('═'.repeat(60));

  let testClientId: string | null = null;
  let cycleId: string | null = null;
  let instanceId: string | null = null;
  const errors: string[] = [];

  // ────────────────────────────────────────────────────────────
  // STEP 1: Health Check
  // ────────────────────────────────────────────────────────────
  section('STEP 1: Health Check');

  const healthRes = await request('GET', '/api/health');
  if (healthRes.status === 200 || healthRes.status === 503) {
    log('✓', `API respondeu: ${healthRes.status} (${healthRes.body.status})`);
    log('  ', `Storage: ${healthRes.body.services?.storage}`);
    log('  ', `AI: classifier=${healthRes.body.ai?.classifier}, tenantManager=${healthRes.body.ai?.tenantManager}`);
    log('  ', `Version: ${healthRes.body.version}`);
  } else {
    log('✗', `API não respondeu corretamente: ${healthRes.status}`);
    errors.push('Health check falhou');
    printSummary(errors);
    return;
  }

  // ────────────────────────────────────────────────────────────
  // STEP 2: Criar Cliente de Teste
  // ────────────────────────────────────────────────────────────
  section('STEP 2: Criar Cliente de Teste');

  const timestamp = Date.now();
  const createRes = await request('POST', '/api/bpo/clientes', {
    nome: `E2E Test Client ${timestamp}`,
    cnpj: '99888777000166',
    email: `e2e-test-${timestamp}@wfinance.com.br`,
    sistema: 'nibo',
    plano: 'Avançado',
  });

  if (createRes.status === 201) {
    testClientId = createRes.body.client?.id;
    log('✓', `Cliente criado: ${testClientId}`);
    log('  ', `Nome: ${createRes.body.client?.nome}`);
    log('  ', `Plano: ${createRes.body.client?.plano}`);
    log('  ', `TenantId: ${createRes.body.client?.tenantId}`);
  } else {
    log('✗', `Falha ao criar cliente: ${createRes.status} - ${JSON.stringify(createRes.body)}`);
    errors.push(`Criar cliente: ${createRes.status}`);
  }

  // ────────────────────────────────────────────────────────────
  // STEP 3: Verificar Cliente na Lista
  // ────────────────────────────────────────────────────────────
  section('STEP 3: Verificar Cliente na Lista');

  const listRes = await request('GET', '/api/bpo/clientes');
  if (listRes.status === 200) {
    const found = listRes.body.items?.find((c: any) => c.id === testClientId);
    if (found) {
      log('✓', `Cliente encontrado na lista (total: ${listRes.body.total})`);
    } else {
      log('!', `Cliente não encontrado na lista (total: ${listRes.body.total})`);
      errors.push('Cliente não aparece na lista');
    }
  } else {
    log('✗', `Falha ao listar clientes: ${listRes.status}`);
    errors.push(`Listar clientes: ${listRes.status}`);
  }

  // ────────────────────────────────────────────────────────────
  // STEP 4: Buscar Detalhe do Cliente
  // ────────────────────────────────────────────────────────────
  section('STEP 4: Detalhe do Cliente');

  if (testClientId) {
    const detailRes = await request('GET', `/api/bpo/clientes/${testClientId}`);
    if (detailRes.status === 200) {
      log('✓', `Detalhe obtido: ${detailRes.body.nome}`);
      log('  ', `Status: ${detailRes.body.status}`);
      log('  ', `Sistema: ${detailRes.body.sistema}`);
      log('  ', `Config: ${JSON.stringify(detailRes.body.config?.notificacoes || {})}`);
    } else {
      log('✗', `Falha: ${detailRes.status} - ${JSON.stringify(detailRes.body)}`);
      errors.push(`Detalhe cliente: ${detailRes.status}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // STEP 4b: Ativar Cliente (status: onboarding → ativo)
  // ────────────────────────────────────────────────────────────

  if (testClientId) {
    const activateRes = await request('PUT', `/api/bpo/clientes/${testClientId}`, {
      status: 'ativo',
    });
    if (activateRes.ok) {
      log('✓', `Cliente ativado: status → ativo`);
    } else {
      log('✗', `Falha ao ativar cliente: ${activateRes.status}`);
      errors.push(`Ativar cliente: ${activateRes.status}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // STEP 5: Gerar Transações Simuladas (com persistência)
  // ────────────────────────────────────────────────────────────
  section('STEP 5: Gerar Transações Simuladas');

  let simulatedTxCount = 0;
  const simRes = await request('POST', '/api/bpo/simulate', {
    clientId: testClientId || 'test-client',
  });

  if (simRes.ok) {
    simulatedTxCount = simRes.body.transactionsStored || simRes.body.data?.length || 0;
    log('✓', `Simulação executada: ${simRes.status}`);
    log('  ', `Transações gravadas no storage: ${simulatedTxCount}`);
    if (simRes.body.data?.length > 0) {
      for (const tx of simRes.body.data.slice(0, 3)) {
        log('  ', `  ${tx.descricao || tx.id} | R$${tx.valor} | ${tx.status || tx.type}`);
      }
    }
    if (simulatedTxCount === 0) {
      log('!', 'Simulate não retornou transactionsStored (pode ser versão antiga)');
    }
  } else {
    log('!', `Simulação retornou ${simRes.status}: ${JSON.stringify(simRes.body).substring(0, 200)}`);
    if (simRes.status === 500) {
      errors.push(`Simulação falhou: ${simRes.status}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // STEP 5b: Verificar Transações no Storage
  // ────────────────────────────────────────────────────────────
  section('STEP 5b: Verificar Transações no Storage');

  if (testClientId) {
    const txRes = await request('GET', `/api/bpo/transactions?clientId=${testClientId}`);
    if (txRes.ok) {
      log('✓', `Transações no storage: ${txRes.body.total}`);
      if (txRes.body.items?.length > 0) {
        for (const tx of txRes.body.items.slice(0, 3)) {
          log('  ', `  [${tx.status}] ${(tx.descricao || '').substring(0, 50)} | R$${tx.valor}`);
        }
      }
      if (txRes.body.total === 0) {
        errors.push('Nenhuma transação encontrada no storage após simulate');
      }
    } else if (txRes.status === 404) {
      log('!', 'Endpoint /api/bpo/transactions não disponível (deploy pendente)');
    } else {
      log('!', `Transações: ${txRes.status}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // STEP 6: Iniciar Ciclo BPO
  // ────────────────────────────────────────────────────────────
  section('STEP 6: Iniciar Ciclo BPO');

  const cycleStartRes = await request('POST', '/api/bpo/cycle', {
    cliente_id: testClientId,
    force: true,
  });

  if (cycleStartRes.status === 202) {
    cycleId = cycleStartRes.body.cycle_id;
    instanceId = cycleStartRes.body.instance_id;
    log('✓', `Ciclo iniciado!`);
    log('  ', `Cycle ID: ${cycleId}`);
    log('  ', `Instance ID: ${instanceId}`);
    log('  ', `Clientes no ciclo: ${cycleStartRes.body.clients}`);
    log('  ', `Status: ${cycleStartRes.body.status}`);
  } else if (cycleStartRes.status === 400) {
    log('!', `Ciclo não iniciado: ${JSON.stringify(cycleStartRes.body)}`);
    log('  ', `(pode ser que não há clientes ativos)`);
    errors.push(`Ciclo não iniciou: ${cycleStartRes.body.message || cycleStartRes.body.error}`);
  } else {
    log('✗', `Falha ao iniciar ciclo: ${cycleStartRes.status}`);
    log('  ', JSON.stringify(cycleStartRes.body).substring(0, 300));
    errors.push(`Iniciar ciclo: ${cycleStartRes.status}`);
  }

  // ────────────────────────────────────────────────────────────
  // STEP 7: Monitorar Ciclo (polling)
  // ────────────────────────────────────────────────────────────
  section('STEP 7: Monitorar Ciclo');

  if (cycleId) {
    const maxPolls = 12;     // 12 polls
    const pollInterval = 5000; // 5s interval => max 60s

    for (let i = 0; i < maxPolls; i++) {
      const statusRes = await request('GET', `/api/bpo/cycle/${cycleId}`);

      if (statusRes.ok && statusRes.body) {
        const status = statusRes.body.status || statusRes.body.cycle?.status;
        const orchestratorStatus = statusRes.body.orchestrator?.runtimeStatus;

        log(
          status === 'completed' ? '✓' : status === 'failed' ? '✗' : '◎',
          `Poll ${i + 1}/${maxPolls}: cycle=${status}, orchestrator=${orchestratorStatus || 'n/a'} (${statusRes.latencyMs}ms)`
        );

        // Show progress details if available
        if (statusRes.body.cycle) {
          const c = statusRes.body.cycle;
          log('  ', `Captured: ${c.transactionsCaptured || 0}, Classified: ${c.transactionsClassified || 0}, Synced: ${c.transactionsSynced || 0}`);
        }

        if (status === 'completed' || status === 'failed' || status === 'partial') {
          log(
            status === 'completed' ? '✓' : '!',
            `Ciclo finalizado com status: ${status}`
          );
          if (statusRes.body.cycle?.errors?.length > 0) {
            log('  ', `Erros: ${JSON.stringify(statusRes.body.cycle.errors).substring(0, 300)}`);
          }
          break;
        }
      } else if (statusRes.status === 404) {
        log('!', `Poll ${i + 1}/${maxPolls}: Ciclo não encontrado (404) - pode estar em processamento`);
      } else {
        log('!', `Poll ${i + 1}/${maxPolls}: status=${statusRes.status}`);
      }

      if (i < maxPolls - 1) {
        await sleep(pollInterval);
      }
    }
  } else {
    log('!', 'Sem cycle_id para monitorar');
  }

  // ────────────────────────────────────────────────────────────
  // STEP 7b: Verificar Transações Processadas Após Ciclo
  // ────────────────────────────────────────────────────────────
  section('STEP 7b: Transações Após Pipeline IA');

  if (testClientId) {
    const txAfterRes = await request('GET', `/api/bpo/transactions?clientId=${testClientId}`);
    if (txAfterRes.ok && txAfterRes.body.total > 0) {
      log('✓', `Total transações: ${txAfterRes.body.total}`);

      // Count by status
      const statusCounts: Record<string, number> = {};
      for (const tx of txAfterRes.body.items) {
        statusCounts[tx.status] = (statusCounts[tx.status] || 0) + 1;
      }
      for (const [st, count] of Object.entries(statusCounts)) {
        log('  ', `  [${st}]: ${count}`);
      }

      // Check if any were classified (meaning AI pipeline ran)
      const classified = (txAfterRes.body.items || []).filter(
        (t: any) => t.status !== 'capturado' && t.status !== 'novo'
      );
      if (classified.length > 0) {
        log('✓', `${classified.length} transações processadas pelo pipeline IA`);
        for (const tx of classified.slice(0, 3)) {
          log('  ', `  ${tx.descricao?.substring(0, 40)} → ${tx.categoriaNome || 'sem categoria'} (${tx.status})`);
        }
      } else {
        log('!', 'Nenhuma transação foi processada pelo pipeline IA (pode ser normal se capture falhou)');
      }
    } else if (txAfterRes.status === 404) {
      log('!', 'Endpoint /api/bpo/transactions não disponível');
    } else {
      log('!', `Sem transações após ciclo: ${txAfterRes.status}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // STEP 8: Verificar Filas
  // ────────────────────────────────────────────────────────────
  section('STEP 8: Status das Filas');

  const filasRes = await request('GET', '/api/bpo/filas');
  if (filasRes.ok) {
    log('✓', `Filas responderam: ${filasRes.status}`);
    if (filasRes.body.filas?.length > 0) {
      for (const fila of filasRes.body.filas) {
        log('  ', `${fila.nome}: ${fila.mensagens} msgs (${fila.status})`);
      }
    } else {
      log('  ', 'Nenhuma fila configurada');
    }
    if (filasRes.body.ciclo_atual) {
      log('  ', `Ciclo atual: ${filasRes.body.ciclo_atual.status} (${filasRes.body.ciclo_atual.progresso}%)`);
    }
  } else {
    log('✗', `Filas: ${filasRes.status}`);
    errors.push(`Filas: ${filasRes.status}`);
  }

  // ────────────────────────────────────────────────────────────
  // STEP 9: Dashboard
  // ────────────────────────────────────────────────────────────
  section('STEP 9: Dashboard Atualizado');

  const dashRes = await request('GET', '/api/bpo/dashboard');
  if (dashRes.ok) {
    log('✓', `Dashboard respondeu: ${dashRes.status}`);
    log('  ', `KPIs: pendentes=${dashRes.body.kpis?.pendentes}, processando=${dashRes.body.kpis?.processando}, concluídos hoje=${dashRes.body.kpis?.concluidosHoje}, erros=${dashRes.body.kpis?.erro}`);
    log('  ', `Pipeline: captura=${dashRes.body.pipeline?.captura?.status}, classificação=${dashRes.body.pipeline?.classificacao?.status}, sync=${dashRes.body.pipeline?.sync?.status}`);
    if (dashRes.body.ultimosCiclos?.length > 0) {
      log('  ', `Último ciclo: ${dashRes.body.ultimosCiclos[0]?.id} (${dashRes.body.ultimosCiclos[0]?.status})`);
    }
    if (dashRes.body.alertas?.length > 0) {
      for (const alerta of dashRes.body.alertas) {
        log('  ', `Alerta [${alerta.prioridade}]: ${alerta.mensagem}`);
      }
    }
  } else {
    log('✗', `Dashboard: ${dashRes.status} - ${JSON.stringify(dashRes.body).substring(0, 200)}`);
    errors.push(`Dashboard: ${dashRes.status}`);
  }

  // ────────────────────────────────────────────────────────────
  // STEP 10: Workspace do Cliente
  // ────────────────────────────────────────────────────────────
  section('STEP 10: Workspace do Cliente');

  if (testClientId) {
    const wsRes = await request('GET', `/api/bpo/workspace/${testClientId}`);
    if (wsRes.ok) {
      log('✓', `Workspace respondeu: ${wsRes.status}`);
      log('  ', `Cliente: ${wsRes.body.client?.nome}`);
      log('  ', `Operacional: autorizações=${wsRes.body.operational?.pendingAuthorizations || 0}, dúvidas=${wsRes.body.operational?.pendingDoubts || 0}`);
      if (wsRes.body.strategic) {
        log('  ', `Estratégico: runway=${wsRes.body.strategic?.runway || '-'}, burn_rate=${wsRes.body.strategic?.burnRate || '-'}`);
      }
    } else {
      log('✗', `Workspace: ${wsRes.status} - ${JSON.stringify(wsRes.body).substring(0, 200)}`);
      errors.push(`Workspace: ${wsRes.status}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // STEP 11: Autorizações
  // ────────────────────────────────────────────────────────────
  section('STEP 11: Autorizações Pendentes');

  const authRes = await request('GET', '/api/bpo/autorizacoes');
  if (authRes.ok) {
    log('✓', `Autorizações: ${authRes.body.total || 0} total`);
    if (authRes.body.items?.length > 0) {
      const first = authRes.body.items[0];
      log('  ', `Primeira: ${first.descricao?.substring(0, 60)} - R$${first.valor} (${first.status})`);

      // Tentar aprovar uma autorização se houver
      log('  ', 'Testando aprovação...');
      const approveRes = await request('POST', `/api/bpo/autorizacoes/${first.id}/aprovar`, {
        notas: 'Aprovado via E2E test',
      });
      log(approveRes.ok ? '✓' : '!', `Aprovar: ${approveRes.status} - ${JSON.stringify(approveRes.body).substring(0, 100)}`);
    } else {
      log('  ', 'Nenhuma autorização pendente');
    }
  } else {
    log('✗', `Autorizações: ${authRes.status}`);
    errors.push(`Autorizações: ${authRes.status}`);
  }

  // ────────────────────────────────────────────────────────────
  // STEP 12: Dúvidas
  // ────────────────────────────────────────────────────────────
  section('STEP 12: Dúvidas Pendentes');

  const duvidasRes = await request('GET', '/api/bpo/duvidas');
  if (duvidasRes.ok) {
    log('✓', `Dúvidas: ${duvidasRes.body.total || 0} total`);
    if (duvidasRes.body.items?.length > 0) {
      const first = duvidasRes.body.items[0];
      log('  ', `Primeira: tipo=${first.tipo}, status=${first.status}`);

      // Tentar resolver uma dúvida
      log('  ', 'Testando resolução...');
      const resolveRes = await request('POST', `/api/bpo/duvidas/${first.id}/resolver`, {
        resolucao: { categoria: 'Fornecedores', confianca: 0.95 },
        notas: 'Resolvido via E2E test',
      });
      log(resolveRes.ok ? '✓' : '!', `Resolver: ${resolveRes.status} - ${JSON.stringify(resolveRes.body).substring(0, 100)}`);
    } else {
      log('  ', 'Nenhuma dúvida pendente');
    }
  } else {
    log('✗', `Dúvidas: ${duvidasRes.status}`);
    errors.push(`Dúvidas: ${duvidasRes.status}`);
  }

  // ────────────────────────────────────────────────────────────
  // STEP 13: Histórico
  // ────────────────────────────────────────────────────────────
  section('STEP 13: Histórico');

  const histRes = await request('GET', '/api/bpo/historico?limit=5');
  if (histRes.ok) {
    log('✓', `Histórico: ${histRes.body.total || 0} total (mostrando ${histRes.body.items?.length || 0})`);
    for (const item of (histRes.body.items || []).slice(0, 3)) {
      log('  ', `[${item.tipo}] ${item.descricao?.substring(0, 60)} - ${item.data}`);
    }
  } else {
    log('✗', `Histórico: ${histRes.status}`);
    errors.push(`Histórico: ${histRes.status}`);
  }

  // ────────────────────────────────────────────────────────────
  // STEP 14: Métricas
  // ────────────────────────────────────────────────────────────
  section('STEP 14: Métricas');

  const metricsGlobalRes = await request('GET', '/api/bpo/metrics');
  if (metricsGlobalRes.ok) {
    log('✓', `Métricas globais: scope=${metricsGlobalRes.body.scope}`);
    const tx = metricsGlobalRes.body.transactions;
    if (tx) {
      log('  ', `Transações: total=${tx.total || 0}, classified=${tx.classified || 0}, synced=${tx.synced || 0}`);
    }
  } else {
    log('✗', `Métricas globais: ${metricsGlobalRes.status}`);
    errors.push(`Métricas globais: ${metricsGlobalRes.status}`);
  }

  if (testClientId) {
    const metricsTenantRes = await request('GET', `/api/bpo/metrics/${testClientId}`);
    if (metricsTenantRes.ok) {
      log('✓', `Métricas tenant: clientId=${metricsTenantRes.body.clientId}`);
      if (metricsTenantRes.body.operational) {
        log('  ', `Operacional: ${JSON.stringify(metricsTenantRes.body.operational).substring(0, 120)}`);
      }
      if (metricsTenantRes.body.aiModel) {
        log('  ', `AI Model: ${JSON.stringify(metricsTenantRes.body.aiModel).substring(0, 120)}`);
      }
    } else {
      log('✗', `Métricas tenant: ${metricsTenantRes.status}`);
      errors.push(`Métricas tenant: ${metricsTenantRes.status}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // STEP 15: Atualizar e Verificar Cliente
  // ────────────────────────────────────────────────────────────
  section('STEP 15: Atualizar Cliente');

  if (testClientId) {
    const updateRes = await request('PUT', `/api/bpo/clientes/${testClientId}`, {
      plano: 'Premium',
      config: {
        notificacoes: {
          email: true,
          whatsapp: true,
          resumoDiario: true,
          alertaVencimento: true,
        },
      },
    });
    if (updateRes.ok) {
      log('✓', `Cliente atualizado para plano Premium`);
    } else {
      log('✗', `Atualizar: ${updateRes.status} - ${JSON.stringify(updateRes.body).substring(0, 200)}`);
      errors.push(`Atualizar cliente: ${updateRes.status}`);
    }

    // Verificar atualização
    const verifyRes = await request('GET', `/api/bpo/clientes/${testClientId}`);
    if (verifyRes.ok) {
      log('✓', `Verificado: plano=${verifyRes.body.plano}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // SUMMARY
  // ────────────────────────────────────────────────────────────
  printSummary(errors, testClientId, cycleId);
}

function printSummary(errors: string[], clientId?: string | null, cycleId?: string | null): void {
  console.log('');
  console.log('═'.repeat(60));
  console.log('  RESUMO DO FLUXO E2E');
  console.log('═'.repeat(60));

  if (clientId) console.log(`  Cliente teste: ${clientId}`);
  if (cycleId) console.log(`  Ciclo: ${cycleId}`);

  console.log('');
  if (errors.length === 0) {
    console.log('  Status: FLUXO COMPLETO OK');
  } else {
    console.log(`  Status: ${errors.length} PROBLEMA(S) ENCONTRADO(S)`);
    console.log('');
    for (const err of errors) {
      console.log(`    ✗ ${err}`);
    }
  }
  console.log('');
  console.log('═'.repeat(60));
  console.log('');

  process.exit(errors.length > 0 ? 1 : 0);
}

// ============================================================================
// Run
// ============================================================================

runE2EFlow().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
