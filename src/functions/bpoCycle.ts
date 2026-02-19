/**
 * BPO Cycle - operacao-head
 *
 * POST /api/bpo/cycle - Inicia ciclo manualmente
 * GET  /api/bpo/cycle/{id} - Status de um ciclo
 */

import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import * as df from 'durable-functions';
import { createCycle, getCycle, getActiveClients } from '../storage/tableClient';
import { todayYMD, nowISO } from '../../shared/utils';

// Start cycle manually
app.http('bpoCycleStart', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'bpo/cycle',
  extraInputs: [df.input.durableClient()],
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    context.log('[bpoCycle] Manual cycle start requested');

    try {
      const body = (await request.json().catch(() => ({}))) as {
        cliente_id?: string;
        force?: boolean;
      };

      // Create cycle record
      const date = todayYMD();
      const cycle = await createCycle(date);

      // Get clients to process
      let clients = await getActiveClients();
      if (body.cliente_id) {
        clients = clients.filter((c) => c.id === body.cliente_id);
      }

      if (clients.length === 0) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            message: 'Nenhum cliente ativo encontrado',
          },
        };
      }

      // Start orchestrator
      const durableClient = df.getClient(context);
      const instanceId = await durableClient.startNew('dailyCycleOrchestrator', {
        input: {
          cycleId: cycle.id,
          date,
          clientIds: clients.map((c) => c.id),
          force: body.force || false,
        },
      });

      context.log(`[bpoCycle] Started orchestrator: ${instanceId}`);

      return {
        status: 202,
        jsonBody: {
          cycle_id: cycle.id,
          instance_id: instanceId,
          status: 'started',
          message: `Ciclo iniciado para ${clients.length} cliente(s)`,
          clients: clients.map((c) => ({ id: c.id, nome: c.nome })),
        },
      };
    } catch (error) {
      context.error('[bpoCycle] Error starting cycle:', error);
      return {
        status: 500,
        jsonBody: {
          success: false,
          message: 'Erro ao iniciar ciclo',
        },
      };
    }
  },
});

// Get cycle status
app.http('bpoCycleStatus', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'bpo/cycle/{id}',
  extraInputs: [df.input.durableClient()],
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    const id = request.params.id;
    context.log(`[bpoCycle] Status requested for ${id}`);

    try {
      const cycle = await getCycle(id);

      if (!cycle) {
        return {
          status: 404,
          jsonBody: { error: 'Ciclo não encontrado' },
        };
      }

      // Try to get orchestrator status
      let orchestratorStatus = null;
      try {
        const durableClient = df.getClient(context);
        const status = await durableClient.getStatus(id);
        if (status) {
          orchestratorStatus = {
            runtimeStatus: status.runtimeStatus,
            output: status.output,
            lastUpdatedTime: status.lastUpdatedTime,
          };
        }
      } catch {
        // Orchestrator not found or error
      }

      return {
        status: 200,
        jsonBody: {
          ...cycle,
          orchestrator: orchestratorStatus,
        },
      };
    } catch (error) {
      context.error('[bpoCycle] Error getting status:', error);
      return {
        status: 500,
        jsonBody: { error: 'Erro ao obter status do ciclo' },
      };
    }
  },
});
