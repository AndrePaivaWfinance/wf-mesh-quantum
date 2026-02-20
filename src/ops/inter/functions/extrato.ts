/**
 * Extrato + Saldo - inter-ops
 *
 * GET /api/extrato - Consulta extrato bancário
 * GET /api/saldo - Consulta saldo
 * GET /api/comprovantes - Lista comprovantes
 * GET /api/comprovantes/:idTransacao/pdf - Download PDF comprovante
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getInterClient } from '../adapters/client';
import { createLogger } from '../shared/utils';

const logger = createLogger('InterExtrato');

// GET /api/extrato - Bank statements
app.http('inter-extrato', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'inter/extrato',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const thirtyDaysAgo = (() => {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return d.toISOString().split('T')[0];
      })();

      const dataInicio = req.query.get('dataInicio') || thirtyDaysAgo;
      const dataFim = req.query.get('dataFim') || today;

      logger.info('Getting extrato', { dataInicio, dataFim });

      const client = getInterClient();
      const extrato = await client.getExtrato({ dataInicio, dataFim });

      return {
        status: 200,
        jsonBody: {
          items: extrato,
          total: extrato.length,
          periodo: { dataInicio, dataFim },
        },
      };
    } catch (error: unknown) {
      logger.error('Failed to get extrato', error);

      return {
        status: 500,
        jsonBody: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  },
});

// GET /api/saldo - Account balance
app.http('inter-saldo', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'inter/saldo',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      logger.info('Getting saldo');

      const client = getInterClient();
      const saldo = await client.getSaldo();

      if (!saldo) {
        return {
          status: 500,
          jsonBody: { error: 'Failed to get saldo' },
        };
      }

      return {
        status: 200,
        jsonBody: {
          ...saldo,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error: unknown) {
      logger.error('Failed to get saldo', error);

      return {
        status: 500,
        jsonBody: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  },
});

// GET /api/comprovantes - List payment receipts
app.http('inter-comprovantes-list', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'inter/comprovantes',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const dataInicio = req.query.get('dataInicio') || undefined;
      const dataFim = req.query.get('dataFim') || undefined;
      const tipoTransacao = req.query.get('tipoTransacao') || undefined;

      logger.info('Listing comprovantes', { dataInicio, dataFim });

      const client = getInterClient();
      const comprovantes = await client.listComprovantes({
        dataInicio,
        dataFim,
        tipoTransacao,
      });

      return {
        status: 200,
        jsonBody: {
          items: comprovantes,
          total: comprovantes.length,
        },
      };
    } catch (error: unknown) {
      logger.error('Failed to list comprovantes', error);

      return {
        status: 500,
        jsonBody: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  },
});

// GET /api/comprovantes/:idTransacao/pdf - Download comprovante PDF
app.http('inter-comprovantes-pdf', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'inter/comprovantes/{idTransacao}/pdf',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const idTransacao = req.params.idTransacao;

      if (!idTransacao) {
        return {
          status: 400,
          jsonBody: { error: 'idTransacao is required' },
        };
      }

      logger.info('Getting comprovante PDF', { idTransacao });

      const client = getInterClient();
      const result = await client.getComprovantePDF(idTransacao);

      if (!result?.pdfBase64) {
        return {
          status: 404,
          jsonBody: { error: 'Comprovante PDF not found' },
        };
      }

      return {
        status: 200,
        jsonBody: {
          idTransacao,
          pdfBase64: result.pdfBase64,
        },
      };
    } catch (error: unknown) {
      logger.error('Failed to get comprovante PDF', error);

      return {
        status: 500,
        jsonBody: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  },
});
