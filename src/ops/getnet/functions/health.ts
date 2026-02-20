/**
 * Health Check - getnet-ops (integrado ao mesh)
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

app.http('getnet-health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'getnet/health',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const getnetConfigured = !!(process.env.GETNET_USER && process.env.GETNET_PASS);

    return {
      status: getnetConfigured ? 200 : 503,
      jsonBody: {
        status: getnetConfigured ? 'healthy' : 'degraded',
        service: 'getnet-ops (mesh)',
        timestamp: new Date().toISOString(),
        sftp: getnetConfigured ? 'configured' : 'not_configured',
        host: 'sftp1.getnet.com.br',
      },
    };
  },
});
