/**
 * Sync - omie-ops
 *
 * POST /api/sync - Sincroniza transacao para Omie
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getOmieClient } from '../adapters/client';
import { SyncRequest, SyncResponse } from '../adapters/types';
import { createLogger } from '../shared/utils';

const logger = createLogger('OmieSync');

app.http('omie-sync', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'omie/sync',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = (await req.json()) as SyncRequest;
      const { transactionId, tipo } = body;

      logger.info('Starting sync', { transactionId, tipo });

      // Omie sync uses JSON-RPC for creating contas a pagar/receber
      // For now, return a placeholder - full implementation depends on
      // the specific Omie methods needed (IncluirContaPagar, IncluirContaReceber)

      const response: SyncResponse = {
        success: false,
        action: 'skipped',
        error: 'Omie sync write operations not yet implemented. Use capture for read-only.',
      };

      logger.info('Sync completed', { transactionId, action: response.action });

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
