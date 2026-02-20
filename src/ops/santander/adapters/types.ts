/**
 * Santander Types - Tipos completos para API Santander
 * Migrado de wf-financeiro/SantanderAgent/__init__.py
 */

// ============================================================================
// AUTH TYPES
// ============================================================================

export interface SantanderConfig {
  clientId: string;
  clientSecret: string;
  environment: 'sandbox' | 'production';
  workspaceId?: string;
  convenio?: string;
  agencia?: string;
  conta?: string;
  contaDigito?: string;
  // Certificados mTLS (Base64)
  certBase64?: string;
  keyBase64?: string;
}

export interface SantanderToken {
  accessToken: string;
  expiresAt: number;
  tokenType: string;
}

// ============================================================================
// DDA (Débito Direto Autorizado)
// ============================================================================

export interface SantanderDDA {
  barCode: string;
  dueDate: string;
  paymentLimitDate?: string;
  nominalValue: number;
  discountValue?: number;
  fineValue?: number;
  interestValue?: number;
  totalValue?: number;
  payerDocumentNumber?: string;
  titleSituation?: string;
  titleOrigin?: string;
  beneficiary: {
    beneficiaryName: string;
    beneficiaryDocument: string;
    beneficiaryType?: string;
  };
  finalBeneficiary?: {
    finalBeneficiaryName: string;
    finalBeneficiaryDocument: string;
  };
}

export interface DDAListParams {
  initialDueDate?: string;
  finalDueDate?: string;
  initialIssueDate?: string;
  finalIssueDate?: string;
  titleSituation?: string;
  titleOrigin?: string;
  beneficiaryDocument?: string;
  bankNumber?: string;
  initialValue?: number;
  finalValue?: number;
  _limit?: number;
  _offset?: number;
  _sort?: string;
}

// ============================================================================
// PIX
// ============================================================================

export interface SantanderPIX {
  id: string;
  status: string;
  type: string;
  amount: number;
  createdAt: string;
  key?: string;
  keyType?: string;
  receiverName?: string;
  receiverDocument?: string;
  receiverBank?: string;
  description?: string;
  e2eId?: string;
}

export interface PIXCreateParams {
  amount: number;
  key: string;
  keyType: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP';
  description?: string;
  scheduledDate?: string;
}

// ============================================================================
// BOLETOS
// ============================================================================

export interface SantanderBoleto {
  id: string;
  barCode: string;
  status: string;
  amount: number;
  dueDate: string;
  paymentDate?: string;
  beneficiaryName?: string;
  beneficiaryDocument?: string;
  description?: string;
}

export interface BoletoCreateParams {
  barCode: string;
  paymentDate?: string;
  amount?: number;
  description?: string;
}

// ============================================================================
// COMPROVANTES
// ============================================================================

export interface SantanderComprovante {
  paymentId: string;
  requestId?: string;
  status: string;
  paymentType?: string;
  amount?: number;
  paymentDate?: string;
  beneficiaryName?: string;
  beneficiaryDocument?: string;
  pdfBase64?: string;
  downloadUrl?: string;
}

export interface ComprovanteListParams {
  startDate?: string;
  endDate?: string;
  paymentType?: string;
  beneficiaryDocument?: string;
  category?: string;
  accountAgency?: string;
  accountNumber?: string;
  _limit?: number;
  _offset?: number;
}

// ============================================================================
// STATEMENTS (Extrato)
// ============================================================================

export interface SantanderStatement {
  id: string;
  date: string;
  description: string;
  value: number;
  balance: number;
  type: 'credit' | 'debit';
  category?: string;
  transactionId?: string;
}

// ============================================================================
// PAYMENTS
// ============================================================================

export interface SantanderPayment {
  paymentId: string;
  status: string;
  paymentType: string;
  value: number;
  paymentDate: string;
  beneficiaryName?: string;
  beneficiaryDocument?: string;
  barCode?: string;
  pixKey?: string;
}

// ============================================================================
// WORKSPACE
// ============================================================================

export interface SantanderWorkspace {
  id: string;
  type: string;
  description?: string;
  mainDebitAccount?: {
    branch: string;
    number: string;
  };
  pixPaymentsActive?: boolean;
  barCodePaymentsActive?: boolean;
  bankSlipPaymentsActive?: boolean;
  bankSlipAvailableActive?: boolean;
  taxesByFieldPaymentsActive?: boolean;
  vehicleTaxesPaymentsActive?: boolean;
}

// ============================================================================
// CAPTURE TYPES
// ============================================================================

export interface CaptureRequest {
  clientId: string;
  cycleId: string;
  startDate?: string;
  endDate?: string;
  captureType?: 'dda' | 'statement' | 'pix' | 'boleto' | 'all';
  workspaceId?: string;
}

export interface CaptureResponse {
  success: boolean;
  source: 'santander';
  clientId: string;
  cycleId: string;
  workspaceId?: string;
  transactions: {
    total: number;
    new: number;
    updated: number;
    skipped: number;
  };
  dda?: number;
  pix?: number;
  boletos?: number;
  statements?: number;
  comprovantes?: number;
  errors?: string[];
  durationMs: number;
}

// ============================================================================
// API RESPONSE WRAPPER
// ============================================================================

export interface SantanderApiResponse<T> {
  _content?: T[];
  content?: T[];
  data?: T[];
  items?: T[];
  totalElements?: number;
  totalPages?: number;
  page?: number;
  size?: number;
}
