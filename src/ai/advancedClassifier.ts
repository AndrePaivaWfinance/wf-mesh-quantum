import OpenAI from 'openai';
import { Transaction, ClassificationResult, FeedbackRecord } from '../../shared/types';
import { getOpenAIClient, ADVANCED_MODEL } from './openaiClient';
import { LearningLoop, FeedbackRecord as LearningFeedbackRecord } from '../learning/learningLoop';
import { getTransactionHistory } from '../storage/tableClient';

/**
 * Classificador Avançado (80/20 System)
 *
 * Responsável por classificar transações com alta precisão e aprendizado contínuo.
 */
export class AdvancedClassifier {
    private readonly CONFIDENCE_THRESHOLD_AUTO = 0.85; // 85% para automação
    private readonly MODEL_VERSION = ADVANCED_MODEL;
    private openai: OpenAI;
    private learningLoop: LearningLoop;

    constructor(
        apiKey: string,
        private readonly organizationId?: string
    ) {
        if (!apiKey) throw new Error('OpenAI API Key is required');
        this.openai = getOpenAIClient(apiKey);
        this.learningLoop = new LearningLoop();
    }

    /**
     * Classifica uma única transação
     */
    async classify(transaction: Transaction): Promise<ClassificationResult> {
        // 1. Validar entrada
        if (!transaction || !transaction.descricao) {
            throw new Error('Transação inválida para classificação');
        }

        // 2. Buscar contexto (transações similares anteriores)
        const context = await this.getSimilarTransactions(transaction);

        // 3. Executar classificação IA
        const result = await this.predict(transaction, context);

        // 4. Pós-processamento e regras de negócio
        return this.applyBusinessRules(transaction, result);
    }

    /**
     * Registra feedback humano para o loop de aprendizado
     */
    async learn(feedback: FeedbackRecord): Promise<void> {
        const learningFeedback: LearningFeedbackRecord = {
            transactionId: feedback.transactionId,
            clientId: feedback.clientId,
            originalClassification: {
                categoria: feedback.predictionIA?.categoria || 'Desconhecido',
                confianca: feedback.predictionIA?.confianca || 0,
                explicacao: feedback.predictionIA?.explicacao || '',
                tipoDespesa: 'variavel',
                recorrencia: 'unica',
                alternativas: [],
            },
            humanCorrection: feedback.correcaoHumana?.categoria || feedback.correcaoHumana || '',
            comment: feedback.correcaoHumana?.comentario,
            timestamp: feedback.timestamp,
            userId: feedback.usuario || 'system',
        };

        await this.learningLoop.recordFeedback(learningFeedback);
    }

    /**
     * Busca transações similares para few-shot learning via keyword search no histórico
     */
    private async getSimilarTransactions(current: Transaction): Promise<Transaction[]> {
        try {
            // 1. Buscar exemplos de feedback (correções humanas) para few-shot context
            const feedbackExamples = await this.learningLoop.getExamplesForContext(
                current.clientId,
                5
            );

            // 2. Buscar transações históricas classificadas para keyword matching
            const history = await getTransactionHistory(current.clientId, 50);

            // 3. Filtrar por keyword similarity (descricao/contraparte)
            const keywords = this.extractKeywords(current.descricao);
            const similar = history
                .filter(tx =>
                    tx.categoriaNome && // Só classificadas
                    tx.id !== current.id &&
                    keywords.some(kw =>
                        tx.descricao.toLowerCase().includes(kw) ||
                        (tx.contraparte && tx.contraparte.toLowerCase().includes(kw))
                    )
                )
                .slice(0, 3);

            // 4. Enriquecer com categorias corrigidas do feedback
            for (const fb of feedbackExamples) {
                const existing = similar.find(s => s.id === fb.transactionId);
                if (existing) {
                    existing.categoriaNome = fb.humanCorrection;
                }
            }

            return similar;
        } catch (error) {
            // Fallback silencioso — classificação funciona sem contexto
            return [];
        }
    }

    /**
     * Extrai keywords da descrição para busca por similaridade
     */
    private extractKeywords(text: string): string[] {
        const stopwords = ['de', 'da', 'do', 'para', 'em', 'no', 'na', 'os', 'as', 'um', 'uma', 'e', 'ou', 'com', 'por', 'que', 'pix', 'ted', 'doc'];
        return text
            .toLowerCase()
            .replace(/[^a-záéíóúàâêôãõç\s]/g, '')
            .split(/\s+/)
            .filter(w => w.length > 2 && !stopwords.includes(w));
    }

    /**
     * Chamada ao modelo LLM
     */
    protected async predict(
        transaction: Transaction,
        context: Transaction[]
    ): Promise<ClassificationResult> {

        const contextPrompt = context.length > 0
            ? `\nExemplos similares anteriores:\n${context.map(t => `- "${t.descricao}" -> ${t.categoriaNome}`).join('\n')}`
            : '';

        const systemPrompt = `
      Você é um especialista em contabilidade e classificação financeira para BPO.
      Sua tarefa é analisar uma transação financeira e classificá-la corretamente.
      
      Retorne APENAS um objeto JSON com o seguinte formato:
      {
        "categoria": "Nome da Categoria",
        "centroCusto": "Centro de Custo (opcional)",
        "tipoDespesa": "fixa" | "variavel",
        "recorrencia": "unica" | "mensal" | "anual",
        "confianca": 0.0 a 1.0,
        "alternativas": [
          { "categoria": "Outra Categoria", "confianca": 0.0, "razao": "Motivo" }
        ],
        "explicacao": "Breve explicação do porquê desta classificação"
      }
      
      Analise a descrição, valor e data. Identifique padrões de fornecedores conhecidos (Uber, AWS, Google, Posto, etc).
    `;

        const userPrompt = `
      Transação para classificar:
      Descrição: "${transaction.descricao}"
      Valor: ${transaction.valor}
      Data: ${transaction.dataRealizacao || transaction.dataVencimento || 'N/A'}
      Tipo: ${transaction.type}
      
      ${contextPrompt}
    `;

        try {
            const response = await this.openai.chat.completions.create({
                model: this.MODEL_VERSION,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.1 // Baixa temperatura para maior determinismo
            });

            const content = response.choices[0].message.content;
            if (!content) throw new Error('Resposta vazia da OpenAI');

            const prediction = JSON.parse(content);

            return {
                ...prediction,
                modeloVersion: this.MODEL_VERSION
            };

        } catch (error) {
            console.error('Erro na classificação OpenAI:', error);
            // Fallback seguro
            return {
                categoria: 'A Classificar',
                tipoDespesa: 'variavel',
                recorrencia: 'unica',
                confianca: 0.0,
                alternativas: [],
                explicacao: `Erro na classificação automática: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    /**
     * Aplica regras de negócio determinísticas sobre a previsão da IA
     */
    private applyBusinessRules(
        transaction: Transaction,
        result: ClassificationResult
    ): ClassificationResult {
        // Regra 1: Valor alto requer revisão humana
        if (Math.abs(transaction.valor) > 10000) {
            return {
                ...result,
                confianca: Math.min(result.confianca, 0.79), // Força < 80%
                explicacao: result.explicacao + ' [ALERT: Valor alto (> 10k) requer revisão humana]'
            };
        }

        // Regra 2: Transações "A Classificar" nunca podem ter confiança alta
        if (result.categoria === 'A Classificar' || result.categoria === 'Outras') {
            return {
                ...result,
                confianca: 0.0
            };
        }

        return result;
    }
}
