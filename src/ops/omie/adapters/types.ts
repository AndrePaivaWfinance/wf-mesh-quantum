/**
 * Omie Types - Tipos para API Omie ERP
 *
 * A API do Omie usa JSON-RPC. Cada chamada envia:
 * {
 *   "call": "NomeDoMetodo",
 *   "app_key": "xxx",
 *   "app_secret": "xxx",
 *   "param": [{ ... }]
 * }
 */

// ============================================================================
// OMIE API REQUEST/RESPONSE WRAPPERS
// ============================================================================

export interface OmieApiRequest {
  call: string;
  app_key: string;
  app_secret: string;
  param: unknown[];
}

export interface OmieListResponse<T> {
  pagina: number;
  total_de_paginas: number;
  registros: number;
  total_de_registros: number;
  [key: string]: T[] | number; // Dynamic list field name
}

// ============================================================================
// CONTAS A PAGAR
// ============================================================================

export interface OmieContaPagar {
  codigo_lancamento_omie?: number;
  codigo_lancamento_integracao?: string;
  codigo_cliente_fornecedor?: number;
  numero_documento?: string;
  data_vencimento?: string; // DD/MM/YYYY
  valor_documento?: number;
  valor_pis?: number;
  valor_cofins?: number;
  valor_csll?: number;
  valor_ir?: number;
  valor_iss?: number;
  valor_inss?: number;
  codigo_categoria?: string;
  data_previsao?: string; // DD/MM/YYYY
  id_conta_corrente?: number;
  observacao?: string;
  status_titulo?: string;
  data_emissao?: string; // DD/MM/YYYY
  data_entrada?: string; // DD/MM/YYYY
  data_pagamento?: string; // DD/MM/YYYY
  valor_pagamento?: number;
  cabecalho?: {
    codigo_lancamento_omie?: number;
  };
  departamentos?: OmieDepartamento[];
  categorias?: OmieCategoriaLancamento[];
  info?: {
    dAlt?: string;
    hAlt?: string;
    dInc?: string;
    hInc?: string;
  };
}

export interface OmieContaPagarListRequest {
  pagina?: number;
  registros_por_pagina?: number;
  apenas_importado_api?: string; // 'N' or 'S'
  filtrar_por_data_de?: string; // DD/MM/YYYY
  filtrar_por_data_ate?: string; // DD/MM/YYYY
  filtrar_por_status?: string; // 'LIQUIDADO', 'ABERTO', 'VENCIDO'
}

export interface OmieContaPagarListResponse {
  pagina: number;
  total_de_paginas: number;
  registros: number;
  total_de_registros: number;
  conta_pagar_cadastro: OmieContaPagar[];
}

// ============================================================================
// CONTAS A RECEBER
// ============================================================================

export interface OmieContaReceber {
  codigo_lancamento_omie?: number;
  codigo_lancamento_integracao?: string;
  codigo_cliente_fornecedor?: number;
  numero_documento?: string;
  data_vencimento?: string; // DD/MM/YYYY
  valor_documento?: number;
  codigo_categoria?: string;
  data_previsao?: string; // DD/MM/YYYY
  id_conta_corrente?: number;
  observacao?: string;
  status_titulo?: string;
  data_emissao?: string; // DD/MM/YYYY
  data_entrada?: string; // DD/MM/YYYY
  data_recebimento?: string; // DD/MM/YYYY
  valor_recebido?: number;
  departamentos?: OmieDepartamento[];
  categorias?: OmieCategoriaLancamento[];
  info?: {
    dAlt?: string;
    hAlt?: string;
    dInc?: string;
    hInc?: string;
  };
}

export interface OmieContaReceberListRequest {
  pagina?: number;
  registros_por_pagina?: number;
  apenas_importado_api?: string;
  filtrar_por_data_de?: string; // DD/MM/YYYY
  filtrar_por_data_ate?: string; // DD/MM/YYYY
  filtrar_por_status?: string; // 'RECEBIDO', 'ABERTO', 'VENCIDO'
}

export interface OmieContaReceberListResponse {
  pagina: number;
  total_de_paginas: number;
  registros: number;
  total_de_registros: number;
  conta_receber_cadastro: OmieContaReceber[];
}

// ============================================================================
// CATEGORIAS
// ============================================================================

export interface OmieCategoria {
  codigo?: string;
  descricao?: string;
  descricao_padrao?: string;
  id_sintetico?: string;
  tag_conta?: string;
  conta_inativa?: string; // 'S' or 'N'
}

export interface OmieCategoriaListResponse {
  pagina: number;
  total_de_paginas: number;
  registros: number;
  total_de_registros: number;
  categoria_cadastro: OmieCategoria[];
}

