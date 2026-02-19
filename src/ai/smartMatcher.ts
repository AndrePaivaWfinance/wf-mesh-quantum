import { Transaction, MatchResult } from '../../shared/types';

/**
 * Conciliador Inteligente (80/20 System)
 * 
 * Realiza o matching entre previstos (ERP) e realizados (Banco).
 * Suporta fuzzy matching de datas, valores e descrições.
 */
export class SmartMatcher {

    // Tolerâncias
    private readonly DATE_TOLERANCE_DAYS = 3;
    private readonly VALUE_TOLERANCE_PERCENT = 0.02; // 2% para diferenças de juros/multa

    /**
     * Tenta encontrar matches para uma lista de previstos contra realizados
     */
    async match(
        previstos: Transaction[],
        realizados: Transaction[]
    ): Promise<MatchResult[]> {
        const results: MatchResult[] = [];
        const matchedRealizados = new Set<string>();

        for (const previsto of previstos) {
            // 1. Tenta Match Exato (ID ou Nosso Número)
            const exactMatch = this.findExactMatch(previsto, realizados, matchedRealizados);

            if (exactMatch) {
                results.push(exactMatch);
                matchedRealizados.add(exactMatch.realizadoId!);
                continue;
            }

            // 2. Tenta Fuzzy Match (Valor + Data + Descrição)
            const fuzzyMatch = this.findFuzzyMatch(previsto, realizados, matchedRealizados);

            if (fuzzyMatch) {
                results.push(fuzzyMatch);
                matchedRealizados.add(fuzzyMatch.realizadoId!);
                continue;
            }

            // 3. Sem match
            results.push({
                previstoId: previsto.id,
                confianca: 0.0,
                tipo: 'sem_match'
            });
        }

        return results;
    }

    private findExactMatch(
        previsto: Transaction,
        realizados: Transaction[],
        matchedIds: Set<string>
    ): MatchResult | null {
        const match = realizados.find(r =>
            !matchedIds.has(r.id) && (
                (r.nossoNumero && r.nossoNumero === previsto.nossoNumero) ||
                (r.codigoBarras && r.codigoBarras === previsto.codigoBarras) ||
                (r.numeroDocumento && r.numeroDocumento === previsto.numeroDocumento)
            )
        );

        if (match) {
            return {
                previstoId: previsto.id,
                realizadoId: match.id,
                confianca: 1.0,
                tipo: 'exato',
                divergencias: this.calculateDivergences(previsto, match)
            };
        }

        return null;
    }

    private findFuzzyMatch(
        previsto: Transaction,
        realizados: Transaction[],
        matchedIds: Set<string>
    ): MatchResult | null {
        let bestMatch: Transaction | null = null;
        let bestScore = 0;

        for (const realizado of realizados) {
            if (matchedIds.has(realizado.id)) continue;

            const score = this.calculateMatchScore(previsto, realizado);

            if (score > bestScore && score > 0.8) { // Threshold mínimo de 80%
                bestScore = score;
                bestMatch = realizado;
            }
        }

        if (bestMatch) {
            return {
                previstoId: previsto.id,
                realizadoId: bestMatch.id,
                confianca: bestScore,
                tipo: 'fuzzy',
                divergencias: this.calculateDivergences(previsto, bestMatch)
            };
        }

        return null;
    }

    private calculateMatchScore(p: Transaction, r: Transaction): number {
        let score = 0;

        // 1. Valor (Peso 50%)
        const valDiff = Math.abs(p.valor - r.valor);
        const valPercent = valDiff / Math.abs(p.valor);

        if (valDiff < 0.01) score += 0.5; // Exato
        else if (valPercent <= this.VALUE_TOLERANCE_PERCENT) score += 0.4; // Dentro da tolerância
        else return 0; // Valor muito diferente, aborta

        // 2. Data (Peso 30%)
        const pDate = new Date(p.dataVencimento || '').getTime();
        const rDate = new Date(r.dataRealizacao || '').getTime();
        const dayDiff = Math.abs(pDate - rDate) / (1000 * 60 * 60 * 24);

        if (dayDiff < 1) score += 0.3;
        else if (dayDiff <= this.DATE_TOLERANCE_DAYS) score += 0.2;
        // Se data for muito longe, não zera, pois pode ser atraso grande

        // 3. Descrição (Peso 20%)
        const pDesc = this.normalizeString(p.descricao);
        const rDesc = this.normalizeString(r.descricao);

        if (pDesc === rDesc) score += 0.2;
        else if (rDesc.includes(pDesc) || pDesc.includes(rDesc)) score += 0.15;
        else {
            // Simple word match
            const pWords = pDesc.split(' ');
            const rWords = rDesc.split(' ');
            const intersections = pWords.filter(w => rWords.includes(w) && w.length > 3);
            if (intersections.length > 0) score += 0.1;
        }

        return Math.min(score, 1.0);
    }

    private calculateDivergences(p: Transaction, r: Transaction): any[] {
        const divergences = [];

        if (Math.abs(p.valor - r.valor) > 0.01) {
            divergences.push({
                campo: 'valor',
                esperado: p.valor,
                encontrado: r.valor
            });
        }

        const pDate = new Date(p.dataVencimento || '').toISOString().split('T')[0];
        const rDate = new Date(r.dataRealizacao || '').toISOString().split('T')[0];

        if (pDate !== rDate) {
            divergences.push({
                campo: 'data',
                esperado: pDate,
                encontrado: rDate
            });
        }

        return divergences;
    }

    private normalizeString(str: string): string {
        return str.toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9 ]/g, "");
    }
}
