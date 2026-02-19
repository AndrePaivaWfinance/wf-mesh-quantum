/**
 * TenantMonitor - Monitoramento por Tenant
 *
 * Registra métricas de processamento por cliente:
 * - Transações processadas
 * - Latência de cada fase (classificação, matching, decisão)
 * - Erros e rate limit hits
 *
 * Tabela: OperacaoMetrics
 * PK: clientId | RK: YYYY-MM-DD
 */

import { TableClient, TableEntity } from '@azure/data-tables';
import { createLogger, nowISO } from '../../shared/utils';

const logger = createLogger('TenantMonitor');

const TABLE_NAME = 'OperacaoMetrics';

export interface DailyMetrics {
    clientId: string;
    date: string;
    transactionsTotal: number;
    transactionsAutoApproved: number;
    transactionsEscalated: number;
    transactionsFailed: number;
    avgClassificationLatencyMs: number;
    avgMatchingLatencyMs: number;
    avgDecisionLatencyMs: number;
    totalCycleTimeMs: number;
    rateLimitHits: number;
    errorsCount: number;
    lastError?: string;
    accuracy?: number;
    updatedAt: string;
}

export class TenantMonitor {
    private tableClient: TableClient | null = null;
    private useStorage: boolean;
    private inMemoryMetrics: Map<string, DailyMetrics> = new Map();

    constructor() {
        const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
        this.useStorage = !!connStr;

        if (connStr) {
            this.tableClient = TableClient.fromConnectionString(connStr, TABLE_NAME);
            this.tableClient.createTable().catch(() => { });
        } else {
            logger.warn('No storage connection. Using in-memory metrics.');
        }
    }

    async recordCycleResult(clientId: string, result: {
        transactionsTotal: number;
        autoApproved: number;
        escalated: number;
        failed: number;
        classificationLatencyMs: number;
        matchingLatencyMs: number;
        decisionLatencyMs: number;
        totalCycleTimeMs: number;
    }): Promise<void> {
        const date = new Date().toISOString().split('T')[0];
        const key = `${clientId}:${date}`;

        const existing = await this.getDailyMetrics(clientId, date);
        const cycleCount = existing ? Math.max(existing.transactionsTotal / 10, 1) : 0;

        const metrics: DailyMetrics = {
            clientId,
            date,
            transactionsTotal: (existing?.transactionsTotal || 0) + result.transactionsTotal,
            transactionsAutoApproved: (existing?.transactionsAutoApproved || 0) + result.autoApproved,
            transactionsEscalated: (existing?.transactionsEscalated || 0) + result.escalated,
            transactionsFailed: (existing?.transactionsFailed || 0) + result.failed,
            avgClassificationLatencyMs: this.runningAvg(
                existing?.avgClassificationLatencyMs || 0, result.classificationLatencyMs, cycleCount
            ),
            avgMatchingLatencyMs: this.runningAvg(
                existing?.avgMatchingLatencyMs || 0, result.matchingLatencyMs, cycleCount
            ),
            avgDecisionLatencyMs: this.runningAvg(
                existing?.avgDecisionLatencyMs || 0, result.decisionLatencyMs, cycleCount
            ),
            totalCycleTimeMs: (existing?.totalCycleTimeMs || 0) + result.totalCycleTimeMs,
            rateLimitHits: existing?.rateLimitHits || 0,
            errorsCount: existing?.errorsCount || 0,
            updatedAt: nowISO(),
        };

        await this.upsertMetrics(metrics);
    }

    async recordRateLimitHit(clientId: string): Promise<void> {
        const date = new Date().toISOString().split('T')[0];
        const existing = await this.getDailyMetrics(clientId, date);

        if (existing) {
            existing.rateLimitHits += 1;
            existing.updatedAt = nowISO();
            await this.upsertMetrics(existing);
        }
    }

    async recordError(clientId: string, error: string): Promise<void> {
        const date = new Date().toISOString().split('T')[0];
        const existing = await this.getDailyMetrics(clientId, date);

        if (existing) {
            existing.errorsCount += 1;
            existing.lastError = error.substring(0, 500);
            existing.updatedAt = nowISO();
            await this.upsertMetrics(existing);
        }
    }

