import {
    Transaction,
    ClassificationResult,
    Anomaly,
    MatchResult,
    Decision
} from '../../shared/types';

/**
 * Motor de Decisão (80/20 System)
 * 
 * Orquestra a decisão final para cada transação baseado em:
 * 1. Classificação (Confiança)
 * 2. Anomalias (Risco)
 * 3. Matching (Conciliação)
 */
export class DecisionEngine {

    // Limites configuráveis
    private readonly CONFIDENCE_THRESHOLD_AUTO = 0.85;
    private readonly ANOMALY_SCORE_THRESHOLD = 0.5;

    /**
     * Toma uma decisão sobre o que fazer com a transação
     */
    decide(
        transaction: Transaction,
        classification: ClassificationResult,
        anomalies: Anomaly[],
        match?: MatchResult
    ): Decision {
        const regrasAplicadas: string[] = [];

        // 1. Prioridade: Anomalias Críticas -> Escalar
        const criticalAnomaly = anomalies.find(a => a.severidade === 'critica' || a.severidade === 'alta');
        if (criticalAnomaly) {
            regrasAplicadas.push('ANOMALIA_CRITICA_DETECTADA');
            return {
                acao: 'escalar',
                confianca: 0.0,
                razao: `Anomalia crítica detectada: ${criticalAnomaly.descricao}`,
                requisitoHumano: true,
                regrasAplicadas
            };
        }

        // 2. Prioridade: Regras de Negócio Específicas
        if (transaction.valor > 50000) {
            regrasAplicadas.push('VALOR_MUITO_ALTO');
            return {
                acao: 'escalar',
                confianca: 1.0,
                razao: 'Valor superior a R$ 50.000 requer aprovação executiva',
                requisitoHumano: true,
                regrasAplicadas
            };
        }

        // 3. Prioridade: Matching
        if (match) {
            if (match.tipo === 'exato' || match.confianca > 0.95) {
                regrasAplicadas.push('MATCH_CONFIRMADO');
                return {
                    acao: 'sync_auto',
                    confianca: 1.0,
                    razao: 'Conciliação confirmada com alta precisão',
                    requisitoHumano: false,
                    regrasAplicadas
                };
            } else if (match.tipo === 'sem_match' && transaction.type === 'pagar') {
                // Pagamento sem match previsto -> Alerta
                regrasAplicadas.push('PAGAMENTO_SEM_PREVISAO');
                return {
                    acao: 'aguardar',
                    confianca: 0.5,
                    razao: 'Pagamento realizado sem previsão correspondente',
                    requisitoHumano: true,
                    regrasAplicadas
                };
            }
        }

        // 4. Prioridade: Classificação
        if (classification.confianca >= this.CONFIDENCE_THRESHOLD_AUTO) {
            regrasAplicadas.push('CLASSIFICACAO_ALTA_CONFIANCA');
            return {
                acao: 'categorizar_auto',
                confianca: classification.confianca,
                razao: `Classificação automática com ${Math.round(classification.confianca * 100)}% de confiança`,
                requisitoHumano: false,
                regrasAplicadas
            };
        } else {
            regrasAplicadas.push('CLASSIFICACAO_BAIXA_CONFIANCA');
            return {
                acao: 'escalar',
                confianca: classification.confianca,
                razao: 'Baixa confiança na classificação automática',
                requisitoHumano: true,
                regrasAplicadas
            };
        }
    }
}
