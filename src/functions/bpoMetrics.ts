/**
 * BPO Metrics API
 *
 * GET /api/bpo/metrics          → Métricas globais
 * GET /api/bpo/metrics/:clientId → Métricas por tenant
 */

import {
    app,
    HttpRequest,
    HttpResponseInit,
    InvocationContext,
} from '@azure/functions';
import { TenantMonitor } from '../infra/monitoring';
import { LearningLoop } from '../learning/learningLoop';
import { nowISO } from '../../shared/utils';

const monitor = new TenantMonitor();
const learningLoop = new LearningLoop();

app.http('bpoMetrics', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'bpo/metrics/{clientId?}',
    handler: async (
        request: HttpRequest,
        context: InvocationContext
    ): Promise<HttpResponseInit> => {
        const clientId = request.params.clientId;
        const date = (request.query.get('date') as string) || undefined;

        try {
            if (clientId) {
                // Per-tenant metrics
                const daily = await monitor.getDailyMetrics(clientId, date);
                const modelMetrics = await learningLoop.evaluateModel(clientId);

                return {
                    status: 200,
                    jsonBody: {
                        clientId,
                        date: date || new Date().toISOString().split('T')[0],
                        timestamp: nowISO(),
                        operational: daily || {
                            transactionsTotal: 0,
                            transactionsAutoApproved: 0,
                            transactionsEscalated: 0,
                            transactionsFailed: 0,
                            avgClassificationLatencyMs: 0,
                            avgMatchingLatencyMs: 0,
                            avgDecisionLatencyMs: 0,
                            rateLimitHits: 0,
                            errorsCount: 0,
                        },
                        aiModel: {
                            accuracy: modelMetrics.accuracy,
                            totalCorrections: modelMetrics.totalCorrections,
                            totalPredictions: modelMetrics.totalPredictions,
                            topConfusedCategories: modelMetrics.topConfusedCategories,
                        },
                    },
                };
            } else {
                // Global metrics
                const global = await monitor.getGlobalMetrics(date);

                return {
                    status: 200,
                    jsonBody: {
                        scope: 'global',
                        date: date || new Date().toISOString().split('T')[0],
                        timestamp: nowISO(),
                        tenants: global.totalTenants,
                        transactions: {
                            total: global.totalTransactions,
                            autoApprovalRate: Math.round(global.autoApprovalRate * 100) + '%',
                        },
                        performance: {
                            avgCycleTimeMs: Math.round(global.avgCycleTime),
                        },
                        errors: {
                            total: global.totalErrors,
                        },
                    },
                };
            }
        } catch (error: any) {
            context.log(`[bpoMetrics] Error: ${error.message}`);
            return {
                status: 500,
                jsonBody: { error: 'Failed to retrieve metrics', detail: error.message },
            };
        }
    },
});
