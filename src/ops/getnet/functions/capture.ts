/**
 * Capture - getnet-ops (integrado ao mesh)
 *
 * POST /api/getnet/capture - Captura dados do SFTP Getnet e persiste no storage do mesh
 *
 * Migrado de wf-financeiro/GetnetAgent/__init__.py
 *
 * Fluxo:
 * 1. Conecta ao SFTP e baixa arquivo posicional por data
 * 2. Parseia arquivo (layout V10.1, 401 chars, 8 tipos de registro)
 * 3. Filtra registros por lógica de negócio (débito/crédito, LQ, D-1)
 * 4. Cria transações: RECEBER (bruto), PAGAR (taxas), VENDA_CARTAO (informativo)
 * 5. Persiste no Table Storage com idempotência
 *
 * Ações disponíveis:
 *   - listar: Retorna dados parseados (stateless, não salva)
 *   - ingerir/capture: Salva no storage e retorna resultado
 *   - raw: Retorna linhas brutas do arquivo
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import * as crypto from 'crypto';
import { getGetnetClient } from '../adapters/client';
import { parseConteudo, parearManPos } from '../adapters/fileHelper';
import {
  CaptureRequest,
  CaptureResponse,
  GetnetRegistro,
  GetnetResumoVendas,
  GetnetComprovanteVendas,
  GetnetAjusteFinanceiro,
  GetnetAntecipacao,
  GetnetNegociacaoCessao,
} from '../adapters/types';
import { createLogger, nowISO } from '../shared/utils';
import { getExistingSourceIds, upsertTransactionsIdempotent } from '../../../storage/tableClient';
import { Transaction, TransactionType, TransactionSource, TransactionStatus } from '../../../types';

const logger = createLogger('GetnetCapture');

function shortHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
}

// ============================================================================
// CONVERSORES DE REGISTRO -> TRANSACTION
// ============================================================================

/**
 * Converte resumo de venda em transação RECEBER (valor bruto)
 */
function vendaToReceber(
  venda: GetnetResumoVendas,
  clientId: string,
  cycleId: string,
  dataMovimento: string
): Transaction {
  const sourceId = `getnet-rv-${venda.NumeroRV}-${venda.Produto}-${venda.Bandeira}`;
  return {
    id: `getnet-receber-${shortHash(sourceId)}`,
    clientId,
    type: TransactionType.RECEBER,
    status: TransactionStatus.CAPTURADO,
    source: TransactionSource.GETNET,
    valor: venda.ValorBruto,
    valorOriginal: venda.ValorBruto,
    dataVencimento: venda.DataPagamento || dataMovimento,
    descricao: `Venda cartão ${venda.Produto}/${venda.Bandeira} - RV ${venda.NumeroRV}`,
    descricaoOriginal: `Venda cartão ${venda.Produto}/${venda.Bandeira} - RV ${venda.NumeroRV}`,
    contraparte: `Getnet - ${venda.Bandeira}`,
    sourceId,
    sourceName: 'getnet',
    rawData: JSON.parse(JSON.stringify(venda)),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    capturedAt: nowISO(),
    cycleId,
    metadata: {
      tipo_registro: 'resumo_venda_receber',
      numero_rv: venda.NumeroRV,
      bandeira: venda.Bandeira,
      produto: venda.Produto,
      codigo_estabelecimento: venda.CodigoEstabelecimento,
      tipo_pagamento: venda.TipoPagamento,
      valor_bruto: venda.ValorBruto,
      valor_liquido: venda.ValorLiquido,
      valor_tarifa: venda.ValorTaxaDesconto,
      data_rv: venda.DataRV,
      data_movimento: dataMovimento,
    },
  } as any;
}

/**
 * Converte taxa da venda em transação PAGAR (taxa maquineta)
 */
function vendaToPagar(
  venda: GetnetResumoVendas,
  clientId: string,
  cycleId: string,
  dataMovimento: string
): Transaction {
  const sourceId = `getnet-taxa-${venda.NumeroRV}-${venda.Produto}-${venda.Bandeira}`;
  return {
    id: `getnet-pagar-${shortHash(sourceId)}`,
    clientId,
    type: TransactionType.PAGAR,
    status: TransactionStatus.CAPTURADO,
    source: TransactionSource.GETNET,
    valor: venda.ValorTaxaDesconto,
    valorOriginal: venda.ValorTaxaDesconto,
    dataVencimento: venda.DataPagamento || dataMovimento,
    descricao: `Taxa cartão ${venda.Produto}/${venda.Bandeira} - RV ${venda.NumeroRV}`,
    descricaoOriginal: `Taxa cartão ${venda.Produto}/${venda.Bandeira} - RV ${venda.NumeroRV}`,
    contraparte: 'Getnet S.A.',
    sourceId,
    sourceName: 'getnet',
    rawData: JSON.parse(JSON.stringify(venda)),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    capturedAt: nowISO(),
    cycleId,
    metadata: {
      tipo_registro: 'resumo_venda_taxa',
      numero_rv: venda.NumeroRV,
      bandeira: venda.Bandeira,
      produto: venda.Produto,
      codigo_estabelecimento: venda.CodigoEstabelecimento,
      valor_bruto_venda: venda.ValorBruto,
      valor_liquido_venda: venda.ValorLiquido,
      data_movimento: dataMovimento,
    },
  } as any;
}

/**
 * Converte venda em transação VENDA_CARTAO (informativo, não entra no fluxo)
 */
