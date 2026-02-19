/**
 * Daily Trigger - operacao-head
 *
 * Timer trigger que executa diariamente às 6h
 * Inicia o ciclo de processamento para todos os clientes ativos
 */

import { app, InvocationContext, Timer } from '@azure/functions';
import * as df from 'durable-functions';
import { createCycle, getActiveClients } from '../storage/tableClient';
import { todayYMD, createLogger } from '../../shared/utils';

const logger = createLogger('DailyTrigger');

app.timer('dailyTrigger', {
  // Executa às 6:00 AM (UTC-3 = 9:00 UTC)
  schedule: '0 0 9 * * *',
  extraInputs: [df.input.durableClient()],
  handler: async (timer: Timer, context: InvocationContext): Promise<void> => {
    logger.info('Daily trigger started', {
      scheduledTime: timer.scheduleStatus?.last,
      isPastDue: timer.isPastDue,
    });

    if (timer.isPastDue) {
      logger.warn('Timer is past due, proceeding anyway');
    }

    try {
      // Get active clients
      const clients = await getActiveClients();

      if (clients.length === 0) {
        logger.info('No active clients found, skipping cycle');
        return;
      }

      logger.info(`Found ${clients.length} active clients`);

      // Create cycle record
      const date = todayYMD();
      const cycle = await createCycle(date);

      logger.info(`Created cycle: ${cycle.id}`);

      // Start orchestrator
      const durableClient = df.getClient(context);
      const instanceId = await durableClient.startNew('dailyCycleOrchestrator', {
        instanceId: cycle.id,
        input: {
          cycleId: cycle.id,
          date,
          clientIds: clients.map((c) => c.id),
          force: false,
        },
      });

      logger.info(`Started orchestrator: ${instanceId}`, {
        cycleId: cycle.id,
        clientCount: clients.length,
      });
    } catch (error) {
      logger.error('Error in daily trigger', error);
      throw error;
    }
  },
});
