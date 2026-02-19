/**
 * BPO Histórico - operacao-head
 *
 * GET /api/bpo/historico
 */

import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import { getHistory } from '../storage/tableClient';

app.http('bpoHistorico', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'bpo/historico',
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    context.log('[bpoHistorico] History requested');

    try {
      const clientId = request.query.get('cliente_id') || undefined;
      const limit = parseInt(request.query.get('limit') || '50');
      const offset = parseInt(request.query.get('offset') || '0');

      const { items, total } = await getHistory(clientId, limit, offset);

      return {
        status: 200,
        jsonBody: {
          items,
          total,
          limit,
          offset,
        },
      };
    } catch (error) {
      context.error('[bpoHistorico] Error:', error);
      return {
        status: 500,
        jsonBody: { error: 'Erro ao carregar histórico' },
      };
    }
  },
});
