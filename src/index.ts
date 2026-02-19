/**
 * wf-operacao-head
 *
 * Orquestrador estratégico de operações BPO.
 * Responsável por:
 * - Ciclo diário de processamento
 * - Orquestração de capturas (fan-out)
 * - Classificação IA
 * - API para frontend (/bpo/*)
 */

// Functions
import './functions/health';
import './functions/bpoDashboard';
import './functions/bpoAutorizacoes';
import './functions/bpoDuvidas';
import './functions/bpoHistorico';
import './functions/bpoFilas';
import './functions/bpoCycle';
import './functions/bpoClientes';
import './functions/bpoSimulation';

// Triggers
import './triggers/dailyTrigger';

// Orchestrators
import './orchestrators/dailyCycleOrchestrator';
import './orchestrators/clientProcessingOrchestrator';

// Activities
import './activities/captureActivity';
import './activities/classifyActivity';
import './activities/syncActivity';
import './activities/aiProcessingActivity';
import './activities/infraActivities';
import './activities/notificationActivity';
import './activities/feedbackActivity';

// Metrics
import './functions/bpoMetrics';

console.log('[operacao-head] Functions registered');
