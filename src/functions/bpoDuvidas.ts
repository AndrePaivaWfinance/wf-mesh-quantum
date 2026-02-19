/**
 * BPO Dúvidas - operacao-head
 *
 * GET  /api/bpo/duvidas
 * POST /api/bpo/duvidas/{id}/resolver
 * POST /api/bpo/duvidas/{id}/pular
 */

import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import {
  getPendingDoubts,
  resolveDoubt,
  skipDoubt,
  addHistoryAction,
} from '../storage/tableClient';
import { nowISO } from '../../shared/utils';

// List doubts
app.http('bpoDuvidasList', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'bpo/duvidas',
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    context.log('[bpoDuvidas] List requested');

    try {
      const clientId = request.query.get('cliente_id') || undefined;
      const tipo = request.query.get('tipo') || undefined;

      const items = await getPendingDoubts(clientId, tipo);

      return {
        status: 200,
        jsonBody: {
          items,
          total: items.length,
        },
      };
    } catch (error) {
      context.error('[bpoDuvidas] Error:', error);
      return {
        status: 500,
        jsonBody: { error: 'Erro ao listar dúvidas' },
      };
    }
  },
});

// Resolve doubt
app.http('bpoDuvidasResolver', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'bpo/duvidas/{id}/resolver',
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    const id = request.params.id;
    context.log(`[bpoDuvidas] Resolving ${id}`);

    try {
      const body = (await request.json()) as {
        resolucao: Record<string, unknown>;
        notas?: string;
      };

      if (!body.resolucao) {
        return {
          status: 400,
          jsonBody: { success: false, message: 'Resolução é obrigatória' },
        };
      }

      await resolveDoubt(id, body.resolucao, body.notas);

      // Add to history
      await addHistoryAction({
        id: `hist-${Date.now()}`,
        clientId: 'SYSTEM',
        tipo: 'classificacao',
        descricao: `Dúvida ${id} resolvida`,
        data: nowISO(),
        detalhes: { doubtId: id, resolucao: body.resolucao },
      });

      return {
        status: 200,
        jsonBody: {
          success: true,
          message: 'Dúvida resolvida',
        },
      };
    } catch (error) {
      context.error('[bpoDuvidas] Error resolving:', error);
      return {
        status: 500,
        jsonBody: { success: false, message: 'Erro ao resolver dúvida' },
      };
    }
  },
});

// Skip doubt
app.http('bpoDuvidasPular', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'bpo/duvidas/{id}/pular',
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    const id = request.params.id;
    context.log(`[bpoDuvidas] Skipping ${id}`);

    try {
      const body = (await request.json()) as { motivo?: string };

      await skipDoubt(id, body.motivo || 'Sem motivo informado');

      return {
        status: 200,
        jsonBody: {
          success: true,
          message: 'Dúvida pulada',
        },
      };
    } catch (error) {
      context.error('[bpoDuvidas] Error skipping:', error);
      return {
        status: 500,
        jsonBody: { success: false, message: 'Erro ao pular dúvida' },
      };
    }
  },
});
