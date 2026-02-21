/**
 * BPO Autorizações - operacao-head
 *
 * GET  /api/bpo/autorizacoes
 * POST /api/bpo/autorizacoes/{id}/aprovar
 * POST /api/bpo/autorizacoes/{id}/rejeitar
 */

import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import {
  getPendingAuthorizations,
  approveAuthorization,
  rejectAuthorization,
  addHistoryAction,
} from '../storage/tableClient';
import { nowISO } from '../../shared/utils';

// List authorizations
app.http('bpoAutorizacoesList', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'bpo/autorizacoes',
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    context.log('[bpoAutorizacoes] List requested');

    try {
      const clientId = request.query.get('cliente_id') || undefined;
      const tipo = request.query.get('tipo') as 'pagar' | 'receber' | undefined;

      const items = await getPendingAuthorizations(clientId, tipo);

      return {
        status: 200,
        jsonBody: {
          items,
          total: items.length,
        },
      };
    } catch (error) {
      context.error('[bpoAutorizacoes] Error:', error);
      return {
        status: 500,
        jsonBody: { error: 'Erro ao listar autorizações' },
      };
    }
  },
});

// Approve authorization
app.http('bpoAutorizacoesAprovar', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'bpo/autorizacoes/{id}/aprovar',
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    const id = request.params.id;
    context.log(`[bpoAutorizacoes] Approving ${id}`);

    try {
      const body = (await request.json()) as { notas?: string };

      // Buscar autorização para obter o clientId antes de aprovar
      const allAuths = await getPendingAuthorizations();
      const authRecord = allAuths.find(a => a.id === id);
      const authClientId = authRecord?.clientId || 'SYSTEM';

      await approveAuthorization(id, body.notas);

      // Add to history
      await addHistoryAction({
        id: `hist-${Date.now()}`,
        clientId: authClientId,
        tipo: 'aprovacao',
        descricao: `Autorização ${id} aprovada`,
        data: nowISO(),
        detalhes: { authorizationId: id, notas: body.notas },
      });

      return {
        status: 200,
        jsonBody: {
          success: true,
          message: 'Pagamento aprovado com sucesso',
        },
      };
    } catch (error) {
      context.error('[bpoAutorizacoes] Error approving:', error);
      return {
        status: 500,
        jsonBody: { success: false, message: 'Erro ao aprovar pagamento' },
      };
    }
  },
});

// Reject authorization
app.http('bpoAutorizacoesRejeitar', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'bpo/autorizacoes/{id}/rejeitar',
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    const id = request.params.id;
    context.log(`[bpoAutorizacoes] Rejecting ${id}`);

    try {
      const body = (await request.json()) as { motivo: string };

      if (!body.motivo) {
        return {
          status: 400,
          jsonBody: { success: false, message: 'Motivo é obrigatório' },
        };
      }

      // Buscar autorização para obter o clientId antes de rejeitar
      const rejectAuths = await getPendingAuthorizations();
      const rejectAuth = rejectAuths.find(a => a.id === id);
      const rejectClientId = rejectAuth?.clientId || 'SYSTEM';

      await rejectAuthorization(id, body.motivo);

      // Add to history
      await addHistoryAction({
        id: `hist-${Date.now()}`,
        clientId: rejectClientId,
        tipo: 'rejeicao',
        descricao: `Autorização ${id} rejeitada: ${body.motivo}`,
        data: nowISO(),
        detalhes: { authorizationId: id, motivo: body.motivo },
      });

      return {
        status: 200,
        jsonBody: {
          success: true,
          message: 'Pagamento rejeitado',
        },
      };
    } catch (error) {
      context.error('[bpoAutorizacoes] Error rejecting:', error);
      return {
        status: 500,
        jsonBody: { success: false, message: 'Erro ao rejeitar pagamento' },
      };
    }
  },
});
