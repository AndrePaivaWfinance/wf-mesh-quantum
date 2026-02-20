import * as df from 'durable-functions';
import { InvocationContext } from "@azure/functions";
import { AdvancedClassifier } from "../ai/advancedClassifier";
import { AnomalyDetector } from "../ai/anomalyDetector";
import { SmartMatcher } from "../ai/smartMatcher";
import { DecisionEngine } from "../ai/decisionEngine";
import { Transaction, TransactionStatus, TransactionType, DoubtType, ClassificationResult, Anomaly, Decision } from "../../shared/types";
import {
    getTransactionsByStatus,
    getTransactionHistory,
    updateTransaction,
    createAuthorization,
    createDoubt,
    addHistoryAction,
} from "../storage/tableClient";
import { nowISO } from "../../shared/utils";

interface AIProcessingInput {
    clientId: string;
    cycleId: string;
    captureResults: any[];
}

interface AIProcessingOutput {
    processedCount: number;
    autoApprovedCount: number;
    syncCandidates: Transaction[];
    results: any[];
}

export async function aiProcessingActivity(input: AIProcessingInput, context: InvocationContext): Promise<AIProcessingOutput> {
    const { clientId, captureResults } = input;

    // 1. Initialize AI Components
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        context.log('[AI Pipeline] OPENAI_API_KEY not found. Using mock mode.');
    }

    // Instantiate with or without key (Classifier handles internal logic)
    const classifier = new AdvancedClassifier(apiKey || 'mock-key');
    const anomalyDetector = new AnomalyDetector();
    const matcher = new SmartMatcher();
    const decisionEngine = new DecisionEngine();

    // 2. Get transactions from storage (CAPTURADO status) + flatten capture results
    let allTransactions: Transaction[] = [];

    // Load persisted transactions from Table Storage
    try {
        const storedTxs = await getTransactionsByStatus(clientId, TransactionStatus.CAPTURADO);
        if (storedTxs.length > 0) {
            allTransactions = storedTxs;
            context.log(`[AI Pipeline] Loaded ${storedTxs.length} CAPTURADO transactions from storage`);
        }
    } catch (err: any) {
        context.log(`[AI Pipeline] Could not load from storage: ${err.message}`);
    }

    // Also include any inline capture results
    if (allTransactions.length === 0 && captureResults && Array.isArray(captureResults)) {
        for (const res of captureResults) {
            if (res && res.transactions && Array.isArray(res.transactions)) {
                allTransactions = allTransactions.concat(res.transactions);
            }
        }
    }

    context.log(`[AI Pipeline] Processing ${allTransactions.length} transactions for client ${clientId}`);

    // 3. Load history from Table Storage for anomaly detection & matching
    const results = [];
    const syncCandidates: Transaction[] = [];
    let history: Transaction[] = [];
    try {
        history = await getTransactionHistory(clientId, 100);
        context.log(`[AI Pipeline] Loaded ${history.length} historical transactions`);
    } catch (err: any) {
        context.log(`[AI Pipeline] Could not load history: ${err.message}`);
    }

    for (const tx of allTransactions) {
        try {
            // A. Classify
            const classification = await classifier.classify(tx);

            // B. Detect Anomalies
            const anomalies = await anomalyDetector.detect([tx], history);

            // C. Match (Placeholder: logic currently matches against history/previstos)
            const matches = await matcher.match([tx], history);
            const matchResult = matches.find(m => m.previstoId === tx.id);

            // D. Decide
            const decision = decisionEngine.decide(tx, classification, anomalies, matchResult);

            // Apply Decision Logic & Persist to Storage
            if (decision.acao === 'categorizar_auto' || decision.acao === 'sync_auto') {
                tx.categoriaNome = classification.categoria;
                tx.categoriaConfianca = classification.confianca;
                tx.status = TransactionStatus.CLASSIFICADO;
                tx.metadata = {
                    ...tx.metadata,
                    aiDecision: decision.acao,
                    confidence: decision.confianca,
                };

                // Persist classification to storage
                try {
                    await updateTransaction(clientId, tx.id, {
                        status: TransactionStatus.CLASSIFICADO,
                        categoriaNome: classification.categoria,
                        categoriaConfianca: classification.confianca,
                        processedAt: nowISO(),
                        metadata: tx.metadata,
                    });
                } catch (e: any) {
                    context.log(`[AI Pipeline] Could not update tx ${tx.id}: ${e.message}`);
                }

                if (decision.acao === 'sync_auto') {
                    syncCandidates.push(tx);
                }
            } else if (decision.acao === 'escalar') {
                tx.status = TransactionStatus.REVISAO_PENDENTE;
                tx.metadata = {
                    ...tx.metadata,
                    aiDecision: decision.acao,
                    reviewReason: decision.razao,
                    anomalies,
                };

                // Persist status update
                try {
                    await updateTransaction(clientId, tx.id, {
                        status: TransactionStatus.REVISAO_PENDENTE,
                        categoriaNome: classification.categoria,
                        categoriaConfianca: classification.confianca,
                        processedAt: nowISO(),
                        metadata: tx.metadata,
                    });
                } catch (e: any) {
                    context.log(`[AI Pipeline] Could not update tx ${tx.id}: ${e.message}`);
                }

                // Create authorization for high-value escalated items
                try {
                    await createAuthorization({
                        id: `auth-${tx.id}`,
                        clientId,
                        transactionId: tx.id,
                        tipo: tx.type === TransactionType.PAGAR ? 'pagar' : 'receber',
                        descricao: tx.descricao,
                        valor: tx.valor,
                        vencimento: tx.dataVencimento || nowISO().split('T')[0],
                        contraparte: tx.contraparte || 'Desconhecido',
                        categoria: classification.categoria,
                        status: 'pendente',
                        criadoEm: nowISO(),
                    });
                } catch (e: any) {
                    context.log(`[AI Pipeline] Could not create auth for ${tx.id}: ${e.message}`);
                }
            } else {
                // aguardar, rejeitar, etc
                tx.metadata = {
                    ...tx.metadata,
                    aiDecision: decision.acao,
                    reviewReason: decision.razao,
                    anomalies,
                };

                try {
                    await updateTransaction(clientId, tx.id, {
                        status: TransactionStatus.PROCESSANDO,
                        categoriaNome: classification.categoria,
                        categoriaConfianca: classification.confianca,
                        processedAt: nowISO(),
                        metadata: tx.metadata,
                    });
                } catch (e: any) {
                    context.log(`[AI Pipeline] Could not update tx ${tx.id}: ${e.message}`);
                }
            }

            // Create doubt for low-confidence classifications
            if (classification.confianca < 0.8 && decision.acao !== 'sync_auto') {
                try {
                    await createDoubt({
                        id: `doubt-${tx.id}`,
                        clientId,
                        transactionId: tx.id,
                        tipo: DoubtType.CLASSIFICACAO,
                        transacao: {
                            id: tx.id,
                            descricao: tx.descricao,
                            valor: tx.valor,
                            data: tx.dataVencimento || nowISO().split('T')[0],
                        },
                        sugestaoIA: {
                            categoria: classification.categoria,
                            confianca: classification.confianca,
                        },
                        opcoes: classification.alternativas?.map((a, i) => ({
                            id: `alt-${i}`,
                            nome: a.categoria,
                        })) || [],
                        status: 'pendente',
                        criadoEm: nowISO(),
                    });
                } catch (e: any) {
                    context.log(`[AI Pipeline] Could not create doubt for ${tx.id}: ${e.message}`);
                }
            }

            results.push({
                transactionId: tx.id,
                classification,
                anomalies,
                decision,
            });
        } catch (err: any) {
            context.log(`[AI Pipeline][Error] Processing transaction ${tx.id}: ${err.message}`);
            results.push({
                transactionId: tx.id,
                error: err.message,
            });
        }
    }

    // Log history action for this processing
    try {
        await addHistoryAction({
            id: `hist-ai-${input.cycleId}-${clientId}`,
            clientId,
            tipo: 'classificacao',
            descricao: `Pipeline IA processou ${allTransactions.length} transações: ${syncCandidates.length} auto-sync, ${results.filter(r => r.decision?.acao === 'escalar').length} escaladas`,
            data: nowISO(),
            detalhes: {
                cycleId: input.cycleId,
                processed: allTransactions.length,
                syncCandidates: syncCandidates.length,
            },
        });
    } catch (e: any) {
        context.log(`[AI Pipeline] Could not log history: ${e.message}`);
    }

    return {
        processedCount: allTransactions.length,
        autoApprovedCount: syncCandidates.length,
        syncCandidates,
        results
    };
}

// Register as Azure Function Activity
df.app.activity('aiProcessingActivity', {
    handler: aiProcessingActivity
});