function vendaToVendaCartao(
  venda: GetnetResumoVendas,
  clientId: string,
  cycleId: string,
  dataMovimento: string,
  comprovantes?: GetnetComprovanteVendas[]
): Transaction {
  const sourceId = `getnet-venda-${venda.NumeroRV}-${venda.Produto}-${venda.Bandeira}`;

  // Calcular valor de faturamento e parcelas a partir dos comprovantes (Tipo 2)
  const valorFaturamento = comprovantes && comprovantes.length > 0
    ? comprovantes.reduce((sum, cv) => sum + cv.ValorTransacao, 0)
    : venda.ValorBruto;

  const comprovantesRef = comprovantes?.map(cv => {
    // Taxa proporcional: peso do comprovante no RV * taxa total do RV
    const peso = venda.ValorBruto > 0 ? cv.ValorTransacao / venda.ValorBruto : 0;
    const taxaProporcional = Math.round(venda.ValorTaxaDesconto * peso * 100) / 100;
    const valorLiquidoEstimado = Math.round((cv.ValorTransacao - taxaProporcional) * 100) / 100;

    return {
      nsu: cv.NSU,
      valor_faturamento: cv.ValorTransacao,
      parcela_atual: cv.Parcela,
      total_parcelas: cv.TotalParcelas,
      valor_parcela: cv.ValorParcela,
      taxa_proporcional: taxaProporcional,
      valor_liquido_estimado: valorLiquidoEstimado,
      data_transacao: cv.DataTransacao,
      data_pagamento: cv.DataPagamento,
      numero_cartao: cv.NumeroCartao,
      codigo_autorizacao: cv.CodigoAutorizacao,
      bandeira: cv.Bandeira,
    };
  });

  return {
    id: `getnet-venda-${shortHash(sourceId)}`,
    clientId,
    type: TransactionType.VENDA_CARTAO,
    status: TransactionStatus.CAPTURADO,
    source: TransactionSource.GETNET,
    valor: venda.ValorBruto,
    valorOriginal: venda.ValorBruto,
    dataVencimento: venda.DataPagamento || dataMovimento,
    descricao: `Vendas cartão ${venda.Produto}/${venda.Bandeira} - RV ${venda.NumeroRV}`,
    descricaoOriginal: `Vendas cartão ${venda.Produto}/${venda.Bandeira} - RV ${venda.NumeroRV}`,
    contraparte: `Getnet - ${venda.Bandeira}`,
    sourceId,
    sourceName: 'getnet',
    rawData: JSON.parse(JSON.stringify(venda)),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    capturedAt: nowISO(),
    cycleId,
    metadata: {
      tipo_registro: 'venda_informativo',
      numero_rv: venda.NumeroRV,
      valor_bruto: venda.ValorBruto,
      valor_liquido: venda.ValorLiquido,
      valor_taxa: venda.ValorTaxaDesconto,
      valor_faturamento: valorFaturamento,
      data_pagamento: venda.DataPagamento,
      data_rv: venda.DataRV,
      data_movimento: dataMovimento,
      qtd_comprovantes: comprovantes?.length ?? 0,
      comprovantes: comprovantesRef,
    },
  } as any;
}

/**
 * Converte comprovante de vendas (Tipo 2) em transação COMPROVANTE (documento de referência)
 *
 * O comprovante é o registro individual de cada transação no cartão.
 * Carrega o valor de faturamento (ValorTransacao), dados de parcelamento,
 * e a taxa proporcional rateada do Resumo de Vendas (Tipo 1).
 * Vinculado ao VENDA_CARTAO do mesmo RV.
 */
function comprovanteToTransaction(
  comprovante: GetnetComprovanteVendas,
  clientId: string,
  cycleId: string,
  dataMovimento: string,
  vendaCartaoId?: string,
  taxaProporcional?: number
): Transaction {
  const sourceId = `getnet-cv-${comprovante.NumeroRV}-${comprovante.NSU}`;
  const taxa = taxaProporcional ?? 0;
  const valorLiquidoEstimado = Math.round((comprovante.ValorTransacao - taxa) * 100) / 100;

  return {
    id: `getnet-cv-${shortHash(sourceId)}`,
    clientId,
    type: TransactionType.COMPROVANTE,
    status: TransactionStatus.CAPTURADO,
    source: TransactionSource.GETNET,
    valor: comprovante.ValorTransacao,
    valorOriginal: comprovante.ValorTransacao,
    dataVencimento: comprovante.DataPagamento || dataMovimento,
    dataEmissao: comprovante.DataTransacao || dataMovimento,
    descricao: `Comprovante ${comprovante.NSU} - RV ${comprovante.NumeroRV} - ${comprovante.Bandeira}`,
    descricaoOriginal: `Comprovante ${comprovante.NSU} - RV ${comprovante.NumeroRV} - ${comprovante.Bandeira}`,
    contraparte: `Getnet - ${comprovante.Bandeira}`,
    numeroDocumento: comprovante.NSU,
    sourceId,
    sourceName: 'getnet',
    vinculadoA: vendaCartaoId,
    vinculacaoTipo: vendaCartaoId ? 'automatico' : undefined,
    rawData: JSON.parse(JSON.stringify(comprovante)),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    capturedAt: nowISO(),
    cycleId,
    metadata: {
      tipo_registro: 'comprovante_venda',
      numero_rv: comprovante.NumeroRV,
      nsu: comprovante.NSU,
      bandeira: comprovante.Bandeira,
      codigo_estabelecimento: comprovante.CodigoEstabelecimento,
      codigo_autorizacao: comprovante.CodigoAutorizacao,
      numero_cartao: comprovante.NumeroCartao,
      valor_faturamento: comprovante.ValorTransacao,
      parcela_atual: comprovante.Parcela,
      total_parcelas: comprovante.TotalParcelas,
      valor_parcela: comprovante.ValorParcela,
      taxa_proporcional: taxa,
      valor_liquido_estimado: valorLiquidoEstimado,
      data_transacao: comprovante.DataTransacao,
      hora_transacao: comprovante.HoraTransacao,
      data_pagamento: comprovante.DataPagamento,
      data_movimento: dataMovimento,
    },
  } as any;
}

