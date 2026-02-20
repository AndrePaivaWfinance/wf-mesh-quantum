/**
 * Boletos - santander-ops (integrado ao mesh)
 *
 * GET /api/santander/boletos - Lista boletos
 * POST /api/santander/boletos/pay - Inicia pagamento de boleto (requer aprovação no internet banking)
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getSantanderClient } from '../adapters/client';
import { BoletoCreateParams } from '../adapters/types';
import { createLogger } from '../shared/utils';

const logger = createLogger('SantanderBoletos');

// GET /api/boletos - List boletos
app.http('santander-boletos-list', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'santander/boletos',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const clientSlug = req.query.get('clientSlug') || undefined;

      logger.info('Listing boletos', { clientSlug });

      const client = getSantanderClient();
      const boletos = await client.listBoletos();

      return {
        status: 200,
        jsonBody: {
          items: boletos,
          total: boletos.length,
        },
      };
    } catch (error: unknown) {
      logger.error('Failed to list boletos', error);

      return {
        status: 500,
        jsonBody: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  },
});

// POST /api/boletos/pay - Initiate boleto payment (requires gestor approval in internet banking)
app.http('santander-boletos-pay', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'santander/boletos/pay',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = (await req.json()) as BoletoCreateParams & { clientSlug?: string };
      const { barCode, paymentDate, amount, description, clientSlug } = body;

      if (!barCode) {
        return {
          status: 400,
          jsonBody: { error: 'barCode is required' },
        };
      }

      logger.info('Initiating boleto payment (pending gestor approval)', {
        barCode: barCode.substring(0, 10) + '...',
        amount,
        clientSlug,
      });

      const client = getSantanderClient();
      const result = await client.createBoleto({
        barCode,
        paymentDate,
        amount,
        description,
      });

      if (!result) {
        return {
          status: 500,
          jsonBody: {
            success: false,
            error: 'Failed to initiate boleto payment',
          },
        };
      }

      return {
        status: 200,
        jsonBody: {
          success: true,
          boleto: result,
        },
      };
    } catch (error: unknown) {
      logger.error('Failed to initiate boleto payment', error);

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
