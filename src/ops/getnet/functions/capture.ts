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
import { parseConteudo, filtrarPorEstabelecimento, calcularResumoFinanceiro } from '../adapters/fileHelper';
import {
  CaptureRequest,
  CaptureResponse,
  GetnetRegistro,
  GetnetResumoVendas,
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
      valor_tarifa: venda.ValorTarifa,
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
    valor: venda.ValorTarifa,
    valorOriginal: venda.ValorTarifa,
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
  dataMovimento: string
): Transaction {
  const sourceId = `getnet-venda-${venda.NumeroRV}-${venda.Produto}-${venda.Bandeira}`;
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
      valor_taxa: venda.ValorTarifa,
      data_pagamento: venda.DataPagamento,
      data_rv: venda.DataRV,
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

  return [...debitoProcessados, ...creditoProcessados];
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

      // 6. Se ação é LISTAR, retornar dados organizados por estabelecimento
      if (action === 'listar') {
        const dadosPorEstabelecimento = Array.from(estabelecimentosUnicos).map(codigo => {
          const dados = filtrarPorEstabelecimento(registros, codigo);
          const resumo = calcularResumoFinanceiro(dados);
          return { codigo_estabelecimento: codigo, resumo, dados };
        });

        return {
          status: 200,
          jsonBody: {
            success: true,
            action: 'listar',
            arquivo: {
              nome: nomeArquivo,
              tamanho_bytes: resultado.tamanhoBytes,
              total_linhas: resultado.totalLinhas,
              data_movimento: dataMovimento,
            },
            dados: {
              total_estabelecimentos: estabelecimentosUnicos.size,
              estabelecimentos: dadosPorEstabelecimento,
            },
          },
        };
      }

      // 7. AÇÃO PRINCIPAL: INGERIR/CAPTURE
      // Buscar transações existentes para idempotência
      const existingSourceIds = await getExistingSourceIds(clientId, 'getnet');
      logger.info('Existing Getnet transactions', { count: existingSourceIds.size });

      const transactions: Transaction[] = [];
      let totalReceber = 0;
      let totalPagar = 0;
      let totalVendas = 0;

      // 7a. Processar RESUMOS DE VENDAS (Tipo 1)
      const resumosVendas = filtrarResumosVendas(registros, dataMovimento, codigoEstabelecimento);

      for (const venda of resumosVendas) {
        // RECEBER (valor bruto)
        transactions.push(vendaToReceber(venda, clientId, cycleId, dataMovimento));
        totalReceber++;

        // PAGAR (taxa maquineta)
        if (venda.ValorTarifa > 0) {
          transactions.push(vendaToPagar(venda, clientId, cycleId, dataMovimento));
          totalPagar++;
        }

        // VENDA_CARTAO (informativo)
        transactions.push(vendaToVendaCartao(venda, clientId, cycleId, dataMovimento));
        totalVendas++;
      }

      // 7b. Processar AJUSTES FINANCEIROS (Tipo 3)
      // Excluir ajustes de vendas já liquidadas (LQ)
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

      logger.info(`Processando ${ajustes.length} ajustes financeiros`);
      for (const ajuste of ajustes) {
        const tx = ajusteToTransaction(ajuste, clientId, cycleId, dataMovimento);
        transactions.push(tx);
        if (tx.type === TransactionType.PAGAR) totalPagar++;
        else totalReceber++;
      }

      // 7c. Processar ANTECIPAÇÕES (Tipo 4)
      let antecipacoes = registros.filter(r => r.TipoRegistro === 4) as GetnetAntecipacao[];
      if (codigoEstabelecimento) {
        antecipacoes = antecipacoes.filter(r => r.CodigoEstabelecimento.trim() === codigoEstabelecimento);
      }

      logger.info(`Processando ${antecipacoes.length} antecipações`);
      for (const antecipacao of antecipacoes) {
        const txs = antecipacaoToTransactions(antecipacao, clientId, cycleId, dataMovimento);
        for (const tx of txs) {
          transactions.push(tx);
          if (tx.type === TransactionType.PAGAR) totalPagar++;
          else totalReceber++;
        }
      }

      // 7d. Processar CESSÕES (Tipo 5) - apenas CS
      let cessoes = registros.filter(r => r.TipoRegistro === 5) as GetnetNegociacaoCessao[];
      if (codigoEstabelecimento) {
        cessoes = cessoes.filter(r => r.CodigoEstabelecimento.trim() === codigoEstabelecimento);
      }
      cessoes = cessoes.filter(r => r.Indicador === 'CS');

      logger.info(`Processando ${cessoes.length} cessões CS`);
      for (const cessao of cessoes) {
        const txs = cessaoToTransactions(cessao, clientId, cycleId, dataMovimento);
        for (const tx of txs) {
          transactions.push(tx);
          if (tx.type === TransactionType.PAGAR) totalPagar++;
          else totalReceber++;
        }
      }

      // 7e. Tipo 6 (URs) - IGNORADO (apenas informativo)
      const urs = registros.filter(r => r.TipoRegistro === 6);
      logger.info(`Tipo 6 (URs): ${urs.length} registros ignorados (apenas agenda/informativo)`);

      // 8. Persistir com idempotência
      let result = { created: [] as string[], updated: [] as string[], skipped: [] as string[] };
      if (transactions.length > 0) {
        result = await upsertTransactionsIdempotent(transactions, existingSourceIds);
        logger.info('Transactions persisted (idempotent)', {
          created: result.created.length,
          updated: result.updated.length,
          skipped: result.skipped.length,
        });
      }

      logger.info(`Captura Getnet concluída: RECEBER=${totalReceber} PAGAR=${totalPagar} VENDAS=${totalVendas}`);

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
        receber: totalReceber,
        pagar: totalPagar,
        vendas: totalVendas,
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
