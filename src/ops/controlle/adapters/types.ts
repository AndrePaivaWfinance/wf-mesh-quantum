/**
 * Controlle Types - Tipos para API Controlle
 *
 * Controlle (antigo Organizze) usa REST API com Bearer Token.
 * Documentacao: https://api.controlle.com/docs
 */

// ============================================================================
// CONTAS (Lancamentos)
// ============================================================================

export interface ControlleLancamento {
  id?: number;
  description?: string;
  notes?: string;
  date?: string; // YYYY-MM-DD
  paid?: boolean;
  amount_cents?: number;
  total_installments?: number;
  installment?: number;
  recurring?: boolean;
  account_id?: number;
  category_id?: number;
  contact_id?: number;
  credit_card_id?: number;
  credit_card_invoice_id?: number;
  paid_credit_card_id?: number;
  paid_credit_card_invoice_id?: number;
  oposite_transaction_id?: number;
  oposite_account_id?: number;
  tags?: string[];
  attachments_count?: number;
  payment_date?: string; // YYYY-MM-DD
  competency_date?: string; // YYYY-MM-DD (data de competencia)
  created_at?: string;
  updated_at?: string;
}

// ============================================================================
// CATEGORIAS
// ============================================================================

export interface ControlleCategoria {
  id?: number;
  name?: string;
  color?: string;
  parent_id?: number;
  group_id?: number;
  fixed?: boolean;
  kind?: 'income' | 'expense'; // receita ou despesa
  archive?: boolean;
}

// ============================================================================
// CONTATOS (Clientes / Fornecedores)
// ============================================================================

export interface ControlleContato {
  id?: number;
  name?: string;
  email?: string;
  phone?: string;
  document?: string; // CPF ou CNPJ
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

// ============================================================================
// CONTAS BANCARIAS
// ============================================================================

export interface ControlleConta {
  id?: number;
  name?: string;
  description?: string;
  archived?: boolean;
  default?: boolean;
  type?: string; // 'checking', 'savings', 'credit_card', 'other'
}

// ============================================================================
// NORMALIZED TYPES (Output)
// ============================================================================

export interface ControllePayable {
  id: string;
  description: string;
  dueDate: string;
  competencyDate?: string;
  value: number;
  paidValue: number;
  openValue: number;
  status: 'Pago' | 'Pendente' | 'Vencido';
  supplier: string;
  category: string;
  categoryId?: string;
  paymentDate?: string;
  notes?: string;
}

export interface ControlleReceivable {
  id: string;
  description: string;
  dueDate: string;
  competencyDate?: string;
  value: number;
  paidValue: number;
  openValue: number;
  status: 'Recebido' | 'Pendente' | 'Vencido';
  customer: string;
  category: string;
  categoryId?: string;
  paymentDate?: string;
  notes?: string;
}

// ============================================================================
// CAPTURE/SYNC TYPES
// ============================================================================

export interface CaptureRequest {
  clientId: string;
  cycleId: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
}

export interface CaptureResponse {
  success: boolean;
  source: 'controlle';
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

export interface ControlleConnectionTest {
  connected: boolean;
  apiUrl: string;
  environment: string;
  mode: 'LIVE' | 'ERROR';
  error?: string;
}
