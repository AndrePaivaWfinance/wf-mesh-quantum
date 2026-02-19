/**
 * AI Classifier - operacao-head
 *
 * Classificador de transações financeiras usando OpenAI.
 * Responsável por categorizar transações automaticamente.
 */

import OpenAI from 'openai';
import { createLogger } from '../../shared/utils';
import { TransactionType, Category } from '../types';
import { getOpenAIClient, DEFAULT_MODEL } from './openaiClient';

const logger = createLogger('AIClassifier');

// ============================================================================
// INTERFACES
// ============================================================================

export interface ClassificationInput {
  descricao: string;
  valor: number;
  tipo: TransactionType;
  contraparte?: string;
  dataVencimento?: string;
  fonte?: string;
}

export interface ClassificationResult {
  categoryId: string;
  categoryName: string;
  confidence: number;
  reasoning?: string;
}

export interface ClassifierConfig {
  model: string;
  temperature: number;
  confidenceThreshold: number;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: ClassifierConfig = {
  model: DEFAULT_MODEL,
  temperature: 0.3,
  confidenceThreshold: 0.8,
};

// ============================================================================
// DEFAULT CATEGORIES
// ============================================================================

export const DEFAULT_CATEGORIES: Category[] = [
  // Despesas
  { id: 'desp-001', clientId: 'DEFAULT', codigo: '1.1', nome: 'Fornecedores', tipo: 'despesa', nivel: 1, ativo: true },
  { id: 'desp-002', clientId: 'DEFAULT', codigo: '1.2', nome: 'Impostos e Taxas', tipo: 'despesa', nivel: 1, ativo: true },
  { id: 'desp-003', clientId: 'DEFAULT', codigo: '1.3', nome: 'Folha de Pagamento', tipo: 'despesa', nivel: 1, ativo: true },
  { id: 'desp-004', clientId: 'DEFAULT', codigo: '1.4', nome: 'Aluguel e Condomínio', tipo: 'despesa', nivel: 1, ativo: true },
  { id: 'desp-005', clientId: 'DEFAULT', codigo: '1.5', nome: 'Energia e Água', tipo: 'despesa', nivel: 1, ativo: true },
  { id: 'desp-006', clientId: 'DEFAULT', codigo: '1.6', nome: 'Telefone e Internet', tipo: 'despesa', nivel: 1, ativo: true },
  { id: 'desp-007', clientId: 'DEFAULT', codigo: '1.7', nome: 'Material de Escritório', tipo: 'despesa', nivel: 1, ativo: true },
  { id: 'desp-008', clientId: 'DEFAULT', codigo: '1.8', nome: 'Marketing e Publicidade', tipo: 'despesa', nivel: 1, ativo: true },
  { id: 'desp-009', clientId: 'DEFAULT', codigo: '1.9', nome: 'Serviços Terceirizados', tipo: 'despesa', nivel: 1, ativo: true },
  { id: 'desp-010', clientId: 'DEFAULT', codigo: '1.10', nome: 'Tarifas Bancárias', tipo: 'despesa', nivel: 1, ativo: true },
  { id: 'desp-011', clientId: 'DEFAULT', codigo: '1.11', nome: 'Despesas Diversas', tipo: 'despesa', nivel: 1, ativo: true },

  // Receitas
  { id: 'rec-001', clientId: 'DEFAULT', codigo: '2.1', nome: 'Vendas de Produtos', tipo: 'receita', nivel: 1, ativo: true },
  { id: 'rec-002', clientId: 'DEFAULT', codigo: '2.2', nome: 'Prestação de Serviços', tipo: 'receita', nivel: 1, ativo: true },
  { id: 'rec-003', clientId: 'DEFAULT', codigo: '2.3', nome: 'Receitas Financeiras', tipo: 'receita', nivel: 1, ativo: true },
  { id: 'rec-004', clientId: 'DEFAULT', codigo: '2.4', nome: 'Outras Receitas', tipo: 'receita', nivel: 1, ativo: true },

  // Transferências
  { id: 'transf-001', clientId: 'DEFAULT', codigo: '3.1', nome: 'Transferência entre Contas', tipo: 'transferencia', nivel: 1, ativo: true },
  { id: 'transf-002', clientId: 'DEFAULT', codigo: '3.2', nome: 'Aplicação Financeira', tipo: 'transferencia', nivel: 1, ativo: true },
  { id: 'transf-003', clientId: 'DEFAULT', codigo: '3.3', nome: 'Resgate de Aplicação', tipo: 'transferencia', nivel: 1, ativo: true },
];

// ============================================================================
// CLASSIFIER CLASS
// ============================================================================

export class TransactionClassifier {
  private openai: OpenAI;
  private config: ClassifierConfig;
  private categories: Category[];

  constructor(
    apiKey: string,
    categories: Category[] = DEFAULT_CATEGORIES,
    config: Partial<ClassifierConfig> = {}
  ) {
    this.openai = getOpenAIClient(apiKey);
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.categories = categories;
  }

