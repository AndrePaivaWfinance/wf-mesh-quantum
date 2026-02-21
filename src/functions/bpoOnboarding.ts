/**
 * BPO Onboarding - operacao-head
 *
 * POST /api/bpo/onboarding         - Executa onboarding (salva credenciais + testa)
 * GET  /api/bpo/onboarding/{id}    - Checklist do que falta
 *
 * Uso:
 *   POST /api/bpo/onboarding
 *   {
 *     "clientId": "uuid-do-cliente",
 *     "omie": { "appKey": "...", "appSecret": "..." },
 *     "santander": { "clientId": "...", "clientSecret": "...", "agencia": "1234", "conta": "56789" },
 *     "getnet": { "user": "...", "password": "...", "estabelecimento": "..." }
 *   }
 *
 * Resposta:
 *   {
 *     "clientId": "...",
 *     "tenantId": "oticas-rey",
 *     "nome": "Óticas Rey",
 *     "sources": {
 *       "omie":      { "configured": true,  "secretsSaved": true, "tested": true, "fields": [...] },
 *       "santander": { "configured": true,  "secretsSaved": true, "tested": false, "error": "..." },
 *       "getnet":    { "configured": false, "fields": [{"name": "Senha SFTP", "status": "missing"}] }
 *     },
 *     "ready": false,
 *     "nextSteps": ["getnet: preencher Senha SFTP Getnet", "santander: corrigir erro — ..."]
 *   }
 */

import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import {
  executeOnboarding,
  getOnboardingChecklist,
  OnboardingInput,
} from '../infra/onboardingService';

// POST /api/bpo/onboarding — executa onboarding
app.http('bpoOnboardingExecute', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'bpo/onboarding',
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    context.log('[bpoOnboarding] Execute requested');

    try {
      const body = (await request.json()) as OnboardingInput;

      if (!body.clientId) {
        return {
          status: 400,
          jsonBody: { error: 'clientId é obrigatório' },
        };
      }

      const result = await executeOnboarding(body);

      return {
        status: 200,
        jsonBody: result,
      };
    } catch (error: any) {
      context.error('[bpoOnboarding] Error:', error);

      const status = error.message?.includes('não encontrado') ? 404 : 500;
      return {
        status,
        jsonBody: { error: error.message },
      };
    }
  },
});

// GET /api/bpo/onboarding/{id} — checklist
app.http('bpoOnboardingChecklist', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'bpo/onboarding/{id}',
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    const clientId = request.params.id;
    context.log(`[bpoOnboarding] Checklist for ${clientId}`);

    try {
      if (!clientId) {
        return {
          status: 400,
          jsonBody: { error: 'clientId é obrigatório' },
        };
      }

      const result = await getOnboardingChecklist(clientId);

      return {
        status: 200,
        jsonBody: result,
      };
    } catch (error: any) {
      context.error('[bpoOnboarding] Error:', error);

      const status = error.message?.includes('não encontrado') ? 404 : 500;
      return {
        status,
        jsonBody: { error: error.message },
      };
    }
  },
});