/**
 * Converte ajuste financeiro em transação PAGAR ou RECEBER
 */
function ajusteToTransaction(
  ajuste: GetnetAjusteFinanceiro,
  clientId: string,
  cycleId: string,
  dataMovimento: string
): Transaction {
  const isPagar = ajuste.SinalTransacao === '-';
  const tipo = isPagar ? TransactionType.PAGAR : TransactionType.RECEBER;
  const tipoRegistro = isPagar ? 'ajuste_debito' : 'ajuste_credito';
  const sourceId = `getnet-ajuste-${ajuste.NumeroRV}-${ajuste.SinalTransacao}-${ajuste.ValorAjuste}`;

  return {
    id: `getnet-ajuste-${shortHash(sourceId)}`,
    clientId,
    type: tipo,
    status: TransactionStatus.CAPTURADO,
    source: TransactionSource.GETNET,
    valor: ajuste.ValorAjuste,
    valorOriginal: ajuste.ValorAjuste,
    dataVencimento: ajuste.DataPagamento || dataMovimento,
    descricao: `Ajuste Getnet (${ajuste.SinalTransacao}) - RV ${ajuste.NumeroRV} - ${ajuste.MotivoAjuste}`,
    descricaoOriginal: `Ajuste Getnet (${ajuste.SinalTransacao}) - RV ${ajuste.NumeroRV} - ${ajuste.MotivoAjuste}`,
    contraparte: 'Getnet S.A.',
    sourceId,
    sourceName: 'getnet',
    rawData: JSON.parse(JSON.stringify(ajuste)),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    capturedAt: nowISO(),
    cycleId,
    metadata: {
      tipo_registro: tipoRegistro,
      codigo_estabelecimento: ajuste.CodigoEstabelecimento,
      data_movimento: dataMovimento,
    },
  } as any;
}

/**
 * Converte antecipação em transações RECEBER (valor líquido) + PAGAR (taxa)
 */
function antecipacaoToTransactions(
  antecipacao: GetnetAntecipacao,
  clientId: string,
  cycleId: string,
  dataMovimento: string
): Transaction[] {
  const transactions: Transaction[] = [];
  const baseId = `getnet-antec-${antecipacao.NumeroOperacao}`;

  if (antecipacao.ValorLiquidoAntecipacao > 0) {
    const sourceIdReceber = `${baseId}-receber`;
    transactions.push({
      id: `getnet-antec-rec-${shortHash(sourceIdReceber)}`,
      clientId,
      type: TransactionType.RECEBER,
      status: TransactionStatus.CAPTURADO,
      source: TransactionSource.GETNET,
      valor: antecipacao.ValorLiquidoAntecipacao,
      valorOriginal: antecipacao.ValorLiquidoAntecipacao,
      dataVencimento: antecipacao.DataAntecipacao || dataMovimento,
      descricao: `Antecipação Getnet - Op. ${antecipacao.NumeroOperacao}`,
      descricaoOriginal: `Antecipação Getnet - Op. ${antecipacao.NumeroOperacao}`,
      contraparte: 'Getnet S.A.',
      sourceId: sourceIdReceber,
      sourceName: 'getnet',
      rawData: JSON.parse(JSON.stringify(antecipacao)),
      createdAt: nowISO(),
      updatedAt: nowISO(),
      capturedAt: nowISO(),
      cycleId,
      metadata: {
        tipo_registro: 'antecipacao_receber',
        codigo_estabelecimento: antecipacao.CodigoEstabelecimento,
        data_movimento: dataMovimento,
      },
    } as any);
  }

  const valorTaxa = antecipacao.ValorBrutoAntecipacao - antecipacao.ValorLiquidoAntecipacao;
  if (valorTaxa > 0) {
    const sourceIdPagar = `${baseId}-taxa`;
    transactions.push({
      id: `getnet-antec-tax-${shortHash(sourceIdPagar)}`,
      clientId,
      type: TransactionType.PAGAR,
      status: TransactionStatus.CAPTURADO,
      source: TransactionSource.GETNET,
      valor: valorTaxa,
      valorOriginal: valorTaxa,
      dataVencimento: antecipacao.DataAntecipacao || dataMovimento,
      descricao: `Taxa antecipação Getnet - Op. ${antecipacao.NumeroOperacao}`,
      descricaoOriginal: `Taxa antecipação Getnet - Op. ${antecipacao.NumeroOperacao}`,
      contraparte: 'Getnet S.A.',
      sourceId: sourceIdPagar,
      sourceName: 'getnet',
      rawData: JSON.parse(JSON.stringify(antecipacao)),
      createdAt: nowISO(),
      updatedAt: nowISO(),
      capturedAt: nowISO(),
      cycleId,
      metadata: {
        tipo_registro: 'antecipacao_taxa',
        codigo_estabelecimento: antecipacao.CodigoEstabelecimento,
        data_movimento: dataMovimento,
      },
    } as any);
  }

  return transactions;
}

