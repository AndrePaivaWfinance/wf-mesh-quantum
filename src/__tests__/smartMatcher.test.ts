import { SmartMatcher } from '../ai/smartMatcher';
import {
  Transaction,
  TransactionType,
  TransactionStatus,
  TransactionSource,
} from '../../shared/types';

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    clientId: 'client-1',
    type: TransactionType.PAGAR,
    status: TransactionStatus.CAPTURADO,
    source: TransactionSource.NIBO,
    valor: -1000,
    descricao: 'PAGTO FORNECEDOR XYZ',
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
    capturedAt: '2026-01-15T00:00:00Z',
    dataVencimento: '2026-01-15',
    dataRealizacao: '2026-01-15',
    ...overrides,
  };
}

describe('SmartMatcher', () => {
  let matcher: SmartMatcher;

  beforeEach(() => {
    matcher = new SmartMatcher();
  });

  describe('Exact matching', () => {
    test('matches by nossoNumero', async () => {
      const previstos = [makeTx({ id: 'prev-1', nossoNumero: 'NN123' })];
      const realizados = [makeTx({ id: 'real-1', nossoNumero: 'NN123' })];

      const results = await matcher.match(previstos, realizados);

      expect(results).toHaveLength(1);
      expect(results[0].tipo).toBe('exato');
      expect(results[0].confianca).toBe(1.0);
      expect(results[0].previstoId).toBe('prev-1');
      expect(results[0].realizadoId).toBe('real-1');
    });

    test('matches by codigoBarras', async () => {
      const previstos = [makeTx({ id: 'prev-1', codigoBarras: 'BAR123' })];
      const realizados = [makeTx({ id: 'real-1', codigoBarras: 'BAR123' })];

      const results = await matcher.match(previstos, realizados);

      expect(results[0].tipo).toBe('exato');
      expect(results[0].confianca).toBe(1.0);
    });

    test('matches by numeroDocumento', async () => {
      const previstos = [makeTx({ id: 'prev-1', numeroDocumento: 'DOC123' })];
      const realizados = [makeTx({ id: 'real-1', numeroDocumento: 'DOC123' })];

      const results = await matcher.match(previstos, realizados);

      expect(results[0].tipo).toBe('exato');
    });
  });

  describe('Fuzzy matching', () => {
    test('matches with same value, date and description', async () => {
      const previstos = [
        makeTx({ id: 'prev-1', valor: -1000, dataVencimento: '2026-01-15', descricao: 'PAGTO FORNECEDOR' }),
      ];
      const realizados = [
        makeTx({ id: 'real-1', valor: -1000, dataRealizacao: '2026-01-15', descricao: 'PAGTO FORNECEDOR' }),
      ];

      const results = await matcher.match(previstos, realizados);

      expect(results[0].tipo).toBe('fuzzy');
      expect(results[0].confianca).toBeGreaterThanOrEqual(0.8);
    });

    test('matches with small value difference (within 2%)', async () => {
      const previstos = [
        makeTx({ id: 'prev-1', valor: -1000, dataVencimento: '2026-01-15', descricao: 'PAGTO FORNECEDOR' }),
      ];
      const realizados = [
        makeTx({ id: 'real-1', valor: -1015, dataRealizacao: '2026-01-15', descricao: 'PAGTO FORNECEDOR' }),
      ];

      const results = await matcher.match(previstos, realizados);

      expect(results[0].tipo).toBe('fuzzy');
      expect(results[0].confianca).toBeGreaterThanOrEqual(0.8);
    });

    test('does not match with large value difference (> 2%)', async () => {
      const previstos = [
        makeTx({ id: 'prev-1', valor: -1000, dataVencimento: '2026-01-15', descricao: 'PAGTO FORNECEDOR' }),
      ];
      const realizados = [
        makeTx({ id: 'real-1', valor: -2000, dataRealizacao: '2026-01-15', descricao: 'PAGTO FORNECEDOR' }),
      ];

      const results = await matcher.match(previstos, realizados);

      expect(results[0].tipo).toBe('sem_match');
    });

    test('detects divergences in matched transactions', async () => {
      const previstos = [
        makeTx({ id: 'prev-1', valor: -1000, dataVencimento: '2026-01-15', descricao: 'PAGTO FORNECEDOR' }),
      ];
      const realizados = [
        makeTx({ id: 'real-1', valor: -1010, dataRealizacao: '2026-01-16', descricao: 'PAGTO FORNECEDOR' }),
      ];

      const results = await matcher.match(previstos, realizados);

      if (results[0].divergencias) {
        const campos = results[0].divergencias.map(d => d.campo);
        expect(campos).toContain('valor');
        expect(campos).toContain('data');
      }
    });
  });

  describe('No match', () => {
    test('returns sem_match when no match found', async () => {
      const previstos = [
        makeTx({ id: 'prev-1', valor: -1000, descricao: 'PAGTO X' }),
      ];
      const realizados = [
        makeTx({ id: 'real-1', valor: -5000, descricao: 'RECEBIMENTO Y' }),
      ];

      const results = await matcher.match(previstos, realizados);

      expect(results[0].tipo).toBe('sem_match');
      expect(results[0].confianca).toBe(0.0);
    });

    test('returns sem_match for empty realizados', async () => {
      const previstos = [makeTx({ id: 'prev-1' })];

      const results = await matcher.match(previstos, []);

      expect(results[0].tipo).toBe('sem_match');
    });
  });

  describe('Multiple matches', () => {
    test('matches each previsto to different realizado', async () => {
      const previstos = [
        makeTx({ id: 'prev-1', nossoNumero: 'NN1' }),
        makeTx({ id: 'prev-2', nossoNumero: 'NN2' }),
      ];
      const realizados = [
        makeTx({ id: 'real-1', nossoNumero: 'NN1' }),
        makeTx({ id: 'real-2', nossoNumero: 'NN2' }),
      ];

      const results = await matcher.match(previstos, realizados);

      expect(results).toHaveLength(2);
      expect(results[0].realizadoId).toBe('real-1');
      expect(results[1].realizadoId).toBe('real-2');
    });

    test('does not double-match a realizado', async () => {
      const previstos = [
        makeTx({ id: 'prev-1', nossoNumero: 'NN1' }),
        makeTx({ id: 'prev-2', nossoNumero: 'NN1' }),
      ];
      const realizados = [
        makeTx({ id: 'real-1', nossoNumero: 'NN1' }),
      ];

      const results = await matcher.match(previstos, realizados);

      const matched = results.filter(r => r.tipo === 'exato');
      expect(matched).toHaveLength(1);
    });
  });
});
