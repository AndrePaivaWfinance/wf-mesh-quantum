/**
 * BPO Dashboard - operacao-head
 *
 * GET /api/bpo/dashboard
 */

import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import {
  getActiveClients,
  getRecentCycles,
  getPendingAuthorizations,
  getPendingDoubts,
} from '../storage/tableClient';
import { BPODashboard } from '../types';

app.http('bpoDashboard', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'bpo/dashboard',
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    context.log('[bpoDashboard] Dashboard requested');

    try {
      const clientId = request.query.get('cliente_id') || undefined;

      // Get data in parallel
      const [clients, cycles, authorizations, doubts] = await Promise.all([
        getActiveClients(),
        getRecentCycles(5),
        getPendingAuthorizations(clientId),
        getPendingDoubts(clientId),
      ]);

      // Calculate KPIs
      const pendentes = authorizations.length + doubts.length;
      const processando = cycles.filter((c) => c.status === 'running').length;
      const erro = cycles.filter((c) => c.status === 'failed').length;
      const concluidosHoje = cycles
        .filter((c) => c.status === 'completed' && c.date === new Date().toISOString().split('T')[0])
        .reduce((sum, c) => sum + c.transactionsSynced, 0);

      // Get current cycle for pipeline status
      const currentCycle = cycles.find((c) => c.status === 'running');
      const lastCycle = cycles.find((c) => c.status === 'completed') || cycles[0];

      const dashboard: BPODashboard = {
        kpis: {
          pendentes,
          processando,
          erro,
          concluidosHoje,
        },
        pipeline: {
          captura: {
            status: currentCycle ? 'running' : 'idle',
            count: lastCycle?.transactionsCaptured || 0,
          },
          classificacao: {
            status: currentCycle ? 'running' : 'idle',
            count: lastCycle?.transactionsClassified || 0,
          },
          sync: {
            status: currentCycle ? 'pending' : 'idle',
            count: lastCycle?.transactionsSynced || 0,
          },
        },
        ultimosCiclos: cycles.map((c) => ({
          id: c.id,
          data: c.date,
          status: c.status,
          transacoes: c.transactionsCaptured,
          erros: c.errors.length,
        })),
        alertas: generateAlerts(authorizations.length, doubts.length, cycles),
      };

      return {
        status: 200,
        jsonBody: dashboard,
      };
    } catch (error) {
      context.error('[bpoDashboard] Error:', error);
      return {
        status: 500,
        jsonBody: { error: 'Erro ao carregar dashboard' },
      };
    }
  },
});

function generateAlerts(
  authCount: number,
  doubtCount: number,
  cycles: any[]
): BPODashboard['alertas'] {
  const alertas: BPODashboard['alertas'] = [];

  if (authCount > 0) {
    alertas.push({
      tipo: 'autorizacao',
      mensagem: `${authCount} pagamento(s) aguardando aprovação`,
      prioridade: authCount > 5 ? 'alta' : 'media',
    });
  }

  if (doubtCount > 0) {
    alertas.push({
      tipo: 'classificacao',
      mensagem: `${doubtCount} transação(ões) aguardando classificação`,
      prioridade: doubtCount > 10 ? 'alta' : 'media',
    });
  }

  const failedCycles = cycles.filter((c) => c.status === 'failed');
  if (failedCycles.length > 0) {
    alertas.push({
      tipo: 'erro',
      mensagem: `${failedCycles.length} ciclo(s) com erro`,
      prioridade: 'alta',
    });
  }

  return alertas;
}