/**
 * Converte cessão CS em transações RECEBER (líquido) + PAGAR (taxa)
 */
function cessaoToTransactions(
  cessao: GetnetNegociacaoCessao,
  clientId: string,
  cycleId: string,
  dataMovimento: string
): Transaction[] {
  const transactions: Transaction[] = [];
  const baseId = `getnet-cessao-${cessao.NumeroOperacao}`;

  if (cessao.ValorLiquidoCessao > 0) {
    const sourceIdReceber = `${baseId}-receber`;
    transactions.push({
      id: `getnet-cess-rec-${shortHash(sourceIdReceber)}`,
      clientId,
      type: TransactionType.RECEBER,
      status: TransactionStatus.CAPTURADO,
      source: TransactionSource.GETNET,
      valor: cessao.ValorLiquidoCessao,
      valorOriginal: cessao.ValorLiquidoCessao,
      dataVencimento: cessao.DataPagamento || dataMovimento,
      descricao: `Cessão de recebíveis - Op. ${cessao.NumeroOperacao}`,
      descricaoOriginal: `Cessão de recebíveis - Op. ${cessao.NumeroOperacao}`,
      contraparte: 'Getnet - Cessão Recebíveis',
      sourceId: sourceIdReceber,
      sourceName: 'getnet',
      rawData: JSON.parse(JSON.stringify(cessao)),
      createdAt: nowISO(),
      updatedAt: nowISO(),
      capturedAt: nowISO(),
      cycleId,
      metadata: {
        tipo_registro: 'cessao_receber',
        numero_operacao: cessao.NumeroOperacao,
        codigo_estabelecimento: cessao.CodigoEstabelecimento,
        indicador: cessao.Indicador,
        valor_bruto_cessao: cessao.ValorBrutoCessao,
        valor_taxa_cessao: cessao.ValorTaxaCessao,
        valor_liquido_cessao: cessao.ValorLiquidoCessao,
        data_movimento: dataMovimento,
      },
    } as any);
  }

  if (cessao.ValorTaxaCessao > 0) {
    const sourceIdPagar = `${baseId}-taxa`;
    transactions.push({
      id: `getnet-cess-tax-${shortHash(sourceIdPagar)}`,
      clientId,
      type: TransactionType.PAGAR,
      status: TransactionStatus.CAPTURADO,
      source: TransactionSource.GETNET,
      valor: cessao.ValorTaxaCessao,
      valorOriginal: cessao.ValorTaxaCessao,
      dataVencimento: cessao.DataPagamento || dataMovimento,
      descricao: `Taxa cessão recebíveis - Op. ${cessao.NumeroOperacao}`,
      descricaoOriginal: `Taxa cessão recebíveis - Op. ${cessao.NumeroOperacao}`,
      contraparte: 'Getnet S.A.',
      sourceId: sourceIdPagar,
      sourceName: 'getnet',
      rawData: JSON.parse(JSON.stringify(cessao)),
      createdAt: nowISO(),
      updatedAt: nowISO(),
      capturedAt: nowISO(),
      cycleId,
      metadata: {
        tipo_registro: 'cessao_taxa',
        numero_operacao: cessao.NumeroOperacao,
        codigo_estabelecimento: cessao.CodigoEstabelecimento,
        data_movimento: dataMovimento,
      },
    } as any);
  }

  return transactions;
}

// ============================================================================
// LÓGICA DE FILTRO DE VENDAS (DÉBITO vs CRÉDITO)
// ============================================================================

/**
 * Aplica filtros de negócio nos resumos de vendas
 *
 * DÉBITO (SE = Santander Eletrônico):
 *   - Venda em D → Liquidada em D+1 (sempre vem como LQ)
 *   - Filtro: DataRV == D-1
 *   - NÃO filtrar por LQ
 *
 * CRÉDITO (SM = Santander Mastercard, etc):
 *   - Filtro: TipoPagamento != LQ (evita parcelas antigas)
 *   - Filtro: DataRV == D-1 (apenas vendas novas)
 */
