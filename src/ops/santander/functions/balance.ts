/**
 * Balance - santander-ops (integrado ao mesh)
 *
 * GET /api/santander/balance - Consulta saldo da conta (placeholder - usa extrato)
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getSantanderClient } from '../adapters/client';
import { createLogger } from '../shared/utils';

const logger = createLogger('SantanderBalance');

app.http('santander-balance', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'santander/balance',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const accountId = req.query.get('accountId');
      const startDate = req.query.get('startDate');
      const endDate = req.query.get('endDate') || new Date().toISOString().split('T')[0];

      if (!accountId) {
        return {
          status: 400,
          jsonBody: { error: 'accountId is required' },
        };
      }

      logger.info('Getting balance via statements', { accountId });

      const client = getSantanderClient();

      // Use statements to get balance info
      const start = startDate || (() => {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return d.toISOString().split('T')[0];
      })();

      const statements = await client.getStatements(accountId, start, endDate);

      // Get last statement for balance
      const lastStatement = statements.length > 0 ? statements[statements.length - 1] : null;

      return {
        status: 200,
        jsonBody: {
          accountId,
          balance: lastStatement?.balance || 0,
          statementsCount: statements.length,
          lastStatementDate: lastStatement?.date || null,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error: unknown) {
      logger.error('Failed to get balance', error);

      return {
        status: 500,
        jsonBody: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  },
});
