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
  CONTROLLE = 'controlle',
  SANTANDER = 'santander',
  INTER = 'inter',
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
  CONTROLLE = 'controlle',
}

/** Status do cliente */
export enum ClientStatus {
  ATIVO = 'ativo',
  INATIVO = 'inativo',
  ONBOARDING = 'onboarding',
  SUSPENSO = 'suspenso',
}

/** Plano do cliente */
export enum ClientPlano {
  ESSENCIAL = 'Essencial',
  AVANCADO = 'Avançado',
  PREMIUM = 'Premium',
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

/**
 * Cliente BPO - Modelo Unificado
 *
 * Fonte de verdade UNICA para dados de cliente.
 * Tabela: Clientes (stoperacoes)
 * PartitionKey: tenantId | RowKey: id
 *
 * Substitui as tabelas antigas:
 * - OperacaoClients (operacao-head)
 * - PortalClients (portal-api)
 * - clientes (webstatics API)
 */
export interface Client {
  id: string;
  tenantId: string; // slug curto para uso como PK em outras tabelas (ex: "wf-001")
  nome: string;
  cnpj: string;
  email: string;
  telefone?: string;

  // Plano & Status
  plano: ClientPlano;
  sistema: ClientSystem;
  status: ClientStatus;

  // Configurações de integração
  config: ClientConfig;

  // Origem (se veio do pipeline comercial)
  leadId?: string; // ID do lead que originou este cliente
  contratoId?: string; // ID do contrato Adobe Sign

  // Metadados
  createdAt: string;
  updatedAt: string;
}

/** Configuração do cliente */
export interface ClientConfig {
  // Credenciais ERP - Nibo
  niboTenantId?: string;
  niboApiKey?: string; // login → Table Storage

  // Credenciais ERP - Omie
  omieAppKey?: string; // login → Table Storage (secret via KV)
  omieAppSecret?: string; // legado — novos clientes usam "kv:{tenantId}-OMIE-APP-SECRET"

  // Credenciais ERP - Controlle
  controlleApiKey?: string;

  // Banco - Santander
  banco?: string;
  bancoAgencia?: string;
  bancoConta?: string;
  bancoContaDigito?: string;
  santanderClientId?: string; // login OAuth → Table Storage (secret via KV)

  // Adquirente - Getnet
  adquirente?: string;
  getnetEstabelecimento?: string;
  getnetUser?: string; // login SFTP → Table Storage (password via KV)

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
  metadata?: Record<string, any>;
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

/** Gera tenantId a partir do nome (slug) */
export function generateTenantId(nome: string): string {
  return nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
}

/** Cria um novo cliente (modelo unificado) */
export function createClient(data: {
  nome: string;
  cnpj: string;
  email: string;
  telefone?: string;
  sistema: ClientSystem;
  plano?: ClientPlano;
  tenantId?: string;
  config?: Partial<ClientConfig>;
  leadId?: string;
  contratoId?: string;
}): Client {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    tenantId: data.tenantId || generateTenantId(data.nome),
    nome: data.nome,
    cnpj: data.cnpj,
    email: data.email,
    telefone: data.telefone,
    plano: data.plano || ClientPlano.ESSENCIAL,
    sistema: data.sistema,
    status: ClientStatus.ONBOARDING,
    config: {
      notificacoes: {
        email: true,
        whatsapp: false,
        resumoDiario: true,
        alertaVencimento: true,
      },
      categoriasCustomizadas: false,
      ...data.config,
    },
    leadId: data.leadId,
    contratoId: data.contratoId,
    createdAt: now,
    updatedAt: now,
  };
}

// ============================================================================
// INTERFACES - AI & Automation (80/20 System)
// ============================================================================

/** Resultado da classificação avançada */
export interface ClassificationResult {
  categoria: string;
  centroCusto?: string;
  projeto?: string;
  tipoDespesa: 'fixa' | 'variavel';
  recorrencia: 'unica' | 'mensal' | 'anual';
  confianca: number; // 0.0 a 1.0
  alternativas: Array<{
    categoria: string;
    confianca: number;
    razao: string;
  }>;
  explicacao: string;
  modeloVersion?: string;
}

/** Anomalia detectada */
export interface Anomaly {
  tipo: 'valor' | 'frequencia' | 'timing' | 'fraude' | 'padrao_desconhecido';
  severidade: 'baixa' | 'media' | 'alta' | 'critica';
  transacaoId: string;
  descricao: string;
  razao: string;
  sugestaoAcao: string;
  autoResolve: boolean;
  score: number; // 0.0 a 1.0 (quanto maior, mais anômalo)
}

/** Resultado do matching inteligente */
export interface MatchResult {
  previstoId?: string;
  realizadoId?: string;
  confianca: number;
  tipo: 'exato' | 'fuzzy' | 'split' | 'agrupamento' | 'sem_match';
  divergencias?: Array<{
    campo: string;
    esperado: any;
    encontrado: any;
  }>;
  metadados?: Record<string, any>;
}

/** Decisão do motor de regras */
export interface Decision {
  acao: 'aprovar' | 'rejeitar' | 'escalar' | 'aguardar' | 'categorizar_auto' | 'sync_auto';
  confianca: number;
  razao: string;
  requisitoHumano: boolean;
  regrasAplicadas: string[];
}

/** Registro de feedback para aprendizado */
export interface FeedbackRecord {
  id: string;
  transactionId: string;
  clientId: string;
  tipo: 'classificacao' | 'anomalia' | 'matching';
  predictionIA: any;
  correcaoHumana: any; // O que o humano decidiu/corrigiu
  timestamp: string;
  usuario?: string;
}