function filtrarResumosVendas(
  registros: GetnetRegistro[],
  dataMovimento: string,
  codigoEstabelecimento?: string
): GetnetResumoVendas[] {
  // Todos os tipo 1
  let resumos = registros.filter(r => r.TipoRegistro === 1) as GetnetResumoVendas[];

  // Filtrar por estabelecimento se especificado
  if (codigoEstabelecimento) {
    resumos = resumos.filter(r => r.CodigoEstabelecimento.trim() === codigoEstabelecimento);
  }

  // Calcular D-1
  let dataD1: string | null = null;
  try {
    const dataArquivo = new Date(dataMovimento);
    dataArquivo.setDate(dataArquivo.getDate() - 1);
    dataD1 = dataArquivo.toISOString().split('T')[0];
  } catch {
    dataD1 = null;
  }

  logger.info(`Data do arquivo: ${dataMovimento} | Filtrando DataRV = ${dataD1}`);

  // Separar por tipo de produto
  const resumosDebito = resumos.filter(r => r.Produto === 'SE');
  const resumosCredito = resumos.filter(r => r.Produto !== 'SE');

  // DÉBITO: Filtrar apenas por DataRV == D-1
  let debitoProcessados: GetnetResumoVendas[];
  if (dataD1) {
    debitoProcessados = resumosDebito.filter(r => r.DataRV === dataD1);
  } else {
    debitoProcessados = resumosDebito;
  }

  // CRÉDITO: Filtrar LQ E DataRV == D-1
  const creditoSemLQ = resumosCredito.filter(r => r.TipoPagamento !== 'LQ');
  let creditoProcessados: GetnetResumoVendas[];
  if (dataD1) {
    creditoProcessados = creditoSemLQ.filter(r => r.DataRV === dataD1);
  } else {
    creditoProcessados = creditoSemLQ;
  }

  logger.info(`Resumos: DÉBITO ${resumosDebito.length} -> ${debitoProcessados.length} | CRÉDITO ${resumosCredito.length} -> ${creditoProcessados.length}`);

  // Parear MAN/POS para corrigir ValorBruto descontado
  const filtrados = [...debitoProcessados, ...creditoProcessados];
  const pareados = parearManPos(filtrados);

  const corrigidos = pareados.filter(r => !r.isBrutoDescontado).length;
  const pendentes = pareados.filter(r => r.isBrutoDescontado).length;
  logger.info(`MAN/POS pairing: ${corrigidos} corrigidos, ${pendentes} sem par POS (bruto descontado)`);

  return pareados;
}

// ============================================================================
// FUNÇÕES FOCADAS — cada uma recebe só os tipos que precisa
// ============================================================================

/**
 * Função 1: Processa FATURAMENTO (Tipo 1 + Tipo 2)
 *
 * Recebe resumos de vendas e comprovantes, gera:
 * - RECEBER (valor bruto da venda)
 * - PAGAR (taxa da maquineta)
 * - VENDA_CARTAO (informativo com comprovantes embutidos)
 * - COMPROVANTE (documento individual com taxa proporcional)
 */
function processarFaturamento(
  resumosVendas: GetnetResumoVendas[],
  comprovantes: GetnetComprovanteVendas[],
  clientId: string,
  cycleId: string,
  dataMovimento: string
) {
  const transactions: Transaction[] = [];
  let totalReceber = 0;
  let totalPagar = 0;
  let totalVendas = 0;

  // Indexar comprovantes por NumeroRV
  const comprovantesPorRV = new Map<string, GetnetComprovanteVendas[]>();
  for (const cv of comprovantes) {
    const rv = cv.NumeroRV;
    if (!comprovantesPorRV.has(rv)) comprovantesPorRV.set(rv, []);
    comprovantesPorRV.get(rv)!.push(cv);
  }

  logger.info(`Comprovantes (Tipo 2): ${comprovantes.length} registros indexados por ${comprovantesPorRV.size} RVs`);

  for (const venda of resumosVendas) {
    const cvsDaVenda = comprovantesPorRV.get(venda.NumeroRV);

    transactions.push(vendaToReceber(venda, clientId, cycleId, dataMovimento));
    totalReceber++;

    if (venda.ValorTaxaDesconto > 0) {
      transactions.push(vendaToPagar(venda, clientId, cycleId, dataMovimento));
      totalPagar++;
    }

    const vendaCartao = vendaToVendaCartao(venda, clientId, cycleId, dataMovimento, cvsDaVenda);
    transactions.push(vendaCartao);
    totalVendas++;

    // COMPROVANTE com taxa proporcional rateada do RV
    if (cvsDaVenda) {
      for (const cv of cvsDaVenda) {
        const peso = venda.ValorBruto > 0 ? cv.ValorTransacao / venda.ValorBruto : 0;
        const taxaProporcional = Math.round(venda.ValorTaxaDesconto * peso * 100) / 100;
        transactions.push(comprovanteToTransaction(cv, clientId, cycleId, dataMovimento, vendaCartao.id, taxaProporcional));
      }
    }
  }

  return { transactions, totalReceber, totalPagar, totalVendas };
}

/**
 * Função 2: Processa AJUSTES (Tipo 3)
 *
 * Recebe ajustes financeiros (já filtrados de RVs liquidados), gera RECEBER ou PAGAR.
 */
function processarAjustes(
  ajustes: GetnetAjusteFinanceiro[],
  clientId: string,
  cycleId: string,
  dataMovimento: string
) {
  const transactions: Transaction[] = [];
  let totalReceber = 0;
  let totalPagar = 0;

  for (const ajuste of ajustes) {
    const tx = ajusteToTransaction(ajuste, clientId, cycleId, dataMovimento);
    transactions.push(tx);
    if (tx.type === TransactionType.PAGAR) totalPagar++;
    else totalReceber++;
  }

  return { transactions, totalReceber, totalPagar };
}

/**
 * Função 3: Enriquece COMPROVANTEs com antecipação (Tipo 4) e cessão (Tipo 5)
 *
 * Recebe as transações já geradas + registros Tipo 4/5 do mesmo arquivo.
 * Cruza por DataPagamento + CodigoEstabelecimento + Bandeira e rateia
 * proporcionalmente a taxa de antecipação/cessão em cada comprovante.
 *
 * Também gera as transações RECEBER/PAGAR de antecipação e cessão.
 */
