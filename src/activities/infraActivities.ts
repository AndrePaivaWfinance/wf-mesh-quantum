import * as df from 'durable-functions';
import { InvocationContext } from "@azure/functions";
import { TenantManager } from "../infra/tenantManager";
import { RateLimiter } from "../infra/rateLimiter";

const tenantManager = new TenantManager();
const rateLimiter = new RateLimiter();

// Activity: getTenantConfigActivity
export async function getTenantConfigActivity(input: { clientId: string }, context: InvocationContext): Promise<any> {
    const config = await tenantManager.getTenantConfig(input.clientId);
    return config;
}

// Activity: checkRateLimitActivity
export async function checkRateLimitActivity(input: { clientId: string, limit: number }, context: InvocationContext): Promise<boolean> {
    const allowed = await rateLimiter.checkLimit(input.clientId, input.limit);
    if (!allowed) {
        context.log(`[RateLimit] Client ${input.clientId} exceeded limit of ${input.limit}`);
    }
    return allowed;
}

df.app.activity('getTenantConfigActivity', {
    handler: getTenantConfigActivity
});

df.app.activity('checkRateLimitActivity', {
    handler: checkRateLimitActivity
});
