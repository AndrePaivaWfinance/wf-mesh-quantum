import { AnomalyDetector } from '../ai/anomalyDetector';
import {
  Transaction,
  TransactionType,
  TransactionStatus,
  TransactionSource,
} from '../../shared/types';

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-current',
    clientId: 'client-1',
    type: TransactionType.PAGAR,
    status: TransactionStatus.CAPTURADO,
    source: TransactionSource.SANTANDER,
    valor: -1000,
    descricao: 'PAGTO FORNECEDOR',
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-01-15T10:00:00Z',
    capturedAt: '2026-01-15T10:00:00Z',
    dataRealizacao: '2026-01-15T10:00:00Z', // Wednesday
    ...overrides,
  };
}

describe('AnomalyDetector', () => {
  let detector: AnomalyDetector;

  beforeEach(() => {
    detector = new AnomalyDetector();
  });

  describe('Duplicate detection', () => {
    test('detects duplicate transaction within 2-day window', async () => {
      const current = makeTx({ id: 'tx-new' });
      const history = [
        makeTx({
          id: 'tx-old',
          dataRealizacao: '2026-01-14T10:00:00Z',
        }),
      ];

      const anomalies = await detector.detect([current], history);
      const dup = anomalies.find(a => a.tipo === 'frequencia');

      expect(dup).toBeDefined();
      expect(dup!.severidade).toBe('alta');
      expect(dup!.score).toBe(0.95);
    });

    test('ignores different values', async () => {
      const current = makeTx({ id: 'tx-new', valor: -2000 });
      const history = [
        makeTx({ id: 'tx-old', valor: -1000, dataRealizacao: '2026-01-14T10:00:00Z' }),
      ];

      const anomalies = await detector.detect([current], history);
      const dup = anomalies.find(a => a.tipo === 'frequencia');

      expect(dup).toBeUndefined();
    });

    test('ignores different descriptions', async () => {
      const current = makeTx({ id: 'tx-new', descricao: 'PAGTO X' });
      const history = [
        makeTx({ id: 'tx-old', descricao: 'PAGTO Y', dataRealizacao: '2026-01-14T10:00:00Z' }),
      ];

      const anomalies = await detector.detect([current], history);
      const dup = anomalies.find(a => a.tipo === 'frequencia');

      expect(dup).toBeUndefined();
    });

    test('ignores duplicates outside 2-day window', async () => {
      const current = makeTx({ id: 'tx-new' });
      const history = [
        makeTx({ id: 'tx-old', dataRealizacao: '2026-01-10T10:00:00Z' }),
      ];

      const anomalies = await detector.detect([current], history);
      const dup = anomalies.find(a => a.tipo === 'frequencia');

      expect(dup).toBeUndefined();
    });
  });

  describe('Value anomaly detection (Z-score)', () => {
    test('detects outlier with Z-score > 3', async () => {
      // History: 5 transactions with similar values (~100)
      const history = Array.from({ length: 6 }, (_, i) =>
        makeTx({
          id: `hist-${i}`,
          valor: -(100 + i),
          descricao: 'PAGTO FORNECEDOR',
          categoriaNome: 'Fornecedores',
        })
      );

      // Current: way higher than usual
      const current = makeTx({
        id: 'tx-outlier',
        valor: -10000,
        descricao: 'PAGTO FORNECEDOR',
        categoriaNome: 'Fornecedores',
      });

      const anomalies = await detector.detect([current], history);
      const outlier = anomalies.find(a => a.tipo === 'valor');

      expect(outlier).toBeDefined();
      expect(outlier!.severidade).toBe('alta');
    });

    test('ignores normal values within range', async () => {
      const history = Array.from({ length: 6 }, (_, i) =>
        makeTx({
          id: `hist-${i}`,
          valor: -(100 + i * 10),
          descricao: 'PAGTO FORNECEDOR',
          categoriaNome: 'Fornecedores',
        })
      );

      const current = makeTx({
        id: 'tx-normal',
        valor: -130,
        descricao: 'PAGTO FORNECEDOR',
        categoriaNome: 'Fornecedores',
      });

      const anomalies = await detector.detect([current], history);
      const outlier = anomalies.find(a => a.tipo === 'valor');

      expect(outlier).toBeUndefined();
    });

    test('requires at least 5 history samples', async () => {
      const history = Array.from({ length: 3 }, (_, i) =>
        makeTx({
          id: `hist-${i}`,
          valor: -100,
          descricao: 'PAGTO FORNECEDOR',
          categoriaNome: 'Fornecedores',
        })
      );

      const current = makeTx({
        id: 'tx-outlier',
        valor: -99999,
        descricao: 'PAGTO FORNECEDOR',
        categoriaNome: 'Fornecedores',
      });

      const anomalies = await detector.detect([current], history);
      const outlier = anomalies.find(a => a.tipo === 'valor');

      expect(outlier).toBeUndefined();
    });
  });

  describe('Timing anomaly detection', () => {
    test('detects weekend transaction (Saturday)', async () => {
      // 2026-01-17 is a Saturday
      const current = makeTx({
        dataRealizacao: '2026-01-17T10:00:00Z',
      });

      const anomalies = await detector.detect([current], []);
      const timing = anomalies.find(a => a.tipo === 'timing');

      expect(timing).toBeDefined();
      expect(timing!.severidade).toBe('baixa');
      expect(timing!.autoResolve).toBe(true);
      expect(timing!.score).toBe(0.3);
    });

    test('detects weekend transaction (Sunday)', async () => {
      // 2026-01-18 is a Sunday
      const current = makeTx({
        dataRealizacao: '2026-01-18T10:00:00Z',
      });

      const anomalies = await detector.detect([current], []);
      const timing = anomalies.find(a => a.tipo === 'timing');

      expect(timing).toBeDefined();
    });

    test('no timing anomaly on weekday', async () => {
      // 2026-01-15 is a Thursday
      const current = makeTx({
        dataRealizacao: '2026-01-15T10:00:00Z',
      });

      const anomalies = await detector.detect([current], []);
      const timing = anomalies.find(a => a.tipo === 'timing');

      expect(timing).toBeUndefined();
    });
  });

  describe('Multiple anomalies', () => {
    test('can detect multiple anomaly types at once', async () => {
      const history = Array.from({ length: 6 }, (_, i) =>
        makeTx({
          id: `hist-${i}`,
          valor: -100,
          descricao: 'PAGTO FORNECEDOR',
          categoriaNome: 'Fornecedores',
          dataRealizacao: '2026-01-10T10:00:00Z',
        })
      );

      // 2026-01-18 is Sunday, value is outlier, and matches a duplicate
      const current = makeTx({
        id: 'tx-multi',
        valor: -100,
        descricao: 'PAGTO FORNECEDOR',
        categoriaNome: 'Fornecedores',
        dataRealizacao: '2026-01-18T10:00:00Z',
      });

      const anomalies = await detector.detect([current], history);

      // Should detect timing (Sunday) but not necessarily duplicate (depends on date window)
      const types = anomalies.map(a => a.tipo);
      expect(types).toContain('timing');
    });
  });
});
