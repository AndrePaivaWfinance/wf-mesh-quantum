import {
  nowISO,
  todayYMD,
  formatDateBR,
  formatDateTimeBR,
  parseDate,
  addDays,
  diffDays,
  formatCurrency,
  parseCurrency,
  roundMoney,
  normalizeString,
  cleanString,
  truncate,
  extractNumbers,
  isValidCNPJ,
  formatCNPJ,
  withRetry,
  sleep,
  createLogger,
  processBatch,
  processBatchConcurrent,
} from '../utils';

// ============================================================================
// DATE UTILS
// ============================================================================

describe('Date Utils', () => {
  test('nowISO returns ISO string', () => {
    const result = nowISO();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(() => new Date(result)).not.toThrow();
  });

  test('todayYMD returns YYYY-MM-DD format', () => {
    const result = todayYMD();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('formatDateBR formats date in Brazilian format', () => {
    const result = formatDateBR('2026-01-15');
    expect(result).toContain('15');
    expect(result).toContain('2026');
  });

  test('formatDateTimeBR formats datetime', () => {
    const result = formatDateTimeBR('2026-01-15T10:30:00.000Z');
    expect(result).toContain('15');
    expect(result).toContain('2026');
  });

  test('parseDate handles ISO format', () => {
    const result = parseDate('2026-01-15T00:00:00.000Z');
    expect(result).toBeInstanceOf(Date);
    expect(result!.getFullYear()).toBe(2026);
  });

  test('parseDate handles DD/MM/YYYY format', () => {
    const result = parseDate('15/01/2026');
    expect(result).toBeInstanceOf(Date);
    expect(result!.getDate()).toBe(15);
    expect(result!.getMonth()).toBe(0); // January
    expect(result!.getFullYear()).toBe(2026);
  });

  test('parseDate handles YYYY-MM-DD format', () => {
    const result = parseDate('2026-01-15');
    expect(result).toBeInstanceOf(Date);
  });

  test('parseDate returns null for invalid input', () => {
    expect(parseDate('not-a-date')).toBeNull();
  });

  test('addDays adds days correctly', () => {
    const base = new Date(2026, 0, 1);
    const result = addDays(base, 10);
    expect(result.getDate()).toBe(11);
    expect(result.getMonth()).toBe(0);
  });

  test('addDays handles month overflow', () => {
    const base = new Date(2026, 0, 28);
    const result = addDays(base, 5);
    expect(result.getMonth()).toBe(1); // February
  });

  test('diffDays calculates correctly', () => {
    const d1 = new Date(2026, 0, 1);
    const d2 = new Date(2026, 0, 11);
    expect(diffDays(d1, d2)).toBe(10);
  });

  test('diffDays is absolute', () => {
    const d1 = new Date(2026, 0, 11);
    const d2 = new Date(2026, 0, 1);
    expect(diffDays(d1, d2)).toBe(10);
  });
});

// ============================================================================
// MONEY UTILS
// ============================================================================

describe('Money Utils', () => {
  test('formatCurrency formats BRL correctly', () => {
    const result = formatCurrency(1500.5);
    expect(result).toContain('1.500,50');
  });

  test('formatCurrency handles zero', () => {
    const result = formatCurrency(0);
    expect(result).toContain('0,00');
  });

  test('parseCurrency handles BR format (1.500,00)', () => {
    expect(parseCurrency('1.500,00')).toBe(1500);
  });

  test('parseCurrency handles US format (1500.00)', () => {
    expect(parseCurrency('1500.00')).toBe(1500);
  });

  test('parseCurrency handles R$ prefix', () => {
    expect(parseCurrency('R$ 1.500,00')).toBe(1500);
  });

  test('parseCurrency returns 0 for empty', () => {
    expect(parseCurrency('')).toBe(0);
  });

  test('roundMoney rounds to 2 decimal places', () => {
    expect(roundMoney(10.555)).toBe(10.56);
    expect(roundMoney(10.554)).toBe(10.55);
    expect(roundMoney(10)).toBe(10);
  });
});

// ============================================================================
// STRING UTILS
// ============================================================================

describe('String Utils', () => {
  test('normalizeString lowercases and removes accents', () => {
    expect(normalizeString('São Paulo')).toBe('sao paulo');
    expect(normalizeString('  Café  ')).toBe('cafe');
    expect(normalizeString('AÇÃO')).toBe('acao');
  });

  test('cleanString removes special characters', () => {
    expect(cleanString('abc-123!')).toBe('abc123');
    expect(cleanString('hello world')).toBe('hello world');
  });

  test('truncate respects maxLength', () => {
    expect(truncate('hello', 10)).toBe('hello');
    expect(truncate('hello world!', 8)).toBe('hello...');
  });

  test('extractNumbers returns only digits', () => {
    expect(extractNumbers('12.345.678/0001-99')).toBe('12345678000199');
    expect(extractNumbers('abc')).toBe('');
  });

  test('isValidCNPJ validates correct CNPJ', () => {
    expect(isValidCNPJ('11.222.333/0001-81')).toBe(true);
  });

  test('isValidCNPJ rejects invalid CNPJ', () => {
    expect(isValidCNPJ('00.000.000/0000-00')).toBe(false);
    expect(isValidCNPJ('123')).toBe(false);
    expect(isValidCNPJ('11.111.111/1111-11')).toBe(false);
  });

  test('formatCNPJ formats correctly', () => {
    expect(formatCNPJ('11222333000181')).toBe('11.222.333/0001-81');
  });

  test('formatCNPJ returns original for invalid length', () => {
    expect(formatCNPJ('123')).toBe('123');
  });
});

// ============================================================================
// RETRY UTILS
// ============================================================================

describe('Retry Utils', () => {
  test('withRetry succeeds on first try', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxRetries: 3, delayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('withRetry retries on failure', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { maxRetries: 3, delayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('withRetry throws after maxRetries', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fails'));

    await expect(
      withRetry(fn, { maxRetries: 2, delayMs: 10 })
    ).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  test('sleep waits approximately the specified time', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});

// ============================================================================
// LOGGER
// ============================================================================

describe('Logger', () => {
  test('createLogger returns logger with all methods', () => {
    const logger = createLogger('Test');
    expect(logger.info).toBeDefined();
    expect(logger.warn).toBeDefined();
    expect(logger.error).toBeDefined();
    expect(logger.debug).toBeDefined();
  });

  test('logger.info outputs to console', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    const logger = createLogger('MyModule');
    logger.info('hello');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[MyModule]'), expect.anything());
    spy.mockRestore();
  });

  test('logger.error outputs to console.error', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation();
    const logger = createLogger('Err');
    logger.error('oops', new Error('test'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[Err]'), 'test');
    spy.mockRestore();
  });
});

// ============================================================================
// BATCH UTILS
// ============================================================================

describe('Batch Utils', () => {
  test('processBatch processes all items', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await processBatch(items, 2, async (n) => n * 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  test('processBatch respects batch size', async () => {
    let maxConcurrent = 0;
    let current = 0;

    const items = [1, 2, 3, 4, 5];
    await processBatch(items, 2, async (n) => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await sleep(10);
      current--;
      return n;
    });

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  test('processBatchConcurrent processes all items', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await processBatchConcurrent(items, 3, async (n) => n * 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  test('processBatchConcurrent limits concurrency', async () => {
    let maxConcurrent = 0;
    let current = 0;

    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    await processBatchConcurrent(items, 3, async (n) => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await sleep(20);
      current--;
      return n;
    });

    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });
});
