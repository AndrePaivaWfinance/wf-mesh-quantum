/**
 * PIX - inter-ops
 *
 * GET /api/pix - Lista PIX recebidos/enviados
 * POST /api/pix/pay - Cria pagamento PIX
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getInterClient } from '../adapters/client';
import { PIXCreateParams } from '../adapters/types';
import { createLogger } from '../shared/utils';

const logger = createLogger('InterPIX');

// GET /api/pix - List PIX transactions
app.http('inter-pix-list', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'inter/pix',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      // Default: today
      const today = new Date().toISOString().split('T')[0];
      const dataInicio = req.query.get('dataInicio') || today;
      const dataFim = req.query.get('dataFim') || today;

      logger.info('Listing PIX', { dataInicio, dataFim });

      const client = getInterClient();
      const pix = await client.listPIX({ dataInicio, dataFim });

      return {
        status: 200,
        jsonBody: {
          items: pix,
          total: pix.length,
        },
      };
    } catch (error: unknown) {
      logger.error('Failed to list PIX', error);

      return {
        status: 500,
        jsonBody: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  },
});

// POST /api/pix/pay - Create PIX payment
app.http('inter-pix-pay', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'inter/pix/pay',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = (await req.json()) as PIXCreateParams;
      const { valor, chave, descricao } = body;

      if (!valor || !chave) {
        return {
          status: 400,
          jsonBody: { error: 'valor and chave are required' },
        };
      }

      logger.info('Creating PIX payment', { valor, chave });

      const client = getInterClient();
      const result = await client.createPIX({ valor, chave, descricao });

      if (!result) {
        return {
          status: 500,
          jsonBody: { success: false, error: 'Failed to create PIX payment' },
        };
      }

      return {
        status: 200,
        jsonBody: { success: true, pix: result },
      };
    } catch (error: unknown) {
      logger.error('Failed to create PIX payment', error);

      return {
        status: 500,
        jsonBody: {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  },
});
