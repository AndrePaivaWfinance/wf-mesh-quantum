/**
 * Capture - controlle-ops (integrado ao mesh)
 *
 * POST /api/controlle/capture - Captura dados do Controlle e persiste no storage do mesh
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import * as crypto from 'crypto';
import { getControlleClient } from '../adapters/client';
import { CaptureRequest, CaptureResponse, ControllePayable, ControlleReceivable } from '../adapters/types';
import { createLogger } from '../shared/utils';
import { getExistingSourceIds, upsertTransactionsIdempotent } from '../../../storage/tableClient';
import { Transaction, TransactionType, TransactionSource, TransactionStatus } from '../../../types';

const logger = createLogger('ControlleCapture');

function nowISO(): string {
  return new Date().toISOString();
}

function shortHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
}

function payableToTransaction(p: ControllePayable, clientId: string, cycleId: string): Transaction {
  return {
    id: `ctrl-pagar-${shortHash(p.id)}`,
    clientId,
    type: TransactionType.PAGAR,
    status: TransactionStatus.CAPTURADO,
    source: TransactionSource.CONTROLLE,
    valor: p.value,
    valorOriginal: p.value,
    dataVencimento: p.dueDate,
    descricao: p.description,
    descricaoOriginal: p.description,
    contraparte: p.supplier,
    categoriaId: p.categoryId,
    categoriaNome: p.category,
    sourceId: p.id,
    sourceName: 'controlle',
    rawData: JSON.parse(JSON.stringify(p)),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    capturedAt: nowISO(),
    cycleId,
  } as any;
}

function receivableToTransaction(r: ControlleReceivable, clientId: string, cycleId: string): Transaction {
  return {
    id: `ctrl-receber-${shortHash(r.id)}`,
    clientId,
    type: TransactionType.RECEBER,
    status: TransactionStatus.CAPTURADO,
    source: TransactionSource.CONTROLLE,
    valor: r.value,
    valorOriginal: r.value,
    dataVencimento: r.dueDate,
    descricao: r.description,
    descricaoOriginal: r.description,
    contraparte: r.customer,
    categoriaId: r.categoryId,
    categoriaNome: r.category,
    sourceId: r.id,
    sourceName: 'controlle',
    rawData: JSON.parse(JSON.stringify(r)),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    capturedAt: nowISO(),
    cycleId,
  } as any;
}

app.http('controlle-capture', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'controlle/capture',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const startTime = Date.now();

    try {
      const body = (await req.json()) as CaptureRequest;
      const { clientId, cycleId, startDate, endDate } = body;

      logger.info('Starting Controlle capture', { clientId, cycleId });

      // Default date range: last 7 days
      const end = endDate || new Date().toISOString().split('T')[0];
      const start = startDate || (() => {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        return d.toISOString().split('T')[0];
      })();

      const client = getControlleClient();

      // Buscar transações existentes para idempotência
      const existingSourceIds = await getExistingSourceIds(clientId, 'controlle');
      logger.info('Existing Controlle transactions', { count: existingSourceIds.size });

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
        source: 'controlle',
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
          source: 'controlle',
          error: error.message,
          durationMs: Date.now() - startTime,
        },
      };
    }
  },
});
