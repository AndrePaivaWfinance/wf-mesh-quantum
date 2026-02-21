/**
 * Getnet Types - Tipos para integração SFTP Getnet
 * Migrado de wf-financeiro/shared/getnet_file_helper.py + GetnetAgent/__init__.py
 */

// ============================================================================
// RECORD TYPES (parsed from positional file)
// ============================================================================

/** Header do arquivo (Tipo 0) */
export interface GetnetHeader {
  TipoRegistro: 0;
  DataMovimento: string | null;
  HoraGeracao: string;
  CodigoEstabelecimento: string;
  CNPJ: string;
  NomeAdquirente: string;
  VersaoLayout: string;
  LinhaRaw: string;
}

/** Resumo de Vendas (Tipo 1) — Layout V10.1 oficial */
export interface GetnetResumoVendas {
  TipoRegistro: 1;
  CodigoEstabelecimento: string;
  Produto: string;
  /** Forma de captura: MAN (rede/bandeira, valor líquido), POS (terminal, valor bruto real) */
  Bandeira: string;
  NumeroRV: string;
  DataRV: string | null;
  DataPagamento: string | null;
  Banco: string;
  Agencia: string;
  ContaCorrente: string;
  CVsAceitos: number;
  CVsRejeitados: number;
  ValorBruto: number;
  ValorLiquido: number;
  ValorTaxaServico: number;
  ValorTaxaDesconto: number;
  ValorRejeitado: number;
  ValorCredito: number;
  ValorEncargos: number;
  TipoPagamento: string;
  NumeroParcela: number;
  QuantidadeParcelas: number;
  CodigoEstabelecimentoCentralizador: string;
  /**
   * true quando Bandeira=MAN e ValorTaxaDesconto=0: indica que ValorBruto já está
   * descontado da taxa da maquineta (a Getnet reporta o líquido como "bruto" nos registros MAN).
   * O bruto REAL vem do registro POS pareado (mesmo ValorLiquido + DataPagamento).
   */
  isBrutoDescontado: boolean;
}

/** Comprovante de Vendas (Tipo 2) */
export interface GetnetComprovanteVendas {
  TipoRegistro: 2;
  CodigoEstabelecimento: string;
  NumeroRV: string;
  NSU: string;
  DataTransacao: string | null;
  HoraTransacao: string;
  NumeroCartao: string;
  ValorTransacao: number;
  Parcela: string;
  TotalParcelas: string;
  ValorParcela: number;
  DataPagamento: string | null;
  CodigoAutorizacao: string;
  Bandeira: string;
}

/** Ajuste Financeiro (Tipo 3) */
export interface GetnetAjusteFinanceiro {
  TipoRegistro: 3;
  CodigoEstabelecimento: string;
  NumeroRV: string;
  DataAjuste: string | null;
  DataPagamento: string | null;
  SinalTransacao: string;
  ValorAjuste: number;
  MotivoAjuste: string;
}

/** Antecipação (Tipo 4) */
export interface GetnetAntecipacao {
  TipoRegistro: 4;
  CodigoEstabelecimento: string;
  Produto: string;
  Bandeira: string;
  NumeroOperacao: string;
  DataAntecipacao: string | null;
  DataOriginalPagamento: string | null;
  ValorBrutoAntecipacao: number;
  TaxaAntecipacao: number;
  ValorLiquidoAntecipacao: number;
}

/** Negociação/Cessão (Tipo 5) */
export interface GetnetNegociacaoCessao {
  TipoRegistro: 5;
  CodigoEstabelecimento: string;
  DataCessao: string | null;
  DataPagamento: string | null;
  NumeroOperacao: string;
  Indicador: string;
  ValorBrutoCessao: number;
  ValorTaxaCessao: number;
  ValorLiquidoCessao: number;
  LinhaRaw: string;
}

/** Unidade de Recebível (Tipo 6) */
export interface GetnetUnidadeRecebivel {
  TipoRegistro: 6;
  CodigoEstabelecimento: string;
  DataPagamento: string | null;
  NumeroOperacao: string;
  Indicador: string;
  TipoProduto: string;
  DataLiquidacao: string | null;
  ValorBrutoUR: number;
  ValorDescontoUR: number;
  ValorLiquidoUR: number;
  LinhaRaw: string;
}

/** Trailer do arquivo (Tipo 9) */
export interface GetnetTrailer {
  TipoRegistro: 9;
  TotalRegistros: number;
  ValorTotalBruto: number;
  ValorTotalLiquido: number;
  QuantidadeRVs: number;
  LinhaRaw: string;
}

/** Union de todos os tipos de registro */
export type GetnetRegistro =
  | GetnetHeader
  | GetnetResumoVendas
  | GetnetComprovanteVendas
  | GetnetAjusteFinanceiro
  | GetnetAntecipacao
  | GetnetNegociacaoCessao
  | GetnetUnidadeRecebivel
  | GetnetTrailer;

// ============================================================================
// SFTP CLIENT TYPES
// ============================================================================

/** Arquivo encontrado no SFTP */
export interface GetnetArquivoSFTP {
  nome: string;
  tamanho: number;
  dataModificacao: Date;
  timestamp: number;
}

/** Resultado da busca SFTP */
export interface GetnetSFTPResult {
  erro: boolean;
  mensagem: string;
  arquivo: string | null;
  conteudo: string | null;
  dataModificacao?: string;
  tamanhoBytes?: number;
  totalLinhas?: number;
}

// ============================================================================
// DADOS POR ESTABELECIMENTO
// ============================================================================

/** Dados filtrados por estabelecimento */
export interface DadosEstabelecimento {
  header: GetnetHeader | null;
  resumos_vendas: GetnetResumoVendas[];
  comprovantes_vendas: GetnetComprovanteVendas[];
  ajustes_financeiros: GetnetAjusteFinanceiro[];
  antecipacoes: GetnetAntecipacao[];
  negociacoes_cessao: GetnetNegociacaoCessao[];
  unidades_recebiveis: GetnetUnidadeRecebivel[];
  trailer: GetnetTrailer | null;
}

// ============================================================================
// REQUEST / RESPONSE CONTRACTS
// ============================================================================

/** Request para capture */
export interface CaptureRequest {
  clientId: string;
  cycleId: string;
  startDate?: string;
  endDate?: string;
  action?: 'listar' | 'ingerir' | 'raw';
  codigoEstabelecimento?: string;
}

/** Response do capture */
export interface CaptureResponse {
  success: boolean;
  source: 'getnet';
  clientId: string;
  cycleId: string;
  transactions: {
    total: number;
    new: number;
    updated: number;
    skipped: number;
  };
  receber: number;
  pagar: number;
  vendas: number;
  durationMs: number;
}
