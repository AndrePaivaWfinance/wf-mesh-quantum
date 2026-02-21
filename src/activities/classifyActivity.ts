/**
 * Classify Activity - operacao-head
 *
 * Activity que classifica transações usando IA (OpenAI).
 * Processa em batch as transações capturadas.
 */

import * as df from 'durable-functions';
import { InvocationContext } from '@azure/functions';
import OpenAI from 'openai';
import { createLogger, nowISO } from '../../shared/utils';
import { TransactionType, TransactionStatus, DoubtType } from '../types';
import { getOpenAIClient as getAIClient, DEFAULT_MODEL } from '../ai/openaiClient';
import {
  getTransactionsByStatus,
  updateTransaction,
  createDoubt as createDoubtRecord,
  getCategories,
} from '../storage/tableClient';

const logger = createLogger('ClassifyActivity');

interface ClassifyBatchInput {
  clientId: string;
  cycleId: string;
}

interface ClassifyBatchOutput {
  classified: number;
  needsReview: number;
  errors: number;
}

// Classify batch activity
df.app.activity('classifyBatchActivity', {
  handler: async (
    input: ClassifyBatchInput,
    context: InvocationContext
  ): Promise<ClassifyBatchOutput> => {
    const { clientId, cycleId } = input;

    logger.info('Starting batch classification', { clientId, cycleId });

    try {
      // Get unclassified transactions for this client/cycle
      const transactions = await getUnclassifiedTransactions(clientId, cycleId);

      if (transactions.length === 0) {
        logger.info('No transactions to classify');
        return { classified: 0, needsReview: 0, errors: 0 };
      }

      logger.info(`Found ${transactions.length} transactions to classify`);

      // Get categories for this client
      const categories = await getClientCategories(clientId);

      // Classify each transaction
      let classified = 0;
      let needsReview = 0;
      let errors = 0;

      const openai = getOpenAIClient();

      for (const tx of transactions) {
        try {
          const result = await classifyTransaction(openai, tx, categories);

          if (result.confidence >= 0.8) {
            // Auto-classify
            await updateTransactionCategory(tx.id, result.categoryId, result.categoryName, clientId);
            classified++;
          } else {
            // Send to review
            await createDoubtForReview(tx, result, clientId);
            needsReview++;
          }
        } catch (error) {
          logger.error(`Error classifying transaction ${tx.id}`, error);
          errors++;
        }
      }

      logger.info('Classification completed', { classified, needsReview, errors });

      return { classified, needsReview, errors };
    } catch (error: any) {
      logger.error('Batch classification failed', error);
      return { classified: 0, needsReview: 0, errors: 1 };
    }
  },
});

