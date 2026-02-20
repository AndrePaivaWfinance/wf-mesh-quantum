/**
 * Capture - inter-ops (integrado ao mesh)
 *
 * POST /api/inter/capture - Captura DDA, PIX, boletos e extrato do Inter
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import * as crypto from 'crypto';
import { getInterClient } from '../adapters/client';
import { CaptureRequest, CaptureResponse, InterDDA, InterPIX, InterBoleto } from '../adapters/types';
import { createLogger, nowISO } from '../shared/utils';
import { getExistingSourceIds, upsertTransactionsIdempotent } from '../../../storage/tableClient';
import { Transaction, TransactionType, TransactionSource, TransactionStatus } from '../../../types';

const logger = createLogger('InterCapture');

function shortHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
}

function ddaToTransaction(dda: InterDDA, clientId: string, cycleId: string): Transaction {
  return {
    id: `inter-dda-${shortHash(dda.codigoBarras)}`,
    clientId,
    type: TransactionType.PAGAR,
    status: TransactionStatus.CAPTURADO,
    source: TransactionSource.INTER,
    valor: dda.valorNominal,
    valorOriginal: dda.valorTotal || dda.valorNominal,
    dataVencimento: dda.dataVencimento,
    descricao: `DDA Inter - ${dda.beneficiario?.nome || 'Boleto'}`,
    descricaoOriginal: `DDA ${dda.codigoBarras}`,
    contraparte: dda.beneficiario?.nome,
    contraparteCnpj: dda.beneficiario?.cpfCnpj,
    codigoBarras: dda.codigoBarras,
    sourceId: dda.codigoBarras,
    sourceName: 'inter',
    rawData: JSON.parse(JSON.stringify(dda)),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    capturedAt: nowISO(),
    cycleId,
  } as any;
}

function pixToTransaction(pix: InterPIX, clientId: string, cycleId: string): Transaction {
  const isPagar = pix.natureza === 'PAGAMENTO';
  return {
    id: `inter-pix-${shortHash(pix.endToEndId || pix.txid || String(Date.now()))}`,
    clientId,
    type: isPagar ? TransactionType.PAGAR : TransactionType.RECEBER,
    status: TransactionStatus.CAPTURADO,
    source: TransactionSource.INTER,
    valor: parseFloat(pix.valor),
    valorOriginal: parseFloat(pix.valor),
    dataVencimento: pix.horario?.split('T')[0],
    descricao: `PIX Inter - ${pix.pagador?.nome || pix.recebedor?.nome || 'Transação'}`,
    descricaoOriginal: pix.infoPagador || `PIX ${pix.endToEndId || pix.txid}`,
    contraparte: isPagar ? pix.recebedor?.nome : pix.pagador?.nome,
    contraparteCnpj: isPagar ? (pix.recebedor?.cnpj || pix.recebedor?.cpf) : (pix.pagador?.cnpj || pix.pagador?.cpf),
    sourceId: pix.endToEndId || pix.txid || '',
    sourceName: 'inter',
    rawData: JSON.parse(JSON.stringify(pix)),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    capturedAt: nowISO(),
    cycleId,
  } as any;
}

function boletoToTransaction(boleto: InterBoleto, clientId: string, cycleId: string): Transaction {
  return {
    id: `inter-boleto-${shortHash(boleto.nossoNumero)}`,
    clientId,
    type: TransactionType.RECEBER,
    status: TransactionStatus.CAPTURADO,
    source: TransactionSource.INTER,
    valor: boleto.valorNominal,
    valorOriginal: boleto.valorNominal,
    dataVencimento: boleto.dataVencimento,
    descricao: `Boleto Inter - ${boleto.pagador?.nome || boleto.seuNumero || 'Cobrança'}`,
    descricaoOriginal: `Boleto ${boleto.nossoNumero}`,
    contraparte: boleto.pagador?.nome,
    contraparteCnpj: boleto.pagador?.cpfCnpj,
    codigoBarras: boleto.codigoBarras,
    nossoNumero: boleto.nossoNumero,
    sourceId: boleto.nossoNumero,
    sourceName: 'inter',
    rawData: JSON.parse(JSON.stringify(boleto)),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    capturedAt: nowISO(),
    cycleId,
  } as any;
}

app.http('inter-capture', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'inter/capture',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const startTime = Date.now();

    try {
      const body = (await req.json()) as CaptureRequest;
      const { clientId, cycleId, startDate, endDate, captureType } = body;

      logger.info('Starting Inter capture', { clientId, cycleId, captureType });

      // Default date range: last 7 days
      const end = endDate || new Date().toISOString().split('T')[0];
      const start =
        startDate ||
        (() => {
          const d = new Date();
          d.setDate(d.getDate() - 7);
          return d.toISOString().split('T')[0];
        })();

      const client = getInterClient();

      // Buscar transações existentes para idempotência
      const existingSourceIds = await getExistingSourceIds(clientId, 'inter');
      logger.info('Existing Inter transactions', { count: existingSourceIds.size });

      const allTransactions: Transaction[] = [];
      let ddaCount = 0;
      let pixCount = 0;
      let boletosCount = 0;
      let extratoCount = 0;
      let comprovantesCount = 0;
      const errors: string[] = [];

      // Capture DDA
      if (!captureType || captureType === 'dda' || captureType === 'all') {
        try {
          const dda = await client.listDDA({ dataInicial: start, dataFinal: end });
          ddaCount = dda.length;
          allTransactions.push(...dda.map(d => ddaToTransaction(d, clientId, cycleId)));
          logger.info('DDA captured', { count: ddaCount });
        } catch (error) {
          errors.push(`DDA: ${String(error)}`);
        }
      }

      // Capture PIX
      if (!captureType || captureType === 'pix' || captureType === 'all') {
        try {
          const pix = await client.listPIX({ dataInicio: start, dataFim: end });
          pixCount = pix.length;
          allTransactions.push(...pix.map(p => pixToTransaction(p, clientId, cycleId)));
          logger.info('PIX captured', { count: pixCount });
        } catch (error) {
          errors.push(`PIX: ${String(error)}`);
        }
      }

      // Capture Boletos
      if (!captureType || captureType === 'boleto' || captureType === 'all') {
        try {
          const boletos = await client.listBoletos({ dataInicial: start, dataFinal: end });
          boletosCount = boletos.length;
          allTransactions.push(...boletos.map(b => boletoToTransaction(b, clientId, cycleId)));
          logger.info('Boletos captured', { count: boletosCount });
        } catch (error) {
          errors.push(`Boletos: ${String(error)}`);
        }
      }

      // Capture Extrato
      if (!captureType || captureType === 'extrato' || captureType === 'all') {
        try {
          const extrato = await client.getExtrato({ dataInicio: start, dataFim: end });
          extratoCount = extrato.length;
          logger.info('Extrato captured', { count: extratoCount });
        } catch (error) {
          errors.push(`Extrato: ${String(error)}`);
        }
      }

      // Capture Comprovantes
      if (captureType === 'all') {
        try {
          const comprovantes = await client.listComprovantes({ dataInicio: start, dataFim: end });
          comprovantesCount = comprovantes.length;
          logger.info('Comprovantes captured', { count: comprovantesCount });
        } catch (error) {
          errors.push(`Comprovantes: ${String(error)}`);
        }
      }

      // Persistir com idempotência
      let result = { created: [] as string[], updated: [] as string[], skipped: [] as string[] };
      if (allTransactions.length > 0) {
        result = await upsertTransactionsIdempotent(allTransactions, existingSourceIds);
        logger.info('Transactions persisted (idempotent)', {
          created: result.created.length,
          updated: result.updated.length,
          skipped: result.skipped.length,
        });
      }

      const totalTransactions = ddaCount + pixCount + boletosCount + extratoCount;

      const response: CaptureResponse = {
        success: errors.length === 0,
        source: 'inter',
        clientId,
        cycleId,
        transactions: {
          total: totalTransactions,
          new: result.created.length,
          updated: result.updated.length,
          skipped: result.skipped.length,
        },
        dda: ddaCount,
        pix: pixCount,
        boletos: boletosCount,
        extrato: extratoCount,
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
          source: 'inter',
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        },
      };
    }
  },
});
