/**
 * Boletos - inter-ops
 *
 * GET /api/boletos - Lista boletos emitidos
 * GET /api/boletos/:nossoNumero - Detalhe de um boleto
 * POST /api/boletos/pay - Pagamento de boleto
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getInterClient } from '../adapters/client';
import { BoletoListParams, BoletoPagamentoParams } from '../adapters/types';
import { createLogger } from '../shared/utils';

const logger = createLogger('InterBoletos');

// GET /api/boletos - List boletos
app.http('inter-boletos-list', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'inter/boletos',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const dataInicial = req.query.get('dataInicial') || undefined;
      const dataFinal = req.query.get('dataFinal') || undefined;
      const situacao = req.query.get('situacao') as BoletoListParams['situacao'] || undefined;

      logger.info('Listing boletos', { dataInicial, dataFinal, situacao });

      const client = getInterClient();
      const boletos = await client.listBoletos({ dataInicial, dataFinal, situacao });

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

// GET /api/boletos/:nossoNumero - Get boleto detail
app.http('inter-boletos-detail', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'inter/boletos/{nossoNumero}',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const nossoNumero = req.params.nossoNumero;

      if (!nossoNumero) {
        return {
          status: 400,
          jsonBody: { error: 'nossoNumero is required' },
        };
      }

      logger.info('Getting boleto detail', { nossoNumero });

      const client = getInterClient();
      const boleto = await client.getBoleto(nossoNumero);

      if (!boleto) {
        return {
          status: 404,
          jsonBody: { error: 'Boleto not found' },
        };
      }

      return {
        status: 200,
        jsonBody: boleto,
      };
    } catch (error: unknown) {
      logger.error('Failed to get boleto detail', error);

      return {
        status: 500,
        jsonBody: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  },
});

// POST /api/boletos/pay - Pay boleto
app.http('inter-boletos-pay', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'inter/boletos/pay',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = (await req.json()) as BoletoPagamentoParams;
      const { codBarraLinhaDigitavel, valorPagar } = body;

      if (!codBarraLinhaDigitavel) {
        return {
          status: 400,
          jsonBody: { error: 'codBarraLinhaDigitavel is required' },
        };
      }

      logger.info('Paying boleto', {
        barCode: codBarraLinhaDigitavel.substring(0, 10) + '...',
        valor: valorPagar,
      });

      const client = getInterClient();
      const result = await client.payBoleto(body);

      if (!result) {
        return {
          status: 500,
          jsonBody: { success: false, error: 'Failed to pay boleto' },
        };
      }

      return {
        status: 200,
        jsonBody: { success: true, pagamento: result },
      };
    } catch (error: unknown) {
      logger.error('Failed to pay boleto', error);

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
