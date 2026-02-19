import * as df from 'durable-functions';
import { InvocationContext } from "@azure/functions";
import { ProactiveNotifier } from "../notifications/proactiveNotifier";

const notifier = new ProactiveNotifier();

// Activity: Send Daily Summary
export async function sendDailySummaryActivity(input: { clientId: string, summary: any }, context: InvocationContext): Promise<void> {
    await notifier.sendDailySummary(input.clientId, input.summary);
}

// Activity: Send Critical Alert
export async function sendAlertActivity(input: { clientId: string, alert: any }, context: InvocationContext): Promise<void> {
    await notifier.sendAlert(input.clientId, input.alert);
}

df.app.activity('sendDailySummaryActivity', {
    handler: sendDailySummaryActivity
});

df.app.activity('sendAlertActivity', {
    handler: sendAlertActivity
});
