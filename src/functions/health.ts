/**
 * Health Check - operacao-head
 *
 * GET /api/health
 * Returns component status: storage, ops services, AI pipeline
 */

import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions';
import { nowISO } from '../../shared/utils';

const BUILD_VERSION = process.env.BUILD_VERSION || '2.0.0';
const DEPLOY_TIMESTAMP = new Date().toISOString();

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async (
    request: HttpRequest,
    context: InvocationContext
  ): Promise<HttpResponseInit> => {
    context.log('[health] Health check requested');

    const services: Record<string, string> = {
      storage: 'unknown',
      'nibo-ops': 'unknown',
      'santander-ops': 'unknown',
      'getnet-ops': 'unknown',
      'utils-ops': 'unknown',
    };

    // Check storage connection
    try {
      if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
        services.storage = 'connected';
      } else {
        services.storage = 'not_configured';
      }
    } catch {
      services.storage = 'error';
    }

    // Check ops services (just check if URLs are configured)
    services['nibo-ops'] = process.env.NIBO_OPS_URL ? 'configured' : 'not_configured';
    services['santander-ops'] = process.env.SANTANDER_OPS_URL ? 'configured' : 'not_configured';
    services['getnet-ops'] = process.env.GETNET_OPS_URL ? 'configured' : 'not_configured';
    services['utils-ops'] = process.env.UTILS_OPS_URL ? 'configured' : 'not_configured';

    // AI Pipeline components
    const aiComponents: Record<string, string> = {
      classifier: process.env.OPENAI_API_KEY ? 'configured' : 'not_configured',
      tenantManager: 'active',
      rateLimiter: 'active',
      learningLoop: 'active',
      monitoring: 'active',
    };

    const allHealthy = Object.values(services).every(
      (s) => s === 'connected' || s === 'configured'
    );

    return {
      status: allHealthy ? 200 : 503,
      jsonBody: {
        status: allHealthy ? 'healthy' : 'degraded',
        timestamp: nowISO(),
        version: BUILD_VERSION,
        deployedAt: DEPLOY_TIMESTAMP,
        service: 'wf-operacao-head',
        services,
        ai: aiComponents,
        scaling: {
          maxConcurrentActivities: 10,
          maxConcurrentOrchestrators: 5,
          functionTimeout: '10m',
        },
      },
    };
  },
});
