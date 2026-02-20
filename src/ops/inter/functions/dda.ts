/**
 * DDA - inter-ops
 *
 * GET /api/dda - Lista boletos DDA disponíveis
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getInterClient } from '../adapters/client';
import { DDAListParams } from '../adapters/types';
import { createLogger } from '../shared/utils';

const logger = createLogger('InterDDA');

app.http('inter-dda-list', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'inter/dda',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const dataInicial = req.query.get('dataInicial') || undefined;
      const dataFinal = req.query.get('dataFinal') || undefined;
      const situacao = req.query.get('situacao') as DDAListParams['situacao'] || undefined;

      logger.info('Listing DDA boletos', { dataInicial, dataFinal, situacao });

      const params: DDAListParams = {
        dataInicial,
        dataFinal,
        situacao,
      };

      const client = getInterClient();
      const boletos = await client.listDDA(params);

      return {
        status: 200,
        jsonBody: {
          items: boletos,
          total: boletos.length,
        },
      };
    } catch (error: unknown) {
      logger.error('Failed to list DDA boletos', error);

      return {
        status: 500,
        jsonBody: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  },
});
