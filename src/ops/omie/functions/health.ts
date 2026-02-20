/**
 * Health Check - omie-ops
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

app.http('omie-health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'omie/health',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const omieConfigured = !!process.env.OMIE_APP_KEY && !!process.env.OMIE_APP_SECRET;

    return {
      status: omieConfigured ? 200 : 503,
      jsonBody: {
        status: omieConfigured ? 'healthy' : 'degraded',
        service: 'omie-ops (mesh)',
        timestamp: new Date().toISOString(),
        omie: omieConfigured ? 'configured' : 'not_configured',
      },
    };
  },
});
