/**
 * RateLimiter - Proteção por Tenant
 *
 * Controla taxa de requisições por cliente usando Azure Table Storage.
 * Janela: 1 hora (PK: clientId, RK: YYYY-MM-DD-HH).
 * Fallback: in-memory para dev/local.
 */

import { TableClient, TableEntity } from '@azure/data-tables';
import { createLogger } from '../../shared/utils';

const logger = createLogger('RateLimiter');

const TABLE_NAME = 'OperacaoRateLimits';

export class RateLimiter {
    private inMemoryStore: Map<string, number> = new Map();
    private tableClient: TableClient | null = null;
    private useStorage: boolean;

    constructor() {
        const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
        this.useStorage = !!connStr;

        if (connStr) {
            this.tableClient = TableClient.fromConnectionString(connStr, TABLE_NAME);
            // Ensure table exists (fire-and-forget at startup)
            this.tableClient.createTable().catch(() => { });
        } else {
            logger.warn('No storage connection string. Using in-memory rate limiter.');
        }
    }

    async checkLimit(clientId: string, limit: number): Promise<boolean> {
        const windowKey = this.getWindowKey();

        if (this.useStorage && this.tableClient) {
            return this.checkLimitStorage(clientId, windowKey, limit);
        }
        return this.checkLimitMemory(clientId, windowKey, limit);
    }

    private async checkLimitStorage(clientId: string, windowKey: string, limit: number): Promise<boolean> {
        try {
            let currentCount = 0;

            try {
                const entity = await this.tableClient!.getEntity<TableEntity>(clientId, windowKey);
                currentCount = (entity.count as number) || 0;
            } catch (err: any) {
                if (err.statusCode !== 404) throw err;
                // Entity doesn't exist yet, count = 0
            }

            if (currentCount >= limit) {
                logger.warn(`Rate limit exceeded for ${clientId}: ${currentCount}/${limit}`);
                return false;
            }

            // Increment counter
            await this.tableClient!.upsertEntity({
                partitionKey: clientId,
                rowKey: windowKey,
                count: currentCount + 1,
                updatedAt: new Date().toISOString(),
            }, 'Merge');

            return true;
        } catch (error) {
            logger.error('Error checking rate limit in storage, falling back to allow', error as Error);
            return true; // Fail open — don't block clients due to storage issues
        }
    }

    private checkLimitMemory(clientId: string, windowKey: string, limit: number): boolean {
        const key = `${clientId}:${windowKey}`;
        const current = this.inMemoryStore.get(key) || 0;

        if (current >= limit) {
            logger.warn(`[Memory] Rate limit exceeded for ${clientId}: ${current}/${limit}`);
            return false;
        }

        this.inMemoryStore.set(key, current + 1);
        return true;
    }

    private getWindowKey(): string {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}-${hh}`;
    }
}