  /**
   * Classifica uma transação
   */
  async classify(input: ClassificationInput): Promise<ClassificationResult> {
    logger.info('Classifying transaction', {
      descricao: input.descricao.substring(0, 50),
      tipo: input.tipo,
    });

    // Filter categories by transaction type
    const relevantCategories = this.filterCategoriesByType(input.tipo);

    if (relevantCategories.length === 0) {
      logger.warn('No relevant categories found');
      return {
        categoryId: 'unknown',
        categoryName: 'Não classificado',
        confidence: 0,
      };
    }

    // Build prompt
    const prompt = this.buildPrompt(input, relevantCategories);

    try {
      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt(),
          },
          { role: 'user', content: prompt },
        ],
        temperature: this.config.temperature,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content || '{}';
      const result = JSON.parse(content);

      logger.info('Classification result', {
        categoryId: result.categoryId,
        confidence: result.confidence,
      });

      return {
        categoryId: result.categoryId || 'unknown',
        categoryName: result.categoryName || 'Não classificado',
        confidence: result.confidence || 0.5,
        reasoning: result.reasoning,
      };
    } catch (error) {
      logger.error('Classification failed', error);
      throw error;
    }
  }

  /**
   * Classifica múltiplas transações em batch
   */
  async classifyBatch(
    inputs: ClassificationInput[]
  ): Promise<ClassificationResult[]> {
    logger.info(`Classifying batch of ${inputs.length} transactions`);

    const results: ClassificationResult[] = [];

    for (const input of inputs) {
      try {
        const result = await this.classify(input);
        results.push(result);
      } catch (error) {
        results.push({
          categoryId: 'error',
          categoryName: 'Erro na classificação',
          confidence: 0,
        });
      }
    }

    return results;
  }

  /**
   * Verifica se a classificação precisa de revisão humana
   */
  needsReview(result: ClassificationResult): boolean {
    return result.confidence < this.config.confidenceThreshold;
  }

  // Private methods

  private filterCategoriesByType(tipo: TransactionType): Category[] {
    const tipoMap: Record<string, Category['tipo'][]> = {
      [TransactionType.PAGAR]: ['despesa'],
      [TransactionType.RECEBER]: ['receita'],
      [TransactionType.TRANSFERENCIA]: ['transferencia'],
      [TransactionType.EXTRATO]: ['despesa', 'receita', 'transferencia'],
    };

    const tipos = tipoMap[tipo] || ['despesa', 'receita'];
    return this.categories.filter((c) => tipos.includes(c.tipo) && c.ativo);
  }

  private buildPrompt(
    input: ClassificationInput,
    categories: Category[]
  ): string {
    const categoryList = categories
      .map((c) => `- ${c.id}: ${c.nome} (${c.codigo})`)
      .join('\n');

    return `Classifique a seguinte transação financeira em uma das categorias abaixo.

TRANSAÇÃO:
- Descrição: ${input.descricao}
- Valor: R$ ${Math.abs(input.valor).toFixed(2)}
- Tipo: ${input.tipo}
${input.contraparte ? `- Contraparte: ${input.contraparte}` : ''}
${input.dataVencimento ? `- Data: ${input.dataVencimento}` : ''}
${input.fonte ? `- Fonte: ${input.fonte}` : ''}

CATEGORIAS DISPONÍVEIS:
${categoryList}

Responda em JSON com o formato:
{
  "categoryId": "id da categoria mais adequada",
  "categoryName": "nome da categoria",
  "confidence": 0.0 a 1.0 (confiança na classificação),
  "reasoning": "breve explicação do motivo da classificação"
}`;
  }

  private getSystemPrompt(): string {
    return `Você é um assistente especializado em classificação de transações financeiras para empresas brasileiras.

REGRAS:
1. Sempre classifique na categoria mais específica possível
2. Use a descrição e contraparte para identificar o tipo de despesa/receita
3. Considere palavras-chave comuns:
   - "ENERGIA", "LUZ", "CEMIG", "CPFL" → Energia e Água
   - "ALUGUEL", "CONDOMÍNIO" → Aluguel e Condomínio
   - "FGTS", "INSS", "IRRF", "SALÁRIO" → Folha de Pagamento
   - "DAS", "SIMPLES", "ICMS", "ISS" → Impostos e Taxas
   - "PIX RECEBIDO", "CRÉDITO" → Verificar contexto
   - "TARIFA", "IOF", "TED", "DOC" → Tarifas Bancárias

4. Se a descrição for ambígua, dê confiança menor
5. Responda APENAS em JSON válido`;
  }
}

// ============================================================================
// FACTORY
// ============================================================================

let classifierInstance: TransactionClassifier | null = null;

export function getClassifier(
  categories?: Category[],
  config?: Partial<ClassifierConfig>
): TransactionClassifier {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY não configurada');
  }

  if (!classifierInstance) {
    classifierInstance = new TransactionClassifier(apiKey, categories, config);
  }

  return classifierInstance;
}
