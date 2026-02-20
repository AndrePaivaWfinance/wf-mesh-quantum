/**
 * PIX - santander-ops (integrado ao mesh)
 *
 * GET /api/santander/pix - Lista transações PIX
 * POST /api/santander/pix/pay - Inicia pagamento PIX (requer aprovação no internet banking)
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getSantanderClient } from '../adapters/client';
import { PIXCreateParams } from '../adapters/types';
import { createLogger } from '../shared/utils';

const logger = createLogger('SantanderPIX');

// GET /api/pix - List PIX transactions
app.http('santander-pix-list', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'santander/pix',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const clientSlug = req.query.get('clientSlug') || undefined;

      logger.info('Listing PIX transactions', { clientSlug });

      const client = getSantanderClient();
      const transactions = await client.listPIX();

      return {
        status: 200,
        jsonBody: {
          items: transactions,
          total: transactions.length,
        },
      };
    } catch (error: unknown) {
      logger.error('Failed to list PIX transactions', error);

      return {
        status: 500,
        jsonBody: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  },
});

// POST /api/pix/pay - Initiate PIX payment (requires gestor approval in internet banking)
app.http('santander-pix-pay', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'santander/pix/pay',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = (await req.json()) as PIXCreateParams & { clientSlug?: string };
      const { amount, key, keyType, description, scheduledDate, clientSlug } = body;

      if (!amount) {
        return {
          status: 400,
          jsonBody: { error: 'amount is required' },
        };
      }

      if (!key) {
        return {
          status: 400,
          jsonBody: { error: 'key is required' },
        };
      }

      if (!keyType) {
        return {
          status: 400,
          jsonBody: { error: 'keyType is required (CPF, CNPJ, EMAIL, PHONE, EVP)' },
        };
      }

      logger.info('Initiating PIX payment (pending gestor approval)', {
        amount,
        keyType,
        key: key.substring(0, 5) + '...',
        clientSlug,
      });

      const client = getSantanderClient();
      const result = await client.createPIX({
        amount,
        key,
        keyType,
        description,
        scheduledDate,
      });

      if (!result) {
        return {
          status: 500,
          jsonBody: {
            success: false,
            error: 'Failed to initiate PIX payment',
          },
        };
      }

      return {
        status: 200,
        jsonBody: {
          success: true,
          pix: result,
        },
      };
    } catch (error: unknown) {
      logger.error('Failed to initiate PIX payment', error);

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
