/**
 * Inter API Client - Cliente completo com suporte a mTLS
 * Migrado de wf-financeiro inter.py (InterSkill)
 *
 * Funcionalidades:
 * - Autenticação OAuth2 com cache de token
 * - Suporte a mTLS via certificados Base64
 * - DDA (Débito Direto Autorizado) → wf-a-pagar
 * - PIX (listagem, pagamento) → wf-extrato
 * - Boletos (listagem, pagamento) → wf-a-receber / wf-extrato
 * - Comprovantes (extração) → wf-extrato
 * - Extrato bancário → wf-extrato
 * - Saldo → consulta
 */

import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createLogger, withRetry, sleep } from '../shared/utils';
import {
  InterConfig,
  InterDDA,
  InterPIX,
  InterBoleto,
  InterComprovante,
  InterExtrato,
  InterSaldo,
  InterApiResponse,
  DDAListParams,
  PIXListParams,
  PIXCreateParams,
  BoletoListParams,
  BoletoPagamentoParams,
  ComprovanteListParams,
  ExtratoParams,
} from './types';

const logger = createLogger('InterClient');

// ============================================================================
// TOKEN CACHE (compartilhado entre instâncias)
// ============================================================================

interface TokenCache {
  accessToken: string;
  expiresAt: Date;
}

const tokenCache: Map<string, TokenCache> = new Map();

// ============================================================================
// CLIENT CLASS
// ============================================================================

export class InterClient {
  private config: InterConfig;
  private baseUrl: string;
  private authUrl: string;
  private certPath?: string;
  private keyPath?: string;
  private httpsAgent?: https.Agent;

  constructor(config: InterConfig) {
    this.config = config;

    // URLs baseadas no ambiente
    if (config.environment === 'production') {
      this.baseUrl = 'https://cdpj.partners.bancointer.com.br';
      this.authUrl = 'https://cdpj.partners.bancointer.com.br/oauth/v2/token';
    } else {
      this.baseUrl = 'https://cdpj-sandbox.partners.bancointer.com.br';
      this.authUrl = 'https://cdpj-sandbox.partners.bancointer.com.br/oauth/v2/token';
    }

    // Configurar certificados mTLS se fornecidos
    if (config.certBase64 && config.keyBase64) {
      this.setupCertificates(config.certBase64, config.keyBase64);
    }

    logger.info('Inter client initialized', {
      environment: config.environment,
      baseUrl: this.baseUrl,
      hasCertificates: !!(config.certBase64 && config.keyBase64),
      contaCorrente: config.contaCorrente ? '***' + config.contaCorrente.slice(-4) : 'not set',
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
      this.certPath = path.join(tempDir, `inter_cert_${timestamp}.pem`);
      this.keyPath = path.join(tempDir, `inter_key_${timestamp}.pem`);

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
    return `inter_${this.config.clientId}_${this.config.environment}`;
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
        scope: 'boleto-cobranca.read boleto-cobranca.write cob.read cob.write cobv.read cobv.write extrato.read pagamento-boleto.read pagamento-boleto.write pagamento-darf.read pagamento-darf.write pagamento-pix.read pagamento-pix.write pix.read pix.write webhook.read webhook.write',
      });

      const fetchOptions: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      };

