/**
 * Sync Activity - operacao-head
 *
 * Activity que sincroniza transações classificadas para o sistema de destino (Nibo/Omie).
 * Processa em batch as transações prontas.
 */

import * as df from 'durable-functions';
import { InvocationContext } from '@azure/functions';
import { createLogger, withRetry } from '../../shared/utils';

const logger = createLogger('SyncActivity');

interface SyncBatchInput {
  clientId: string;
  cycleId: string;
  destination: 'nibo' | 'omie';
}

interface SyncBatchOutput {
  synced: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

// Sync batch activity
df.app.activity('syncBatchActivity', {
  handler: async (
    input: SyncBatchInput,
    context: InvocationContext
  ): Promise<SyncBatchOutput> => {
    const { clientId, cycleId, destination } = input;

    logger.info('Starting batch sync', { clientId, cycleId, destination });

    try {
      // Get classified transactions ready for sync
      const transactions = await getTransactionsToSync(clientId, cycleId);

      if (transactions.length === 0) {
        logger.info('No transactions to sync');
        return { synced: 0, created: 0, updated: 0, skipped: 0, errors: 0 };
      }

      logger.info(`Found ${transactions.length} transactions to sync`);

      // Get ops URL
      const opsUrl = destination === 'nibo'
        ? process.env.NIBO_OPS_URL
        : process.env.OMIE_OPS_URL;

      const opsKey = destination === 'nibo'
        ? process.env.NIBO_OPS_KEY
        : process.env.OMIE_OPS_KEY;

      if (!opsUrl) {
        logger.warn(`No URL configured for ${destination}`);
        return { synced: 0, created: 0, updated: 0, skipped: 0, errors: 1 };
      }

      // Sync each transaction
      let created = 0;
      let updated = 0;
      let skipped = 0;
      let errors = 0;

      for (const tx of transactions) {
        try {
          const result = await syncTransaction(opsUrl, opsKey || '', tx, destination);

          switch (result.action) {
            case 'created':
              created++;
              break;
            case 'updated':
              updated++;
              break;
            case 'skipped':
              skipped++;
              break;
          }

          // Update transaction with external ID if created
          if (result.externalId) {
            await updateTransactionExternalId(tx.id, destination, result.externalId);
          }
        } catch (error) {
          logger.error(`Error syncing transaction ${tx.id}`, error);
          errors++;
        }
      }

      const synced = created + updated;
      logger.info('Sync completed', { synced, created, updated, skipped, errors });

      return { synced, created, updated, skipped, errors };
    } catch (error: any) {
      logger.error('Batch sync failed', error);
      return { synced: 0, created: 0, updated: 0, skipped: 0, errors: 1 };
    }
  },
});

// Single sync activity
df.app.activity('syncActivity', {
  handler: async (
    input: {
      transactionId: string;
      clientId: string;
      cycleId: string;
      destination: 'nibo' | 'omie';
      action: 'create' | 'update';
    },
    context: InvocationContext
  ): Promise<{
    success: boolean;
    action: 'created' | 'updated' | 'skipped';
    externalId?: string;
    error?: string;
    durationMs: number;
  }> => {
    const startTime = Date.now();

    try {
      // Get transaction data
      const transaction = await getTransaction(input.transactionId);

      if (!transaction) {
        return {
          success: false,
          action: 'skipped',
          error: 'Transaction not found',
          durationMs: Date.now() - startTime,
        };
      }

      const opsUrl = input.destination === 'nibo'
        ? process.env.NIBO_OPS_URL
        : process.env.OMIE_OPS_URL;

      const opsKey = input.destination === 'nibo'
        ? process.env.NIBO_OPS_KEY
        : process.env.OMIE_OPS_KEY;

      const result = await syncTransaction(
        opsUrl || '',
        opsKey || '',
        transaction,
        input.destination
      );

      return {
        success: true,
        action: result.action,
        externalId: result.externalId,
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      logger.error('Sync failed', error);
      return {
        success: false,
        action: 'skipped',
        error: error.message,
        durationMs: Date.now() - startTime,
      };
    }
  },
});

// Helper functions
async function getTransactionsToSync(
  clientId: string,
  cycleId: string
): Promise<any[]> {
  // TODO: Implement - get transactions with status CLASSIFICADO
  return [];
}

async function getTransaction(transactionId: string): Promise<any> {
  // TODO: Implement - get single transaction
  return null;
}

async function syncTransaction(
  opsUrl: string,
  opsKey: string,
  transaction: any,
  destination: 'nibo' | 'omie'
): Promise<{
  action: 'created' | 'updated' | 'skipped';
  externalId?: string;
}> {
  const response = await withRetry(
    async () => {
      const res = await fetch(`${opsUrl}/api/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-functions-key': opsKey,
        },
        body: JSON.stringify({
          transactionId: transaction.id,
          clientId: transaction.clientId,
          descricao: transaction.descricao,
          valor: transaction.valor,
          dataVencimento: transaction.dataVencimento,
          categoriaId: transaction.categoriaId,
          categoriaNome: transaction.categoriaNome,
          contraparte: transaction.contraparte,
          tipo: transaction.type,
          existingExternalId: destination === 'nibo'
            ? transaction.niboId
            : transaction.omieId,
        }),
      });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(`Sync failed: ${res.status} - ${error}`);
      }

      return res.json();
    },
    { maxRetries: 3, delayMs: 2000 }
  );

  return {
    action: response.action || 'skipped',
    externalId: response.externalId,
  };
}

async function updateTransactionExternalId(
  transactionId: string,
  destination: 'nibo' | 'omie',
  externalId: string
): Promise<void> {
  // TODO: Implement - update transaction with external ID
  logger.info('Updated transaction external ID', {
    transactionId,
    destination,
    externalId,
  });
}
