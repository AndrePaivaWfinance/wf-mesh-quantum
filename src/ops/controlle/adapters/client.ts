/**
 * Controlle API Client
 *
 * Controlle (antigo Organizze) usa REST API com autenticacao por API Key (Basic Auth).
 * Base64(email:apikey) no header Authorization.
 *
 * Documentacao: https://api.controlle.com/docs
 */

import { createLogger, withRetry } from '../shared/utils';
import {
  ControlleLancamento,
  ControlleCategoria,
  ControlleContato,
  ControlleConta,
  ControllePayable,
  ControlleReceivable,
  ControlleConnectionTest,
} from './types';

const logger = createLogger('ControlleClient');

// ============================================================================
// CLIENT CLASS
// ============================================================================

export class ControlleClient {
  private apiKey: string;
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.controlle.com/v1';

    // Controlle uses Basic Auth with email:apikey
    // The API key already encodes the auth
    this.headers = {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    logger.info('Controlle client initialized');
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    params?: Record<string, string>,
    data?: unknown
  ): Promise<T[]> {
    const url = new URL(`${this.baseUrl}${endpoint}`);

    if (params && method === 'GET') {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    try {
      const response = await withRetry(
        async () => {
          const res = await fetch(url.toString(), {
            method,
            headers: this.headers,
            body: method !== 'GET' && data ? JSON.stringify(data) : undefined,
          });

          if (!res.ok) {
            const error = await res.text();
            throw new Error(`Controlle API error ${res.status}: ${error}`);
          }

          return res.json();
        },
        { maxRetries: 3, delayMs: 1000 }
      );

      if (Array.isArray(response)) {
        return response as T[];
      }

      return [response as T];
    } catch (error) {
      logger.error(`Request failed: ${endpoint}`, error);
      return [];
    }
  }

  private async requestSingle<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    params?: Record<string, string>,
    data?: unknown
  ): Promise<T | null> {
    const results = await this.request<T>(endpoint, method, params, data);
    return results[0] || null;
  }

  // ============================================================================
  // LANCAMENTOS (Transactions)
  // ============================================================================

  async getLancamentos(
    startDate?: string,
    endDate?: string,
    type?: 'expense' | 'income'
  ): Promise<ControlleLancamento[]> {
    const params: Record<string, string> = {};

    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    if (type) params.type = type;

    return this.request<ControlleLancamento>('/transactions', 'GET', params);
  }

  async getPayables(startDate: string, endDate: string): Promise<ControllePayable[]> {
    const lancamentos = await this.getLancamentos(startDate, endDate, 'expense');

    return lancamentos
      .filter((l) => (l.amount_cents || 0) < 0) // Expenses are negative
      .map((l) => {
        const value = Math.abs(l.amount_cents || 0) / 100;
        const isPaid = !!l.paid;
        const isOverdue = !isPaid && l.date && new Date(l.date) < new Date();

        return {
          id: String(l.id || ''),
          description: l.description || '',
          dueDate: l.date || '',
          competencyDate: l.competency_date || undefined,
          value,
          paidValue: isPaid ? value : 0,
          openValue: isPaid ? 0 : value,
          status: isPaid ? 'Pago' as const : isOverdue ? 'Vencido' as const : 'Pendente' as const,
          supplier: String(l.contact_id || ''),
          category: String(l.category_id || ''),
          categoryId: l.category_id ? String(l.category_id) : undefined,
          paymentDate: l.payment_date || undefined,
          notes: l.notes || undefined,
        };
      });
  }

  async getReceivables(startDate: string, endDate: string): Promise<ControlleReceivable[]> {
    const lancamentos = await this.getLancamentos(startDate, endDate, 'income');

    return lancamentos
      .filter((l) => (l.amount_cents || 0) > 0) // Income is positive
      .map((l) => {
        const value = (l.amount_cents || 0) / 100;
        const isReceived = !!l.paid;
        const isOverdue = !isReceived && l.date && new Date(l.date) < new Date();

        return {
          id: String(l.id || ''),
          description: l.description || '',
          dueDate: l.date || '',
          competencyDate: l.competency_date || undefined,
          value,
          paidValue: isReceived ? value : 0,
          openValue: isReceived ? 0 : value,
          status: isReceived ? 'Recebido' as const : isOverdue ? 'Vencido' as const : 'Pendente' as const,
          customer: String(l.contact_id || ''),
          category: String(l.category_id || ''),
          categoryId: l.category_id ? String(l.category_id) : undefined,
          paymentDate: l.payment_date || undefined,
          notes: l.notes || undefined,
        };
      });
  }

  // ============================================================================
  // CATEGORIAS
  // ============================================================================

  async getCategorias(): Promise<ControlleCategoria[]> {
    return this.request<ControlleCategoria>('/categories');
  }

  // ============================================================================
  // CONTATOS
  // ============================================================================

  async getContatos(): Promise<ControlleContato[]> {
    return this.request<ControlleContato>('/contacts');
  }

  async getContatoById(id: number): Promise<ControlleContato | null> {
    return this.requestSingle<ControlleContato>(`/contacts/${id}`);
  }

  // ============================================================================
  // CONTAS BANCARIAS
  // ============================================================================

  async getContas(): Promise<ControlleConta[]> {
    return this.request<ControlleConta>('/accounts');
  }

  // ============================================================================
  // CONNECTION TEST
  // ============================================================================

  async testConnection(): Promise<ControlleConnectionTest> {
    try {
      const accounts = await this.getContas();

      return {
        connected: accounts.length > 0,
        apiUrl: this.baseUrl,
        environment: 'production',
        mode: accounts.length > 0 ? 'LIVE' : 'ERROR',
      };
    } catch (error) {
      return {
        connected: false,
        apiUrl: this.baseUrl,
        environment: 'production',
        mode: 'ERROR',
        error: String(error),
      };
    }
  }
}

// ============================================================================
// FACTORY
// ============================================================================

let clientInstance: ControlleClient | null = null;

export function getControlleClient(): ControlleClient {
  if (!clientInstance) {
    const apiKey = process.env.CONTROLLE_API_KEY;
    if (!apiKey) {
      throw new Error('CONTROLLE_API_KEY not configured');
    }
    clientInstance = new ControlleClient(apiKey);
  }
  return clientInstance;
}

export function resetControlleClient(): void {
  clientInstance = null;
}
