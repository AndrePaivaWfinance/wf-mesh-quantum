/**
 * Omie API Client
 *
 * A API do Omie usa JSON-RPC sobre HTTP POST.
 * Cada request envia app_key + app_secret no body.
 *
 * Documentacao: https://developer.omie.com.br/
 */

import { createLogger, withRetry } from '../shared/utils';
import {
  OmieApiRequest,
  OmieContaPagar,
  OmieContaReceber,
  OmieCategoria,
  OmieClienteFornecedor,
  OmieContaCorrente,
  OmiePayable,
  OmieReceivable,
  OmieConnectionTest,
  OmieUpsertClienteRequest,
  OmieUpsertClienteResponse,
  OmieUpsertContaPagarRequest,
  OmieUpsertContaPagarResponse,
  OmieUpsertContaReceberRequest,
  OmieUpsertContaReceberResponse,
} from './types';

const logger = createLogger('OmieClient');

// ============================================================================
// DATE UTILS
// ============================================================================

/** Convert YYYY-MM-DD to DD/MM/YYYY (Omie format) */
export function toOmieDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

/** Convert DD/MM/YYYY (Omie format) to YYYY-MM-DD */
export function fromOmieDate(omieDate: string): string {
  if (!omieDate) return '';
  const [day, month, year] = omieDate.split('/');
  return `${year}-${month}-${day}`;
}

// ============================================================================
// CLIENT CLASS
// ============================================================================

export class OmieClient {
  private appKey: string;
  private appSecret: string;
  private baseUrl: string;

