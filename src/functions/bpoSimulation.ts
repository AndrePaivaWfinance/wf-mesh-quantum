/**
 * BPO Simulation & Workspace - operacao-head
 * 
 * POST /api/bpo/simulate
 * GET /api/bpo/workspace/{clientId}
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import OpenAI from 'openai';
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

            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

            // Generate 3-5 random "dirty" transactions
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
                model: 'gpt-4-turbo-preview',
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: 'json_object' }
            });

            const simulatedData = JSON.parse(completion.choices[0].message.content || '{"transactions":[]}');

            // In a real scenario, we would save these to OperacaoTransactions
            // For the simulation demo, we return them directly

            return {
                status: 200,
                jsonBody: {
                    message: 'Simulação gerada com sucesso',
                    clientId,
                    data: simulatedData.transactions
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
