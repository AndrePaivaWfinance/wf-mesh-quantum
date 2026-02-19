/**
 * TenantManager - Multi-Tenant Configuration
 * 
 * Lê configurações do cliente a partir da tabela Clientes (real)
 * e mapeia o plano do cliente para features e limites.
 * 
 * Cache em memória com TTL de 5 min para evitar leituras frequentes.
 */

import { getClientById } from '../../shared/storage/clientStorage';
import { Client, ClientPlano } from '../../shared/types';
import { createLogger } from '../../shared/utils';

const logger = createLogger('TenantManager');

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

export interface TenantConfig {
    clientId: string;
    tenantId: string;
    plan: string;
    features: {
        aiClassification: boolean;
        autoSync: boolean;
        anomalyDetection: boolean;
        smartMatching: boolean;
        proactiveNotifications: boolean;
    };
    limits: {
        maxTransactionsPerDay: number;
        maxHistoryRetentionDays: number;
        maxConcurrentCaptures: number;
    };
}

interface CacheEntry {
    config: TenantConfig;
    expiresAt: number;
}

// Mapeamento Plano -> Features/Limites
const PLAN_CONFIGS: Record<string, Omit<TenantConfig, 'clientId' | 'tenantId' | 'plan'>> = {
    [ClientPlano.ESSENCIAL]: {
        features: {
            aiClassification: true,
            autoSync: false,
            anomalyDetection: false,
            smartMatching: false,
            proactiveNotifications: false,
        },
        limits: {
            maxTransactionsPerDay: 200,
            maxHistoryRetentionDays: 90,
            maxConcurrentCaptures: 1,
        },
    },
    [ClientPlano.AVANCADO]: {
        features: {
            aiClassification: true,
            autoSync: true,
            anomalyDetection: true,
            smartMatching: true,
            proactiveNotifications: true,
        },
        limits: {
            maxTransactionsPerDay: 1000,
            maxHistoryRetentionDays: 365,
            maxConcurrentCaptures: 3,
        },
    },
    [ClientPlano.PREMIUM]: {
        features: {
            aiClassification: true,
            autoSync: true,
            anomalyDetection: true,
            smartMatching: true,
            proactiveNotifications: true,
        },
        limits: {
            maxTransactionsPerDay: 10000,
            maxHistoryRetentionDays: 3650,
            maxConcurrentCaptures: 10,
        },
    },
};

// Fallback para planos não mapeados
const DEFAULT_CONFIG = PLAN_CONFIGS[ClientPlano.ESSENCIAL];

export class TenantManager {
    private cache: Map<string, CacheEntry> = new Map();

    async getTenantConfig(clientId: string): Promise<TenantConfig> {
        // 1. Check cache
        const cached = this.cache.get(clientId);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.config;
        }

        // 2. Load from storage
        const client = await getClientById(clientId);

        if (!client) {
            logger.warn(`Client ${clientId} not found in storage, using defaults`);
            return this.buildDefaultConfig(clientId);
        }

        const config = this.buildConfigFromClient(client);

        // 3. Cache
        this.cache.set(clientId, {
            config,
            expiresAt: Date.now() + CACHE_TTL_MS,
        });

        logger.info(`Loaded config for ${clientId}: plan=${config.plan}`);
        return config;
    }

    invalidateCache(clientId: string): void {
        this.cache.delete(clientId);
    }

    invalidateAll(): void {
        this.cache.clear();
    }

    private buildConfigFromClient(client: Client): TenantConfig {
        const planConfig = PLAN_CONFIGS[client.plano] || DEFAULT_CONFIG;

        return {
            clientId: client.id,
            tenantId: client.tenantId,
            plan: client.plano,
            ...planConfig,
        };
    }

    private buildDefaultConfig(clientId: string): TenantConfig {
        return {
            clientId,
            tenantId: clientId,
            plan: ClientPlano.ESSENCIAL,
            ...DEFAULT_CONFIG,
        };
    }
}
