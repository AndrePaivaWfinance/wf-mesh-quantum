/**
 * Sync - nibo-ops (integrado ao mesh)
 *
 * POST /api/nibo/sync - Sincroniza transação para Nibo
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getNiboClient } from '../adapters/client';
import { SyncRequest, SyncResponse } from '../adapters/types';
import { createLogger } from '../shared/utils';
import { updateTransaction } from '../../../storage/tableClient';

const logger = createLogger('NiboSync');

app.http('nibo-sync', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'nibo/sync',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = (await req.json()) as SyncRequest;
      const {
        transactionId,
        clientId,
        descricao,
        valor,
        dataVencimento,
        categoriaId,
        contraparte,
        tipo,
        existingExternalId,
      } = body;

      logger.info('Starting sync', { transactionId, tipo, existingExternalId });

      const client = getNiboClient();

      let response: SyncResponse;

      if (existingExternalId) {
        // Update existing schedule
        const updated = await client.updateSchedule(existingExternalId, {
          description: descricao,
          value: valor,
          dueDate: dataVencimento,
          categoryId: categoriaId,
        });

        response = {
          success: !!updated,
          action: updated ? 'updated' : 'skipped',
          externalId: existingExternalId,
        };
      } else {
        // Create new schedule
        const created = await client.createSchedule({
          type: tipo === 'pagar' ? 'Debit' : 'Credit',
          description: descricao,
          value: valor,
          dueDate: dataVencimento,
          categoryId: categoriaId,
        });

        response = {
          success: !!created,
          action: created ? 'created' : 'skipped',
          externalId: created?.scheduleId,
        };
      }

      logger.info('Sync completed', { transactionId, action: response.action });

      // Update transaction in mesh storage with external ID
      if (response.success && response.externalId && clientId && transactionId) {
        try {
          await updateTransaction(clientId, transactionId, {
            niboId: response.externalId,
            status: 'SINCRONIZADO' as any,
          });
          logger.info('Transaction updated in mesh storage', { transactionId, niboId: response.externalId });
        } catch (err) {
          logger.error('Failed to update transaction in mesh storage', err as Error);
        }
      }

      return { status: 200, jsonBody: response };
    } catch (error: any) {
      logger.error('Sync failed', error);

      return {
        status: 500,
        jsonBody: {
          success: false,
          action: 'skipped',
          error: error.message,
        },
      };
    }
  },
});
