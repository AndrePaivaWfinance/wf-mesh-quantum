/**
 * Categories - controlle-ops
 *
 * GET /api/categories - Lista categorias do Controlle
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getControlleClient } from '../adapters/client';
import { createLogger } from '../shared/utils';

const logger = createLogger('ControlleCategories');

app.http('controlle-categories', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'controlle/categories',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const client = getControlleClient();
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
