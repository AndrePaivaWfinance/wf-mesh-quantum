/**
 * BPO Filas - operacao-head
 *
 * GET /api/bpo/filas
 */

import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import { QueueServiceClient } from '@azure/storage-queue';
import { getRecentCycles } from '../storage/tableClient';
import { ALL_QUEUES } from '../../shared/queues/contracts';
import { QueueStatus } from '../types';

app.http('bpoFilas', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'bpo/filas',
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    context.log('[bpoFilas] Filas status requested');

    try {
      const filas: QueueStatus[] = [];

      // Try to get queue stats if storage is configured
      const connString = process.env.EXEC_STORAGE_CONNECTION_STRING || process.env.AZURE_STORAGE_CONNECTION_STRING;

      if (connString) {
        try {
          const queueService = QueueServiceClient.fromConnectionString(connString);

          for (const [key, queueName] of Object.entries(ALL_QUEUES)) {
            try {
              const queueClient = queueService.getQueueClient(queueName);
              const properties = await queueClient.getProperties();

              filas.push({
                nome: queueName,
                mensagens: properties.approximateMessagesCount || 0,
                status: properties.approximateMessagesCount && properties.approximateMessagesCount > 0
                  ? 'processing'
                  : 'idle',
              });
            } catch {
              // Queue might not exist yet
              filas.push({
                nome: queueName,
                mensagens: 0,
                status: 'idle',
              });
            }
          }
        } catch (error) {
          context.warn('[bpoFilas] Could not get queue stats:', error);
        }
      }

      // If no filas info, return placeholder
      if (filas.length === 0) {
        for (const [key, queueName] of Object.entries(ALL_QUEUES)) {
          filas.push({
            nome: queueName,
            mensagens: 0,
            status: 'idle',
          });
        }
      }

      // Get current cycle info
      const cycles = await getRecentCycles(1);
      const currentCycle = cycles.find((c) => c.status === 'running');

      return {
        status: 200,
        jsonBody: {
          filas,
          ciclo_atual: currentCycle
            ? {
                id: currentCycle.id,
                status: currentCycle.status,
                progresso: calculateProgress(currentCycle),
                etapa: determineEtapa(currentCycle),
              }
            : null,
        },
      };
    } catch (error) {
      context.error('[bpoFilas] Error:', error);
      return {
        status: 500,
        jsonBody: { error: 'Erro ao carregar status das filas' },
      };
    }
  },
});

function calculateProgress(cycle: any): number {
  const total = cycle.transactionsCaptured || 1;
  const processed = cycle.transactionsClassified + cycle.transactionsSynced;
  return Math.round((processed / total) * 100);
}

function determineEtapa(cycle: any): string {
  if (cycle.transactionsSynced > 0) return 'sync';
  if (cycle.transactionsClassified > 0) return 'classificacao';
  if (cycle.transactionsCaptured > 0) return 'captura';
  return 'iniciando';
}
