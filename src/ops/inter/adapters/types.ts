/**
 * Inter Types - Tipos completos para API Banco Inter
 * Migrado de wf-financeiro inter.py (InterSkill)
 *
 * API Base URL: https://cdpj.partners.bancointer.com.br
 * Auth: OAuth2 + mTLS (client_credentials)
 *
 * Operações:
 * - DDA (Débito Direto Autorizado) → wf-a-pagar
 * - PIX (listagem, pagamento) → wf-extrato
 * - Boletos (listagem, pagamento) → wf-a-receber / wf-extrato
 * - Comprovantes (extração) → wf-extrato
 * - Extrato bancário → wf-extrato
 */

// ============================================================================
// AUTH TYPES
// ============================================================================

export interface InterConfig {
  clientId: string;
  clientSecret: string;
  environment: 'sandbox' | 'production';
  contaCorrente?: string;
  // Certificados mTLS (Base64)
  certBase64?: string;
  keyBase64?: string;
}

export interface InterToken {
  accessToken: string;
  expiresAt: number;
  tokenType: string;
  scope: string;
}

// ============================================================================
// DDA (Débito Direto Autorizado)
// ============================================================================

export interface InterDDA {
  codigoBarras: string;
  linhaDigitavel?: string;
  dataVencimento: string;
  dataLimitePagamento?: string;
  valorNominal: number;
  valorDesconto?: number;
  valorMulta?: number;
  valorJuros?: number;
  valorTotal?: number;
  situacao?: string;
  pagadorCpfCnpj?: string;
  pagadorNome?: string;
  beneficiario: {
    nome: string;
    cpfCnpj: string;
    tipo?: string;
  };
  beneficiarioFinal?: {
    nome: string;
    cpfCnpj: string;
  };
}

export interface DDAListParams {
  dataInicial?: string;
  dataFinal?: string;
  situacao?: 'TODOS' | 'ABERTOS' | 'PAGOS' | 'VENCIDOS';
  filtrarDataPor?: 'VENCIMENTO' | 'EMISSAO';
  ordenarPor?: string;
  pagina?: number;
  tamanhoPagina?: number;
}

// ============================================================================
// PIX
// ============================================================================

export interface InterPIX {
  endToEndId?: string;
  txid?: string;
  valor: string;
  horario: string;
  chave?: string;
  tipoChave?: string;
  pagador?: {
    nome: string;
    cpf?: string;
    cnpj?: string;
  };
  recebedor?: {
    nome: string;
    cpf?: string;
    cnpj?: string;
  };
  infoPagador?: string;
  tipo?: string;
  status?: string;
  natureza?: 'RECEBIMENTO' | 'PAGAMENTO';
}

export interface PIXListParams {
  dataInicio: string;
  dataFim: string;
  pagina?: number;
  tamanhoPagina?: number;
  txid?: string;
}

export interface PIXCreateParams {
  valor: number;
  chave: string;
  descricao?: string;
  pagador?: {
    cpf?: string;
    cnpj?: string;
    nome: string;
  };
}

// ============================================================================
// BOLETOS
// ============================================================================

export interface InterBoleto {
  nossoNumero: string;
  codigoBarras?: string;
  linhaDigitavel?: string;
  seuNumero?: string;
  situacao: string;
  dataEmissao: string;
  dataVencimento: string;
  valorNominal: number;
  valorPago?: number;
  dataPagamento?: string;
  pagador?: {
    nome: string;
    cpfCnpj: string;
    endereco?: string;
    cidade?: string;
    uf?: string;
    cep?: string;
  };
  desconto1?: {
    tipo: string;
    valor: number;
    data: string;
  };
  multa?: {
    tipo: string;
    valor: number;
    data: string;
  };
  mora?: {
    tipo: string;
    valor: number;
    data: string;
  };
}

export interface BoletoListParams {
  dataInicial?: string;
  dataFinal?: string;
  situacao?: 'EMABERTO' | 'PAGO' | 'CANCELADO' | 'EXPIRADO' | 'VENCIDO';
  filtrarDataPor?: 'VENCIMENTO' | 'EMISSAO' | 'SITUACAO';
  ordenarPor?: string;
  pagina?: number;
  tamanhoPagina?: number;
}

export interface BoletoPagamentoParams {
  codBarraLinhaDigitavel: string;
  valorPagar: number;
  dataPagamento?: string;
  dataVencimento?: string;
}

// ============================================================================
// COMPROVANTES
// ============================================================================

export interface InterComprovante {
  idTransacao: string;
  tipoTransacao?: string;
  tipoOperacao?: string;
  valor: number;
  dataInclusao?: string;
  dataPagamento?: string;
  situacao?: string;
  descricao?: string;
  detalhe?: string;
  beneficiario?: {
    nome: string;
    cpfCnpj: string;
    banco?: string;
    agencia?: string;
    conta?: string;
  };
  pdfBase64?: string;
}

export interface ComprovanteListParams {
  dataInicio?: string;
  dataFim?: string;
  tipoTransacao?: string;
  tipoOperacao?: string;
  pagina?: number;
  tamanhoPagina?: number;
}

// ============================================================================
// EXTRATO (Statements)
// ============================================================================

export interface InterExtrato {
  dataEntrada: string;
  tipoTransacao: string;
  tipoOperacao: string;
  valor: string;
  titulo: string;
  descricao: string;
  detalhes?: Record<string, unknown>;
}

export interface ExtratoParams {
  dataInicio: string;
  dataFim: string;
  pagina?: number;
  tamanhoPagina?: number;
}

// ============================================================================
// SALDO (Balance)
// ============================================================================

export interface InterSaldo {
  disponivel: number;
  bloqueadoCheque?: number;
  bloqueadoJudicial?: number;
  limite?: number;
}

// ============================================================================
// CAPTURE TYPES
// ============================================================================

export interface CaptureRequest {
  clientId: string;
  cycleId: string;
  startDate?: string;
  endDate?: string;
  captureType?: 'dda' | 'pix' | 'boleto' | 'extrato' | 'all';
}

export interface CaptureResponse {
  success: boolean;
  source: 'inter';
  clientId: string;
  cycleId: string;
  transactions: {
    total: number;
    new: number;
    updated: number;
    skipped: number;
  };
  dda?: number;
  pix?: number;
  boletos?: number;
  extrato?: number;
  comprovantes?: number;
  errors?: string[];
  durationMs: number;
}

// ============================================================================
// API RESPONSE WRAPPER
// ============================================================================

export interface InterApiResponse<T> {
  totalPaginas?: number;
  totalElementos?: number;
  paginaAtual?: number;
  tamanhoPagina?: number;
  ultimaPagina?: boolean;
  primeiraPagina?: boolean;
  conteudo?: T[];
  // Alternate response formats
  data?: T[];
  items?: T[];
}
