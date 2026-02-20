/**
 * Sync - controlle-ops
 *
 * POST /api/sync - Sincroniza transacao para Controlle
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getControlleClient } from '../adapters/client';
import { SyncRequest, SyncResponse } from '../adapters/types';
import { createLogger } from '../shared/utils';

const logger = createLogger('ControlleSync');

app.http('controlle-sync', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'controlle/sync',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = (await req.json()) as SyncRequest;
      const { transactionId, tipo } = body;

      logger.info('Starting sync', { transactionId, tipo });

      // Controlle sync write operations
      // Full implementation depends on specific Controlle API methods for creating transactions

      const response: SyncResponse = {
        success: false,
        action: 'skipped',
        error: 'Controlle sync write operations not yet implemented. Use capture for read-only.',
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
