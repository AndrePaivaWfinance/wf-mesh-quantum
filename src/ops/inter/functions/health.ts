/**
 * Health Check - inter-ops (integrado ao mesh)
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

app.http('inter-health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'inter/health',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const configured =
      !!process.env.INTER_CLIENT_ID && !!process.env.INTER_CLIENT_SECRET;

    return {
      status: configured ? 200 : 503,
      jsonBody: {
        status: configured ? 'healthy' : 'degraded',
        service: 'inter-ops (mesh)',
        timestamp: new Date().toISOString(),
        inter: configured ? 'configured' : 'not_configured',
        environment: process.env.INTER_ENVIRONMENT || 'production',
        hasCertificates: !!(process.env.INTER_CERT_BASE64 && process.env.INTER_KEY_BASE64),
      },
    };
  },
});
