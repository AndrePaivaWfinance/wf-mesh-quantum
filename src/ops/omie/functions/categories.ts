/**
 * Categories - omie-ops
 *
 * GET /api/categories - Lista categorias do Omie
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getOmieClient } from '../adapters/client';
import { createLogger } from '../shared/utils';

const logger = createLogger('OmieCategories');

app.http('omie-categories', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'omie/categories',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const client = getOmieClient();
      const categories = await client.getCategorias();

      return {
        status: 200,
        jsonBody: {
          items: categories,
          total: categories.length,
        },
      };
    } catch (error: any) {
      logger.error('Failed to get categories', error);

      return {
        status: 500,
        jsonBody: { error: error.message },
      };
    }
  },
});
