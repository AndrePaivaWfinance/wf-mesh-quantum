/**
 * Shared Types - Operações BPO
 *
 * Tipos compartilhados entre todos os serviços de operação.
 * Migrado de wf-financeiro/shared/models_financeiro.py
 */

// ============================================================================
// ENUMS
// ============================================================================

/** Tipos de transações financeiras */
export enum TransactionType {
  PAGAR = 'pagar',
  RECEBER = 'receber',
  EXTRATO = 'extrato',
  NF = 'nf',
  BOLETO = 'boleto',
  DDA = 'dda',
  VENDA_CARTAO = 'venda_cartao',
  COMPROVANTE = 'comprovante',
  TRANSFERENCIA = 'transferencia',
  CONCILIACAO = 'conciliacao',
  OUTROS = 'outros',
}

/** Status de processamento da transação */
export enum TransactionStatus {
  // Pipeline inicial
  NOVO = 'novo',
  CAPTURADO = 'capturado',
  CLASSIFICADO = 'classificado',
  PROCESSANDO = 'processando',
  PROCESSADO = 'processado',

  // Contas a pagar
  PAGAMENTO_PENDENTE = 'pagamento_pendente',
  AGENDADO = 'agendado',
  PAGO = 'pago',

  // Contas a receber
  RECEBIMENTO_PENDENTE = 'recebimento_pendente',
  RECEBIDO = 'recebido',

  // Revisão humana
  REVISAO_PENDENTE = 'revisao_pendente',
  APROVADO = 'aprovado',
  REJEITADO = 'rejeitado',

  // Outros
  CONCILIADO = 'conciliado',
  VENCIDO = 'vencido',
  ERRO = 'erro',
}

/** Fonte de origem da transação */
export enum TransactionSource {
  NIBO = 'nibo',
  OMIE = 'omie',
  SANTANDER = 'santander',
  GETNET = 'getnet',
  OFX = 'ofx',
  EXCEL = 'excel',
  CSV = 'csv',
  MANUAL = 'manual',
  EMAIL = 'email',
  UPLOAD = 'upload',
}

/** Tipo de pagamento */
export enum PaymentType {
  BOLETO = 'boleto',
  PIX = 'pix',
  PIX_CHAVE = 'pix_chave',
  TED = 'ted',
  DOC = 'doc',
  DEBITO = 'debito',
  CREDITO = 'credito',
}

/** Sistema de gestão do cliente */
export enum ClientSystem {
  NIBO = 'nibo',
  OMIE = 'omie',
}

/** Status do cliente */
export enum ClientStatus {
  ATIVO = 'ativo',
  INATIVO = 'inativo',
  ONBOARDING = 'onboarding',
  SUSPENSO = 'suspenso',
}

/** Tipo de dúvida para revisão humana */
export enum DoubtType {
  CLASSIFICACAO = 'classificacao',
  VINCULACAO = 'vinculacao',
  EXTRACAO = 'extracao',
  DUPLICIDADE = 'duplicidade',
}

/** Status do ciclo diário */
export enum CycleStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PARTIAL = 'partial',
}

// ============================================================================
// INTERFACES - Core
// ============================================================================

/** Cliente BPO */
export interface Client {
  id: string;
  nome: string;
  cnpj: string;
  sistema: ClientSystem;
  status: ClientStatus;

  // Configurações de integração
  config: ClientConfig;

  // Metadados
  createdAt: string;
  updatedAt: string;
}

/** Configuração do cliente */
export interface ClientConfig {
  // Sistema de gestão
  niboTenantId?: string;
  omieAppKey?: string;
  omieAppSecret?: string;

  // Banco
  banco?: string;
  bancoAgencia?: string;
  bancoConta?: string;

  // Adquirente
  adquirente?: string;
  getnetEstabelecimento?: string;

  // Notificações
  notificacoes: {
    email: boolean;
    whatsapp: boolean;
    resumoDiario: boolean;
    alertaVencimento: boolean;
    emailDestino?: string;
    whatsappNumero?: string;
  };