// ============================================================================
// CLIENTES / FORNECEDORES
// ============================================================================

export interface OmieClienteFornecedor {
  codigo_cliente_omie?: number;
  codigo_cliente_integracao?: string;
  razao_social?: string;
  nome_fantasia?: string;
  cnpj_cpf?: string;
  email?: string;
  telefone1_numero?: string;
  telefone1_ddd?: string;
  tags?: { tag: string }[];
  inativo?: string; // 'S' or 'N'
}

export interface OmieClienteListResponse {
  pagina: number;
  total_de_paginas: number;
  registros: number;
  total_de_registros: number;
  clientes_cadastro: OmieClienteFornecedor[];
}

// ============================================================================
// CONTAS CORRENTES
// ============================================================================

export interface OmieContaCorrente {
  nCodCC?: number;
  cDescricao?: string;
  cCodBanco?: string;
  cNumAgencia?: string;
  cNumCC?: string;
  nSaldoInicial?: number;
  cInativo?: string; // 'S' or 'N'
  tipo_conta_corrente?: string;
}

export interface OmieContaCorrenteListResponse {
  pagina: number;
  total_de_paginas: number;
  registros: number;
  total_de_registros: number;
  ListarContasCorrentes: OmieContaCorrente[];
}

// ============================================================================
// DEPARTAMENTOS (Centros de Custo)
// ============================================================================

export interface OmieDepartamento {
  cCodDep?: string;
  cNomeDep?: string;
  nPerDep?: number;
  nValDep?: number;
  cInativo?: string;
}

export interface OmieCategoriaLancamento {
  codigo_categoria?: string;
  valor?: number;
  percentual?: number;
}

// ============================================================================
// NORMALIZED TYPES (Output)
// ============================================================================

export interface OmiePayable {
  id: string;
  description: string;
  dueDate: string;
  accrualDate?: string;
  value: number;
  paidValue: number;
  openValue: number;
  status: 'Pago' | 'Pendente' | 'Vencido';
  supplier: string;
  category: string;
  categoryId?: string;
  paymentDate?: string;
  documentNumber?: string;
  notes?: string;
}

export interface OmieReceivable {
  id: string;
  description: string;
  dueDate: string;
  accrualDate?: string;
  value: number;
  paidValue: number;
  openValue: number;
  status: 'Recebido' | 'Pendente' | 'Vencido';
  customer: string;
  category: string;
  categoryId?: string;
  paymentDate?: string;
  documentNumber?: string;
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
  source: 'omie';
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

export interface OmieConnectionTest {
  connected: boolean;
  apiUrl: string;
  environment: string;
  mode: 'LIVE' | 'ERROR';
  error?: string;
}

// ============================================================================
// UPSERT TYPES (Write)
// ============================================================================

export interface OmieUpsertClienteRequest {
  codigo_cliente_integracao: string;
  razao_social: string;
  nome_fantasia?: string;
  cnpj_cpf?: string;
  email?: string;
  telefone1_ddd?: string;
  telefone1_numero?: string;
  endereco?: string;
  endereco_numero?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
  cep?: string;
  tags?: { tag: string }[];
  observacao?: string;
}

export interface OmieUpsertClienteResponse {
  codigo_cliente_omie: number;
  codigo_cliente_integracao: string;
  codigo_status: string;
  descricao_status: string;
}

export interface OmieUpsertContaPagarRequest {
  codigo_lancamento_integracao: string;
  codigo_cliente_fornecedor: number;
  data_vencimento: string; // DD/MM/YYYY
  valor_documento: number;
  codigo_categoria: string;
  data_previsao: string; // DD/MM/YYYY
  id_conta_corrente?: number;
  numero_documento?: string;
  data_emissao?: string; // DD/MM/YYYY
  observacao?: string;
}

export interface OmieUpsertContaPagarResponse {
  codigo_lancamento_omie: number;
  codigo_lancamento_integracao: string;
  codigo_status: string;
  descricao_status: string;
}

export interface OmieUpsertContaReceberRequest {
  codigo_lancamento_integracao: string;
  codigo_cliente_fornecedor: number;
  data_vencimento: string; // DD/MM/YYYY
  valor_documento: number;
  codigo_categoria: string;
  data_previsao: string; // DD/MM/YYYY
  id_conta_corrente?: number;
  numero_documento?: string;
  data_emissao?: string; // DD/MM/YYYY
  observacao?: string;
}

export interface OmieUpsertContaReceberResponse {
  codigo_lancamento_omie: number;
  codigo_lancamento_integracao: string;
  codigo_status: string;
  descricao_status: string;
}
