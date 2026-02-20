/**
 * Capture Activity - operacao-head
 *
 * Activity que dispara captura para um ops específico.
 * Chama o endpoint do ops correspondente (nibo-ops, santander-ops, etc).
 */

import * as df from 'durable-functions';
import { InvocationContext } from '@azure/functions';
import {
  CaptureActivityInput,
  CaptureActivityOutput,
  TransactionType,
  TransactionSource,
  TransactionStatus,
  createTransaction,
} from '../types';
import { createLogger, withRetry } from '../../shared/utils';
import { createTransactions, addHistoryAction } from '../storage/tableClient';
import { nowISO } from '../../shared/utils';

const logger = createLogger('CaptureActivity');

// Capture activity
df.app.activity('captureActivity', {
  handler: async (
    input: CaptureActivityInput,
    context: InvocationContext
  ): Promise<CaptureActivityOutput> => {
    const startTime = Date.now();
    const { clientId, cycleId, source } = input;

    logger.info(`Starting capture for ${source}`, { clientId, cycleId });

    try {
      // Get the ops URL for this source
      const opsUrl = getOpsUrl(source);

      if (!opsUrl) {
        logger.warn(`No URL configured for ${source}`);
        return {
          success: false,
          clientId,
          source,
          transactionsCount: 0,
          newCount: 0,
          updatedCount: 0,
          error: `URL não configurada para ${source}`,
          durationMs: Date.now() - startTime,
        };
      }

      // Call the ops service
      const result = await withRetry(
        async () => {
          const response = await fetch(`${opsUrl}/api/capture`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-functions-key': getOpsKey(source),
            },
            body: JSON.stringify({
              clientId,
              cycleId,
              // Add date range if needed
              startDate: getStartDate(),
              endDate: getEndDate(),
            }),
          });

          if (!response.ok) {
            const error = await response.text();
            throw new Error(`Capture failed: ${response.status} - ${error}`);
          }

          return response.json();
        },
        { maxRetries: 3, delayMs: 2000 }
      );

      logger.info(`Capture completed for ${source}`, {
        clientId,
        transactions: result.transactions?.total || 0,
      });

      // Persist captured transactions to Table Storage
      if (result.transactions?.items && Array.isArray(result.transactions.items)) {
        const sourceMap: Record<string, TransactionSource> = {
          nibo: TransactionSource.NIBO,
          omie: TransactionSource.OMIE,
          santander: TransactionSource.SANTANDER,
          getnet: TransactionSource.GETNET,
          ofx: TransactionSource.OFX,
        };

        const txs = result.transactions.items.map((item: any) =>
          createTransaction(
            clientId,
            item.tipo === 'saida' ? TransactionType.PAGAR : TransactionType.RECEBER,
            sourceMap[source] || TransactionSource.MANUAL,
            {
              descricao: item.descricao || item.description || '',
              valor: Math.abs(item.valor || item.value || 0),
              dataVencimento: item.dataVencimento || item.date,
              dataRealizacao: item.dataRealizacao || item.date,
              contraparte: item.contraparte || item.counterparty,
              sourceId: item.id || item.sourceId,
              sourceName: source,
              status: TransactionStatus.CAPTURADO,
            }
          )
        );

        try {
          const savedIds = await createTransactions(txs);
          logger.info(`Persisted ${savedIds.length} transactions from ${source}`);
          await addHistoryAction({
            id: `hist-cap-${cycleId}-${source}`,
            clientId,
            tipo: 'captura',
            descricao: `Captura ${source}: ${savedIds.length} transações`,
            data: nowISO(),
            detalhes: { cycleId, source, count: savedIds.length },
          });
        } catch (err: any) {
          logger.error(`Failed to persist transactions from ${source}`, err);
        }
      }

      return {
        success: true,
        clientId,
        source,
        transactionsCount: result.transactions?.total || 0,
        newCount: result.transactions?.new || 0,
        updatedCount: result.transactions?.updated || 0,
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      logger.error(`Capture failed for ${source}`, error);

      return {
        success: false,
        clientId,
        source,
        transactionsCount: 0,
        newCount: 0,
        updatedCount: 0,
        error: error.message,
        durationMs: Date.now() - startTime,
      };
    }
  },
});

// Get client config activity
df.app.activity('getClientConfigActivity', {
  handler: async (
    input: { clientId: string },
    context: InvocationContext
  ): Promise<any> => {
    const { getClient } = await import('../storage/tableClient');
    const client = await getClient(input.clientId);
    return client?.config || null;
  },
});

// Update cycle status activity
df.app.activity('updateCycleStatusActivity', {
  handler: async (input: any, context: InvocationContext): Promise<void> => {
    const { updateCycle } = await import('../storage/tableClient');
    await updateCycle({
      id: input.cycleId,
      date: input.date,
      ...input,
    });
  },
});

// Helper functions
function getOpsUrl(source: string): string {
  const urls: Record<string, string | undefined> = {
    nibo: process.env.NIBO_OPS_URL,
    omie: process.env.OMIE_OPS_URL,
    santander: process.env.SANTANDER_OPS_URL,
    getnet: process.env.GETNET_OPS_URL,
    ofx: process.env.UTILS_OPS_URL,
  };
  return urls[source] || '';
}

function getOpsKey(source: string): string {
  const keys: Record<string, string | undefined> = {
    nibo: process.env.NIBO_OPS_KEY,
    omie: process.env.OMIE_OPS_KEY,
    santander: process.env.SANTANDER_OPS_KEY,
    getnet: process.env.GETNET_OPS_KEY,
    ofx: process.env.UTILS_OPS_KEY,
  };
  return keys[source] || '';
}

function getStartDate(): string {
  // Last 7 days
  const date = new Date();
  date.setDate(date.getDate() - 7);
  return date.toISOString().split('T')[0];
}

function getEndDate(): string {
  return new Date().toISOString().split('T')[0];
}
