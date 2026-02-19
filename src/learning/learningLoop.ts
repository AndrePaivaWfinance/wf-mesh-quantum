/**
 * LearningLoop - Feedback & Melhoria Contínua
 *
 * Registra feedback humano (correções de classificação IA) e
 * armazena em Azure Table Storage para aprendizado contínuo.
 *
 * Tabela: OperacaoFeedback
 * PK: clientId | RK: transactionId-timestamp
 */

import { TableClient, TableEntity } from '@azure/data-tables';
import { ClassificationResult } from '../../shared/types';
import { createLogger } from '../../shared/utils';

const logger = createLogger('LearningLoop');

const TABLE_NAME = 'OperacaoFeedback';

export interface FeedbackRecord {
    transactionId: string;
    clientId: string;
    originalClassification: ClassificationResult;
    humanCorrection: string; // Categoria correta
    comment?: string;
    timestamp: string;
    userId: string;
}

export interface ModelMetrics {
    accuracy: number;
    totalCorrections: number;
    totalPredictions: number;
    topConfusedCategories: Array<{ predicted: string; actual: string; count: number }>;
}

export class LearningLoop {
    private tableClient: TableClient | null = null;
    private useStorage: boolean;
    // In-memory fallback
    private feedbackStore: FeedbackRecord[] = [];

    constructor() {
        const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
        this.useStorage = !!connStr;

        if (connStr) {
            this.tableClient = TableClient.fromConnectionString(connStr, TABLE_NAME);
            this.tableClient.createTable().catch(() => { });
        } else {
            logger.warn('No storage connection string. Using in-memory feedback store.');
        }
    }

    async recordFeedback(feedback: FeedbackRecord): Promise<void> {
        logger.info(`Recording correction: ${feedback.transactionId} → ${feedback.humanCorrection}`);

        if (this.useStorage && this.tableClient) {
            const entity: TableEntity = {
                partitionKey: feedback.clientId,
                rowKey: `${feedback.transactionId}-${Date.now()}`,
                transactionId: feedback.transactionId,
                originalCategoria: feedback.originalClassification.categoria,
                originalConfianca: feedback.originalClassification.confianca,
                humanCorrection: feedback.humanCorrection,
                comment: feedback.comment || '',
                userId: feedback.userId,
                timestamp: feedback.timestamp,
            };

            await this.tableClient.createEntity(entity);
        } else {
            this.feedbackStore.push(feedback);
        }
    }

    async getClientFeedback(clientId: string, limit: number = 50): Promise<FeedbackRecord[]> {
        if (this.useStorage && this.tableClient) {
            const records: FeedbackRecord[] = [];
            const entities = this.tableClient.listEntities<TableEntity>({
                queryOptions: { filter: `PartitionKey eq '${clientId}'` },
            });

            for await (const entity of entities) {
                records.push({
                    transactionId: entity.transactionId as string,
                    clientId: entity.partitionKey as string,
                    originalClassification: {
                        categoria: entity.originalCategoria as string,
                        confianca: entity.originalConfianca as number,
                        explicacao: '',
                        tipoDespesa: 'variavel',
                        recorrencia: 'unica',
                        alternativas: [],
                    },
                    humanCorrection: entity.humanCorrection as string,
                    comment: entity.comment as string,
                    timestamp: entity.timestamp as string,
                    userId: entity.userId as string,
                });

                if (records.length >= limit) break;
            }

            return records;
        }

        return this.feedbackStore
            .filter(f => f.clientId === clientId)
            .slice(-limit);
    }

    async getExamplesForContext(clientId: string, limit: number = 3): Promise<FeedbackRecord[]> {
        // Returns most recent corrections for few-shot prompting
        const feedback = await this.getClientFeedback(clientId, limit);
        return feedback;
    }

    async evaluateModel(clientId?: string): Promise<ModelMetrics> {
        let records: FeedbackRecord[];

        if (clientId) {
            records = await this.getClientFeedback(clientId, 1000);
        } else if (this.useStorage) {
            // Without clientId, we'd need a full scan. For now, return empty.
            records = [];
        } else {
            records = this.feedbackStore;
        }

        if (records.length === 0) {
            return { accuracy: 1, totalCorrections: 0, totalPredictions: 0, topConfusedCategories: [] };
        }

        // Build confusion matrix
        const confusionMap = new Map<string, number>();
        let correctCount = 0;

        records.forEach(f => {
            if (f.originalClassification.categoria === f.humanCorrection) {
                correctCount++;
            }
            const key = `${f.originalClassification.categoria}|${f.humanCorrection}`;
            confusionMap.set(key, (confusionMap.get(key) || 0) + 1);
        });

        const topConfused = Array.from(confusionMap.entries())
            .filter(([key]) => {
                const [predicted, actual] = key.split('|');
                return predicted !== actual; // Only show misclassifications
            })
            .map(([key, count]) => {
                const [predicted, actual] = key.split('|');
                return { predicted, actual, count };
            })
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        return {
            accuracy: records.length > 0 ? correctCount / records.length : 1,
            totalCorrections: records.length,
            totalPredictions: records.length * 5, // Estimate: ~20% review rate
            topConfusedCategories: topConfused,
        };
    }
}