// Single transaction classify activity
df.app.activity('classifyActivity', {
  handler: async (
    input: {
      transactionId: string;
      clientId: string;
      cycleId: string;
      descricao: string;
      valor: number;
      tipo: 'pagar' | 'receber';
      contraparte?: string;
    },
    context: InvocationContext
  ): Promise<{
    success: boolean;
    categoria?: { id: string; nome: string; confianca: number };
    needsReview: boolean;
    durationMs: number;
  }> => {
    const startTime = Date.now();

    try {
      const categories = await getClientCategories(input.clientId);
      const openai = getOpenAIClient();

      const result = await classifyTransaction(
        openai,
        {
          id: input.transactionId,
          descricao: input.descricao,
          valor: input.valor,
          tipo: input.tipo,
          contraparte: input.contraparte,
        },
        categories
      );

      return {
        success: true,
        categoria: {
          id: result.categoryId,
          nome: result.categoryName,
          confianca: result.confidence,
        },
        needsReview: result.confidence < 0.8,
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      logger.error('Classification failed', error);
      return {
        success: false,
        needsReview: true,
        durationMs: Date.now() - startTime,
      };
    }
  },
});

// Helper functions
function getOpenAIClient(): OpenAI {
  return getAIClient();
}

async function getUnclassifiedTransactions(
  clientId: string,
  cycleId: string
): Promise<any[]> {
  try {
    const txs = await getTransactionsByStatus(clientId, TransactionStatus.CAPTURADO);
    return txs.map(tx => ({
      id: tx.id,
      descricao: tx.descricao,
      valor: tx.valor,
      tipo: tx.type === TransactionType.PAGAR ? 'pagar' : 'receber',
      contraparte: tx.contraparte,
    }));
  } catch (error) {
    logger.error('Failed to get unclassified transactions', error);
    return [];
  }
}

async function getClientCategories(clientId: string): Promise<any[]> {
  try {
    const categories = await getCategories(clientId);
    return categories.map(c => ({
      id: c.id,
      nome: c.nome,
      tipo: c.tipo,
    }));
  } catch (error) {
    logger.error('Failed to get categories from storage, using defaults', error);
    return [
      { id: 'cat-001', nome: 'Fornecedores', tipo: 'despesa' },
      { id: 'cat-002', nome: 'Impostos', tipo: 'despesa' },
      { id: 'cat-003', nome: 'Folha de Pagamento', tipo: 'despesa' },
      { id: 'cat-004', nome: 'Aluguel', tipo: 'despesa' },
      { id: 'cat-005', nome: 'Servicos', tipo: 'despesa' },
      { id: 'cat-006', nome: 'Receita de Vendas', tipo: 'receita' },
      { id: 'cat-007', nome: 'Receita de Servicos', tipo: 'receita' },
      { id: 'cat-008', nome: 'Outras Receitas', tipo: 'receita' },
      { id: 'cat-009', nome: 'Transferencias', tipo: 'transferencia' },
    ];
  }
}

async function classifyTransaction(
  openai: OpenAI,
  transaction: {
    id: string;
    descricao: string;
    valor: number;
    tipo: string;
    contraparte?: string;
  },
  categories: any[]
): Promise<{
  categoryId: string;
  categoryName: string;
  confidence: number;
}> {
  const categoryList = categories
    .map((c) => `- ${c.id}: ${c.nome} (${c.tipo})`)
    .join('\n');

  const prompt = `Classifique a seguinte transação financeira em uma das categorias abaixo.

Transação:
- Descrição: ${transaction.descricao}
- Valor: R$ ${transaction.valor.toFixed(2)}
- Tipo: ${transaction.tipo}
${transaction.contraparte ? `- Contraparte: ${transaction.contraparte}` : ''}

Categorias disponíveis:
${categoryList}

Responda APENAS em JSON com o formato:
{
  "categoryId": "id da categoria",
  "categoryName": "nome da categoria",
  "confidence": 0.0 a 1.0
}`;

  const response = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'Você é um assistente especializado em classificação de transações financeiras. Responda apenas em JSON válido.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content || '{}';
  const result = JSON.parse(content);

  return {
    categoryId: result.categoryId || 'cat-000',
    categoryName: result.categoryName || 'Não classificado',
    confidence: result.confidence || 0.5,
  };
}

async function updateTransactionCategory(
  transactionId: string,
  categoryId: string,
  categoryName: string,
  clientId?: string
): Promise<void> {
  try {
    // We need clientId for the PK; if not provided, try a best-effort update
    if (clientId) {
      await updateTransaction(clientId, transactionId, {
        categoriaId: categoryId,
        categoriaNome: categoryName,
        status: TransactionStatus.CLASSIFICADO,
      });
    }
    logger.info('Updated transaction category', { transactionId, categoryId, categoryName });
  } catch (error) {
    logger.error('Failed to update transaction category', error);
  }
}

async function createDoubtForReview(transaction: any, classification: any, clientId?: string): Promise<void> {
  try {
    await createDoubtRecord({
      id: `doubt-cls-${transaction.id}`,
      clientId: clientId || 'unknown',
      transactionId: transaction.id,
      tipo: DoubtType.CLASSIFICACAO,
      transacao: {
        id: transaction.id,
        descricao: transaction.descricao,
        valor: transaction.valor,
        data: nowISO().split('T')[0],
      },
      sugestaoIA: {
        categoria: classification.categoryName,
        categoriaId: classification.categoryId,
        confianca: classification.confidence,
      },
      opcoes: [],
      status: 'pendente',
      criadoEm: nowISO(),
    });
    logger.info('Created doubt for review', {
      transactionId: transaction.id,
      suggestedCategory: classification.categoryName,
      confidence: classification.confidence,
    });
  } catch (error) {
    logger.error('Failed to create doubt', error);
  }
}
