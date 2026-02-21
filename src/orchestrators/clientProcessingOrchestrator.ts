import * as df from 'durable-functions';
import { OrchestrationContext, OrchestrationHandler } from 'durable-functions';
import { CycleStatus } from '../types';

/**
 * Client Processing Orchestrator (Sub-Orchestrator)
 * 
 * Executa o ciclo de vida completo de um cliente (80/20 Logic):
 * 1. Check Tenant Config & Limits
 * 2. Capture (Ingest)
 * 3. Classify (AI)
 * 4. Detect Anomalies
 * 5. Match
 * 6. Decide
 * 7. Sync / Notify
 */
export interface ClientProcessingInput {
    clientId: string;
    cycleId: string;
    date: string;
    force: boolean;
}

const clientOrchestrator: OrchestrationHandler = function* (context: OrchestrationContext) {
    const input = context.df.getInput() as ClientProcessingInput;
    const { clientId, cycleId, date } = input;

    try {
        // 1. Get Tenant Config & Check Limits
        const tenantConfig = yield context.df.callActivity('getTenantConfigActivity', { clientId });

        // Check Rate Limit (Activity wrapper for RateLimiter)
        const allowed = yield context.df.callActivity('checkRateLimitActivity', {
            clientId,
            limitType: 'daily_transactions',
            limit: tenantConfig.limits.maxTransactionsPerDay
        });

        if (!allowed) {
            throw new Error(`Rate limit exceeded for client ${clientId}`);
        }

        // 2. Capture (Fan-out) — sources derivados da config do cliente
        const sources: string[] = tenantConfig.sources && tenantConfig.sources.length > 0
            ? tenantConfig.sources
            : ['nibo', 'santander', 'getnet']; // fallback seguro
        const captureTasks = sources.map(source =>
            context.df.callActivity('captureActivity', { clientId, cycleId, source })
        );
        const captureResults = yield context.df.Task.all(captureTasks);

        // 3. AI Processing Pipeline (New Activity)
        // This activity will use AdvancedClassifier, AnomalyDetector, SmartMatcher, DecisionEngine internally
        const aiResult = yield context.df.callActivity('aiProcessingActivity', {
            clientId,
            cycleId,
            captureResults
        });

        // 4. Sync (Only for approved transactions)
        if (aiResult.syncCandidates.length > 0) {
            yield context.df.callActivity('syncBatchActivity', {
                clientId,
                cycleId,
                transactions: aiResult.syncCandidates
            });
        }

        // 5. Notify (Daily Summary)
        const summaryData = {
            processed: aiResult.processedCount || 0,
            autoApproved: aiResult.autoApprovedCount || 0,
            needsReview: (aiResult.processedCount || 0) - (aiResult.autoApprovedCount || 0),
            anomalies: aiResult.results ? aiResult.results.filter((r: any) => r.anomalies && r.anomalies.length > 0).length : 0,
            totalValue: 0 // TODO: Sum from transactions
        };

        yield context.df.callActivity('sendDailySummaryActivity', {
            clientId,
            summary: summaryData
        });

        // 6. Check for Critical Alerts
        if (aiResult.results) {
            for (const res of aiResult.results) {
                if (res.anomalies) {
                    for (const anomaly of res.anomalies) {
                        if (anomaly.severidade === 'alta' || anomaly.severidade === 'critica') {
                            yield context.df.callActivity('sendAlertActivity', {
                                clientId,
                                alert: {
                                    title: `Anomalia Crítica Detectada`,
                                    message: `${anomaly.razao} (Transação: ${res.transactionId})`,
                                    severity: anomaly.severidade,
                                    transactionId: res.transactionId
                                }
                            });
                        }
                    }
                }
            }
        }

        return {
            status: 'success',
            clientId,
            details: aiResult
        };

    } catch (error: any) {
        context.log(`[Error] Processing client ${clientId}: ${error.message}`);
        return {
            status: 'failed',
            clientId,
            error: error.message
        };
    }
};

df.app.orchestration('clientProcessingOrchestrator', clientOrchestrator);
