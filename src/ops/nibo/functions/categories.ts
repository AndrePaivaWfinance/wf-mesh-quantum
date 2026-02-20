/**
 * Categories - nibo-ops (integrado ao mesh)
 *
 * GET /api/nibo/categories - Lista categorias do Nibo
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getNiboClient } from '../adapters/client';
import { createLogger } from '../shared/utils';

const logger = createLogger('NiboCategories');

app.http('nibo-categories', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'nibo/categories',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const client = getNiboClient();
      const categories = await client.getCategories();

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
