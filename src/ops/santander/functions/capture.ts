/**
 * Capture - santander-ops (integrado ao mesh)
 *
 * POST /api/santander/capture - Captura extratos e movimentações do Santander
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getSantanderClient } from '../adapters/client';
import { CaptureRequest, CaptureResponse, SantanderDDA, SantanderPIX, SantanderBoleto } from '../adapters/types';
import { createLogger, nowISO } from '../shared/utils';
import { createTransactions } from '../../../storage/tableClient';
import { Transaction, TransactionType, TransactionSource, TransactionStatus } from '../../../types';

const logger = createLogger('SantanderCapture');

function ddaToTransaction(dda: SantanderDDA, clientId: string, cycleId: string): Transaction {
  return {
    id: `sant-dda-${dda.barCode.substring(0, 15)}-${Date.now()}`,
    clientId,
    type: TransactionType.PAGAR,
    status: TransactionStatus.CAPTURADO,
    source: TransactionSource.SANTANDER,
    valor: dda.nominalValue,
    valorOriginal: dda.totalValue || dda.nominalValue,
    dataVencimento: dda.dueDate,
    descricao: `DDA - ${dda.beneficiary?.beneficiaryName || 'Boleto'}`,
    descricaoOriginal: `DDA ${dda.barCode}`,
    contraparte: dda.beneficiary?.beneficiaryName,
    contraparteCnpj: dda.beneficiary?.beneficiaryDocument,
    codigoBarras: dda.barCode,
    sourceId: dda.barCode,
    sourceName: 'santander',
    rawData: JSON.parse(JSON.stringify(dda)),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    capturedAt: nowISO(),
    cycleId,
  } as any;
}

function pixToTransaction(pix: SantanderPIX, clientId: string, cycleId: string): Transaction {
  const isPagar = pix.type === 'debit' || pix.type === 'PAYMENT';
  return {
    id: `sant-pix-${pix.id}-${Date.now()}`,
    clientId,
    type: isPagar ? TransactionType.PAGAR : TransactionType.RECEBER,
    status: TransactionStatus.CAPTURADO,
    source: TransactionSource.SANTANDER,
    valor: pix.amount,
    valorOriginal: pix.amount,
    dataVencimento: pix.createdAt?.split('T')[0],
    descricao: `PIX - ${pix.receiverName || pix.description || 'Transação'}`,
    descricaoOriginal: pix.description || `PIX ${pix.id}`,
    contraparte: pix.receiverName,
    contraparteCnpj: pix.receiverDocument,
    sourceId: pix.id,
    sourceName: 'santander',
    rawData: JSON.parse(JSON.stringify(pix)),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    capturedAt: nowISO(),
    cycleId,
  } as any;
}

function boletoToTransaction(boleto: SantanderBoleto, clientId: string, cycleId: string): Transaction {
  return {
    id: `sant-boleto-${boleto.id}-${Date.now()}`,
    clientId,
    type: TransactionType.PAGAR,
    status: TransactionStatus.CAPTURADO,
    source: TransactionSource.SANTANDER,
    valor: boleto.amount,
    valorOriginal: boleto.amount,
    dataVencimento: boleto.dueDate,
    descricao: `Boleto - ${boleto.beneficiaryName || boleto.description || 'Pagamento'}`,
    descricaoOriginal: boleto.description || `Boleto ${boleto.barCode}`,
    contraparte: boleto.beneficiaryName,
    contraparteCnpj: boleto.beneficiaryDocument,
    codigoBarras: boleto.barCode,
    sourceId: boleto.id,
    sourceName: 'santander',
    rawData: JSON.parse(JSON.stringify(boleto)),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    capturedAt: nowISO(),
    cycleId,
  } as any;
}

app.http('santander-capture', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'santander/capture',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const startTime = Date.now();

    try {
      const body = (await req.json()) as CaptureRequest;
      const { clientId, cycleId, startDate, endDate, captureType, workspaceId } = body;

      logger.info('Starting Santander capture', { clientId, cycleId, captureType });

      // Default date range: last 7 days
      const end = endDate || new Date().toISOString().split('T')[0];
      const start =
        startDate ||
        (() => {
          const d = new Date();
          d.setDate(d.getDate() - 7);
          return d.toISOString().split('T')[0];
        })();

      const client = getSantanderClient();

      const allTransactions: Transaction[] = [];
      let ddaCount = 0;
      let pixCount = 0;
      let boletosCount = 0;
      let statementsCount = 0;
      let comprovantesCount = 0;
      const errors: string[] = [];

      // Capture DDA (if requested)
      if (!captureType || captureType === 'dda' || captureType === 'all') {
        try {
          const dda = await client.listDDA({ initialDueDate: start, finalDueDate: end });
          ddaCount = dda.length;
          allTransactions.push(...dda.map(d => ddaToTransaction(d, clientId, cycleId)));
          logger.info('DDA captured', { count: ddaCount });
        } catch (error) {
          errors.push(`DDA: ${String(error)}`);
        }
      }

      // Capture PIX (if requested)
      if (!captureType || captureType === 'pix' || captureType === 'all') {
        try {
          const pix = await client.listPIX();
          pixCount = pix.length;
          allTransactions.push(...pix.map(p => pixToTransaction(p, clientId, cycleId)));
          logger.info('PIX captured', { count: pixCount });
        } catch (error) {
          errors.push(`PIX: ${String(error)}`);
        }
      }

      // Capture Boletos (if requested)
      if (!captureType || captureType === 'boleto' || captureType === 'all') {
        try {
          const boletos = await client.listBoletos();
          boletosCount = boletos.length;
          allTransactions.push(...boletos.map(b => boletoToTransaction(b, clientId, cycleId)));
          logger.info('Boletos captured', { count: boletosCount });
        } catch (error) {
          errors.push(`Boletos: ${String(error)}`);
        }
      }

      // Capture Comprovantes (if requested)
      if (captureType === 'all') {
        try {
          const comprovantes = await client.listComprovantes({ startDate: start, endDate: end });
          comprovantesCount = comprovantes.length;
          logger.info('Comprovantes captured', { count: comprovantesCount });
        } catch (error) {
          errors.push(`Comprovantes: ${String(error)}`);
        }
      }

      // Persist to mesh storage
      let storedIds: string[] = [];
      if (allTransactions.length > 0) {
        storedIds = await createTransactions(allTransactions);
        logger.info('Transactions stored in mesh', { stored: storedIds.length });
      }

      const totalTransactions = ddaCount + pixCount + boletosCount + statementsCount;

      const response: CaptureResponse = {
        success: errors.length === 0,
        source: 'santander',
        clientId,
        cycleId,
        workspaceId,
        transactions: {
          total: totalTransactions,
          new: storedIds.length,
          updated: 0,
          skipped: totalTransactions - storedIds.length,
        },
        dda: ddaCount,
        pix: pixCount,
        boletos: boletosCount,
        statements: statementsCount,
        comprovantes: comprovantesCount,
        errors: errors.length > 0 ? errors : undefined,
        durationMs: Date.now() - startTime,
      };

      return { status: errors.length > 0 ? 207 : 200, jsonBody: response };
    } catch (error: unknown) {
      logger.error('Capture failed', error);

      return {
        status: 500,
        jsonBody: {
          success: false,
          source: 'santander',
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        },
      };
    }
  },
});