  constructor(appKey: string, appSecret: string) {
    this.appKey = appKey;
    this.appSecret = appSecret;
    this.baseUrl = 'https://app.omie.com.br/api/v1';

    logger.info('Omie client initialized');
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private async request<T>(endpoint: string, call: string, params: unknown[] = [{}]): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const body: OmieApiRequest = {
      call,
      app_key: this.appKey,
      app_secret: this.appSecret,
      param: params,
    };

    try {
      const result = await withRetry(
        async () => {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            const error = await res.text();
            throw new Error(`Omie API error ${res.status}: ${error}`);
          }

          return res.json();
        },
        { maxRetries: 3, delayMs: 1000 }
      );

      return result as T;
    } catch (error) {
      logger.error(`Request failed: ${endpoint} ${call}`, error);
      throw error;
    }
  }

  /** Fetch all pages from a paginated Omie endpoint */
  private async requestAllPages<T>(
    endpoint: string,
    call: string,
    listField: string,
    baseParams: Record<string, unknown> = {}
  ): Promise<T[]> {
    const allItems: T[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const params = {
        ...baseParams,
        pagina: page,
        registros_por_pagina: 500,
      };

      const response = await this.request<Record<string, unknown>>(endpoint, call, [params]);

      totalPages = (response.total_de_paginas as number) || 1;
      const items = (response[listField] as T[]) || [];
      allItems.push(...items);

      logger.info(`Page ${page}/${totalPages}: ${items.length} items`);
      page++;
    } while (page <= totalPages);

    return allItems;
  }

  // ============================================================================
  // CONTAS A PAGAR
  // ============================================================================

  async getContasPagar(
    startDate?: string,
    endDate?: string,
    status?: string
  ): Promise<OmieContaPagar[]> {
    const params: Record<string, unknown> = {};

    if (startDate) params.filtrar_por_data_de = toOmieDate(startDate);
    if (endDate) params.filtrar_por_data_ate = toOmieDate(endDate);
    if (status) params.filtrar_por_status = status;

    return this.requestAllPages<OmieContaPagar>(
      '/financas/contapagar/',
      'ListarContasPagar',
      'conta_pagar_cadastro',
      params
    );
  }

  async getPayables(startDate: string, endDate: string): Promise<OmiePayable[]> {
    const contas = await this.getContasPagar(startDate, endDate);

    return contas.map((c) => {
      const isPaid = c.status_titulo === 'LIQUIDADO';
      const isOverdue = c.status_titulo === 'VENCIDO' ||
        (!isPaid && c.data_vencimento && new Date(fromOmieDate(c.data_vencimento)) < new Date());

      return {
        id: String(c.codigo_lancamento_omie || c.codigo_lancamento_integracao || ''),
        description: c.observacao || c.numero_documento || 'Conta a pagar',
        dueDate: c.data_vencimento ? fromOmieDate(c.data_vencimento) : '',
        accrualDate: c.data_emissao ? fromOmieDate(c.data_emissao) : undefined,
        value: c.valor_documento || 0,
        paidValue: c.valor_pagamento || 0,
        openValue: isPaid ? 0 : (c.valor_documento || 0) - (c.valor_pagamento || 0),
        status: isPaid ? 'Pago' : isOverdue ? 'Vencido' : 'Pendente',
        supplier: String(c.codigo_cliente_fornecedor || ''),
        category: c.codigo_categoria || '',
        categoryId: c.codigo_categoria,
        paymentDate: c.data_pagamento ? fromOmieDate(c.data_pagamento) : undefined,
        documentNumber: c.numero_documento,
        notes: c.observacao,
      };
    });
  }

  // ============================================================================
  // CONTAS A RECEBER
  // ============================================================================

  async getContasReceber(
    startDate?: string,
    endDate?: string,
    status?: string
  ): Promise<OmieContaReceber[]> {
    const params: Record<string, unknown> = {};

    if (startDate) params.filtrar_por_data_de = toOmieDate(startDate);
    if (endDate) params.filtrar_por_data_ate = toOmieDate(endDate);
    if (status) params.filtrar_por_status = status;

    return this.requestAllPages<OmieContaReceber>(
      '/financas/contareceber/',
      'ListarContasReceber',
      'conta_receber_cadastro',
      params
    );
  }

  async getReceivables(startDate: string, endDate: string): Promise<OmieReceivable[]> {
    const contas = await this.getContasReceber(startDate, endDate);

    return contas.map((c) => {
      const isReceived = c.status_titulo === 'RECEBIDO' || c.status_titulo === 'LIQUIDADO';
      const isOverdue = c.status_titulo === 'VENCIDO' ||
        (!isReceived && c.data_vencimento && new Date(fromOmieDate(c.data_vencimento)) < new Date());

      return {
        id: String(c.codigo_lancamento_omie || c.codigo_lancamento_integracao || ''),
        description: c.observacao || c.numero_documento || 'Conta a receber',
        dueDate: c.data_vencimento ? fromOmieDate(c.data_vencimento) : '',
        accrualDate: c.data_emissao ? fromOmieDate(c.data_emissao) : undefined,
        value: c.valor_documento || 0,
        paidValue: c.valor_recebido || 0,
        openValue: isReceived ? 0 : (c.valor_documento || 0) - (c.valor_recebido || 0),
        status: isReceived ? 'Recebido' : isOverdue ? 'Vencido' : 'Pendente',
        customer: String(c.codigo_cliente_fornecedor || ''),
        category: c.codigo_categoria || '',
        categoryId: c.codigo_categoria,
        paymentDate: c.data_recebimento ? fromOmieDate(c.data_recebimento) : undefined,
        documentNumber: c.numero_documento,
        notes: c.observacao,
      };
    });
  }

  // ============================================================================
  // CATEGORIAS
  // ============================================================================

  async getCategorias(): Promise<OmieCategoria[]> {
    return this.requestAllPages<OmieCategoria>(
      '/geral/categorias/',
      'ListarCategorias',
      'categoria_cadastro'
    );
  }

  // ============================================================================
  // CLIENTES / FORNECEDORES
  // ============================================================================

  async getClientes(): Promise<OmieClienteFornecedor[]> {
    return this.requestAllPages<OmieClienteFornecedor>(
      '/geral/clientes/',
      'ListarClientes',
      'clientes_cadastro'
    );
  }

  async getClienteById(codigoOmie: number): Promise<OmieClienteFornecedor | null> {
    try {
      const result = await this.request<OmieClienteFornecedor>(
        '/geral/clientes/',
        'ConsultarCliente',
        [{ codigo_cliente_omie: codigoOmie }]
      );
      return result;
    } catch {
      return null;
    }
  }

  // ============================================================================
  // CONTAS CORRENTES
  // ============================================================================

  async getContasCorrentes(): Promise<OmieContaCorrente[]> {
    return this.requestAllPages<OmieContaCorrente>(
      '/financas/contacorrente/',
      'ListarContasCorrentes',
      'ListarContasCorrentes'
    );
  }

  // ============================================================================
  // UPSERT METHODS (Write)
  // ============================================================================

  async upsertCliente(data: OmieUpsertClienteRequest): Promise<OmieUpsertClienteResponse> {
    return this.request<OmieUpsertClienteResponse>('/geral/clientes/', 'UpsertCliente', [data]);
  }

  async upsertContaPagar(data: OmieUpsertContaPagarRequest): Promise<OmieUpsertContaPagarResponse> {
    return this.request<OmieUpsertContaPagarResponse>('/financas/contapagar/', 'UpsertContaPagar', [data]);
  }

  async upsertContaReceber(data: OmieUpsertContaReceberRequest): Promise<OmieUpsertContaReceberResponse> {
    return this.request<OmieUpsertContaReceberResponse>('/financas/contareceber/', 'UpsertContaReceber', [data]);
  }

  // ============================================================================
  // CONNECTION TEST
  // ============================================================================

  async testConnection(): Promise<OmieConnectionTest> {
    try {
      const categorias = await this.getCategorias();

      return {
        connected: true,
        apiUrl: this.baseUrl,
        environment: 'production',
        mode: 'LIVE',
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

let clientInstance: OmieClient | null = null;

export function getOmieClient(): OmieClient {
  if (!clientInstance) {
    const appKey = process.env.OMIE_APP_KEY;
    const appSecret = process.env.OMIE_APP_SECRET;
    if (!appKey || !appSecret) {
      throw new Error('OMIE_APP_KEY and OMIE_APP_SECRET not configured');
    }
    clientInstance = new OmieClient(appKey, appSecret);
  }
  return clientInstance;
}

export function resetOmieClient(): void {
  clientInstance = null;
}
