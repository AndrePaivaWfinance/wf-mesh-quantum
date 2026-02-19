/**
 * Load Test - Simulador de Carga Multi-Tenant
 * 
 * Simula N clientes processando transações simultaneamente.
 * Mede throughput, latência e taxa de erro.
 * 
 * Uso: npx ts-node src/test/loadTest.ts --clients 10 --transactions 50
 * Ou:  node dist/src/test/loadTest.js --clients 10 --transactions 50
 */

import { TenantMonitor, DailyMetrics } from '../infra/monitoring';
import { TenantManager } from '../infra/tenantManager';
import { RateLimiter } from '../infra/rateLimiter';
import { LearningLoop } from '../learning/learningLoop';

// Parse CLI args
function parseArgs(): { clients: number; transactions: number } {
    const args = process.argv.slice(2);
    let clients = 10;
    let transactions = 50;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--clients' && args[i + 1]) clients = parseInt(args[i + 1]);
        if (args[i] === '--transactions' && args[i + 1]) transactions = parseInt(args[i + 1]);
    }

    return { clients, transactions };
}

// Simulate processing a single transaction
async function simulateTransaction(clientId: string): Promise<{
    latencyMs: number;
    autoApproved: boolean;
    error?: string;
}> {
    const start = Date.now();

    // Simulate classification (50-200ms)
    await sleep(50 + Math.random() * 150);

    // Simulate matching (20-100ms)
    await sleep(20 + Math.random() * 80);

    // Simulate decision (10-50ms)
    await sleep(10 + Math.random() * 40);

    // 80% auto-approved, 15% escalated, 5% error
    const roll = Math.random();
    const error = roll > 0.95 ? `Simulated error for ${clientId}` : undefined;
    const autoApproved = roll < 0.80;

    return {
        latencyMs: Date.now() - start,
        autoApproved,
        error,
    };
}

async function runClientWorkload(
    clientId: string,
    txCount: number,
    tenantManager: TenantManager,
    rateLimiter: RateLimiter,
    monitor: TenantMonitor
): Promise<{
    clientId: string;
    totalMs: number;
    processed: number;
    autoApproved: number;
    errors: number;
    rateLimited: boolean;
}> {
    const start = Date.now();
    let processed = 0;
    let autoApproved = 0;
    let errors = 0;
    let rateLimited = false;

    // Get tenant config
    const config = await tenantManager.getTenantConfig(clientId);

    // Check rate limit
    const allowed = await rateLimiter.checkLimit(clientId, config.limits.maxTransactionsPerDay);
    if (!allowed) {
        rateLimited = true;
        return { clientId, totalMs: Date.now() - start, processed: 0, autoApproved: 0, errors: 0, rateLimited };
    }

    // Process transactions
    const classLatencies: number[] = [];
    const matchLatencies: number[] = [];
    const decisionLatencies: number[] = [];

    for (let i = 0; i < txCount; i++) {
        const result = await simulateTransaction(clientId);
        processed++;

        // Simulated phase latencies (roughly split)
        classLatencies.push(result.latencyMs * 0.5);
        matchLatencies.push(result.latencyMs * 0.3);
        decisionLatencies.push(result.latencyMs * 0.2);

        if (result.error) {
            errors++;
        } else if (result.autoApproved) {
            autoApproved++;
        }
    }

    // Record metrics
    await monitor.recordCycleResult(clientId, {
        transactionsTotal: processed,
        autoApproved,
        escalated: processed - autoApproved - errors,
        failed: errors,
        classificationLatencyMs: avg(classLatencies),
        matchingLatencyMs: avg(matchLatencies),
        decisionLatencyMs: avg(decisionLatencies),
        totalCycleTimeMs: Date.now() - start,
    });

    return { clientId, totalMs: Date.now() - start, processed, autoApproved, errors, rateLimited };
}

function avg(arr: number[]): number {
    return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Percentile calculator
function percentile(arr: number[], p: number): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * p);
    return sorted[Math.min(idx, sorted.length - 1)];
}

async function main() {
    const { clients, transactions } = parseArgs();

    console.log(`\n🚀 Load Test: ${clients} clientes × ${transactions} transações`);
    console.log(`   Total esperado: ${clients * transactions} transações\n`);

    const tenantManager = new TenantManager();
    const rateLimiter = new RateLimiter();
    const monitor = new TenantMonitor();

    const globalStart = Date.now();

    // Run all clients in parallel
    const clientIds = Array.from({ length: clients }, (_, i) => `load-test-client-${String(i + 1).padStart(3, '0')}`);

    const results = await Promise.all(
        clientIds.map(id => runClientWorkload(id, transactions, tenantManager, rateLimiter, monitor))
    );

    const globalDuration = Date.now() - globalStart;

    // Aggregate results
    const totalProcessed = results.reduce((s, r) => s + r.processed, 0);
    const totalAutoApproved = results.reduce((s, r) => s + r.autoApproved, 0);
    const totalErrors = results.reduce((s, r) => s + r.errors, 0);
    const totalRateLimited = results.filter(r => r.rateLimited).length;
    const latencies = results.map(r => r.totalMs);

    console.log('═══════════════════════════════════════');
    console.log('  📊 RESULTADOS DO LOAD TEST');
    console.log('═══════════════════════════════════════');
    console.log(`  Clientes:           ${clients}`);
    console.log(`  Transações/cliente: ${transactions}`);
    console.log(`  Total processado:   ${totalProcessed}`);
    console.log(`  Auto-aprovado:      ${totalAutoApproved} (${Math.round(totalAutoApproved / totalProcessed * 100)}%)`);
    console.log(`  Erros:              ${totalErrors}`);
    console.log(`  Rate Limited:       ${totalRateLimited} clientes`);
    console.log('───────────────────────────────────────');
    console.log(`  Tempo total:        ${globalDuration}ms`);
    console.log(`  Throughput:         ${Math.round(totalProcessed / (globalDuration / 1000))} tx/s`);
    console.log(`  Latência P50:       ${Math.round(percentile(latencies, 0.5))}ms`);
    console.log(`  Latência P95:       ${Math.round(percentile(latencies, 0.95))}ms`);
    console.log(`  Latência P99:       ${Math.round(percentile(latencies, 0.99))}ms`);
    console.log('═══════════════════════════════════════\n');
}

main().catch(console.error);
