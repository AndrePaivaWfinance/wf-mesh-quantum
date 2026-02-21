
import { createLogger } from '../../shared/utils';
import { Client } from '../../shared/types';

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
    private readonly defaultChannel = 'email';

    constructor() {
        // Inicializar clientes de envio (SendGrid, Twilio, etc.)
    }

    /**
     * Resolve o email de destino a partir do config do cliente
     */
    private getEmailDestinatario(clientId: string, clientConfig?: Client['config']): string {
        if (clientConfig?.notificacoes?.emailDestino) {
            return clientConfig.notificacoes.emailDestino;
        }
        // Fallback para email padrão baseado no clientId
        return `operacoes@wfinance.com.br`;
    }

    /**
     * Resolve o número WhatsApp a partir do config do cliente
     */
    private getWhatsappDestinatario(clientId: string, clientConfig?: Client['config']): string {
        if (clientConfig?.notificacoes?.whatsappNumero) {
            return clientConfig.notificacoes.whatsappNumero;
        }
        return '';
    }

    async sendDailySummary(clientId: string, summaryData: {
        processed: number;
        autoApproved: number;
        needsReview: number;
        anomalies: number;
        totalValue: number;
    }, clientConfig?: Client['config']): Promise<void> {
        const message = `
# Resumo Diario de Operacoes - ${new Date().toLocaleDateString('pt-BR')}

Ola! Segue o resumo das operacoes de hoje para o cliente ${clientId}:

- **Processadas**: ${summaryData.processed} transacoes
- **Aprovadas Automaticamente**: ${summaryData.autoApproved} (Economia de tempo estimada: ${(summaryData.autoApproved * 0.5).toFixed(1)} min)
- **Requer Revisao**: ${summaryData.needsReview}
- **Anomalias Detectadas**: ${summaryData.anomalies}

Valor Total Processado: R$ ${summaryData.totalValue.toFixed(2)}

[Acessar Dashboard](https://app.wfinance.com.br/dashboard/${clientId})
    `;

        const destinatario = this.getEmailDestinatario(clientId, clientConfig);

        await this.notify({
            tipo: 'resumo',
            destinatario,
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
    }, clientConfig?: Client['config']): Promise<void> {
        const prefix = alert.severity === 'critica' ? '[URGENTE]' : '[ALERTA]';
        const whatsapp = this.getWhatsappDestinatario(clientId, clientConfig);
        const useWhatsapp = !!whatsapp && clientConfig?.notificacoes?.whatsapp;

        await this.notify({
            tipo: 'alerta',
            destinatario: useWhatsapp ? whatsapp : this.getEmailDestinatario(clientId, clientConfig),
            canal: useWhatsapp ? 'whatsapp' : 'email',
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
