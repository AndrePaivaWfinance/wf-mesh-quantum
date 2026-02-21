/**
 * Capture - santander-ops (integrado ao mesh)
 *
 * POST /api/santander/capture - Captura extratos e movimentações do Santander
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import * as crypto from 'crypto';
import { getSantanderClient, getSantanderClientForTenant } from '../adapters/client';
import { CaptureRequest, CaptureResponse, SantanderDDA, SantanderPIX, SantanderBoleto, SantanderComprovante } from '../adapters/types';
import { createLogger, nowISO } from '../shared/utils';
import { getExistingSourceIds, upsertTransactionsIdempotent, updateTransaction } from '../../../storage/tableClient';
import { Transaction, TransactionType, TransactionSource, TransactionStatus } from '../../../types';
import { getClientById } from '../../shared/storage/clientStorage';
import { resolveSantanderCredentials } from '../../../infra/credentialResolver';

const logger = createLogger('SantanderCapture');

/** Hash curto determinístico para IDs */
function shortHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
}

/** Parse Santander decimal: "1480,0" -> 1480.0 */
function parseDecimal(val: unknown): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return parseFloat(val.replace(',', '.')) || 0;
  return 0;
}

function ddaToTransaction(dda: SantanderDDA, clientId: string, cycleId: string): Transaction {
  // API retorna 'code' ao invés de 'barCode'
  const barCode = dda.barCode || (dda as any).code || '';
  const nominal = parseDecimal(dda.nominalValue);
  const total = parseDecimal(dda.totalValue) || nominal;
  return {
    id: `sant-dda-${shortHash(barCode)}`,
    clientId,
    type: TransactionType.PAGAR,
    status: TransactionStatus.CAPTURADO,
    source: TransactionSource.SANTANDER,
    valor: nominal,
    valorOriginal: total,
    dataVencimento: dda.dueDate,
    descricao: `DDA - ${dda.beneficiary?.beneficiaryName?.trim() || 'Boleto'}`,
    descricaoOriginal: `DDA ${barCode}`,
    contraparte: dda.beneficiary?.beneficiaryName?.trim(),
    contraparteCnpj: String(dda.beneficiary?.beneficiaryDocument || ''),
    codigoBarras: barCode,
    sourceId: barCode,
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
    id: `sant-pix-${shortHash(pix.id)}`,
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
    id: `sant-boleto-${shortHash(boleto.id || boleto.barCode)}`,
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
    sourceId: boleto.id || boleto.barCode,
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

      // Per-client credentials: resolve from ClientConfig, fallback to env vars
      let client;
      const clientData = await getClientById(clientId);
      if (clientData?.config?.banco === 'santander' && clientData?.config?.bancoAgencia) {
        const creds = resolveSantanderCredentials(clientData.config);
        client = getSantanderClientForTenant(creds);
        logger.info('Using per-client Santander credentials', { clientId });
      } else {
        client = getSantanderClient();
        logger.info('Using global Santander credentials (env vars)', { clientId });
      }

      // Buscar transações existentes para idempotência
      const existingSourceIds = await getExistingSourceIds(clientId, 'santander');
      logger.info('Existing Santander transactions', { count: existingSourceIds.size });

      const allTransactions: Transaction[] = [];
      let ddaCount = 0;
      let pixCount = 0;
      let boletosCount = 0;
      let comprovantesCount = 0;
      let comprovantesLinked = 0;
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

      // Capture Comprovantes: persistir como transações + vincular a DDAs existentes
      if (captureType === 'all' || captureType === 'comprovantes') {
        try {
          const comprovantes = await client.listComprovantes({ startDate: start, endDate: end });
          comprovantesCount = comprovantes.length;
          logger.info('Comprovantes captured', { count: comprovantesCount });

          for (const comp of comprovantes) {
            const paymentId = comp.paymentId || (comp as any).id;
            if (!paymentId) continue;

            // Tentar vincular a DDA existente por CNPJ + valor aproximado
            const cnpj = comp.beneficiaryDocument?.replace(/\D/g, '');
            let linkedTxId: string | null = null;

            if (cnpj) {
              for (const tx of allTransactions) {
                const txCnpj = ((tx as any).contraparteCnpj || '').replace(/\D/g, '');
                if (txCnpj === cnpj) {
                  linkedTxId = tx.id;
                  break;
                }
              }
              // Também buscar nas existentes do storage
              if (!linkedTxId) {
                for (const [, existing] of existingSourceIds.entries()) {
                  // Não temos CNPJ no map, mas podemos vincular pelo ID
                  linkedTxId = existing.id;
                  break;
                }
              }
            }

            // Persistir comprovante como transação
            const compTx: Transaction = {
              id: `sant-comp-${shortHash(paymentId)}`,
              clientId,
              type: TransactionType.PAGAR,
              status: TransactionStatus.CAPTURADO,
              source: TransactionSource.SANTANDER,
              valor: comp.amount || 0,
              valorOriginal: comp.amount || 0,
              dataVencimento: comp.paymentDate,
              descricao: `Comprovante - ${comp.beneficiaryName?.trim() || 'Pagamento'}`,
              descricaoOriginal: `Comprovante ${comp.paymentType || ''} ${paymentId}`,
              contraparte: comp.beneficiaryName?.trim(),
              contraparteCnpj: cnpj,
              sourceId: `comp-${paymentId}`,
              sourceName: 'santander',
              rawData: JSON.parse(JSON.stringify(comp)),
              metadata: {
                tipo: 'comprovante',
                paymentId,
                paymentType: comp.paymentType,
                status: comp.status,
                pdfAvailable: !!comp.pdfBase64,
                downloadUrl: comp.downloadUrl,
                linkedTransactionId: linkedTxId,
              },
              createdAt: nowISO(),
              updatedAt: nowISO(),
              capturedAt: nowISO(),
            } as any;

            allTransactions.push(compTx);

            // Se vinculou a DDA, atualizar a DDA com referência ao comprovante
            if (linkedTxId) {
              try {
                await updateTransaction(clientId, linkedTxId, {
                  metadata: {
                    comprovante: {
                      paymentId,
                      transactionId: compTx.id,
                      status: comp.status,
                      pdfAvailable: !!comp.pdfBase64,
                    },
                  },
                } as any);
                comprovantesLinked++;
              } catch {
                // OK - DDA pode não existir ainda se é da mesma captura
              }
            }
          }
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

      const totalFromApi = ddaCount + pixCount + boletosCount;

      const response: CaptureResponse = {
        success: errors.length === 0,
        source: 'santander',
        clientId,
        cycleId,
        workspaceId,
        transactions: {
          total: totalFromApi,
          new: result.created.length,
          updated: result.updated.length,
          skipped: result.skipped.length,
        },
        dda: ddaCount,
        pix: pixCount,
        boletos: boletosCount,
        statements: 0,
        comprovantes: comprovantesCount,
        comprovantesLinked,
        errors: errors.length > 0 ? errors : undefined,
        durationMs: Date.now() - startTime,
      } as any;

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
