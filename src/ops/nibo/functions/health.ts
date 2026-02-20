/**
 * Health Check - nibo-ops (integrado ao mesh)
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

app.http('nibo-health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'nibo/health',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const niboConfigured = !!process.env.NIBO_API_KEY;

    return {
      status: niboConfigured ? 200 : 503,
      jsonBody: {
        status: niboConfigured ? 'healthy' : 'degraded',
        service: 'nibo-ops (mesh)',
        timestamp: new Date().toISOString(),
        nibo: niboConfigured ? 'configured' : 'not_configured',
      },
    };
  },
});
