/**
 * LearningLoop tests - uses in-memory mode
 */

delete process.env.AZURE_STORAGE_CONNECTION_STRING;

jest.mock('@azure/data-tables', () => ({
  TableClient: {
    fromConnectionString: jest.fn(),
  },
}));

import { LearningLoop, FeedbackRecord } from '../learning/learningLoop';

function makeFeedback(overrides: Partial<FeedbackRecord> = {}): FeedbackRecord {
  return {
    transactionId: 'tx-1',
    clientId: 'client-1',
    originalClassification: {
      categoria: 'Fornecedores',
      confianca: 0.8,
      explicacao: 'test',
      tipoDespesa: 'variavel',
      recorrencia: 'unica',
      alternativas: [],
    },
    humanCorrection: 'Aluguel',
    timestamp: new Date().toISOString(),
    userId: 'user-1',
    ...overrides,
  };
}

describe('LearningLoop (in-memory)', () => {
  let loop: LearningLoop;

  beforeEach(() => {
    loop = new LearningLoop();
  });

  test('records and retrieves feedback', async () => {
    await loop.recordFeedback(makeFeedback({ transactionId: 'tx-1' }));
    await loop.recordFeedback(makeFeedback({ transactionId: 'tx-2' }));

    const records = await loop.getClientFeedback('client-1');
    expect(records).toHaveLength(2);
  });

  test('filters feedback by client', async () => {
    await loop.recordFeedback(makeFeedback({ clientId: 'client-1', transactionId: 'tx-1' }));
    await loop.recordFeedback(makeFeedback({ clientId: 'client-2', transactionId: 'tx-2' }));

    const records = await loop.getClientFeedback('client-1');
    expect(records).toHaveLength(1);
    expect(records[0].clientId).toBe('client-1');
  });

  test('respects limit on getClientFeedback', async () => {
    for (let i = 0; i < 10; i++) {
      await loop.recordFeedback(makeFeedback({ transactionId: `tx-${i}` }));
    }

    const records = await loop.getClientFeedback('client-1', 3);
    expect(records).toHaveLength(3);
  });

  test('getExamplesForContext returns limited results', async () => {
    for (let i = 0; i < 10; i++) {
      await loop.recordFeedback(makeFeedback({ transactionId: `tx-${i}` }));
    }

    const examples = await loop.getExamplesForContext('client-1', 3);
    expect(examples).toHaveLength(3);
  });

  describe('evaluateModel', () => {
    test('returns perfect accuracy when no corrections', async () => {
      const metrics = await loop.evaluateModel('client-1');
      expect(metrics.accuracy).toBe(1);
      expect(metrics.totalCorrections).toBe(0);
    });

    test('calculates accuracy correctly', async () => {
      // 2 correct, 1 wrong
      await loop.recordFeedback(makeFeedback({
        transactionId: 'tx-1',
        originalClassification: { categoria: 'Aluguel', confianca: 0.9, explicacao: '', tipoDespesa: 'fixa', recorrencia: 'mensal', alternativas: [] },
        humanCorrection: 'Aluguel',
      }));
      await loop.recordFeedback(makeFeedback({
        transactionId: 'tx-2',
        originalClassification: { categoria: 'Energia', confianca: 0.9, explicacao: '', tipoDespesa: 'fixa', recorrencia: 'mensal', alternativas: [] },
        humanCorrection: 'Energia',
      }));
      await loop.recordFeedback(makeFeedback({
        transactionId: 'tx-3',
        originalClassification: { categoria: 'Fornecedores', confianca: 0.6, explicacao: '', tipoDespesa: 'variavel', recorrencia: 'unica', alternativas: [] },
        humanCorrection: 'Aluguel',
      }));

      const metrics = await loop.evaluateModel('client-1');
      expect(metrics.accuracy).toBeCloseTo(2 / 3);
      expect(metrics.totalCorrections).toBe(3);
    });

    test('identifies confused categories', async () => {
      // Multiple misclassifications: Fornecedores -> Aluguel
      for (let i = 0; i < 5; i++) {
        await loop.recordFeedback(makeFeedback({
          transactionId: `tx-${i}`,
          originalClassification: { categoria: 'Fornecedores', confianca: 0.6, explicacao: '', tipoDespesa: 'variavel', recorrencia: 'unica', alternativas: [] },
          humanCorrection: 'Aluguel',
        }));
      }

      const metrics = await loop.evaluateModel('client-1');
      expect(metrics.topConfusedCategories.length).toBeGreaterThan(0);
      expect(metrics.topConfusedCategories[0].predicted).toBe('Fornecedores');
      expect(metrics.topConfusedCategories[0].actual).toBe('Aluguel');
      expect(metrics.topConfusedCategories[0].count).toBe(5);
    });
  });
});
