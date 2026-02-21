/**
 * Capture Activity - operacao-head
 *
 * Activity que dispara captura para um ops específico.
 * - Getnet: chamada direta via SFTP (mesmo processo, sem HTTP)
 * - Demais: chama o endpoint HTTP do ops correspondente
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
import { executeGetnetCapture } from '../ops/getnet/functions/capture';

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

    // Getnet: chamada direta (SFTP no mesmo processo, sem HTTP)
    if (source === 'getnet') {
      return captureGetnetDirect(clientId, cycleId, startTime);
    }

    // Demais fontes: chamada HTTP para o microservico ops
    return captureViaHttp(clientId, cycleId, source, startTime);
  },
});

/**
 * Captura Getnet — chama a logica SFTP diretamente, sem HTTP intermediario.
 */
async function captureGetnetDirect(
  clientId: string,
  cycleId: string,
  startTime: number
): Promise<CaptureActivityOutput> {
  try {
    const result = await executeGetnetCapture({
      clientId,
      cycleId,
      startDate: getStartDate(),
    });

    if (result.success) {
      await addHistoryAction({
        id: `hist-cap-${cycleId}-getnet`,
        clientId,
        tipo: 'captura',
        descricao: `Captura getnet: ${result.transactions.total} transacoes (${result.transactions.new} novas)`,
        data: nowISO(),
        detalhes: { cycleId, source: 'getnet', ...result.transactions },
      });
    }

    return {
      success: result.success,
      clientId,
      source: 'getnet',
      transactionsCount: result.transactions.total,
      newCount: result.transactions.new,
      updatedCount: result.transactions.updated,
      error: result.error,
      durationMs: Date.now() - startTime,
    };
  } catch (error: any) {
    logger.error('Getnet direct capture failed', error);
    return {
      success: false,
      clientId,
      source: 'getnet',
      transactionsCount: 0,
      newCount: 0,
      updatedCount: 0,
      error: error.message,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Captura via HTTP — para nibo, santander, inter, omie, controlle, ofx.
 */
async function captureViaHttp(
  clientId: string,
  cycleId: string,
  source: string,
  startTime: number
): Promise<CaptureActivityOutput> {
  try {
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
        error: `URL nao configurada para ${source}`,
        durationMs: Date.now() - startTime,
      };
    }

    const result = await withRetry(
      async () => {
        const response = await fetch(`${opsUrl}/api/${source}/capture`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-functions-key': getOpsKey(source),
          },
          body: JSON.stringify({
            clientId,
            cycleId,
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
        controlle: TransactionSource.CONTROLLE,
        santander: TransactionSource.SANTANDER,
        inter: TransactionSource.INTER,
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
          descricao: `Captura ${source}: ${savedIds.length} transacoes`,
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
}

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
    controlle: process.env.CONTROLLE_OPS_URL,
    santander: process.env.SANTANDER_OPS_URL,
    inter: process.env.INTER_OPS_URL,
    ofx: process.env.UTILS_OPS_URL,
  };
  return urls[source] || '';
}

function getOpsKey(source: string): string {
  const keys: Record<string, string | undefined> = {
    nibo: process.env.NIBO_OPS_KEY,
    omie: process.env.OMIE_OPS_KEY,
    controlle: process.env.CONTROLLE_OPS_KEY,
    santander: process.env.SANTANDER_OPS_KEY,
    inter: process.env.INTER_OPS_KEY,
    ofx: process.env.UTILS_OPS_KEY,
  };
  return keys[source] || '';
}

function getStartDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  return date.toISOString().split('T')[0];
}

function getEndDate(): string {
  return new Date().toISOString().split('T')[0];
}
