/**
 * RateLimiter tests - uses in-memory mode (no AZURE_STORAGE_CONNECTION_STRING)
 */

// Ensure no storage connection for in-memory mode
delete process.env.AZURE_STORAGE_CONNECTION_STRING;

// Mock @azure/data-tables to avoid import errors
jest.mock('@azure/data-tables', () => ({
  TableClient: {
    fromConnectionString: jest.fn(),
  },
}));

import { RateLimiter } from '../infra/rateLimiter';

describe('RateLimiter (in-memory)', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  test('allows requests under limit', async () => {
    const result = await limiter.checkLimit('client-1', 10);
    expect(result).toBe(true);
  });

  test('increments counter on each check', async () => {
    for (let i = 0; i < 5; i++) {
      expect(await limiter.checkLimit('client-1', 10)).toBe(true);
    }
  });

  test('blocks requests at limit', async () => {
    // Use up the limit
    for (let i = 0; i < 3; i++) {
      await limiter.checkLimit('client-1', 3);
    }

    // Next one should be blocked
    const result = await limiter.checkLimit('client-1', 3);
    expect(result).toBe(false);
  });

  test('separate limits per client', async () => {
    // Max out client-1
    for (let i = 0; i < 2; i++) {
      await limiter.checkLimit('client-1', 2);
    }
    expect(await limiter.checkLimit('client-1', 2)).toBe(false);

    // client-2 should still be allowed
    expect(await limiter.checkLimit('client-2', 2)).toBe(true);
  });
});
