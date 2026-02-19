import * as df from 'durable-functions';
import { InvocationContext } from "@azure/functions";
import { LearningLoop, FeedbackRecord } from "../learning/learningLoop";

const learningLoop = new LearningLoop();

// Activity: Record Feedback
export async function recordFeedbackActivity(input: FeedbackRecord, context: InvocationContext): Promise<void> {
    await learningLoop.recordFeedback(input);
}

// Activity: Get Evaluation Metrics
export async function getModelMetricsActivity(input: any, context: InvocationContext): Promise<any> {
    return await learningLoop.evaluateModel();
}

df.app.activity('recordFeedbackActivity', {
    handler: recordFeedbackActivity
});

df.app.activity('getModelMetricsActivity', {
    handler: getModelMetricsActivity
});
