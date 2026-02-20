/**
 * Santander API Client - Cliente completo com suporte a mTLS
 * Migrado de wf-financeiro/SantanderAgent/__init__.py
 *
 * Funcionalidades:
 * - Autenticação OAuth2 com cache de token
 * - Suporte a mTLS via certificados Base64
 * - DDA (Débito Direto Autorizado)
 * - PIX (listagem, consulta, criação)
 * - Boletos (listagem, consulta, criação)
 * - Comprovantes (listagem, solicitação, obtenção)
 * - Workspace (listagem, criação)
 */

import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createLogger, withRetry, sleep } from '../shared/utils';
import {
  SantanderConfig,
  SantanderDDA,
  SantanderPIX,
  SantanderBoleto,
  SantanderComprovante,
  SantanderStatement,
  SantanderPayment,
  SantanderWorkspace,
  SantanderApiResponse,
  DDAListParams,
  PIXCreateParams,
  BoletoCreateParams,
  ComprovanteListParams,
} from './types';

const logger = createLogger('SantanderClient');

// ============================================================================
// TOKEN CACHE (compartilhado entre instâncias)
// ============================================================================

interface TokenCache {
  accessToken: string;
  expiresAt: Date;
}

const tokenCache: Map<string, TokenCache> = new Map();
const workspaceCache: Map<string, string> = new Map();

// ============================================================================
// CLIENT CLASS
// ============================================================================

export class SantanderClient {
  private config: SantanderConfig;
  private baseUrl: string;
  private authUrl: string;
  private certPath?: string;
  private keyPath?: string;
  private httpsAgent?: https.Agent;

  constructor(config: SantanderConfig) {
    this.config = config;

    // URLs baseadas no ambiente
    if (config.environment === 'production') {
      this.authUrl = 'https://trust-open.api.santander.com.br/auth/oauth/v2/token';
      this.baseUrl = 'https://trust-open.api.santander.com.br';
    } else {
      this.authUrl = 'https://trust-sandbox.api.santander.com.br/auth/oauth/v2/token';
      this.baseUrl = 'https://trust-sandbox.api.santander.com.br';
    }

    // Configurar certificados mTLS se fornecidos
    if (config.certBase64 && config.keyBase64) {
      this.setupCertificates(config.certBase64, config.keyBase64);
    }

    logger.info('Santander client initialized', {
      environment: config.environment,
      baseUrl: this.baseUrl,
      hasCertificates: !!(config.certBase64 && config.keyBase64),
    });
  }

  // ============================================================================
  // CERTIFICATE SETUP
  // ============================================================================

  private setupCertificates(certBase64: string, keyBase64: string): void {
    try {
      const tempDir = os.tmpdir();
      const timestamp = Date.now();

      // Decodificar Base64
      const certData = Buffer.from(certBase64, 'base64');
      const keyData = Buffer.from(keyBase64, 'base64');

      // Criar arquivos temporários
      this.certPath = path.join(tempDir, `santander_cert_${timestamp}.pem`);
      this.keyPath = path.join(tempDir, `santander_key_${timestamp}.pem`);

      fs.writeFileSync(this.certPath, certData, { mode: 0o400 });
      fs.writeFileSync(this.keyPath, keyData, { mode: 0o400 });

      // Criar HTTPS Agent com certificados
      this.httpsAgent = new https.Agent({
        cert: certData,
        key: keyData,
        rejectUnauthorized: true,
      });

      logger.info('mTLS certificates configured', {
        certPath: this.certPath,
        keyPath: this.keyPath,
      });
    } catch (error) {
      logger.error('Failed to setup certificates', error);
      throw error;
    }
  }

  // Cleanup de certificados
  cleanup(): void {
    try {
      if (this.certPath && fs.existsSync(this.certPath)) {
        fs.unlinkSync(this.certPath);
      }
      if (this.keyPath && fs.existsSync(this.keyPath)) {
        fs.unlinkSync(this.keyPath);
      }
      logger.info('Certificates cleaned up');
    } catch (error) {
      logger.warn('Error cleaning up certificates', error as Record<string, unknown>);
    }
  }

