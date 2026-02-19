/**
 * Daily Cycle Orchestrator - operacao-head
 *
 * Orquestra o ciclo diário de processamento:
 * 1. Para cada cliente (fan-out)
 * 2. Captura de todas as fontes (paralelo)
 * 3. Classificação IA
 * 4. Sync para destino (Nibo/Omie)
 * 5. Agrega resultados (fan-in)
 */

import * as df from 'durable-functions';
import {
  OrchestrationContext,
  OrchestrationHandler,
} from 'durable-functions';
import {
  CycleContext,
  ClientCycleResult,
  CaptureActivityInput,
  CaptureActivityOutput,
  CycleStatus,
} from '../types';
import { updateCycle } from '../storage/tableClient';

interface OrchestratorInput {
  cycleId: string;
  date: string;
  clientIds: string[];
  force: boolean;
}

const orchestrator: OrchestrationHandler = function* (
  context: OrchestrationContext
) {
  const input = context.df.getInput() as OrchestratorInput;
  const { cycleId, date, clientIds, force } = input;

  context.log(`[Orchestrator] Starting cycle ${cycleId} for ${clientIds.length} clients`);

  // Update cycle status to running
  yield context.df.callActivity('updateCycleStatusActivity', {
    cycleId,
    date,
    status: CycleStatus.RUNNING,
    clientsTotal: clientIds.length,
  });

  const results: ClientCycleResult[] = [];
  let totalCaptured = 0;
  let totalClassified = 0;
  let totalSynced = 0;
  let totalReview = 0;
  const errors: any[] = [];

  // Process each client in parallel (fan-out) using Sub-Orchestrator
  const clientTasks = clientIds.map((clientId) =>
    context.df.callSubOrchestrator('clientProcessingOrchestrator', {
      clientId,
      cycleId,
      date,
      force
    })
  );

  const clientResults: any[] = yield context.df.Task.all(clientTasks);

  // Aggregate results
  for (const res of clientResults) {
    if (res.status === 'success') {
      const details = res.details;
      totalCaptured += details.processedCount || 0;
      totalSynced += details.autoApprovedCount || 0;

      results.push({
        clientId: res.clientId,
        status: 'success',
        captures: [], // Simplified for now
        classified: details.processedCount || 0,
        synced: details.autoApprovedCount || 0,
        review: (details.processedCount || 0) - (details.autoApprovedCount || 0),
        errors: [],
        durationMs: 0
      });
    } else {
      errors.push({ clientId: res.clientId, message: res.error });
      results.push({
        clientId: res.clientId,
        status: 'failed',
        captures: [],
        classified: 0,
        synced: 0,
        review: 0,
        errors: [res.error],
        durationMs: 0
      });
    }
  }

  // Update cycle with final stats
  const finalStatus =
    errors.length === 0
      ? CycleStatus.COMPLETED
      : errors.length === clientIds.length
        ? CycleStatus.FAILED
        : CycleStatus.PARTIAL;

  yield context.df.callActivity('updateCycleStatusActivity', {
    cycleId,
    date,
    status: finalStatus,
    clientsProcessed: results.filter((r) => r.status === 'success').length,
    clientsFailed: results.filter((r) => r.status === 'failed').length,
    transactionsCaptured: totalCaptured,
    transactionsClassified: totalClassified,
    transactionsSynced: totalSynced,
    transactionsReview: totalReview,
    completedAt: new Date().toISOString(),
    errors,
  });

  context.log(`[Orchestrator] Cycle ${cycleId} completed with status ${finalStatus}`);

  return {
    cycleId,
    status: finalStatus,
    results,
    totals: {
      captured: totalCaptured,
      classified: totalClassified,
      synced: totalSynced,
      review: totalReview,
      errors: errors.length,
    },
  };
};

df.app.orchestration('dailyCycleOrchestrator', orchestrator);