  // Categorização
  categoriasCustomizadas: boolean;
  planoContasId?: string;
}

/** Transação financeira normalizada */
export interface Transaction {
  id: string;
  clientId: string;

  // Classificação
  type: TransactionType;
  status: TransactionStatus;
  source: TransactionSource;

  // Valores
  valor: number;
  valorOriginal?: number;

  // Datas
  dataVencimento?: string;
  dataEmissao?: string;
  dataRealizacao?: string;
  dataCapturaAjuste?: string;

  // Identificação
  descricao: string;
  descricaoOriginal?: string;
  contraparte?: string; // Fornecedor ou Cliente
  contraparteCnpj?: string;

  // Categorização
  categoriaId?: string;
  categoriaNome?: string;
  categoriaConfianca?: number;

  // Referências externas
  sourceId?: string; // ID na fonte original
  sourceName?: string; // "Santander", "Nibo", etc.
  niboId?: string;
  omieId?: string;
  codigoBarras?: string;
  nossoNumero?: string;
  numeroDocumento?: string;

  // Vinculação
  vinculadoA?: string; // ID da transação prevista vinculada
  vinculacaoTipo?: 'automatico' | 'manual';

  // Dados brutos
  rawData?: Record<string, unknown>;

  // Metadados
  createdAt: string;
  updatedAt: string;
  capturedAt: string;
  processedAt?: string;
}

/** Categoria contábil */
export interface Category {
  id: string;
  clientId: string; // 'DEFAULT' para template padrão
  codigo: string;
  nome: string;
  tipo: 'receita' | 'despesa' | 'transferencia';
  pai?: string; // ID da categoria pai
  nivel: number;
  ativo: boolean;
}

// ============================================================================
// INTERFACES - Ciclo Diário
// ============================================================================

/** Ciclo diário de processamento */
export interface DailyCycle {
  id: string;
  date: string; // YYYY-MM-DD
  status: CycleStatus;

  // Clientes processados
  clientsTotal: number;
  clientsProcessed: number;
  clientsFailed: number;

  // Transações
  transactionsCaptured: number;
  transactionsClassified: number;
  transactionsSynced: number;
  transactionsReview: number;

  // Tempos
  startedAt: string;
  completedAt?: string;
  durationMs?: number;

  // Erros
  errors: CycleError[];
}

/** Erro no ciclo */
export interface CycleError {
  clientId: string;
  stage: 'capture' | 'classify' | 'sync';
  source?: TransactionSource;
  message: string;
  timestamp: string;
}

/** Resultado de captura por cliente */
export interface ClientCaptureResult {
  clientId: string;
  source: TransactionSource;
  status: 'success' | 'error' | 'partial';
  transactionsCount: number;
  newCount: number;
  updatedCount: number;
  errorMessage?: string;
  durationMs: number;
}

// ============================================================================
// INTERFACES - Revisão Humana
// ============================================================================

/** Autorização pendente (pagamento/recebimento) */
export interface PendingAuthorization {
  id: string;
  clientId: string;
  transactionId: string;
  tipo: 'pagar' | 'receber';

  // Dados da transação
  descricao: string;
  valor: number;
  vencimento: string;
  contraparte: string;
  categoria: string;
  documento?: string;

  // Status
  status: 'pendente' | 'aprovado' | 'rejeitado';
  criadoEm: string;
  resolvidoEm?: string;
  resolvidoPor?: string;
  notas?: string;
}

/** Dúvida de enriquecimento */
export interface EnrichmentDoubt {
  id: string;
  clientId: string;
  transactionId: string;
  tipo: DoubtType;

  // Transação
  transacao: {
    id: string;
    descricao: string;
    valor: number;
    data: string;
  };

  // Sugestão da IA
  sugestaoIA?: {
    categoria?: string;
    categoriaId?: string;
    confianca: number;
  };

  // Opções de resolução
  opcoes?: Array<{
    id: string;
    nome: string;
  }>;

  // Status
  status: 'pendente' | 'resolvido' | 'pulado';
  criadoEm: string;
  resolvidoEm?: string;
  resolucao?: Record<string, unknown>;
  notas?: string;
}

