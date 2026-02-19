/**
 * BPO Clientes - operacao-head
 *
 * GET  /api/bpo/clientes - Lista todos os clientes
 * GET  /api/bpo/clientes/{id} - Detalhe de um cliente
 * POST /api/bpo/clientes - Cria novo cliente
 * PUT  /api/bpo/clientes/{id} - Atualiza cliente
 */

import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import { getClients, getClient, upsertClient } from '../storage/tableClient';
import { Client, ClientSystem, ClientPlano, createClient } from '../types';
import { nowISO } from '../../shared/utils';

// List clients
app.http('bpoClientesList', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'bpo/clientes',
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    context.log('[bpoClientes] List requested');

    try {
      const clients = await getClients();

      return {
        status: 200,
        jsonBody: {
          items: clients.map((c) => ({
            id: c.id,
            tenantId: c.tenantId,
            nome: c.nome,
            cnpj: c.cnpj,
            email: c.email,
            plano: c.plano,
            sistema: c.sistema,
            status: c.status,
            banco: c.config.banco,
            adquirente: c.config.adquirente,
          })),
          total: clients.length,
        },
      };
    } catch (error) {
      context.error('[bpoClientes] Error listing:', error);
      return {
        status: 500,
        jsonBody: { error: 'Erro ao listar clientes' },
      };
    }
  },
});

// Get client detail
app.http('bpoClientesDetail', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'bpo/clientes/{id}',
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    const id = request.params.id;
    context.log(`[bpoClientes] Detail requested for ${id}`);

    try {
      const client = await getClient(id);

      if (!client) {
        return {
          status: 404,
          jsonBody: { error: 'Cliente não encontrado' },
        };
      }

      // TODO: Add metrics from transactions table
      const metricas = {
        transacoesMes: 0,
        taxaAutoClassificacao: 0,
        pendentes: 0,
      };

      return {
        status: 200,
        jsonBody: {
          ...client,
          metricas,
        },
      };
    } catch (error) {
      context.error('[bpoClientes] Error getting detail:', error);
      return {
        status: 500,
        jsonBody: { error: 'Erro ao obter cliente' },
      };
    }
  },
});

// Create client
app.http('bpoClientesCreate', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'bpo/clientes',
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    context.log('[bpoClientes] Create requested');

    try {
      const body = (await request.json()) as {
        nome: string;
        cnpj: string;
        email: string;
        telefone?: string;
        sistema: ClientSystem;
        plano?: ClientPlano;
        tenantId?: string;
        config?: Partial<Client['config']>;
      };

      if (!body.nome || !body.cnpj || !body.email || !body.sistema) {
        return {
          status: 400,
          jsonBody: { error: 'nome, cnpj, email e sistema são obrigatórios' },
        };
      }

      const client = createClient({
        nome: body.nome,
        cnpj: body.cnpj,
        email: body.email,
        telefone: body.telefone,
        sistema: body.sistema,
        plano: body.plano,
        tenantId: body.tenantId,
        config: body.config,
      });

      await upsertClient(client);

      return {
        status: 201,
        jsonBody: {
          success: true,
          message: 'Cliente criado com sucesso',
          client,
        },
      };
    } catch (error) {
      context.error('[bpoClientes] Error creating:', error);
      return {
        status: 500,
        jsonBody: { error: 'Erro ao criar cliente' },
      };
    }
  },
});

// Update client
app.http('bpoClientesUpdate', {
  methods: ['PUT'],
  authLevel: 'function',
  route: 'bpo/clientes/{id}',
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    const id = request.params.id;
    context.log(`[bpoClientes] Update requested for ${id}`);

    try {
      const existing = await getClient(id);

      if (!existing) {
        return {
          status: 404,
          jsonBody: { error: 'Cliente não encontrado' },
        };
      }

      const body = (await request.json()) as Partial<Client>;

      const updated: Client = {
        ...existing,
        ...body,
        id: existing.id, // Never change ID
        tenantId: existing.tenantId, // Never change tenantId
        updatedAt: nowISO(),
        config: {
          ...existing.config,
          ...(body.config || {}),
        },
      };

      await upsertClient(updated);

      return {
        status: 200,
        jsonBody: {
          success: true,
          message: 'Cliente atualizado com sucesso',
          client: updated,
        },
      };
    } catch (error) {
      context.error('[bpoClientes] Error updating:', error);
      return {
        status: 500,
        jsonBody: { error: 'Erro ao atualizar cliente' },
      };
    }
  },
});