function processarEEnriquecerAntecipacoesCessoes(
  transacoesExistentes: Transaction[],
  antecipacoes: GetnetAntecipacao[],
  cessoes: GetnetNegociacaoCessao[],
  clientId: string,
  cycleId: string,
  dataMovimento: string
) {
  const transactions: Transaction[] = [];
  let totalReceber = 0;
  let totalPagar = 0;

  // Gerar transações RECEBER/PAGAR de antecipação
  for (const antecipacao of antecipacoes) {
    const txs = antecipacaoToTransactions(antecipacao, clientId, cycleId, dataMovimento);
    for (const tx of txs) {
      transactions.push(tx);
      if (tx.type === TransactionType.PAGAR) totalPagar++;
      else totalReceber++;
    }
  }

  // Gerar transações RECEBER/PAGAR de cessão
  for (const cessao of cessoes) {
    const txs = cessaoToTransactions(cessao, clientId, cycleId, dataMovimento);
    for (const tx of txs) {
      transactions.push(tx);
      if (tx.type === TransactionType.PAGAR) totalPagar++;
      else totalReceber++;
    }
  }

  // =========================================================================
  // ENRIQUECIMENTO — cruzar Tipo 4/5 com COMPROVANTEs existentes
  // =========================================================================
  const comprovanteTxs = transacoesExistentes.filter(t => t.type === TransactionType.COMPROVANTE);
  if (comprovanteTxs.length === 0 || (antecipacoes.length === 0 && cessoes.length === 0)) {
    return { transactions, totalReceber, totalPagar, enriquecidos: { antecipacao: 0, cessao: 0 } };
  }

  // Indexar COMPROVANTEs por chave: DataPagamento|CodigoEstabelecimento|Bandeira
  const cvPorChave = new Map<string, Transaction[]>();
  for (const tx of comprovanteTxs) {
    const meta = (tx as any).metadata;
    const chave = `${meta.data_pagamento}|${meta.codigo_estabelecimento?.trim()}|${meta.bandeira}`;
    if (!cvPorChave.has(chave)) cvPorChave.set(chave, []);
    cvPorChave.get(chave)!.push(tx);
  }

  // Enriquecer com antecipação (Tipo 4)
  let enriquecidosAntecipacao = 0;
  for (const antecipacao of antecipacoes) {
    const chave = `${antecipacao.DataOriginalPagamento}|${antecipacao.CodigoEstabelecimento.trim()}|${antecipacao.Bandeira}`;
    const cvsCasados = cvPorChave.get(chave);
    if (!cvsCasados || cvsCasados.length === 0) continue;

    const totalValorCVs = cvsCasados.reduce((s, t) => s + t.valor, 0);
    if (totalValorCVs === 0) continue;

    for (const tx of cvsCasados) {
      const meta = (tx as any).metadata;
      const peso = tx.valor / totalValorCVs;
      const taxaAntecipacaoRateada = Math.round(antecipacao.TaxaAntecipacao * peso * 100) / 100;
      const valorLiquidoAntecipado = Math.round((tx.valor - (meta.taxa_proporcional || 0) - taxaAntecipacaoRateada) * 100) / 100;

      meta.antecipacao = {
        numero_operacao: antecipacao.NumeroOperacao,
        data_antecipacao: antecipacao.DataAntecipacao,
        data_original_pagamento: antecipacao.DataOriginalPagamento,
        taxa_antecipacao_proporcional: taxaAntecipacaoRateada,
        valor_liquido_antecipado: valorLiquidoAntecipado,
      };
      enriquecidosAntecipacao++;
    }
  }

  // Enriquecer com cessão (Tipo 5)
  let enriquecidosCessao = 0;
  for (const cessao of cessoes) {
    // Cessão não tem Bandeira — buscar por DataPagamento + Estabelecimento (qualquer bandeira)
    for (const [k, cvsCasados] of cvPorChave.entries()) {
      const [dataPgto, codEstab] = k.split('|');
      if (dataPgto !== cessao.DataPagamento || codEstab !== cessao.CodigoEstabelecimento.trim()) continue;

      const totalValorCVs = cvsCasados.reduce((s, t) => s + t.valor, 0);
      if (totalValorCVs === 0) continue;

      for (const tx of cvsCasados) {
        const meta = (tx as any).metadata;
        const peso = tx.valor / totalValorCVs;
        const taxaCessaoRateada = Math.round(cessao.ValorTaxaCessao * peso * 100) / 100;
        const valorLiquidoCedido = Math.round((tx.valor - (meta.taxa_proporcional || 0) - taxaCessaoRateada) * 100) / 100;

        meta.cessao = {
          numero_operacao: cessao.NumeroOperacao,
          data_cessao: cessao.DataCessao,
          data_pagamento_original: cessao.DataPagamento,
          taxa_cessao_proporcional: taxaCessaoRateada,
          valor_liquido_cedido: valorLiquidoCedido,
        };
        enriquecidosCessao++;
      }
    }
  }

  // Propagar enriquecimento para o array comprovantes[] do VENDA_CARTAO
  if (enriquecidosAntecipacao > 0 || enriquecidosCessao > 0) {
    const vendaCartaoTxs = transacoesExistentes.filter(t => t.type === TransactionType.VENDA_CARTAO);
    for (const vc of vendaCartaoTxs) {
      const meta = (vc as any).metadata;
      if (!meta.comprovantes) continue;
      for (const cvRef of meta.comprovantes) {
        const cvTx = comprovanteTxs.find(t => (t as any).metadata.nsu === cvRef.nsu);
        if (!cvTx) continue;
        const cvMeta = (cvTx as any).metadata;
        if (cvMeta.antecipacao) cvRef.antecipacao = cvMeta.antecipacao;
        if (cvMeta.cessao) cvRef.cessao = cvMeta.cessao;
      }
    }
    logger.info(`Enriquecimento: ${enriquecidosAntecipacao} CVs com antecipação, ${enriquecidosCessao} CVs com cessão`);
  }

  return {
    transactions,
    totalReceber,
    totalPagar,
    enriquecidos: { antecipacao: enriquecidosAntecipacao, cessao: enriquecidosCessao },
  };
}

