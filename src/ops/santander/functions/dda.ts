/**
 * DDA - santander-ops (integrado ao mesh)
 *
 * GET /api/santander/dda - Lista boletos DDA disponíveis
 * POST /api/santander/dda/pay - Cria pagamento de boleto DDA
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getSantanderClient } from '../adapters/client';
import { DDAListParams, BoletoCreateParams } from '../adapters/types';
import { createLogger } from '../shared/utils';

const logger = createLogger('SantanderDDA');

// GET /api/dda - List available DDA boletos
app.http('santander-dda-list', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'santander/dda',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const initialDueDate = req.query.get('initialDueDate') || undefined;
      const finalDueDate = req.query.get('finalDueDate') || undefined;
      const titleSituation = req.query.get('titleSituation') || undefined;
      const beneficiaryDocument = req.query.get('beneficiaryDocument') || undefined;

      logger.info('Listing DDA boletos', { initialDueDate, finalDueDate, titleSituation });

      const params: DDAListParams = {
        initialDueDate,
        finalDueDate,
        titleSituation,
        beneficiaryDocument,
      };

      const client = getSantanderClient();
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

// POST /api/dda/pay - Create boleto payment
app.http('santander-dda-pay', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'santander/dda/pay',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = (await req.json()) as BoletoCreateParams;
      const { barCode, paymentDate, amount, description } = body;

      if (!barCode) {
        return {
          status: 400,
          jsonBody: { error: 'barCode is required' },
        };
      }

      logger.info('Creating boleto payment', { barCode: barCode.substring(0, 10) + '...' });

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
            error: 'Failed to create boleto payment',
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
      logger.error('Failed to create boleto payment', error);

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
