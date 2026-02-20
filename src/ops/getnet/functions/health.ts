/**
 * Health Check - getnet-ops (integrado ao mesh)
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';

app.http('getnet-health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'getnet/health',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const hasUser = !!process.env.GETNET_USER;

    let hasPassword = false;
    try {
      const credential = new DefaultAzureCredential();
      const client = new SecretClient('https://kv-wf-core.vault.azure.net', credential);
      const secret = await client.getSecret('GETNET-PASS');
      hasPassword = !!secret.value;
    } catch {
      hasPassword = false;
    }

    const configured = hasUser && hasPassword;

    return {
      status: configured ? 200 : 503,
      jsonBody: {
        status: configured ? 'healthy' : 'degraded',
        service: 'getnet-ops (mesh)',
        timestamp: new Date().toISOString(),
        sftp: configured ? 'configured' : 'not_configured',
        host: 'getsftp2.getnet.com.br',
        user: hasUser ? 'ok' : 'missing',
        password: hasPassword ? 'ok (kv)' : 'missing (kv)',
      },
    };
  },
});
