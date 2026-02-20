/**
 * Health Check - santander-ops (integrado ao mesh)
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

app.http('santander-health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'santander/health',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const configured =
      !!process.env.SANTANDER_CLIENT_ID && !!process.env.SANTANDER_CLIENT_SECRET;

    return {
      status: configured ? 200 : 503,
      jsonBody: {
        status: configured ? 'healthy' : 'degraded',
        service: 'santander-ops (mesh)',
        timestamp: new Date().toISOString(),
        santander: configured ? 'configured' : 'not_configured',
        environment: process.env.SANTANDER_ENVIRONMENT || 'sandbox',
      },
    };
  },
});
