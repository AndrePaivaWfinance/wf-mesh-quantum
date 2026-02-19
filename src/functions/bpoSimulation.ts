/**
 * BPO Simulation & Workspace - operacao-head
 * 
 * POST /api/bpo/simulate
 * GET /api/bpo/workspace/{clientId}
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getOpenAIClient, isOpenAIConfigured, ADVANCED_MODEL } from '../ai/openaiClient';
import {
    getClient,
    getPendingAuthorizations,
    getPendingDoubts,
    getCyclesByDate,
    upsertClient
} from '../storage/tableClient';
import { createLogger, nowISO } from '../../shared/utils';

const logger = createLogger('BPOSimulation');

// Simulation Endpoint
app.http('bpoSimulate', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'bpo/simulate',
    handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
        const { clientId = 'test-client' } = await request.json() as { clientId?: string };

        logger.info(`Starting simulation for client: ${clientId}`);

        try {
            // Ensure client exists
            let client = await getClient(clientId);
            if (!client) {
                await upsertClient({
                    id: clientId,
                    name: 'Cliente de Teste (IA Simulação)',
                    email: 'teste@wfinance.com.br',
                    cnpj: '00.000.000/0001-91',
                    status: 'active',
                    config: {
                        nibo: { enabled: true },
                        omie: { enabled: true },
                        santander: { enabled: true }
                    }
                } as any);
            }

            let transactions: any[];

            // Try OpenAI first, fallback to mock data
            if (isOpenAIConfigured()) {
                try {
                    const openai = getOpenAIClient();
                    const prompt = `
                        Gere de 3 a 5 transações financeiras "sujas" para um extrato bancário.
                        As transações devem ser realistas para uma empresa brasileira.
                        Descrições devem ser abreviadas ou confusas (ex: "PAGTO NF 123 ENEL SP").

                        Retorne APENAS um JSON no formato:
                        {
                            "transactions": [
                                { "descricao": "...", "valor": -100.50, "data": "2026-02-18", "type": "saida" },
                                ...
                            ]
                        }
                    `;

                    const completion = await openai.chat.completions.create({
                        model: ADVANCED_MODEL,
                        messages: [{ role: 'user', content: prompt }],
                        response_format: { type: 'json_object' }
                    });

                    const simulatedData = JSON.parse(completion.choices[0].message.content || '{"transactions":[]}');
                    transactions = simulatedData.transactions;
                    logger.info(`Generated ${transactions.length} transactions via OpenAI`);
                } catch (aiError: any) {
                    logger.warn('OpenAI failed, using mock data:', aiError.message);
                    transactions = generateMockTransactions();
                }
            } else {
                logger.info('No OpenAI key configured, using mock transactions');
                transactions = generateMockTransactions();
            }

            return {
                status: 200,
                jsonBody: {
                    message: 'Simulação gerada com sucesso',
                    clientId,
                    source: isOpenAIConfigured() ? 'openai' : 'mock',
                    data: transactions
                }
            };

        } catch (error: any) {
            logger.error('Error in simulation:', error);
            return { status: 500, jsonBody: { error: error.message } };
        }
    }
});

// Workspace Details Endpoint
app.http('bpoWorkspace', {
    methods: ['GET'],
    authLevel: 'function',
    route: 'bpo/workspace/{clientId}',
    handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
        const clientId = request.params.clientId;

        try {
            const [client, authorizations, doubts, cycles] = await Promise.all([
                getClient(clientId),
                getPendingAuthorizations(clientId),
                getPendingDoubts(clientId),
                getCyclesByDate(new Date().toISOString().split('T')[0])
            ]);

            if (!client) return { status: 404, jsonBody: { error: 'Cliente não encontrado' } };

            return {
                status: 200,
                jsonBody: {
                    client,
                    operational: {
                        pendingAuthorizations: authorizations,
                        enrichmentDoubts: doubts,
                        activeIntegrations: client.config
                    },
                    strategic: {
                        // Mock DRE/KPIs based on existing data or constants for UI testing
                        kpis: {
                            runway: '14 meses',
                            burnRate: 'R$ 180k/mês',
                            contributionMargin: '63.1%'
                        }
                    }
                }
            };
        } catch (error: any) {
            return { status: 500, jsonBody: { error: error.message } };
        }
    }
});

// ============================================================================
// Mock Transaction Generator (fallback when OpenAI unavailable)
// ============================================================================

function generateMockTransactions(): any[] {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    const templates = [
        { descricao: 'PAGTO NF 4521 ENEL SP', valor: -1247.83, data: today, type: 'saida' },
        { descricao: 'TED REC LOJAS AMERICANAS LTDA', valor: 8500.00, data: today, type: 'entrada' },
        { descricao: 'DEB AUT VIVO TELECOMUNIC', valor: -389.90, data: yesterday, type: 'saida' },
        { descricao: 'PIX REC MARIA S OLIVEIRA', valor: 3200.00, data: today, type: 'entrada' },
        { descricao: 'PGTO BOL ALUGUEL IMO C MARTINS', valor: -4500.00, data: yesterday, type: 'saida' },
        { descricao: 'CRD GETNET VENDAS 18/02', valor: 12340.56, data: today, type: 'entrada' },
        { descricao: 'TAR MANUT CTA CORRENTE', valor: -67.50, data: yesterday, type: 'saida' },
        { descricao: 'DDA FORNEC DIST ALIM NORTE LTDA', valor: -2890.00, data: today, type: 'saida' },
    ];

    // Return 3-5 random transactions
    const count = 3 + Math.floor(Math.random() * 3);
    const shuffled = templates.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
}
