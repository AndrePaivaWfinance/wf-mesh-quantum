import * as df from 'durable-functions';
import { InvocationContext } from "@azure/functions";
import { AdvancedClassifier } from "../ai/advancedClassifier";
import { AnomalyDetector } from "../ai/anomalyDetector";
import { SmartMatcher } from "../ai/smartMatcher";
import { DecisionEngine } from "../ai/decisionEngine";
import { Transaction, ClassificationResult, Anomaly, Decision } from "../../shared/types"; // Corrected import path (3 levels up)

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

    // 2. Flatten Transactions from Capture Results
    let allTransactions: Transaction[] = [];
    if (captureResults && Array.isArray(captureResults)) {
        for (const res of captureResults) {
            if (res && res.transactions && Array.isArray(res.transactions)) {
                allTransactions = allTransactions.concat(res.transactions);
            }
        }
    }

    context.log(`[AI Pipeline] Processing ${allTransactions.length} transactions for client ${clientId}`);

    // 3. Process Pipeline
    const results = [];
    const syncCandidates: Transaction[] = [];
    // TODO: Load history from Table Storage for real context
    const history: Transaction[] = [];

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

            // Apply Decision Logic
            // If Auto-Categorize or Auto-Sync, we update the transaction
            if (decision.acao === 'categorizar_auto' || decision.acao === 'sync_auto') {
                tx.categoriaNome = classification.categoria;
                // Add metadata about the automatic decision
                tx.metadata = {
                    ...tx.metadata,
                    aiDecision: decision.acao,
                    confidence: decision.confianca
                };

                // Only push to sync candidates if action is explicitly sync_auto
                // Or if we want to sync all categorized... let's stick to Decision Engine logic
                if (decision.acao === 'sync_auto') {
                    syncCandidates.push(tx);
                }
            } else {
                // Determine status based on decision
                // e.g., 'escalar' -> needs review
                tx.metadata = {
                    ...tx.metadata,
                    aiDecision: decision.acao,
                    reviewReason: decision.razao,
                    anomalies
                };
            }

            results.push({
                transactionId: tx.id,
                classification,
                anomalies,
                decision
            });
        } catch (err: any) {
            context.log(`[AI Pipeline][Error] Processing transaction ${tx.id}: ${err.message}`);
            results.push({
                transactionId: tx.id,
                error: err.message
            });
        }
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
