/**
 * Capture - omie-ops (integrado ao mesh)
 *
 * POST /api/omie/capture - Captura dados do Omie e persiste no storage do mesh
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import * as crypto from 'crypto';
import { getOmieClient, getOmieClientForTenant } from '../adapters/client';
import { CaptureRequest, CaptureResponse, OmiePayable, OmieReceivable } from '../adapters/types';
import { createLogger } from '../shared/utils';
import { getExistingSourceIds, upsertTransactionsIdempotent } from '../../../storage/tableClient';
import { Transaction, TransactionType, TransactionSource, TransactionStatus } from '../../../types';
import { getClientById } from '../../shared/storage/clientStorage';
import { resolveOmieCredentials } from '../../../infra/credentialResolver';

const logger = createLogger('OmieCapture');

function nowISO(): string {
  return new Date().toISOString();
}

function shortHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
}

function payableToTransaction(p: OmiePayable, clientId: string, cycleId: string): Transaction {
  return {
    id: `omie-pagar-${shortHash(p.id)}`,
    clientId,
    type: TransactionType.PAGAR,
    status: TransactionStatus.CAPTURADO,
    source: TransactionSource.OMIE,
    valor: p.value,
    valorOriginal: p.value,
    dataVencimento: p.dueDate,
    descricao: p.description,
    descricaoOriginal: p.description,
    contraparte: p.supplier,
    categoriaId: p.categoryId,
    categoriaNome: p.category,
    sourceId: p.id,
    sourceName: 'omie',
    rawData: JSON.parse(JSON.stringify(p)),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    capturedAt: nowISO(),
    cycleId,
  } as any;
}

function receivableToTransaction(r: OmieReceivable, clientId: string, cycleId: string): Transaction {
  return {
    id: `omie-receber-${shortHash(r.id)}`,
    clientId,
    type: TransactionType.RECEBER,
    status: TransactionStatus.CAPTURADO,
    source: TransactionSource.OMIE,
    valor: r.value,
    valorOriginal: r.value,
    dataVencimento: r.dueDate,
    descricao: r.description,
    descricaoOriginal: r.description,
    contraparte: r.customer,
    categoriaId: r.categoryId,
    categoriaNome: r.category,
    sourceId: r.id,
    sourceName: 'omie',
    rawData: JSON.parse(JSON.stringify(r)),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    capturedAt: nowISO(),
    cycleId,
  } as any;
}

app.http('omie-capture', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'omie/capture',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const startTime = Date.now();

    try {
      const body = (await req.json()) as CaptureRequest;
      const { clientId, cycleId, startDate, endDate } = body;

      logger.info('Starting Omie capture', { clientId, cycleId });

      // Default date range: last 7 days
      const end = endDate || new Date().toISOString().split('T')[0];
      const start = startDate || (() => {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        return d.toISOString().split('T')[0];
      })();

      // Per-client credentials: resolve from ClientConfig, fallback to env vars
      let client;
      const clientData = await getClientById(clientId);
      if (clientData?.config?.omieAppKey && clientData?.config?.omieAppSecret) {
        const creds = resolveOmieCredentials(clientData.config);
        client = getOmieClientForTenant(creds.appKey, creds.appSecret);
        logger.info('Using per-client Omie credentials', { clientId });
      } else {
        client = getOmieClient();
        logger.info('Using global Omie credentials (env vars)', { clientId });
      }

      // Buscar transações existentes para idempotência
      const existingSourceIds = await getExistingSourceIds(clientId, 'omie');
      logger.info('Existing Omie transactions', { count: existingSourceIds.size });

      // Capture payables and receivables in parallel
      const [payables, receivables] = await Promise.all([
        client.getPayables(start, end),
        client.getReceivables(start, end),
      ]);

      logger.info('Capture completed', {
        payables: payables.length,
        receivables: receivables.length,
      });

      // Convert to mesh Transaction format
      const transactions: Transaction[] = [
        ...payables.map(p => payableToTransaction(p, clientId, cycleId)),
        ...receivables.map(r => receivableToTransaction(r, clientId, cycleId)),
      ];

      // Persistir com idempotência
      let result = { created: [] as string[], updated: [] as string[], skipped: [] as string[] };
      if (transactions.length > 0) {
        result = await upsertTransactionsIdempotent(transactions, existingSourceIds);
        logger.info('Transactions persisted (idempotent)', {
          created: result.created.length,
          updated: result.updated.length,
          skipped: result.skipped.length,
        });
      }

      const response: CaptureResponse = {
        success: true,
        source: 'omie',
        clientId,
        cycleId,
        transactions: {
          total: payables.length + receivables.length,
          new: result.created.length,
          updated: result.updated.length,
          skipped: result.skipped.length,
        },
        payables: payables.length,
        receivables: receivables.length,
        durationMs: Date.now() - startTime,
      };

      return { status: 200, jsonBody: response };
    } catch (error: any) {
      logger.error('Capture failed', error);

      return {
        status: 500,
        jsonBody: {
          success: false,
          source: 'omie',
          error: error.message,
          durationMs: Date.now() - startTime,
        },
      };
    }
  },
});
