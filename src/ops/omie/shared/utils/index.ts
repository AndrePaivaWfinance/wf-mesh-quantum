/**
 * Shared Utils - Omie Ops
 */

// ============================================================================
// RETRY UTILS
// ============================================================================

export interface RetryConfig {
  maxRetries: number;
  delayMs: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig
): Promise<T> {
  const { maxRetries, delayMs, backoffMultiplier = 2, maxDelayMs = 30000 } = config;

  let lastError: Error | undefined;
  let currentDelay = delayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries) {
        await sleep(currentDelay);
        currentDelay = Math.min(currentDelay * backoffMultiplier, maxDelayMs);
      }
    }
  }

  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// LOGGING UTILS
// ============================================================================

export function createLogger(prefix: string) {
  return {
    info: (message: string, data?: Record<string, unknown>) => {
      console.log(`[${prefix}] ${message}`, data ? JSON.stringify(data) : '');
    },
    warn: (message: string, data?: Record<string, unknown>) => {
      console.warn(`[${prefix}] ${message}`, data ? JSON.stringify(data) : '');
    },
    error: (message: string, error?: Error | unknown) => {
      console.error(
        `[${prefix}] ${message}`,
        error instanceof Error ? error.message : error
      );
    },
  };
}
