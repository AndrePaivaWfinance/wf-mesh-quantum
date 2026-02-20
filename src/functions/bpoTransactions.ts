/**
 * BPO Transactions API
 *
 * GET /api/bpo/transactions?clientId=xxx          → Listar transações de um cliente
 * GET /api/bpo/transactions?clientId=xxx&status=xx → Filtrar por status
 * GET /api/bpo/transactions/count?clientId=xxx     → Contar transações
 */

import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import {
  getTransactionHistory,
  getTransactionsByStatus,
  getTransactionsByCycle,
  countTransactions,
} from '../storage/tableClient';
import { TransactionStatus } from '../types';

app.http('bpoTransactions', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'bpo/transactions',
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    const clientId = request.query.get('clientId') as string;
    const status = request.query.get('status') as string;
    const cycleId = request.query.get('cycleId') as string;
    const limit = parseInt(request.query.get('limit') || '50', 10);

    if (!clientId) {
      return {
        status: 400,
        jsonBody: { error: 'clientId é obrigatório' },
      };
    }

    try {
      let transactions;

      if (cycleId) {
        transactions = await getTransactionsByCycle(clientId, cycleId);
      } else if (status) {
        transactions = await getTransactionsByStatus(
          clientId,
          status as TransactionStatus
        );
      } else {
        transactions = await getTransactionHistory(clientId, limit);
      }

      return {
        status: 200,
        jsonBody: {
          clientId,
          total: transactions.length,
          items: transactions.slice(0, limit),
        },
      };
    } catch (error: any) {
      return {
        status: 500,
        jsonBody: { error: error.message },
      };
    }
  },
});

app.http('bpoTransactionsCount', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'bpo/transactions/count',
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    const clientId = request.query.get('clientId') as string;
    const status = request.query.get('status') as string;

    try {
      const count = await countTransactions(
        clientId || undefined,
        status ? (status as TransactionStatus) : undefined
      );

      return {
        status: 200,
        jsonBody: { clientId: clientId || 'all', status: status || 'all', count },
      };
    } catch (error: any) {
      return {
        status: 500,
        jsonBody: { error: error.message },
      };
    }
  },
});