// ============================================================================
// ORQUESTRADOR — filtra por tipo e delega para cada função focada
// ============================================================================

function gerarTransacoes(
  registros: GetnetRegistro[],
  clientId: string,
  cycleId: string,
  dataMovimento: string,
  codigoEstabelecimento?: string
) {
  // Separar registros por tipo
  const resumosVendas = filtrarResumosVendas(registros, dataMovimento, codigoEstabelecimento);

  let comprovantes = registros.filter(r => r.TipoRegistro === 2) as GetnetComprovanteVendas[];
  if (codigoEstabelecimento) {
    comprovantes = comprovantes.filter(r => r.CodigoEstabelecimento.trim() === codigoEstabelecimento);
  }

  const rvsLiquidados = new Set<string>();
  for (const r of registros) {
    if (r.TipoRegistro === 1 && (r as GetnetResumoVendas).TipoPagamento === 'LQ') {
      const rv = (r as GetnetResumoVendas).NumeroRV;
      if (rv) rvsLiquidados.add(rv);
    }
  }
  let ajustes = registros.filter(r => r.TipoRegistro === 3) as GetnetAjusteFinanceiro[];
  if (codigoEstabelecimento) {
    ajustes = ajustes.filter(r => r.CodigoEstabelecimento.trim() === codigoEstabelecimento);
  }
  ajustes = ajustes.filter(r => !rvsLiquidados.has(r.NumeroRV));

  let antecipacoes = registros.filter(r => r.TipoRegistro === 4) as GetnetAntecipacao[];
  if (codigoEstabelecimento) {
    antecipacoes = antecipacoes.filter(r => r.CodigoEstabelecimento.trim() === codigoEstabelecimento);
  }

  let cessoes = registros.filter(r => r.TipoRegistro === 5) as GetnetNegociacaoCessao[];
  if (codigoEstabelecimento) {
    cessoes = cessoes.filter(r => r.CodigoEstabelecimento.trim() === codigoEstabelecimento);
  }
  cessoes = cessoes.filter(r => r.Indicador === 'CS');

  // 1. Faturamento (Tipo 1 + Tipo 2) → RECEBER, PAGAR, VENDA_CARTAO, COMPROVANTE
  const faturamento = processarFaturamento(resumosVendas, comprovantes, clientId, cycleId, dataMovimento);

  // 2. Ajustes (Tipo 3) → RECEBER ou PAGAR
  logger.info(`Processando ${ajustes.length} ajustes financeiros`);
  const ajustesResult = processarAjustes(ajustes, clientId, cycleId, dataMovimento);

  // 3. Antecipações + Cessões (Tipo 4 + Tipo 5) → transações próprias + enriquecimento dos COMPROVANTEs
  logger.info(`Processando ${antecipacoes.length} antecipações, ${cessoes.length} cessões CS`);
  const antecCessaoResult = processarEEnriquecerAntecipacoesCessoes(
    faturamento.transactions, antecipacoes, cessoes, clientId, cycleId, dataMovimento
  );

  // Juntar tudo
  const transactions = [
    ...faturamento.transactions,
    ...ajustesResult.transactions,
    ...antecCessaoResult.transactions,
  ];

  const totalReceber = faturamento.totalReceber + ajustesResult.totalReceber + antecCessaoResult.totalReceber;
  const totalPagar = faturamento.totalPagar + ajustesResult.totalPagar + antecCessaoResult.totalPagar;
  const totalVendas = faturamento.totalVendas;

  // Tipo 6 (URs) - IGNORADO
  const urs = registros.filter(r => r.TipoRegistro === 6);
  if (urs.length > 0) {
    logger.info(`Tipo 6 (URs): ${urs.length} registros ignorados (apenas agenda/informativo)`);
  }

  // Resumo com valores BRUTOS (fonte de verdade — líquidos se calculam)
  const resumoBruto = {
    vendas_bruto: resumosVendas.reduce((s, v) => s + v.ValorBruto, 0),
    vendas_faturamento: comprovantes.reduce((s, cv) => s + cv.ValorTransacao, 0),
    taxa_getnet: resumosVendas.reduce((s, v) => s + v.ValorTaxaDesconto, 0),
    comprovantes_total: comprovantes.length,
    ajustes_bruto: ajustes.reduce((s, a) => s + (a.SinalTransacao === '-' ? -a.ValorAjuste : a.ValorAjuste), 0),
    antecipacoes_bruto: antecipacoes.reduce((s, a) => s + a.ValorBrutoAntecipacao, 0),
    cessoes_bruto: cessoes.reduce((s, c) => s + c.ValorBrutoCessao, 0),
  };

  return {
    transactions,
    totais: { receber: totalReceber, pagar: totalPagar, vendas: totalVendas },
    resumoBruto,
  };
}

