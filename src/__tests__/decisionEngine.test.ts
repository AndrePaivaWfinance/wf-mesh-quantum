import { DecisionEngine } from '../ai/decisionEngine';
import {
  Transaction,
  ClassificationResult,
  Anomaly,
  MatchResult,
  TransactionType,
  TransactionStatus,
  TransactionSource,
} from '../../shared/types';

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    clientId: 'client-1',
    type: TransactionType.PAGAR,
    status: TransactionStatus.CLASSIFICADO,
    source: TransactionSource.SANTANDER,
    valor: 1000,
    descricao: 'PAGTO TESTE',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    capturedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeClassification(confianca: number): ClassificationResult {
  return {
    categoria: 'Fornecedores',
    tipoDespesa: 'variavel',
    recorrencia: 'unica',
    confianca,
    alternativas: [],
    explicacao: 'Test classification',
  };
}

function makeAnomaly(severidade: Anomaly['severidade']): Anomaly {
  return {
    tipo: 'valor',
    severidade,
    transacaoId: 'tx-1',
    descricao: 'Test anomaly',
    razao: 'Reason',
    sugestaoAcao: 'Revisar',
    autoResolve: false,
    score: 0.9,
  };
}

describe('DecisionEngine', () => {
  let engine: DecisionEngine;

  beforeEach(() => {
    engine = new DecisionEngine();
  });

  describe('Critical anomaly (highest priority)', () => {
    test('escalates on critical anomaly', () => {
      const decision = engine.decide(
        makeTx(),
        makeClassification(0.99),
        [makeAnomaly('critica')]
      );

      expect(decision.acao).toBe('escalar');
      expect(decision.requisitoHumano).toBe(true);
      expect(decision.regrasAplicadas).toContain('ANOMALIA_CRITICA_DETECTADA');
    });

    test('escalates on high severity anomaly', () => {
      const decision = engine.decide(
        makeTx(),
        makeClassification(0.99),
        [makeAnomaly('alta')]
      );

      expect(decision.acao).toBe('escalar');
      expect(decision.requisitoHumano).toBe(true);
    });

    test('does not escalate on low severity anomaly', () => {
      const decision = engine.decide(
        makeTx(),
        makeClassification(0.95),
        [makeAnomaly('baixa')]
      );

      expect(decision.acao).toBe('categorizar_auto');
    });
  });

  describe('High value rule', () => {
    test('escalates transactions > 50k', () => {
      const decision = engine.decide(
        makeTx({ valor: 60000 }),
        makeClassification(0.99),
        []
      );

      expect(decision.acao).toBe('escalar');
      expect(decision.regrasAplicadas).toContain('VALOR_MUITO_ALTO');
      expect(decision.requisitoHumano).toBe(true);
    });

    test('does not escalate transactions <= 50k', () => {
      const decision = engine.decide(
        makeTx({ valor: 50000 }),
        makeClassification(0.95),
        []
      );

      expect(decision.acao).toBe('categorizar_auto');
    });
  });

  describe('Matching rules', () => {
    test('auto-syncs on exact match', () => {
      const match: MatchResult = {
        previstoId: 'prev-1',
        realizadoId: 'tx-1',
        confianca: 1.0,
        tipo: 'exato',
      };

      const decision = engine.decide(
        makeTx(),
        makeClassification(0.5),
        [],
        match
      );

      expect(decision.acao).toBe('sync_auto');
      expect(decision.requisitoHumano).toBe(false);
      expect(decision.regrasAplicadas).toContain('MATCH_CONFIRMADO');
    });

    test('auto-syncs on fuzzy match > 0.95', () => {
      const match: MatchResult = {
        previstoId: 'prev-1',
        realizadoId: 'tx-1',
        confianca: 0.96,
        tipo: 'fuzzy',
      };

      const decision = engine.decide(
        makeTx(),
        makeClassification(0.5),
        [],
        match
      );

      expect(decision.acao).toBe('sync_auto');
    });

    test('waits for payment without forecast', () => {
      const match: MatchResult = {
        previstoId: 'prev-1',
        confianca: 0.0,
        tipo: 'sem_match',
      };

      const decision = engine.decide(
        makeTx({ type: TransactionType.PAGAR }),
        makeClassification(0.5),
        [],
        match
      );

      expect(decision.acao).toBe('aguardar');
      expect(decision.regrasAplicadas).toContain('PAGAMENTO_SEM_PREVISAO');
    });
  });

  describe('Classification rules', () => {
    test('auto-categorizes with high confidence (>= 0.85)', () => {
      const decision = engine.decide(
        makeTx(),
        makeClassification(0.90),
        []
      );

      expect(decision.acao).toBe('categorizar_auto');
      expect(decision.requisitoHumano).toBe(false);
      expect(decision.regrasAplicadas).toContain('CLASSIFICACAO_ALTA_CONFIANCA');
    });

    test('escalates with low confidence (< 0.85)', () => {
      const decision = engine.decide(
        makeTx(),
        makeClassification(0.60),
        []
      );

      expect(decision.acao).toBe('escalar');
      expect(decision.requisitoHumano).toBe(true);
      expect(decision.regrasAplicadas).toContain('CLASSIFICACAO_BAIXA_CONFIANCA');
    });

    test('exact threshold 0.85 auto-categorizes', () => {
      const decision = engine.decide(
        makeTx(),
        makeClassification(0.85),
        []
      );

      expect(decision.acao).toBe('categorizar_auto');
    });
  });

  describe('Rule priority', () => {
    test('anomaly beats high value', () => {
      const decision = engine.decide(
        makeTx({ valor: 100000 }),
        makeClassification(0.99),
        [makeAnomaly('critica')]
      );

      expect(decision.regrasAplicadas).toContain('ANOMALIA_CRITICA_DETECTADA');
      expect(decision.regrasAplicadas).not.toContain('VALOR_MUITO_ALTO');
    });

    test('high value beats matching', () => {
      const match: MatchResult = {
        previstoId: 'p1',
        realizadoId: 'r1',
        confianca: 1.0,
        tipo: 'exato',
      };

      const decision = engine.decide(
        makeTx({ valor: 60000 }),
        makeClassification(0.99),
        [],
        match
      );

      expect(decision.regrasAplicadas).toContain('VALOR_MUITO_ALTO');
      expect(decision.regrasAplicadas).not.toContain('MATCH_CONFIRMADO');
    });
  });
});
