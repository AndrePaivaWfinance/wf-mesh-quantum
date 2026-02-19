
/**
 * Teste Manual de Integração (Infra + AI)
 * Simula o fluxo do `clientProcessingOrchestrator` e `aiProcessingActivity`
 */

const { TenantManager } = require('./tenantManager');
const { RateLimiter } = require('./rateLimiter');
const { AdvancedClassifier } = require('../ai/advancedClassifier');
const { DecisionEngine } = require('../ai/decisionEngine');

async function testFullFlow() {
    console.log('--- Iniciando Teste de Integração (Infra + AI) ---\n');

    // 1. Setup Infra
    const tenantManager = new TenantManager();
    const rateLimiter = new RateLimiter();
    const clientId = 'teste-manual-001';

    // 2. Simular Check de Config e Limites
    console.log(`[Infra] Buscando config para ${clientId}...`);
    const config = await tenantManager.getTenantConfig(clientId);
    console.log(`[Infra] Config encontrada: Plano ${config.plan}`);

    console.log(`[Infra] Verificando Rate Limit...`);
    const allowed = await rateLimiter.checkLimit(clientId, config.limits.maxTransactionsPerDay);
    if (!allowed) {
        console.error('FAIL: Rate limit bloqueou indevidamente.');
        return;
    }
    console.log('[Infra] Rate Limit OK.');

    // 3. Simular Captura (Mock)
    const transactions = [
        {
            id: 'tx-001',
            clientId,
            descricao: 'PGTO FORNECEDOR XYZ',
            valor: -1500.00,
            data: new Date().toISOString(),
            metadata: {}
        },
        {
            id: 'tx-002',
            clientId,
            descricao: 'RECEBIMENTO CLIENTE ABC',
            valor: 5000.00,
            data: new Date().toISOString(),
            metadata: {}
        }
    ];
    console.log(`[Capture] ${transactions.length} transações capturadas.`);

    // 4. Simular AI Pipeline
    console.log('\n[AI] Iniciando Pipeline de Processamento...');

    // Nota: Usando mocks internos do Classifier para não gastar API real, 
    // mas instanciando a classe real para testar a lógica
    const classifier = new AdvancedClassifier('mock-key');
    const decisionEngine = new DecisionEngine();

    for (const tx of transactions) {
        console.log(`\n  Processando: ${tx.descricao} (${tx.valor})`);

        // Classify
        // Mockando resultado do classify para este teste manual já que não temos API Key real no env deste script
        const classification = {
            categoria: 'Fornecedores',
            confianca: 0.95,
            explicacao: 'Mock classification'
        };
        // Em produção seria: await classifier.classify(tx);

        console.log(`  -> Classificado: ${classification.categoria} (${(classification.confianca * 100).toFixed(0)}%)`);

        // Decision
        // Usando DecisionEngine real
        const decision = decisionEngine.decide(tx, classification, [], undefined); // Sem anomalias/match por enquanto
        console.log(`  -> Decisão: ${decision.acao.toUpperCase()} (Razão: ${decision.razao})`);

        if (decision.acao === 'categorizar_auto' || decision.acao === 'sync_auto') {
            console.log('  -> AÇÃO: Transação atualizada automaticamente.');
        }
    }

    console.log('\n--- Teste Finalizado com Sucesso ---');
}

testFullFlow().catch(console.error);
