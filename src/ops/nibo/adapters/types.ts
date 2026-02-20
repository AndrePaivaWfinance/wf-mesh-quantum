/**
 * Nibo Types - Tipos completos para API Nibo
 * Migrado de wf-financeiro/shared/nibo_client.py
 */

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface NiboSchedule {
  scheduleId: string;
  description?: string;
  dueDate: string;
  value?: number;
  paidValue?: number;
  openValue?: number;
  isPaid?: boolean;
  isDued?: boolean;
  type?: 'Credit' | 'Debit';
  stakeholder?: {
    id?: string;
    name?: string;
  };
  category?: {
    id?: string;
    name?: string;
  };
  costCenter?: {
    id?: string;
    name?: string;
  };
  documentNumber?: string;
  notes?: string;
}

export interface NiboPayable {
  id: string;
  description: string;
  dueDate: string;
  value: number;
  paidValue: number;
  openValue: number;
  status: 'Pago' | 'Vencido' | 'Pendente';
  supplier: string;
  category: string;
  categoryId?: string;
}

export interface NiboReceivable {
  id: string;
  description: string;
  dueDate: string;
  value: number;
  paidValue: number;
  openValue: number;
  status: 'Recebido' | 'Vencido' | 'Pendente';
  customer: string;
  category: string;
  categoryId?: string;
}

export interface NiboCategory {
  id: string;
  name: string;
  type: 'Credit' | 'Debit';
  parentId?: string;
}

export interface NiboAccount {
  id: string;
  name: string;
  bankName?: string;
  agency?: string;
  accountNumber?: string;
  balance?: number;
  isReconcilable?: boolean;
}

export interface NiboCustomer {
  id: string;
  name: string;
  document?: string;
  email?: string;
  phone?: string;
}

export interface NiboSupplier {
  id: string;
  name: string;
  document?: string;
  email?: string;
  phone?: string;
}

// ============================================================================
// NEW TYPES (from Python client)
// ============================================================================

export interface NiboCostCenter {
  id: string;
  name: string;
  code?: string;
  isActive?: boolean;
}

export interface NiboEmployee {
  id: string;
  name: string;
  document?: string;
  email?: string;
  phone?: string;
  role?: string;
}

export interface NiboPartner {
  id: string;
  name: string;
  document?: string;
  email?: string;
  share?: number;
}

export interface NiboStakeholder {
  id: string;
  name: string;
  type?: string;
  document?: string;
  email?: string;
  phone?: string;
}

export interface NiboTransfer {
  id: string;
  originAccountId: string;
  destinyAccountId: string;
  date: string;
  value: number;
  description?: string;
}

export interface NiboBankStatement {
  id?: string;
  date: string;
  description: string;
  value: number;
  balance?: number;
  type?: 'credit' | 'debit';
  category?: string;
  _account_id?: string;
  _account_name?: string;
}

export interface NiboReconciliation {
  id?: string;
  accountId: string;
  date?: string;
  balance?: number;
  status?: string;
  items?: NiboReconciliationItem[];
  _account_id?: string;
  _account_name?: string;
}

export interface NiboReconciliationItem {
  id: string;
  date: string;
  description: string;
  value: number;
  status: 'reconciled' | 'pending' | 'excluded';
}

export interface NiboNFSe {
  id: string;
  number: string;
  issueDate: string;
  value: number;
  customerName?: string;
  customerDocument?: string;
  status?: string;
}

export interface NiboPayment {
  id: string;
  scheduleId?: string;
  date: string;
  value: number;
  description?: string;
  accountId?: string;
}

export interface NiboReceipt {
  id: string;
  scheduleId?: string;
  date: string;
  value: number;
  description?: string;
  accountId?: string;
}

// ============================================================================
// FINANCIAL SUMMARY
// ============================================================================

export interface NiboFinancialSummary {
  period: {
    start: string;
    end: string;
    days: number;
  };
  payables: {
    total: number;
    value: number;
    openValue: number;
    overdue: number;
    dueToday: number;
  };
  receivables: {
    total: number;
    value: number;
    openValue: number;
    overdue: number;
  };
  cashFlow: {
    projected: number;
    current: number;
  };
  alerts: string[];
}

// ============================================================================
// CREATE/UPDATE TYPES
// ============================================================================

export interface CreateScheduleData {
  type: 'Credit' | 'Debit';
  description: string;
  value: number;
  dueDate: string;
  stakeholderId?: string;
  categoryId?: string;
  costCenterId?: string;
  documentNumber?: string;
  notes?: string;
}

export interface CreateTransferData {
  originAccountId: string;
  destinyAccountId: string;
  date: string;
  value: number;
  description?: string;
}

export interface CreateCustomerData {
  name: string;
  document?: string;
  email?: string;
  phone?: string;
}

export interface CreateSupplierData {
  name: string;
  document?: string;
  email?: string;
  phone?: string;
}

export interface CreateCategoryData {
  name: string;
  type: 'Credit' | 'Debit';
  parentId?: string;
}

export interface CreateCostCenterData {
  name: string;
  code?: string;
}

export interface CreateEmployeeData {
  name: string;
  document?: string;
  email?: string;
  phone?: string;
  role?: string;
}

// ============================================================================
// CAPTURE TYPES
// ============================================================================

export interface CaptureRequest {
  clientId: string;
  cycleId: string;
  startDate?: string;
  endDate?: string;
}

export interface CaptureResponse {
  success: boolean;
  source: 'nibo';
  clientId: string;
  cycleId: string;
  transactions: {
    total: number;
    new: number;
    updated: number;
    skipped: number;
  };
  payables: number;
  receivables: number;
  errors?: string[];
  durationMs: number;
}

// ============================================================================
// SYNC TYPES
// ============================================================================

export interface SyncRequest {
  transactionId: string;
  clientId: string;
  descricao: string;
  valor: number;
  dataVencimento: string;
  categoriaId?: string;
  categoriaNome?: string;
  contraparte?: string;
  tipo: 'pagar' | 'receber';
  existingExternalId?: string;
}

export interface SyncResponse {
  success: boolean;
  action: 'created' | 'updated' | 'skipped';
  externalId?: string;
  error?: string;
}

// ============================================================================
// CONNECTION TEST
// ============================================================================

export interface NiboConnectionTest {
  connected: boolean;
  apiUrl: string;
  environment: string;
  accounts: number;
  firstAccountId?: string;
  mode: 'LIVE' | 'ERROR';
  error?: string;
}