    async getDailyMetrics(clientId: string, date?: string): Promise<DailyMetrics | null> {
        const d = date || new Date().toISOString().split('T')[0];

        if (this.useStorage && this.tableClient) {
            try {
                const entity = await this.tableClient.getEntity<TableEntity>(clientId, d);
                return this.entityToMetrics(entity);
            } catch (err: any) {
                if (err.statusCode === 404) return null;
                throw err;
            }
        }

        return this.inMemoryMetrics.get(`${clientId}:${d}`) || null;
    }

    async getGlobalMetrics(date?: string): Promise<{
        totalTenants: number;
        totalTransactions: number;
        autoApprovalRate: number;
        avgCycleTime: number;
        totalErrors: number;
    }> {
        const d = date || new Date().toISOString().split('T')[0];
        let allMetrics: DailyMetrics[] = [];

        if (this.useStorage && this.tableClient) {
            const entities = this.tableClient.listEntities<TableEntity>({
                queryOptions: { filter: `RowKey eq '${d}'` },
            });
            for await (const entity of entities) {
                allMetrics.push(this.entityToMetrics(entity));
            }
        } else {
            allMetrics = Array.from(this.inMemoryMetrics.values())
                .filter(m => m.date === d);
        }

        if (allMetrics.length === 0) {
            return { totalTenants: 0, totalTransactions: 0, autoApprovalRate: 1, avgCycleTime: 0, totalErrors: 0 };
        }

        const totalTx = allMetrics.reduce((sum, m) => sum + m.transactionsTotal, 0);
        const totalAuto = allMetrics.reduce((sum, m) => sum + m.transactionsAutoApproved, 0);
        const totalCycle = allMetrics.reduce((sum, m) => sum + m.totalCycleTimeMs, 0);
        const totalErrors = allMetrics.reduce((sum, m) => sum + m.errorsCount, 0);

        return {
            totalTenants: allMetrics.length,
            totalTransactions: totalTx,
            autoApprovalRate: totalTx > 0 ? totalAuto / totalTx : 1,
            avgCycleTime: totalCycle / allMetrics.length,
            totalErrors,
        };
    }

    private async upsertMetrics(metrics: DailyMetrics): Promise<void> {
        const key = `${metrics.clientId}:${metrics.date}`;

        if (this.useStorage && this.tableClient) {
            const entity: TableEntity = {
                partitionKey: metrics.clientId,
                rowKey: metrics.date,
                ...metrics,
            };
            await this.tableClient.upsertEntity(entity, 'Merge');
        } else {
            this.inMemoryMetrics.set(key, metrics);
        }
    }

    private entityToMetrics(entity: TableEntity): DailyMetrics {
        return {
            clientId: entity.partitionKey as string,
            date: entity.rowKey as string,
            transactionsTotal: (entity.transactionsTotal as number) || 0,
            transactionsAutoApproved: (entity.transactionsAutoApproved as number) || 0,
            transactionsEscalated: (entity.transactionsEscalated as number) || 0,
            transactionsFailed: (entity.transactionsFailed as number) || 0,
            avgClassificationLatencyMs: (entity.avgClassificationLatencyMs as number) || 0,
            avgMatchingLatencyMs: (entity.avgMatchingLatencyMs as number) || 0,
            avgDecisionLatencyMs: (entity.avgDecisionLatencyMs as number) || 0,
            totalCycleTimeMs: (entity.totalCycleTimeMs as number) || 0,
            rateLimitHits: (entity.rateLimitHits as number) || 0,
            errorsCount: (entity.errorsCount as number) || 0,
            lastError: entity.lastError as string | undefined,
            accuracy: entity.accuracy as number | undefined,
            updatedAt: (entity.updatedAt as string) || '',
        };
    }

    private runningAvg(existing: number, newVal: number, count: number): number {
        if (count === 0) return newVal;
        return (existing * count + newVal) / (count + 1);
    }
}
