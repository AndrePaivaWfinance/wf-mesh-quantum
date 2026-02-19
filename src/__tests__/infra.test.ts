/**
 * Tests for infrastructure modules: RateLimiter, TenantMonitor, LearningLoop
 *
 * These modules use in-memory fallback when AZURE_STORAGE_CONNECTION_STRING is not set,
 * which makes them testable without Azure.
 */

// Ensure no storage connection so modules use in-memory mode
delete process.env.AZURE_STORAGE_CONNECTION_STRING;

// Mock @azure/data-tables to prevent import errors
jest.mock('@azure/data-tables', () => ({
  TableClient: {
    fromConnectionString: jest.fn(),
  },
}));

import { RateLimiter } from '../infra/rateLimiter';
import { TenantMonitor } from '../infra/monitoring';
import { LearningLoop, FeedbackRecord } from '../learning/learningLoop';

// ============================================================================
// RateLimiter
// ============================================================================

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  test('allows requests under limit', async () => {
    const result = await limiter.checkLimit('client-1', 10);
    expect(result).toBe(true);
  });

  test('increments counter on each check', async () => {
    // Make 5 requests, all should pass
    for (let i = 0; i < 5; i++) {
      const result = await limiter.checkLimit('client-1', 10);
      expect(result).toBe(true);
    }
  });

  test('blocks when limit is reached', async () => {
    // Exhaust the limit
    for (let i = 0; i < 3; i++) {
      await limiter.checkLimit('client-1', 3);
    }

    // Next should be blocked
    const result = await limiter.checkLimit('client-1', 3);
    expect(result).toBe(false);
  });

  test('tracks limits per client independently', async () => {
    // Exhaust client-1's limit
    for (let i = 0; i < 2; i++) {
      await limiter.checkLimit('client-1', 2);
    }
    expect(await limiter.checkLimit('client-1', 2)).toBe(false);

    // client-2 should still be allowed
    expect(await limiter.checkLimit('client-2', 2)).toBe(true);
  });
});

// ============================================================================
// TenantMonitor
// ============================================================================

describe('TenantMonitor', () => {
  let monitor: TenantMonitor;

  beforeEach(() => {
    monitor = new TenantMonitor();
  });

  test('returns null for unknown client', async () => {
    const metrics = await monitor.getDailyMetrics('unknown');
    expect(metrics).toBeNull();
  });

  test('records and retrieves cycle result', async () => {
    await monitor.recordCycleResult('client-1', {
      transactionsTotal: 100,
      autoApproved: 80,
      escalated: 15,
      failed: 5,
      classificationLatencyMs: 200,
      matchingLatencyMs: 100,
      decisionLatencyMs: 50,
      totalCycleTimeMs: 5000,
    });

    const metrics = await monitor.getDailyMetrics('client-1');
    expect(metrics).not.toBeNull();
    expect(metrics!.transactionsTotal).toBe(100);
    expect(metrics!.transactionsAutoApproved).toBe(80);
    expect(metrics!.transactionsEscalated).toBe(15);
    expect(metrics!.transactionsFailed).toBe(5);
  });

  test('accumulates metrics across cycles', async () => {
    await monitor.recordCycleResult('client-1', {
      transactionsTotal: 50,
      autoApproved: 40,
      escalated: 8,
      failed: 2,
      classificationLatencyMs: 200,
      matchingLatencyMs: 100,
      decisionLatencyMs: 50,
      totalCycleTimeMs: 3000,
    });

    await monitor.recordCycleResult('client-1', {
      transactionsTotal: 30,
      autoApproved: 25,
      escalated: 4,
      failed: 1,
      classificationLatencyMs: 150,
      matchingLatencyMs: 80,
      decisionLatencyMs: 40,
      totalCycleTimeMs: 2000,
    });

    const metrics = await monitor.getDailyMetrics('client-1');
    expect(metrics!.transactionsTotal).toBe(80);
    expect(metrics!.transactionsAutoApproved).toBe(65);
    expect(metrics!.totalCycleTimeMs).toBe(5000);
  });

  test('global metrics aggregates all tenants', async () => {
    await monitor.recordCycleResult('client-1', {
      transactionsTotal: 100,
      autoApproved: 80,
      escalated: 15,
      failed: 5,
      classificationLatencyMs: 200,
      matchingLatencyMs: 100,
      decisionLatencyMs: 50,
      totalCycleTimeMs: 5000,
    });

    await monitor.recordCycleResult('client-2', {
      transactionsTotal: 50,
      autoApproved: 45,
      escalated: 3,
      failed: 2,
      classificationLatencyMs: 180,
      matchingLatencyMs: 90,
      decisionLatencyMs: 40,
      totalCycleTimeMs: 3000,
    });

    const global = await monitor.getGlobalMetrics();
    expect(global.totalTenants).toBe(2);
    expect(global.totalTransactions).toBe(150);
    expect(global.totalErrors).toBe(0); // errors are recorded separately
  });

  test('returns default global metrics when empty', async () => {
    const global = await monitor.getGlobalMetrics('1999-01-01');
    expect(global.totalTenants).toBe(0);
    expect(global.totalTransactions).toBe(0);
    expect(global.autoApprovalRate).toBe(1);
  });
});