      const response = await fetch(this.authUrl, fetchOptions);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Auth failed: ${response.status} - ${error}`);
      }

      const data = await response.json() as {
        access_token: string;
        expires_in: number;
        token_type: string;
        scope: string;
      };

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
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
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
    };

    // Adicionar conta corrente no header se disponível
    if (this.config.contaCorrente) {
      headers['x-conta-corrente'] = this.config.contaCorrente;
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
  // DDA (Débito Direto Autorizado)
  // ============================================================================

  async listDDA(params?: DDAListParams): Promise<InterDDA[]> {
    logger.info('Listing DDA', params as Record<string, unknown> | undefined);

    try {
      const queryParams: Record<string, string | number | undefined> = {};
      if (params) {
        if (params.dataInicial) queryParams.dataInicial = params.dataInicial;
        if (params.dataFinal) queryParams.dataFinal = params.dataFinal;
        if (params.situacao) queryParams.situacao = params.situacao;
        if (params.filtrarDataPor) queryParams.filtrarDataPor = params.filtrarDataPor;
        if (params.ordenarPor) queryParams.ordenarPor = params.ordenarPor;
        if (params.pagina !== undefined) queryParams.pagina = params.pagina;
        if (params.tamanhoPagina) queryParams.tamanhoPagina = params.tamanhoPagina;
      }

      const response = await this.request<InterApiResponse<InterDDA>>(
        '/banking/v2/boletos-dda',
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

  async listPIX(params: PIXListParams): Promise<InterPIX[]> {
    logger.info('Listing PIX', { dataInicio: params.dataInicio, dataFim: params.dataFim });

    try {
      const queryParams: Record<string, string | number | undefined> = {
        dataInicio: params.dataInicio,
        dataFim: params.dataFim,
        pagina: params.pagina,
        tamanhoPagina: params.tamanhoPagina,
        txid: params.txid,
      };

      const response = await this.request<InterApiResponse<InterPIX>>(
        '/banking/v2/pix',
        'GET',
        queryParams
      );

      return this.extractContent(response);
    } catch (error) {
      logger.error('Failed to list PIX', error);
      return [];
    }
  }

  async createPIX(data: PIXCreateParams): Promise<InterPIX | null> {
    logger.info('Creating PIX payment', { valor: data.valor, chave: data.chave });

    try {
      return await this.request<InterPIX>(
        '/banking/v2/pix',
        'POST',
        undefined,
        {
          valor: String(data.valor),
          destinatario: {
            tipo: 'CHAVE',
            chave: data.chave,
          },
          descricao: data.descricao || 'Pagamento PIX',
        }
      );
    } catch (error) {
      logger.error('Failed to create PIX', error);
      return null;
    }
  }

  // ============================================================================
  // BOLETOS
  // ============================================================================

  async listBoletos(params?: BoletoListParams): Promise<InterBoleto[]> {
    logger.info('Listing boletos');

    try {
      const queryParams: Record<string, string | number | undefined> = {};
      if (params) {
        if (params.dataInicial) queryParams.dataInicial = params.dataInicial;
        if (params.dataFinal) queryParams.dataFinal = params.dataFinal;
        if (params.situacao) queryParams.situacao = params.situacao;
        if (params.filtrarDataPor) queryParams.filtrarDataPor = params.filtrarDataPor;
        if (params.ordenarPor) queryParams.ordenarPor = params.ordenarPor;
        if (params.pagina !== undefined) queryParams.pagina = params.pagina;
        if (params.tamanhoPagina) queryParams.tamanhoPagina = params.tamanhoPagina;
      }

      const response = await this.request<InterApiResponse<InterBoleto>>(
        '/cobranca/v3/cobrancas',
        'GET',
        queryParams
      );

      return this.extractContent(response);
    } catch (error) {
      logger.error('Failed to list boletos', error);
      return [];
    }
  }

  async getBoleto(nossoNumero: string): Promise<InterBoleto | null> {
    logger.info('Getting boleto', { nossoNumero });

    try {
      return await this.request<InterBoleto>(
        `/cobranca/v3/cobrancas/${nossoNumero}`
      );
    } catch (error) {
      logger.error('Failed to get boleto', error);
      return null;
    }
  }

  async payBoleto(data: BoletoPagamentoParams): Promise<{ codigoTransacao: string; status: string } | null> {
    logger.info('Paying boleto', {
      barCode: data.codBarraLinhaDigitavel?.substring(0, 10) + '...',
      valor: data.valorPagar,
    });

    try {
      return await this.request<{ codigoTransacao: string; status: string }>(
        '/banking/v2/pagamento',
        'POST',
        undefined,
        {
          codBarraLinhaDigitavel: data.codBarraLinhaDigitavel,
          valorPagar: data.valorPagar,
          dataPagamento: data.dataPagamento || new Date().toISOString().split('T')[0],
          dataVencimento: data.dataVencimento,
        }
      );
    } catch (error) {
      logger.error('Failed to pay boleto', error);
      return null;
    }
  }

  // ============================================================================
  // COMPROVANTES
  // ============================================================================

  async listComprovantes(params?: ComprovanteListParams): Promise<InterComprovante[]> {
    logger.info('Listing comprovantes');

    // Defaults para datas (últimos 7 dias)
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    const queryParams: Record<string, string | number | undefined> = {
      dataInicio: params?.dataInicio || weekAgo.toISOString().split('T')[0],
      dataFim: params?.dataFim || today.toISOString().split('T')[0],
      tipoTransacao: params?.tipoTransacao,
      tipoOperacao: params?.tipoOperacao,
      pagina: params?.pagina,
      tamanhoPagina: params?.tamanhoPagina,
    };

    try {
      const response = await this.request<InterApiResponse<InterComprovante>>(
        '/banking/v2/extrato/comprovantes',
        'GET',
        queryParams
      );

      return this.extractContent(response);
    } catch (error) {
      logger.error('Failed to list comprovantes', error);
      return [];
    }
  }

  async getComprovantePDF(idTransacao: string): Promise<{ pdfBase64?: string } | null> {
    logger.info('Getting comprovante PDF', { idTransacao });

    try {
      const response = await this.request<{ data?: Buffer }>(
        `/banking/v2/extrato/comprovantes/${idTransacao}/pdf`
      );

      if (response?.data && Buffer.isBuffer(response.data)) {
        return { pdfBase64: response.data.toString('base64') };
      }

      return response as { pdfBase64?: string };
    } catch (error) {
      logger.error('Failed to get comprovante PDF', error);
      return null;
    }
  }

  // ============================================================================
  // EXTRATO (Statements)
  // ============================================================================

  async getExtrato(params: ExtratoParams): Promise<InterExtrato[]> {
    logger.info('Getting extrato', { dataInicio: params.dataInicio, dataFim: params.dataFim });

    try {
      const queryParams: Record<string, string | number | undefined> = {
        dataInicio: params.dataInicio,
        dataFim: params.dataFim,
        pagina: params.pagina,
        tamanhoPagina: params.tamanhoPagina,
      };

      const response = await this.request<InterApiResponse<InterExtrato>>(
        '/banking/v2/extrato',
        'GET',
        queryParams
      );

      return this.extractContent(response);
    } catch (error) {
      logger.error('Failed to get extrato', error);
      return [];
    }
  }

  // ============================================================================
  // SALDO (Balance)
  // ============================================================================

  async getSaldo(): Promise<InterSaldo | null> {
    logger.info('Getting saldo');

    try {
      return await this.request<InterSaldo>('/banking/v2/saldo');
    } catch (error) {
      logger.error('Failed to get saldo', error);
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
    contaCorrente?: string;
    error?: string;
  }> {
    try {
      await this.getToken();

      return {
        connected: true,
        environment: this.config.environment,
        hasCertificates: !!(this.config.certBase64 && this.config.keyBase64),
        contaCorrente: this.config.contaCorrente ? '***' + this.config.contaCorrente.slice(-4) : undefined,
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

  private extractContent<T>(response: InterApiResponse<T> | T[] | T): T[] {
    if (Array.isArray(response)) {
      return response;
    }

    if (response && typeof response === 'object') {
      const obj = response as InterApiResponse<T>;
      return obj.conteudo || obj.data || obj.items || [];
    }

    return [];
  }
}

// ============================================================================
// FACTORY
// ============================================================================

let clientInstance: InterClient | null = null;

export function getInterClient(): InterClient {
  if (!clientInstance) {
    const config: InterConfig = {
      clientId: process.env.INTER_CLIENT_ID || '',
      clientSecret: process.env.INTER_CLIENT_SECRET || '',
      environment: (process.env.INTER_ENVIRONMENT as 'sandbox' | 'production') || 'production',
      contaCorrente: process.env.INTER_CONTA_CORRENTE,
      certBase64: process.env.INTER_CERT_BASE64,
      keyBase64: process.env.INTER_KEY_BASE64,
    };

    if (!config.clientId || !config.clientSecret) {
      throw new Error('INTER_CLIENT_ID and INTER_CLIENT_SECRET are required');
    }

    clientInstance = new InterClient(config);
  }

  return clientInstance;
}

export function resetInterClient(): void {
  if (clientInstance) {
    clientInstance.cleanup();
    clientInstance = null;
  }
}
