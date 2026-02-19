import { Transaction, Anomaly } from '../../shared/types';

/**
 * Detector de Anomalias (80/20 System)
 * 
 * Identifica padrões suspeitos, fraudes e erros operacionais.
 * Combina regras determinísticas com análise estatística.
 */
export class AnomalyDetector {

    /**
     * Analisa um lote de transações em busca de anomalias
     */
    async detect(
        currentTransactions: Transaction[],
        history: Transaction[]
    ): Promise<Anomaly[]> {
        const anomalies: Anomaly[] = [];

        for (const transaction of currentTransactions) {
            // 1. Detecção de Duplicidade
            const duplicate = this.checkDuplicate(transaction, history);
            if (duplicate) anomalies.push(duplicate);

            // 2. Detecção de Valor Anômalo (Outlier)
            const outlier = this.checkValueAnomaly(transaction, history);
            if (outlier) anomalies.push(outlier);

            // 3. Detecção de Timing (Fim de semana/Feriado)
            const timing = this.checkTimingAnomaly(transaction);
            if (timing) anomalies.push(timing);
        }

        return anomalies;
    }

    /**
     * Verifica se já existe transação idêntica recentemente
     */
    private checkDuplicate(
        current: Transaction,
        history: Transaction[]
    ): Anomaly | null {
        // Janela de 2 dias para duplicidade
        const toleranceMs = 2 * 24 * 60 * 60 * 1000;
        const currentTime = new Date(current.dataRealizacao || current.dataVencimento || '').getTime();

        const similar = history.find(h => {
            if (h.id === current.id) return false;

            const hTime = new Date(h.dataRealizacao || h.dataVencimento || '').getTime();
            const timeDiff = Math.abs(currentTime - hTime);

            return (
                timeDiff <= toleranceMs &&
                h.valor === current.valor &&
                h.descricao === current.descricao
            );
        });

        if (similar) {
            return {
                tipo: 'frequencia',
                severidade: 'alta',
                transacaoId: current.id,
                descricao: 'Possível duplicidade identificada',
                razao: `Transação idêntica encontrada em ${similar.dataRealizacao} (ID: ${similar.id})`,
                sugestaoAcao: 'Rejeitar a mais recente',
                autoResolve: false,
                score: 0.95
            };
        }

        return null;
    }

    /**
     * Verifica se o valor foge muito do padrão histórico
     */
    private checkValueAnomaly(
        current: Transaction,
        history: Transaction[]
    ): Anomaly | null {
        // Filtra histórico relevante (mesma categoria ou descrição similar)
        const context = history.filter(h =>
            h.categoriaNome === current.categoriaNome ||
            h.descricao.includes(current.descricao.split(' ')[0]) // Mesma primeira palavra
        );

        if (context.length < 5) return null; // Poucos dados para estatística

        // Calcula média e desvio padrão
        const values = context.map(h => Math.abs(h.valor));
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const stdDev = Math.sqrt(values.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / values.length);

        // Z-Score: quantos desvios padrões acima da média
        let zScore = 0;

        if (stdDev === 0) {
            // Se o desvio padrão é 0, qualquer diferença é uma anomalia infinita
            if (Math.abs(Math.abs(current.valor) - mean) > 0.01) {
                zScore = 999; // Valor arbitrariamente alto
            }
        } else {
            zScore = (Math.abs(current.valor) - mean) / stdDev;
        }

        if (zScore > 3) { // 3 sigma (99.7%)
            return {
                tipo: 'valor',
                severidade: 'alta',
                transacaoId: current.id,
                descricao: 'Valor muito acima da média histórica',
                razao: `Valor ${current.valor} é ${(zScore).toFixed(1)}x o desvio padrão (Média: ${mean.toFixed(2)})`,
                sugestaoAcao: 'Revisar manualmente',
                autoResolve: false,
                score: Math.min(zScore / 10, 1.0)
            };
        }

        return null;
    }

    /**
     * Verifica se a transação ocorre em dia não útil
     */
    private checkTimingAnomaly(current: Transaction): Anomaly | null {
        const date = new Date(current.dataRealizacao || current.dataVencimento || '');
        const day = date.getDay(); // 0 = Domingo, 6 = Sábado

        if (day === 0 || day === 6) {
            return {
                tipo: 'timing',
                severidade: 'baixa',
                transacaoId: current.id,
                descricao: 'Transação em final de semana',
                razao: `Data ${date.toISOString().split('T')[0]} cai em um ${day === 0 ? 'Domingo' : 'Sábado'}`,
                sugestaoAcao: 'Verificar se é esperado',
                autoResolve: true, // Pode ser normal
                score: 0.3
            };
        }

        return null;
    }
}