/** Ação no histórico */
export interface HistoryAction {
  id: string;
  clientId: string;
  tipo: 'aprovacao' | 'rejeicao' | 'classificacao' | 'sync' | 'captura' | 'erro';
  descricao: string;
  usuario?: string;
  data: string;
  detalhes?: Record<string, unknown>;
}

// ============================================================================
// INTERFACES - Filas
// ============================================================================

/** Status de uma fila */
export interface QueueStatus {
  nome: string;
  mensagens: number;
  status: 'idle' | 'processing' | 'waiting' | 'error';
}

/** Mensagem de captura */
export interface CaptureMessage {
  clientId: string;
  source: TransactionSource;
  cycleId: string;
  timestamp: string;
  config?: Record<string, unknown>;
}

/** Mensagem de classificação */
export interface ClassifyMessage {
  transactionId: string;
  clientId: string;
  cycleId: string;
  timestamp: string;
}

/** Mensagem de sync */
export interface SyncMessage {
  transactionId: string;
  clientId: string;
  destination: ClientSystem;
  action: 'create' | 'update';
  cycleId: string;
  timestamp: string;
}

// ============================================================================
// INTERFACES - Dashboard
// ============================================================================

/** Dashboard BPO */
export interface BPODashboard {
  kpis: {
    pendentes: number;
    processando: number;
    erro: number;
    concluidosHoje: number;
  };
  pipeline: {
    captura: { status: string; count: number };
    classificacao: { status: string; count: number };
    sync: { status: string; count: number };
  };
  ultimosCiclos: Array<{
    id: string;
    data: string;
    status: CycleStatus;
    transacoes: number;
    erros: number;
  }>;
  alertas: Array<{
    tipo: string;
    mensagem: string;
    prioridade: 'alta' | 'media' | 'baixa';
  }>;
}

// ============================================================================
// INTERFACES - Relatórios (MVP2)
// ============================================================================

/** Fluxo de caixa */
export interface CashFlow {
  periodo: {
    inicio: string;
    fim: string;
  };
  saldoInicial: number;
  saldoFinal: number;
  entradas: number;
  saidas: number;
  movimentacoes: Array<{
    data: string;
    tipo: 'entrada' | 'saida';
    valor: number;
    categoria: string;
    descricao: string;
    realizado: boolean;
  }>;
}

// ============================================================================
// INTERFACES - Notificações (MVP3)
// ============================================================================

/** Configuração de notificação */
export interface NotificationConfig {
  clientId: string;
  tipo: 'resumo_diario' | 'alerta_vencimento' | 'alerta_inadimplencia';
  canal: 'email' | 'whatsapp';
  ativo: boolean;
  horario?: string; // HH:mm
  diasAntecedencia?: number;
}

/** Notificação enviada */
export interface SentNotification {
  id: string;
  clientId: string;
  tipo: string;
  canal: string;
  destinatario: string;
  assunto?: string;
  conteudo: string;
  enviadoEm: string;
  status: 'enviado' | 'falha';
  erro?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

/** Cria uma nova transação */
export function createTransaction(
  clientId: string,
  type: TransactionType,
  source: TransactionSource,
  data: Partial<Transaction>
): Transaction {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    clientId,
    type,
    source,
    status: TransactionStatus.CAPTURADO,
    valor: 0,
    descricao: '',
    createdAt: now,
    updatedAt: now,
    capturedAt: now,
    ...data,
  };
}

/** Cria um novo cliente */
export function createClient(
  nome: string,
  cnpj: string,
  sistema: ClientSystem,
  config: Partial<ClientConfig> = {}
): Client {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    nome,
    cnpj,
    sistema,
    status: ClientStatus.ONBOARDING,
    config: {
      notificacoes: {
        email: true,
        whatsapp: false,
        resumoDiario: true,
        alertaVencimento: true,
      },
      categoriasCustomizadas: false,
      ...config,
    },
    createdAt: now,
    updatedAt: now,
  };
}