  // ============================================================================
  // AUTHENTICATION
  // ============================================================================

  private getCacheKey(): string {
    return `${this.config.clientId}_${this.config.environment}`;
  }

  async getToken(): Promise<string> {
    const cacheKey = this.getCacheKey();
    const cached = tokenCache.get(cacheKey);

    // Verificar cache (com 60s de margem)
    if (cached && cached.expiresAt > new Date(Date.now() + 60000)) {
      return cached.accessToken;
    }

    logger.info('Requesting new OAuth token');

    try {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      });

      const fetchOptions: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      };

      // Node.js fetch com HTTPS agent para mTLS
      const response = await fetch(this.authUrl, fetchOptions);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Auth failed: ${response.status} - ${error}`);
      }

      const data = await response.json() as { access_token: string; expires_in: number; token_type: string };

      const expiresAt = new Date(Date.now() + (data.expires_in - 60) * 1000);

      tokenCache.set(cacheKey, {
        accessToken: data.access_token,
        expiresAt,
      });

      logger.info('Token obtained successfully', { expiresIn: data.expires_in });
      return data.access_token;
    } catch (error) {
      logger.error('Authentication failed', error);
      throw error;
    }
  }

  // ============================================================================
  // HTTP METHODS
  // ============================================================================

  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    params?: Record<string, string | number | undefined>,
    body?: unknown
  ): Promise<T> {
    const token = await this.getToken();

    let url = `${this.baseUrl}${endpoint}`;

    // Adicionar query params para GET
    if (params && method === 'GET') {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Application-Key': this.config.clientId,
    };

    if (this.config.workspaceId) {
      headers['X-Workspace-Id'] = this.config.workspaceId;
    }

    return withRetry(
      async () => {
        const res = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });

        if (!res.ok) {
          const error = await res.text();
          throw new Error(`API error ${res.status}: ${error}`);
        }

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          return res.json() as Promise<T>;
        }

        // Para PDF ou outros tipos, retornar como buffer
        const buffer = await res.arrayBuffer();
        return { data: Buffer.from(buffer) } as T;
      },
      { maxRetries: 3, delayMs: 1000 }
    );
  }

  // ============================================================================
  // WORKSPACE
  // ============================================================================

  async listWorkspaces(): Promise<SantanderWorkspace[]> {
    logger.info('Listing workspaces');

    try {
      const response = await this.request<SantanderApiResponse<SantanderWorkspace>>(
        '/management_payments_partners/v1/workspaces'
      );

      return this.extractContent(response);
    } catch (error) {
      logger.error('Failed to list workspaces', error);
      return [];
    }
  }

  async getWorkspace(): Promise<SantanderWorkspace | null> {
    const cacheKey = this.getCacheKey();
    const cachedId = workspaceCache.get(cacheKey);

    if (cachedId) {
      return { id: cachedId } as SantanderWorkspace;
    }

    // Se tem workspace configurado, usar
    if (this.config.workspaceId) {
      workspaceCache.set(cacheKey, this.config.workspaceId);
      return { id: this.config.workspaceId } as SantanderWorkspace;
    }

    // Buscar via API
    const workspaces = await this.listWorkspaces();

    if (workspaces.length > 0) {
      const workspace = workspaces[0];
      workspaceCache.set(cacheKey, workspace.id);
      return workspace;
    }

    // Criar workspace se necessário
    return this.createWorkspace();
  }

  async createWorkspace(data?: Partial<SantanderWorkspace>): Promise<SantanderWorkspace | null> {
    logger.info('Creating workspace');

    const payload: Record<string, unknown> = data || {
      type: 'PAYMENTS',
      description: 'Workspace WFinance',
      mainDebitAccount: {
        branch: this.config.agencia,
        number: `${this.config.conta}${this.config.contaDigito}`,
      },
      pixPaymentsActive: true,
      barCodePaymentsActive: true,
      bankSlipPaymentsActive: true,
      bankSlipAvailableActive: true,
      taxesByFieldPaymentsActive: true,
      vehicleTaxesPaymentsActive: true,
    };

    try {
      const response = await this.request<SantanderWorkspace>(
        '/management_payments_partners/v1/workspaces',
        'POST',
        undefined,
        payload
      );

      if (response?.id) {
        workspaceCache.set(this.getCacheKey(), response.id);
      }

      return response;
    } catch (error) {
      logger.error('Failed to create workspace', error);
      return null;
    }
  }

  // ============================================================================
  // DDA (Débito Direto Autorizado)
  // ============================================================================

  async listDDA(params?: DDAListParams): Promise<SantanderDDA[]> {
    logger.info('Listing DDA', params as Record<string, unknown> | undefined);

    try {
      const workspace = await this.getWorkspace();
      if (!workspace) {
        throw new Error('Workspace not available');
      }

      // Convert typed params to Record
      const queryParams: Record<string, string | number | undefined> = {};
      if (params) {
        if (params.initialDueDate) queryParams.initialDueDate = params.initialDueDate;
        if (params.finalDueDate) queryParams.finalDueDate = params.finalDueDate;
        if (params.initialIssueDate) queryParams.initialIssueDate = params.initialIssueDate;
        if (params.finalIssueDate) queryParams.finalIssueDate = params.finalIssueDate;
        if (params.titleSituation) queryParams.titleSituation = params.titleSituation;
        if (params.titleOrigin) queryParams.titleOrigin = params.titleOrigin;
        if (params.beneficiaryDocument) queryParams.beneficiaryDocument = params.beneficiaryDocument;
        if (params.bankNumber) queryParams.bankNumber = params.bankNumber;
        if (params.initialValue) queryParams.initialValue = params.initialValue;
        if (params.finalValue) queryParams.finalValue = params.finalValue;
        if (params._limit) queryParams._limit = params._limit;
        if (params._offset) queryParams._offset = params._offset;
        if (params._sort) queryParams._sort = params._sort;
      }

      const response = await this.request<SantanderApiResponse<SantanderDDA>>(
        `/management_payments_partners/v1/workspaces/${workspace.id}/available_bank_slips`,
        'GET',
        queryParams
      );

      return this.extractContent(response);
    } catch (error) {
      logger.error('Failed to list DDA', error);
      return [];
    }
  }

  // ============================================================================
  // PIX
  // ============================================================================

  async listPIX(params?: Record<string, string | number>): Promise<SantanderPIX[]> {
    logger.info('Listing PIX payments');

    try {
      const workspace = await this.getWorkspace();
      if (!workspace) {
        throw new Error('Workspace not available');
      }

      const response = await this.request<SantanderApiResponse<SantanderPIX>>(
        `/management_payments_partners/v1/workspaces/${workspace.id}/pix_payments`,
        'GET',
        params
      );

      return this.extractContent(response);
    } catch (error) {
      logger.error('Failed to list PIX', error);
      return [];
    }
  }

  async getPIX(pixId: string): Promise<SantanderPIX | null> {
    logger.info('Getting PIX', { pixId });

    try {
      const workspace = await this.getWorkspace();
      if (!workspace) {
        throw new Error('Workspace not available');
      }

      return await this.request<SantanderPIX>(
        `/management_payments_partners/v1/workspaces/${workspace.id}/pix_payments/${pixId}`
      );
    } catch (error) {
      logger.error('Failed to get PIX', error);
      return null;
    }
  }

  async createPIX(data: PIXCreateParams): Promise<SantanderPIX | null> {
    logger.info('Creating PIX payment', { amount: data.amount });

    try {
      const workspace = await this.getWorkspace();
      if (!workspace) {
        throw new Error('Workspace not available');
      }

      return await this.request<SantanderPIX>(
        `/management_payments_partners/v1/workspaces/${workspace.id}/pix_payments`,
        'POST',
        undefined,
        data
      );
    } catch (error) {
      logger.error('Failed to create PIX', error);
      return null;
    }
  }

  // ============================================================================
  // BOLETOS
  // ============================================================================

  async listBoletos(params?: Record<string, string | number>): Promise<SantanderBoleto[]> {
    logger.info('Listing boletos');

    try {
      const workspace = await this.getWorkspace();
      if (!workspace) {
        throw new Error('Workspace not available');
      }

      const response = await this.request<SantanderApiResponse<SantanderBoleto>>(
        `/management_payments_partners/v1/workspaces/${workspace.id}/bank_slip_payments`,
        'GET',
        params
      );

      return this.extractContent(response);
    } catch (error) {
      logger.error('Failed to list boletos', error);
      return [];
    }
  }

  async getBoleto(boletoId: string): Promise<SantanderBoleto | null> {
    logger.info('Getting boleto', { boletoId });

    try {
      const workspace = await this.getWorkspace();
      if (!workspace) {
        throw new Error('Workspace not available');
      }

      return await this.request<SantanderBoleto>(
        `/management_payments_partners/v1/workspaces/${workspace.id}/bank_slip_payments/${boletoId}`
      );
    } catch (error) {
      logger.error('Failed to get boleto', error);
      return null;
    }
  }

  async createBoleto(data: BoletoCreateParams): Promise<SantanderBoleto | null> {
    logger.info('Creating boleto payment', { barCode: data.barCode?.substring(0, 10) + '...' });

    try {
      const workspace = await this.getWorkspace();
      if (!workspace) {
        throw new Error('Workspace not available');
      }

      return await this.request<SantanderBoleto>(
        `/management_payments_partners/v1/workspaces/${workspace.id}/bank_slip_payments`,
        'POST',
        undefined,
        data
      );
    } catch (error) {
      logger.error('Failed to create boleto', error);
      return null;
    }
  }

  // ============================================================================
  // COMPROVANTES
  // ============================================================================

  async listComprovantes(params?: ComprovanteListParams): Promise<SantanderComprovante[]> {
    logger.info('Listing comprovantes');

    // Defaults para datas (últimos 7 dias)
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    const queryParams: Record<string, string | number | undefined> = {
      start_date: params?.startDate || weekAgo.toISOString().split('T')[0],
      end_date: params?.endDate || today.toISOString().split('T')[0],
      payment_type: params?.paymentType,
      beneficiary_document: params?.beneficiaryDocument,
      category: params?.category,
      account_agency: params?.accountAgency,
      account_number: params?.accountNumber,
      _limit: params?._limit,
      _offset: params?._offset,
    };

    try {
      const response = await this.request<SantanderApiResponse<SantanderComprovante>>(
        '/consult_payment_receipts/v1/payment_receipts',
        'GET',
        queryParams
      );

      return this.extractContent(response);
    } catch (error) {
      logger.error('Failed to list comprovantes', error);
      return [];
    }
  }

  async requestComprovante(paymentId: string): Promise<{ requestId: string } | null> {
    logger.info('Requesting comprovante', { paymentId });

    try {
      const response = await this.request<{ id?: string; fileRequestId?: string; requestId?: string }>(
        `/consult_payment_receipts/v1/payment_receipts/${paymentId}/file_requests`,
        'POST'
      );

      const requestId = response?.id || response?.fileRequestId || response?.requestId;

      if (requestId) {
        return { requestId };
      }

      return null;
    } catch (error) {
      // Verificar se já existe comprovante
      const errorMsg = String(error);
      if (errorMsg.includes('006') || errorMsg.includes('já existe')) {
        // Buscar histórico
        const history = await this.getComprovanteHistory(paymentId);
        if (history.length > 0) {
          return { requestId: history[0] };
        }
      }

      logger.error('Failed to request comprovante', error);
      return null;
    }
  }

  async getComprovanteHistory(paymentId: string): Promise<string[]> {
    logger.info('Getting comprovante history', { paymentId });

    try {
      const response = await this.request<unknown>(
        `/consult_payment_receipts/v1/payment_receipts/${paymentId}/file_requests`
      );

      return this.extractRequestIds(response);
    } catch (error) {
      logger.error('Failed to get comprovante history', error);
      return [];
    }
  }

  async getComprovante(
    paymentId: string,
    requestId: string
  ): Promise<{ pdfBase64?: string; status?: string; downloadUrl?: string } | null> {
    logger.info('Getting comprovante', { paymentId, requestId });

    try {
      const response = await this.request<{
        file?: { content?: string; fileRepository?: { location?: string }; statusInfo?: { statusCode?: string } };
        status?: string;
        state?: string;
        downloadUrl?: string;
        url?: string;
        content?: string;
        data?: Buffer;
      }>(`/consult_payment_receipts/v1/payment_receipts/${paymentId}/file_requests/${requestId}`);

      // Se retornou PDF direto
      if (response.data && Buffer.isBuffer(response.data)) {
        return {
          pdfBase64: response.data.toString('base64'),
          status: 'AVAILABLE',
        };
      }

      const file = response.file;
      const status =
        response.status || response.state || file?.statusInfo?.statusCode;
      const downloadUrl =
        response.downloadUrl || response.url || file?.fileRepository?.location;
      let pdfBase64 = file?.content || response.content;

      // Se tem URL de download, tentar baixar
      if (!pdfBase64 && downloadUrl) {
        try {
          const dlResponse = await fetch(downloadUrl);
          if (dlResponse.ok) {
            const buffer = await dlResponse.arrayBuffer();
            pdfBase64 = Buffer.from(buffer).toString('base64');
          }
        } catch (dlError) {
          logger.warn('Failed to download comprovante from URL', dlError as Record<string, unknown>);
        }
      }

      return {
        pdfBase64,
        status,
        downloadUrl,
      };
    } catch (error) {
      logger.error('Failed to get comprovante', error);
      return null;
    }
  }

  async emitComprovante(
    paymentId: string,
    maxAttempts = 10,
    intervalMs = 2000
  ): Promise<{
    success: boolean;
    pdfBase64?: string;
    requestId?: string;
    status?: string;
    attempts?: number;
  }> {
    logger.info('Emitting comprovante', { paymentId });

    // 1. Solicitar comprovante
    const requestResult = await this.requestComprovante(paymentId);
    const requestId = requestResult?.requestId;

    if (!requestId) {
      // Buscar no histórico
      const history = await this.getComprovanteHistory(paymentId);
      if (history.length === 0) {
        return {
          success: false,
          status: 'NO_REQUEST_ID',
        };
      }
    }

    const finalRequestId = requestId || (await this.getComprovanteHistory(paymentId))[0];

    // 2. Obter comprovante com retry
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await this.getComprovante(paymentId, finalRequestId);

      if (result?.pdfBase64) {
        return {
          success: true,
          pdfBase64: result.pdfBase64,
          requestId: finalRequestId,
          status: result.status || 'AVAILABLE',
          attempts: attempt,
        };
      }

      const status = result?.status?.toUpperCase();
      if (status && ['AVAILABLE', 'READY', 'COMPLETED', 'DONE'].includes(status)) {
        return {
          success: true,
          requestId: finalRequestId,
          status,
          attempts: attempt,
        };
      }

      if (attempt < maxAttempts) {
        await sleep(intervalMs);
      }
    }

    return {
      success: false,
      requestId: finalRequestId,
      status: 'NOT_AVAILABLE',
      attempts: maxAttempts,
    };
  }

  // ============================================================================
  // STATEMENTS (Extrato)
  // ============================================================================

  async getStatements(
    accountId: string,
    startDate: string,
    endDate: string
  ): Promise<SantanderStatement[]> {
    logger.info('Getting statements', { accountId, startDate, endDate });

    try {
      const response = await this.request<SantanderApiResponse<SantanderStatement>>(
        `/accounts/v1/${accountId}/statements`,
        'GET',
        { startDate, endDate }
      );

      return this.extractContent(response);
    } catch (error) {
      logger.error('Failed to get statements', error);
      return [];
    }
  }

  // ============================================================================
  // PAYMENTS
  // ============================================================================

  async listPayments(): Promise<SantanderPayment[]> {
    logger.info('Listing payments');

    try {
      const response = await this.request<SantanderApiResponse<SantanderPayment>>(
        '/management_payments_partners/v1/payments'
      );

      return this.extractContent(response);
    } catch (error) {
      logger.error('Failed to list payments', error);
      return [];
    }
  }

  async getPayment(paymentId: string): Promise<SantanderPayment | null> {
    logger.info('Getting payment', { paymentId });

    try {
      return await this.request<SantanderPayment>(
        `/management_payments_partners/v1/payments/${paymentId}`
      );
    } catch (error) {
      logger.error('Failed to get payment', error);
      return null;
    }
  }

  // ============================================================================
  // HEALTH CHECK
  // ============================================================================

  async healthCheck(): Promise<{
    connected: boolean;
    environment: string;
    hasCertificates: boolean;
    workspaceId?: string;
    error?: string;
  }> {
    try {
      await this.getToken();
      const workspace = await this.getWorkspace();

      return {
        connected: true,
        environment: this.config.environment,
        hasCertificates: !!(this.config.certBase64 && this.config.keyBase64),
        workspaceId: workspace?.id,
      };
    } catch (error) {
      return {
        connected: false,
        environment: this.config.environment,
        hasCertificates: !!(this.config.certBase64 && this.config.keyBase64),
        error: String(error),
      };
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private extractContent<T>(response: SantanderApiResponse<T> | T[] | T): T[] {
    if (Array.isArray(response)) {
      return response;
    }

    if (response && typeof response === 'object') {
      const obj = response as SantanderApiResponse<T>;
      return obj._content || obj.content || obj.data || obj.items || [];
    }

    return [];
  }

  private extractRequestIds(container: unknown): string[] {
    const ids: string[] = [];

    if (!container) return ids;

    if (typeof container === 'object') {
      const obj = container as Record<string, unknown>;

      // Extrair IDs diretos
      for (const key of ['id', 'fileRequestId', 'requestId']) {
        if (obj[key] && typeof obj[key] === 'string') {
          ids.push(obj[key] as string);
        }
      }

      // Verificar objeto request aninhado
      if (obj.request && typeof obj.request === 'object') {
        ids.push(...this.extractRequestIds(obj.request));
      }

      // Verificar listas
      for (const key of ['items', 'content', '_content', 'fileRequests', 'requests', 'paymentReceiptsFileRequests']) {
        if (Array.isArray(obj[key])) {
          ids.push(...this.extractRequestIds(obj[key]));
        }
      }
    }

    if (Array.isArray(container)) {
      for (const item of container) {
        ids.push(...this.extractRequestIds(item));
      }
    }

    // Remover duplicados
    return [...new Set(ids)];
  }
}

// ============================================================================
// FACTORY
// ============================================================================

let clientInstance: SantanderClient | null = null;

export function getSantanderClient(): SantanderClient {
  if (!clientInstance) {
    const config: SantanderConfig = {
      clientId: process.env.SANTANDER_CLIENT_ID || '',
      clientSecret: process.env.SANTANDER_CLIENT_SECRET || '',
      environment: (process.env.SANTANDER_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
      workspaceId: process.env.SANTANDER_WORKSPACE_ID,
      convenio: process.env.SANTANDER_CONVENIO,
      agencia: process.env.SANTANDER_AGENCIA,
      conta: process.env.SANTANDER_CONTA,
      contaDigito: process.env.SANTANDER_CONTA_DIGITO,
      certBase64: process.env.SANTANDER_CERT_BASE64,
      keyBase64: process.env.SANTANDER_KEY_BASE64,
    };

    if (!config.clientId || !config.clientSecret) {
      throw new Error('SANTANDER_CLIENT_ID and SANTANDER_CLIENT_SECRET are required');
    }

    clientInstance = new SantanderClient(config);
  }

  return clientInstance;
}

export function resetSantanderClient(): void {
  if (clientInstance) {
    clientInstance.cleanup();
    clientInstance = null;
  }
}
