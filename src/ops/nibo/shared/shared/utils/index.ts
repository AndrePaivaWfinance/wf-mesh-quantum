/**
 * Shared Utils - Operações BPO
 *
 * Utilitários compartilhados entre todos os serviços.
 */

// ============================================================================
// DATE UTILS
// ============================================================================

/** Retorna data atual em ISO format */
export function nowISO(): string {
  return new Date().toISOString();
}

/** Retorna data atual em formato YYYY-MM-DD */
export function todayYMD(): string {
  return new Date().toISOString().split('T')[0];
}

/** Formata data para exibição BR */
export function formatDateBR(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('pt-BR');
}

/** Formata data e hora para exibição BR */
export function formatDateTimeBR(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('pt-BR');
}

/** Parse de data em diversos formatos */
export function parseDate(dateStr: string): Date | null {
  // Tenta ISO
  let d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;

  // Tenta DD/MM/YYYY
  const brMatch = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) {
    d = new Date(
      parseInt(brMatch[3]),
      parseInt(brMatch[2]) - 1,
      parseInt(brMatch[1])
    );
    if (!isNaN(d.getTime())) return d;
  }

  // Tenta YYYY-MM-DD
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    d = new Date(
      parseInt(isoMatch[1]),
      parseInt(isoMatch[2]) - 1,
      parseInt(isoMatch[3])
    );
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

/** Adiciona dias a uma data */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** Diferença em dias entre duas datas */
export function diffDays(date1: Date, date2: Date): number {
  const diffTime = Math.abs(date2.getTime() - date1.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// ============================================================================
// MONEY UTILS
// ============================================================================

/** Formata valor monetário BR */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

/** Parse de valor monetário (aceita "1.500,00" ou "1500.00") */
export function parseCurrency(value: string): number {
  if (!value) return 0;

  // Remove espaços e símbolo de moeda
  let clean = value.replace(/\s/g, '').replace(/R\$/g, '');

  // Se tem vírgula como decimal (BR format)
  if (clean.includes(',')) {
    clean = clean.replace(/\./g, '').replace(',', '.');
  }

  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

/** Arredonda para 2 casas decimais */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

// ============================================================================
// STRING UTILS
// ============================================================================

/** Normaliza string para comparação */
export function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Remove caracteres especiais */
export function cleanString(str: string): string {
  return str.replace(/[^a-zA-Z0-9\s]/g, '').trim();
}

/** Trunca string com ellipsis */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/** Extrai números de uma string */
export function extractNumbers(str: string): string {
  return str.replace(/\D/g, '');
}

/** Valida CNPJ */
export function isValidCNPJ(cnpj: string): boolean {
  const cleaned = extractNumbers(cnpj);
  if (cleaned.length !== 14) return false;

  // Validação básica de dígitos iguais
  if (/^(\d)\1+$/.test(cleaned)) return false;

  // Validação do dígito verificador
  let sum = 0;
  let weight = 5;

  for (let i = 0; i < 12; i++) {
    sum += parseInt(cleaned[i]) * weight;
    weight = weight === 2 ? 9 : weight - 1;
  }

  let digit = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (parseInt(cleaned[12]) !== digit) return false;

  sum = 0;
  weight = 6;

  for (let i = 0; i < 13; i++) {
    sum += parseInt(cleaned[i]) * weight;
    weight = weight === 2 ? 9 : weight - 1;
  }

  digit = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  return parseInt(cleaned[13]) === digit;
}

/** Formata CNPJ */
export function formatCNPJ(cnpj: string): string {
  const cleaned = extractNumbers(cnpj);
  if (cleaned.length !== 14) return cnpj;
  return cleaned.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    '$1.$2.$3/$4-$5'
  );
}

// ============================================================================
// RETRY UTILS
// ============================================================================

/** Configuração de retry */
export interface RetryConfig {
  maxRetries: number;
  delayMs: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
}

/** Executa função com retry */
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

/** Sleep helper */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// LOGGING UTILS
// ============================================================================

/** Cria logger com prefixo */
export function createLogger(prefix: string) {
  return {
    info: (message: string, data?: Record<string, unknown>) => {
      console.log(`[${prefix}] ${message}`, data ? JSON.stringify(data) : '');
    },
    warn: (message: string, data?: Record<string, unknown>) => {
      console.warn(`[${prefix}] ⚠️ ${message}`, data ? JSON.stringify(data) : '');
    },
    error: (message: string, error?: Error | unknown) => {
      console.error(
        `[${prefix}] ❌ ${message}`,
        error instanceof Error ? error.message : error
      );
    },
    debug: (message: string, data?: Record<string, unknown>) => {
      if (process.env.DEBUG === 'true') {
        console.log(`[${prefix}] 🔍 ${message}`, data ? JSON.stringify(data) : '');
      }
    },
  };
}

// ============================================================================
// BATCH UTILS
// ============================================================================

/** Processa array em batches */
export async function processBatch<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
  }

  return results;
}

/** Processa array em batches com concorrência limitada */
export async function processBatchConcurrent<T, R>(
  items: T[],
  concurrency: number,
  processor: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await processor(items[currentIndex]);
    }
  }

  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
}