// ============================================================================
// HTTP HANDLER
// ============================================================================

app.http('getnet-capture', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'getnet/capture',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const startTime = Date.now();

    try {
      const body = (await req.json()) as CaptureRequest;
      const { clientId, cycleId, startDate, action, codigoEstabelecimento } = body;

      logger.info('Iniciando captura Getnet', { clientId, cycleId, action });

      // Data padrão: hoje
      const dataBusca = startDate || new Date().toISOString().split('T')[0];

      // 1. Conectar e baixar arquivo SFTP
      const cliente = getGetnetClient();
      const resultado = await cliente.buscarArquivoPorData(dataBusca);

      if (resultado.erro || !resultado.conteudo) {
        logger.error(`Falha ao buscar arquivo SFTP: ${resultado.mensagem}`);
        return {
          status: 500,
          jsonBody: {
            success: false,
            source: 'getnet',
            error: `Falha ao buscar arquivo SFTP: ${resultado.mensagem}`,
            durationMs: Date.now() - startTime,
          },
        };
      }

      const nomeArquivo = resultado.arquivo!;
      logger.info(`Arquivo baixado: ${nomeArquivo} (${resultado.totalLinhas} linhas)`);

      // 2. Extrair data do nome do arquivo (getnetextr_YYYYMMDD.txt)
      let dataMovimento = dataBusca;
      try {
        const dataArquivo = nomeArquivo.split('_')[1].split('.')[0];
        const ano = dataArquivo.substring(0, 4);
        const mes = dataArquivo.substring(4, 6);
        const dia = dataArquivo.substring(6, 8);
        dataMovimento = `${ano}-${mes}-${dia}`;
      } catch {
        logger.warn('Não foi possível extrair data do nome do arquivo');
      }

      // 3. Parsear arquivo completo
      const registros = parseConteudo(resultado.conteudo);
      if (!registros || registros.length === 0) {
        return {
          status: 500,
          jsonBody: {
            success: false,
            source: 'getnet',
            error: 'Arquivo vazio ou inválido (0 registros parseados)',
            durationMs: Date.now() - startTime,
          },
        };
      }

      logger.info(`Total de registros parseados: ${registros.length}`);

      // 4. Identificar estabelecimentos
      const estabelecimentosUnicos = new Set<string>();
      for (const registro of registros) {
        const codigo = ('CodigoEstabelecimento' in registro)
          ? (registro as any).CodigoEstabelecimento?.trim() || ''
          : '';
        if (codigo && codigo !== 'UNKNOWN') {
          estabelecimentosUnicos.add(codigo);
        }
      }
      logger.info(`Estabelecimentos encontrados: ${estabelecimentosUnicos.size}`);

      // 5. Se ação é RAW, retornar dados brutos
      if (action === 'raw') {
        return {
          status: 200,
          jsonBody: {
            success: true,
            action: 'raw',
            arquivo: { nome: nomeArquivo, data_movimento: dataMovimento },
            total_registros: registros.length,
            registros,
          },
        };
      }

      // 6. Gerar transações (lógica unificada para listar e ingerir)
      const { transactions, totais, resumoBruto } = gerarTransacoes(
        registros, clientId, cycleId, dataMovimento, codigoEstabelecimento
      );

      logger.info(`Transações geradas: RECEBER=${totais.receber} PAGAR=${totais.pagar} VENDAS=${totais.vendas}`);

      // 7. LISTAR = dry-run (mesma lógica do ingerir, sem persistir)
      if (action === 'listar') {
        return {
          status: 200,
          jsonBody: {
            success: true,
            action: 'listar',
            source: 'getnet',
            clientId,
            cycleId,
            arquivo: {
              nome: nomeArquivo,
              tamanho_bytes: resultado.tamanhoBytes,
              total_linhas: resultado.totalLinhas,
              data_movimento: dataMovimento,
            },
            resumo: resumoBruto,
            transactions,
            totais,
            durationMs: Date.now() - startTime,
          },
        };
      }

      // 8. INGERIR = persistir com idempotência
      const existingSourceIds = await getExistingSourceIds(clientId, 'getnet');
      logger.info('Existing Getnet transactions', { count: existingSourceIds.size });

      let result = { created: [] as string[], updated: [] as string[], skipped: [] as string[] };
      if (transactions.length > 0) {
        result = await upsertTransactionsIdempotent(transactions, existingSourceIds);
        logger.info('Transactions persisted (idempotent)', {
          created: result.created.length,
          updated: result.updated.length,
          skipped: result.skipped.length,
        });
      }

      logger.info(`Captura Getnet concluída: RECEBER=${totais.receber} PAGAR=${totais.pagar} VENDAS=${totais.vendas}`);

      const response: CaptureResponse = {
        success: true,
        source: 'getnet',
        clientId,
        cycleId,
        transactions: {
          total: transactions.length,
          new: result.created.length,
          updated: result.updated.length,
          skipped: result.skipped.length,
        },
        receber: totais.receber,
        pagar: totais.pagar,
        vendas: totais.vendas,
        durationMs: Date.now() - startTime,
      };

      return { status: 200, jsonBody: response };
    } catch (error: any) {
      logger.error('Capture failed', error);

      return {
        status: 500,
        jsonBody: {
          success: false,
          source: 'getnet',
          error: error.message,
          durationMs: Date.now() - startTime,
        },
      };
    }
  },
});