// ============================================================================
// LearningLoop
// ============================================================================

describe('LearningLoop', () => {
  let loop: LearningLoop;

  beforeEach(() => {
    loop = new LearningLoop();
  });

  function makeFeedback(
    clientId: string,
    predicted: string,
    actual: string
  ): FeedbackRecord {
    return {
      transactionId: `tx-${Date.now()}-${Math.random()}`,
      clientId,
      originalClassification: {
        categoria: predicted,
        confianca: 0.8,
        explicacao: 'test',
        tipoDespesa: 'variavel',
        recorrencia: 'unica',
        alternativas: [],
      },
      humanCorrection: actual,
      timestamp: new Date().toISOString(),
      userId: 'test-user',
    };
  }

  test('records and retrieves feedback', async () => {
    await loop.recordFeedback(makeFeedback('client-1', 'A', 'B'));

    const feedback = await loop.getClientFeedback('client-1');
    expect(feedback).toHaveLength(1);
    expect(feedback[0].humanCorrection).toBe('B');
  });

  test('filters feedback by client', async () => {
    await loop.recordFeedback(makeFeedback('client-1', 'A', 'B'));
    await loop.recordFeedback(makeFeedback('client-2', 'C', 'D'));

    const c1 = await loop.getClientFeedback('client-1');
    expect(c1).toHaveLength(1);

    const c2 = await loop.getClientFeedback('client-2');
    expect(c2).toHaveLength(1);
  });

  test('evaluateModel returns 100% accuracy with no corrections', async () => {
    const metrics = await loop.evaluateModel('client-1');
    expect(metrics.accuracy).toBe(1);
    expect(metrics.totalCorrections).toBe(0);
  });

  test('evaluateModel calculates accuracy correctly', async () => {
    // 2 correct, 1 incorrect
    await loop.recordFeedback(makeFeedback('client-1', 'Fornecedores', 'Fornecedores'));
    await loop.recordFeedback(makeFeedback('client-1', 'Energia', 'Energia'));
    await loop.recordFeedback(makeFeedback('client-1', 'Fornecedores', 'Aluguel'));

    const metrics = await loop.evaluateModel('client-1');
    expect(metrics.accuracy).toBeCloseTo(2 / 3, 2);
    expect(metrics.totalCorrections).toBe(3);
  });

  test('evaluateModel identifies confused categories', async () => {
    await loop.recordFeedback(makeFeedback('client-1', 'Fornecedores', 'Aluguel'));
    await loop.recordFeedback(makeFeedback('client-1', 'Fornecedores', 'Aluguel'));
    await loop.recordFeedback(makeFeedback('client-1', 'Energia', 'Telecom'));

    const metrics = await loop.evaluateModel('client-1');

    expect(metrics.topConfusedCategories.length).toBeGreaterThan(0);
    expect(metrics.topConfusedCategories[0].predicted).toBe('Fornecedores');
    expect(metrics.topConfusedCategories[0].actual).toBe('Aluguel');
    expect(metrics.topConfusedCategories[0].count).toBe(2);
  });

  test('getExamplesForContext returns limited records', async () => {
    for (let i = 0; i < 10; i++) {
      await loop.recordFeedback(makeFeedback('client-1', 'A', 'B'));
    }

    const examples = await loop.getExamplesForContext('client-1', 3);
    expect(examples).toHaveLength(3);
  });
});
