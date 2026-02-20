/**
 * Shared Utils - Operações BPO (Inter)
 */

// ============================================================================
// DATE UTILS
// ============================================================================

export function nowISO(): string {
  return new Date().toISOString();
}

export function todayYMD(): string {
  return new Date().toISOString().split('T')[0];
}

export function formatDateBR(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('pt-BR');
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// ============================================================================
// MONEY UTILS
// ============================================================================

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

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
    debug: (message: string, data?: Record<string, unknown>) => {
      if (process.env.DEBUG === 'true') {
        console.log(`[${prefix}] ${message}`, data ? JSON.stringify(data) : '');
      }
    },
  };
}
