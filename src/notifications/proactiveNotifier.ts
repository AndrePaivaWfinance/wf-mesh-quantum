
import { createLogger } from '../../shared/utils';

const logger = createLogger('ProactiveNotifier');

export interface Notification {
    tipo: 'resumo' | 'alerta' | 'previsao' | 'sugestao';
    destinatario: string; // Email ou ID do usuário
    canal: 'email' | 'whatsapp' | 'dashboard';
    conteudo: string; // Markdown supported
    prioridade: 'baixa' | 'media' | 'alta';
    acoes?: Array<{
        label: string;
        url: string;
        tipo: 'link' | 'botao';
    }>;
    metadata?: any;
}

export class ProactiveNotifier {
    private readonly defaultChannel = 'email'; // Pode vir de config

    constructor() {
        // Inicializar clientes de envio (SendGrid, Twilio, etc.)
    }

    async sendDailySummary(clientId: string, summaryData: {
        processed: number;
        autoApproved: number;
        needsReview: number;
        anomalies: number;
        totalValue: number;
    }): Promise<void> {
        const message = `
# Resumo Diário de Operações - ${new Date().toLocaleDateString()}

Olá! Segue o resumo das operações de hoje para o cliente ${clientId}:

- **Processadas**: ${summaryData.processed} transações
- **Aprovadas Automaticamente**: ${summaryData.autoApproved} (Economia de tempo estimada: ${(summaryData.autoApproved * 0.5).toFixed(1)} min)
- **Requer Revisão**: ${summaryData.needsReview}
- **Anomalias Detectadas**: ${summaryData.anomalies}

Valor Total Processado: R$ ${summaryData.totalValue.toFixed(2)}

[Acessar Dashboard](https://app.wfinance.com.br/dashboard/${clientId})
    `;

        await this.notify({
            tipo: 'resumo',
            destinatario: `contato@${clientId}.com`, // TODO: Pegar do TenantConfig
            canal: 'email',
            prioridade: 'media',
            conteudo: message,
            acoes: [{ label: 'Ver Detalhes', url: `https://app.wfinance.com.br/dashboard/${clientId}`, tipo: 'link' }]
        });
    }

    async sendAlert(clientId: string, alert: {
        title: string;
        message: string;
        severity: 'alta' | 'critica';
        transactionId?: string;
    }): Promise<void> {
        const prefix = alert.severity === 'critica' ? '🚨 [URGENTE]' : '⚠️ [ALERTA]';

        await this.notify({
            tipo: 'alerta',
            destinatario: `admin@${clientId}.com`,
            canal: 'whatsapp', // Urgente vai no whats
            prioridade: 'alta',
            conteudo: `${prefix} ${alert.title}\n\n${alert.message}`,
            metadata: { transactionId: alert.transactionId }
        });
    }

    private async notify(notification: Notification): Promise<void> {
        // MOCK: Em produção, isso chamaria SendGrid/Twilio/Azure Communication Services
        logger.info(`[Notification] Enviando ${notification.tipo} via ${notification.canal} para ${notification.destinatario}`);
        logger.info(`[Content] ${notification.conteudo}`);

        // Simulate async delay
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}
