/**
 * Health Check - controlle-ops
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

app.http('controlle-health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'controlle/health',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const controlleConfigured = !!process.env.CONTROLLE_API_KEY;

    return {
      status: controlleConfigured ? 200 : 503,
      jsonBody: {
        status: controlleConfigured ? 'healthy' : 'degraded',
        service: 'controlle-ops (mesh)',
        timestamp: new Date().toISOString(),
        controlle: controlleConfigured ? 'configured' : 'not_configured',
      },
    };
  },
});
