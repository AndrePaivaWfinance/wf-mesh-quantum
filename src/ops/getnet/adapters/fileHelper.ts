/**
 * Getnet File Helper - Parser de arquivos de conciliação Getnet
 * Migrado de wf-financeiro/shared/getnet_file_helper.py
 *
 * Parseia arquivos posicionais da Getnet (layout V10.1, 401 chars)
 * e retorna dados estruturados.
 *
 * Tipos de registro:
 *   0 - Header
 *   1 - Resumo de vendas
 *   2 - Comprovante de vendas
 *   3 - Ajuste financeiro
 *   4 - Antecipação
 *   5 - Negociação/Cessão
 *   6 - Unidade de recebível
 *   9 - Trailer
 */

import { createLogger } from '../shared/utils';
import {
  GetnetRegistro,
  GetnetHeader,
  GetnetResumoVendas,
  GetnetComprovanteVendas,
  GetnetAjusteFinanceiro,
  GetnetAntecipacao,
  GetnetNegociacaoCessao,
  GetnetUnidadeRecebivel,
  GetnetTrailer,
  DadosEstabelecimento,
} from './types';

const logger = createLogger('GetnetFileHelper');

// ============================================================================
// PARSER PRINCIPAL
// ============================================================================

/**
 * Parseia conteúdo completo do arquivo Getnet
 */
export function parseConteudo(conteudo: string): GetnetRegistro[] {
  const registros: GetnetRegistro[] = [];
  const linhas = conteudo.split('\n');

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    const numeroLinha = i + 1;

    if (!linha.trim()) continue;

    try {
      const tipoRegistro = parseInt(linha.substring(0, 1), 10);

      let registro: GetnetRegistro | null = null;

      switch (tipoRegistro) {
        case 0:
          registro = parseHeader(linha);
          break;
        case 1:
          registro = parseResumoVendas(linha);
          break;
        case 2:
          registro = parseComprovanteVendas(linha);
          break;
        case 3:
          registro = parseAjusteFinanceiro(linha);
          break;
        case 4:
          registro = parseAntecipacao(linha);
          break;
        case 5:
          registro = parseNegociacaoCessao(linha);
          break;
        case 6:
          registro = parseUnidadeRecebivel(linha);
          break;
        case 9:
          registro = parseTrailer(linha);
          break;
        default:
          logger.warn(`Tipo de registro desconhecido na linha ${numeroLinha}: ${tipoRegistro}`);
          continue;
      }

      if (registro) {
        registros.push(registro);
      }
    } catch (e: any) {
      logger.error(`Erro ao parsear linha ${numeroLinha}: ${e.message}`);
      continue;
    }
  }

  logger.info(`Parseados ${registros.length} registros do arquivo Getnet`);
  return registros;
}

// ============================================================================
// PARSERS POR TIPO
// ============================================================================

/**
 * Parse do Header (Tipo 0)
 *
 * Layout V10.1 REAL (401 chars):
 * [0:1]     Tipo Registro (0)
 * [1:9]     Data Movimento (DDMMAAAA)
 * [9:16]    Hora Geração (HHMMSSC)
 * [16:24]   Data Geração repetida (DDMMAAAA)
 * [24:31]   Identificador fixo (CEADM100)
 * [31:46]   Código Estabelecimento (15 chars)
 * [46:60]   CNPJ (14 chars)
 * [60:80]   Nome Adquirente (20 chars)
 */
function parseHeader(linha: string): GetnetHeader {
  let codigoEstab = '';
  if (linha.length > 46) {
    codigoEstab = linha.substring(31, 46).trim();
  }
  // Fallback: buscar após EADM100
  if (!codigoEstab && linha.includes('EADM100')) {
    const idx = linha.indexOf('EADM100') + 7;
    codigoEstab = linha.substring(idx, idx + 15).trim();
  }

  return {
    TipoRegistro: 0,
    DataMovimento: linha.length > 9 ? parseDataDDMMAAAA(linha.substring(1, 9)) : null,
    HoraGeracao: linha.length > 16 ? linha.substring(9, 16).trim() : '',
    CodigoEstabelecimento: codigoEstab,
    CNPJ: linha.length > 60 ? linha.substring(46, 60).trim() : '',
    NomeAdquirente: linha.length > 80 ? linha.substring(60, 80).trim() : '',
    VersaoLayout: '10.1',
    LinhaRaw: linha.substring(0, Math.min(100, linha.length)),
  };
}

/**
 * Parse do Resumo de Vendas (Tipo 1)
 *
 * Layout V10.1 oficial (200 chars) — posições 1-indexed conforme spec Getnet:
 * Seq  Campo                               Pos(1-idx)  Tam  0-indexed
 *  1   Tipo Registro                        1- 1         1   [0:1]
 *  2   Código Estabelecimento               2-16        15   [1:16]
 *  3   Código do Produto                   17-18         2   [16:18]
 *  4   Forma de Captura                    19-21         3   [18:21]
 *  5   Número do RV                        22-30         9   [21:30]
 *  6   Data do RV                          31-38         8   [30:38]
 *  7   Data do Pagamento                   39-46         8   [38:46]
 *  8   Banco                               47-49         3   [46:49]
 *  9   Agência                             50-55         6   [49:55]
 * 10   Conta Corrente                      56-66        11   [55:66]
 * 11   Nº CVs Aceitos                      67-75         9   [66:75]
 * 12   Nº CVs Rejeitados                   76-84         9   [75:84]
 * 13   Valor Bruto                         85-96        12   [84:96]
 * 14   Valor Líquido                       97-108       12   [96:108]
 * 15   Valor Taxa de Serviço              109-120       12   [108:120]
 * 16   Valor Taxa de Desconto             121-132       12   [120:132]
 * 17   Valor Rejeitado                    133-144       12   [132:144]
 * 18   Valor Crédito                      145-156       12   [144:156]
 * 19   Valor Encargos                     157-168       12   [156:168]
 * 20   Tipo Pagamento                     169-170        2   [168:170]
 * 21   Nº da Parcela                      171-172        2   [170:172]
 * 22   Qtd de Parcelas                    173-174        2   [172:174]
 * 23   Cod Estab Centralizador            175-189       15   [174:189]
 * 24   Reservado                          190-200       11   [189:200]
 *
 * IMPORTANTE: registros com Bandeira=MAN sempre têm ValorTaxaDesconto=0
 * e ValorBruto=ValorLiquido — o "bruto" já está descontado da taxa Getnet.
 * O bruto REAL vem do registro POS pareado (mesmo ValorLiquido+DataPag).
 */
function parseResumoVendas(linha: string): GetnetResumoVendas {
  const bandeira = linha.length > 21 ? linha.substring(18, 21).trim() : '';
  const valorTaxaDesconto = linha.length > 132 ? parseValor(linha.substring(120, 132)) : 0.0;
  const valorBruto = linha.length > 96 ? parseValor(linha.substring(84, 96)) : 0.0;
  const valorLiquido = linha.length > 108 ? parseValor(linha.substring(96, 108)) : 0.0;

  return {
    TipoRegistro: 1,
    CodigoEstabelecimento: linha.length > 16 ? linha.substring(1, 16).trim() : 'UNKNOWN',
    Produto: linha.length > 18 ? linha.substring(16, 18).trim() : '',
    Bandeira: bandeira,
    NumeroRV: linha.length > 30 ? linha.substring(21, 30).trim() : '',
    DataRV: linha.length > 38 ? parseDataDDMMAAAA(linha.substring(30, 38)) : null,
    DataPagamento: linha.length > 46 ? parseDataDDMMAAAA(linha.substring(38, 46)) : null,
    Banco: linha.length > 49 ? linha.substring(46, 49).trim() : '',
    Agencia: linha.length > 55 ? linha.substring(49, 55).trim() : '',
    ContaCorrente: linha.length > 66 ? linha.substring(55, 66).trim() : '',
    CVsAceitos: linha.length > 75 ? parseInt(linha.substring(66, 75).trim() || '0', 10) : 0,
    CVsRejeitados: linha.length > 84 ? parseInt(linha.substring(75, 84).trim() || '0', 10) : 0,
    ValorBruto: valorBruto,
    ValorLiquido: valorLiquido,
    ValorTaxaServico: linha.length > 120 ? parseValor(linha.substring(108, 120)) : 0.0,
    ValorTaxaDesconto: valorTaxaDesconto,
    ValorRejeitado: linha.length > 144 ? parseValor(linha.substring(132, 144)) : 0.0,
    ValorCredito: linha.length > 156 ? parseValor(linha.substring(144, 156)) : 0.0,
    ValorEncargos: linha.length > 168 ? parseValor(linha.substring(156, 168)) : 0.0,
    TipoPagamento: linha.length > 170 ? linha.substring(168, 170).trim() : '',
    NumeroParcela: linha.length > 172 ? parseInt(linha.substring(170, 172).trim() || '0', 10) : 0,
    QuantidadeParcelas: linha.length > 174 ? parseInt(linha.substring(172, 174).trim() || '0', 10) : 0,
    CodigoEstabelecimentoCentralizador: linha.length > 189 ? linha.substring(174, 189).trim() : '',
    isBrutoDescontado: bandeira === 'MAN' && valorTaxaDesconto === 0 && valorBruto === valorLiquido,
  };
}

/**
 * Parse do Comprovante de Vendas (Tipo 2)
 *
 * Layout V10.1 (401 chars):
 * [0:1]     Tipo Registro
 * [1:16]    Cod Estabelecimento (15 chars)
 * [16:25]   Número RV (9 chars)
 * [25:37]   NSU (12 chars)
 * [37:45]   Data Transação (DDMMAAAA)
 * [45:51]   Hora Transação (HHMMSS)
 * [51:70]   Número Cartão (19 chars)
 * [70:82]   Valor Transação (12 chars)
 * [106:108] Parcela Atual (2 chars)
 * [108:110] Total Parcelas (2 chars)
 * [110:122] Valor Parcela (12 chars)
 * [122:130] Data Pagamento (DDMMAAAA)
 * [130:140] Código Autorização (10 chars)
 * [140:144] Bandeira (4 chars)
 */
function parseComprovanteVendas(linha: string): GetnetComprovanteVendas {
  return {
    TipoRegistro: 2,
    CodigoEstabelecimento: linha.length > 16 ? linha.substring(1, 16).trim() : 'UNKNOWN',
    NumeroRV: linha.length > 25 ? linha.substring(16, 25).trim() : '',
    NSU: linha.length > 37 ? linha.substring(25, 37).trim() : '',
    DataTransacao: linha.length > 45 ? parseDataDDMMAAAA(linha.substring(37, 45)) : null,
    HoraTransacao: linha.length > 51 ? linha.substring(45, 51).trim() : '',
    NumeroCartao: linha.length > 70 ? linha.substring(51, 70).trim() : '',
    ValorTransacao: linha.length > 82 ? parseValor(linha.substring(70, 82)) : 0.0,
    Parcela: linha.length > 108 ? linha.substring(106, 108).trim() : '',
    TotalParcelas: linha.length > 110 ? linha.substring(108, 110).trim() : '',
    ValorParcela: linha.length > 122 ? parseValor(linha.substring(110, 122)) : 0.0,
    DataPagamento: linha.length > 130 ? parseDataDDMMAAAA(linha.substring(122, 130)) : null,
    CodigoAutorizacao: linha.length > 140 ? linha.substring(130, 140).trim() : '',
    Bandeira: linha.length > 144 ? linha.substring(140, 144).trim() : '',
  };
}

/**
 * Parse do Ajuste Financeiro (Tipo 3)
 *
 * Layout V10.1 (401 chars):
 * [0:1]     Tipo Registro
 * [1:16]    Cod Estabelecimento (15 chars)
 * [16:25]   Número RV (9 chars)
 * [25:33]   Data Ajuste (DDMMAAAA)
 * [33:41]   Data Pagamento (DDMMAAAA)
 * [62:63]   Sinal (+/-)
 * [63:75]   Valor Ajuste (12 chars)
 * [87:117]  Motivo Ajuste (30 chars)
 */
function parseAjusteFinanceiro(linha: string): GetnetAjusteFinanceiro {
  return {
    TipoRegistro: 3,
    CodigoEstabelecimento: linha.length > 16 ? linha.substring(1, 16).trim() : 'UNKNOWN',
    NumeroRV: linha.length > 25 ? linha.substring(16, 25).trim() : '',
    DataAjuste: linha.length > 33 ? parseDataDDMMAAAA(linha.substring(25, 33)) : null,
    DataPagamento: linha.length > 41 ? parseDataDDMMAAAA(linha.substring(33, 41)) : null,
    SinalTransacao: linha.length > 63 ? linha.substring(62, 63).trim() : '+',
    ValorAjuste: linha.length > 75 ? parseValor(linha.substring(63, 75)) : 0.0,
    MotivoAjuste: linha.length > 117 ? linha.substring(87, 117).trim() : '',
  };
}

/**
 * Parse da Antecipação (Tipo 4)
 *
 * [0:1]     Tipo Registro
 * [1:16]    Cod Estabelecimento (15 chars)
 * [16:18]   Produto (2 chars)
 * [18:21]   Bandeira (3 chars)
 * [21:35]   Número Operação (14 chars)
 * [35:43]   Data Antecipação (DDMMAAAA)
 * [43:51]   Data Original Pagamento (DDMMAAAA)
 * [51:66]   Valor Bruto Antecipação (15 chars)
 * [66:81]   Taxa Antecipação (15 chars)
 * [81:96]   Valor Líquido Antecipação (15 chars)
 */
function parseAntecipacao(linha: string): GetnetAntecipacao {
  return {
    TipoRegistro: 4,
    CodigoEstabelecimento: linha.length > 16 ? linha.substring(1, 16).trim() : 'UNKNOWN',
    Produto: linha.length > 18 ? linha.substring(16, 18).trim() : '',
    Bandeira: linha.length > 21 ? linha.substring(18, 21).trim() : '',
    NumeroOperacao: linha.length > 35 ? linha.substring(21, 35).trim() : '',
    DataAntecipacao: linha.length > 43 ? parseDataDDMMAAAA(linha.substring(35, 43)) : null,
    DataOriginalPagamento: linha.length > 51 ? parseDataDDMMAAAA(linha.substring(43, 51)) : null,
    ValorBrutoAntecipacao: linha.length > 66 ? parseValor(linha.substring(51, 66)) : 0.0,
    TaxaAntecipacao: linha.length > 81 ? parseValor(linha.substring(66, 81)) : 0.0,
    ValorLiquidoAntecipacao: linha.length > 96 ? parseValor(linha.substring(81, 96)) : 0.0,
  };
}

/**
 * Parse da Negociação/Cessão (Tipo 5)
 *
 * Campos comuns:
 * [0:1]     Tipo Registro (5)
 * [1:16]    Cod Estabelecimento (15 chars)
 * [16:24]   Data Cessão (DDMMAAAA)
 * [24:32]   Data Pagamento (DDMMAAAA)
 * [32:52]   Número Operação/ID (20 chars)
 * [52:54]   Indicador (2 chars) - CL/CS
 *
 * CL (Cessão Liquidada):
 * [54:78]   Valor Bruto (24 chars)
 * [78:102]  Valor Líquido (24 chars)
 *
 * CS (Cessão Solicitada):
 * [54:66]   Campo Reservado (12 chars)
 * [66:78]   Valor Bruto (12 chars)
 * [78:90]   Valor Taxa/Desconto (12 chars)
 * [90:102]  Valor Líquido (12 chars)
 */
function parseNegociacaoCessao(linha: string): GetnetNegociacaoCessao {
  const indicador = linha.length > 54 ? linha.substring(52, 54).trim() : '';

  let valorBruto = 0.0;
  let valorTaxa = 0.0;
  let valorLiquido = 0.0;

  if (indicador === 'CL') {
    valorBruto = linha.length > 78 ? parseValor(linha.substring(54, 78)) : 0.0;
    valorLiquido = linha.length > 102 ? parseValor(linha.substring(78, 102)) : 0.0;
  } else {
    // CS
    valorBruto = linha.length > 78 ? parseValor(linha.substring(66, 78)) : 0.0;
    valorTaxa = linha.length > 90 ? parseValor(linha.substring(78, 90)) : 0.0;
    valorLiquido = linha.length > 102 ? parseValor(linha.substring(90, 102)) : 0.0;
  }

  return {
    TipoRegistro: 5,
    CodigoEstabelecimento: linha.length > 16 ? linha.substring(1, 16).trim() : 'UNKNOWN',
    DataCessao: linha.length > 24 ? parseDataDDMMAAAA(linha.substring(16, 24)) : null,
    DataPagamento: linha.length > 32 ? parseDataDDMMAAAA(linha.substring(24, 32)) : null,
    NumeroOperacao: linha.length > 52 ? linha.substring(32, 52).trim() : '',
    Indicador: indicador,
    ValorBrutoCessao: valorBruto,
    ValorTaxaCessao: valorTaxa,
    ValorLiquidoCessao: valorLiquido,
    LinhaRaw: linha.substring(0, Math.min(120, linha.length)),
  };
}

/**
 * Parse da Unidade de Recebível (Tipo 6)
 *
 * [0:1]     Tipo Registro (6)
 * [1:16]    Cod Estabelecimento (15 chars)
 * [16:24]   Data Pagamento (DDMMAAAA)
 * [24:44]   Número Operação/ID (20 chars)
 * [44:46]   Indicador (2 chars) - CL/CS/LQ
 * [46:64]   Campos Reservados (18 chars)
 * [64:66]   Tipo Produto (2 chars) - SM/EC
 * [66:74]   Data Liquidação (DDMMAAAA)
 *
 * CS: [94:107] Valor Bruto, [107:120] Desconto, [120:133] Valor Líquido (left-aligned)
 * CL: [108:122] Valor Líquido (right-aligned com zeros)
 */
function parseUnidadeRecebivel(linha: string): GetnetUnidadeRecebivel {
  const indicador = linha.length > 46 ? linha.substring(44, 46).trim() : '';

  let valorBruto = 0.0;
  let valorDesconto = 0.0;
  let valorLiquido = 0.0;

  if (indicador === 'CS' && linha.length > 133) {
    valorBruto = parseValorLeftAligned(linha.substring(94, 107));
    valorDesconto = parseValorLeftAligned(linha.substring(107, 120));
    valorLiquido = parseValorLeftAligned(linha.substring(120, 133));
  } else if (indicador === 'CL' && linha.length > 122) {
    valorLiquido = parseValor(linha.substring(108, 122));
    if (valorLiquido === 0) {
      valorLiquido = parseValor(linha.substring(110, 124));
    }
  } else if (indicador === 'LQ' && linha.length > 122) {
    valorLiquido = parseValor(linha.substring(108, 122));
  }

  return {
    TipoRegistro: 6,
    CodigoEstabelecimento: linha.length > 16 ? linha.substring(1, 16).trim() : 'UNKNOWN',
    DataPagamento: linha.length > 24 ? parseDataDDMMAAAA(linha.substring(16, 24)) : null,
    NumeroOperacao: linha.length > 44 ? linha.substring(24, 44).trim() : '',
    Indicador: indicador,
    TipoProduto: linha.length > 66 ? linha.substring(64, 66).trim() : '',
    DataLiquidacao: linha.length > 74 ? parseDataDDMMAAAA(linha.substring(66, 74)) : null,
    ValorBrutoUR: valorBruto,
    ValorDescontoUR: valorDesconto,
    ValorLiquidoUR: valorLiquido,
    LinhaRaw: linha.substring(0, Math.min(140, linha.length)),
  };
}

/**
 * Parse do Trailer (Tipo 9)
 *
 * [0:1]     Tipo Registro (9)
 * [1:7]     Total de Registros (6 chars)
 * [7:25]    Valor Total Bruto (18 chars)
 * [25:43]   Valor Total Líquido (18 chars)
 * [43:49]   Quantidade de RVs (6 chars)
 */
function parseTrailer(linha: string): GetnetTrailer {
  let totalRegistros = 0;
  try {
    totalRegistros = parseInt(linha.substring(1, 7).trim() || '0', 10);
  } catch {
    try {
      totalRegistros = parseInt(linha.substring(1, 12).trim() || '0', 10);
    } catch {
      // ignore
    }
  }

  let valorBruto = linha.length > 25 ? parseValor(linha.substring(7, 25)) : 0.0;
  if (valorBruto === 0) {
    valorBruto = linha.length > 27 ? parseValor(linha.substring(12, 27)) : 0.0;
  }

  let valorLiquido = linha.length > 43 ? parseValor(linha.substring(25, 43)) : 0.0;
  if (valorLiquido === 0) {
    valorLiquido = linha.length > 45 ? parseValor(linha.substring(27, 45)) : 0.0;
  }

  let qtdRVs = 0;
  try {
    qtdRVs = parseInt(linha.substring(43, 49).trim() || '0', 10);
  } catch {
    try {
      qtdRVs = parseInt(linha.substring(42, 52).trim() || '0', 10);
    } catch {
      // ignore
    }
  }

  return {
    TipoRegistro: 9,
    TotalRegistros: totalRegistros,
    ValorTotalBruto: valorBruto,
    ValorTotalLiquido: valorLiquido,
    QuantidadeRVs: qtdRVs,
    LinhaRaw: linha.substring(0, Math.min(60, linha.length)),
  };
}

// ============================================================================
// FUNÇÕES AUXILIARES DE FILTRO E RESUMO
// ============================================================================

/**
 * Filtra registros de um estabelecimento específico
 */
export function filtrarPorEstabelecimento(
  registros: GetnetRegistro[],
  codigoEstabelecimento: string
): DadosEstabelecimento {
  const dados: DadosEstabelecimento = {
    header: null,
    resumos_vendas: [],
    comprovantes_vendas: [],
    ajustes_financeiros: [],
    antecipacoes: [],
    negociacoes_cessao: [],
    unidades_recebiveis: [],
    trailer: null,
  };

  for (const registro of registros) {
    const tipo = registro.TipoRegistro;
    const codigo = ('CodigoEstabelecimento' in registro)
      ? (registro as any).CodigoEstabelecimento?.trim() || ''
      : '';

    if (codigo !== codigoEstabelecimento && tipo !== 0 && tipo !== 9) {
      continue;
    }

    switch (tipo) {
      case 0:
        dados.header = registro as GetnetHeader;
        break;
      case 1:
        dados.resumos_vendas.push(registro as GetnetResumoVendas);
        break;
      case 2:
        dados.comprovantes_vendas.push(registro as GetnetComprovanteVendas);
        break;
      case 3:
        dados.ajustes_financeiros.push(registro as GetnetAjusteFinanceiro);
        break;
      case 4:
        dados.antecipacoes.push(registro as GetnetAntecipacao);
        break;
      case 5:
        dados.negociacoes_cessao.push(registro as GetnetNegociacaoCessao);
        break;
      case 6:
        dados.unidades_recebiveis.push(registro as GetnetUnidadeRecebivel);
        break;
      case 9:
        dados.trailer = registro as GetnetTrailer;
        break;
    }
  }

  return dados;
}

// ============================================================================
// PAREAMENTO MAN/POS — corrigir ValorBruto descontado em registros MAN
// ============================================================================

/**
 * Para cada venda, a Getnet gera DOIS registros Tipo 1:
 *   - Bandeira POS: ValorBruto = bruto REAL, ValorTaxaDesconto = taxa visível
 *   - Bandeira MAN: ValorBruto = já descontado da taxa, ValorTaxaDesconto = 0
 *
 * Registros MAN são duplicatas com valor líquido disfarçado de bruto.
 * Esta função pareia MAN com POS (mesmo ValorLiquido + DataPagamento)
 * e corrige o bruto do MAN com os valores reais do POS.
 *
 * Para registros PF (parcela futura) sem POS pareado, mantém o MAN como está
 * mas marca isBrutoDescontado=true.
 */
export function parearManPos(resumos: GetnetResumoVendas[]): GetnetResumoVendas[] {
  // Separar POS e MAN
  const posRecords = resumos.filter(r => r.Bandeira !== 'MAN');
  const manRecords = resumos.filter(r => r.Bandeira === 'MAN');

  // Índice POS por chave ValorLiquido+DataPagamento (para match com MAN)
  const posIndex = new Map<string, GetnetResumoVendas>();
  for (const pos of posRecords) {
    const key = `${pos.ValorLiquido.toFixed(2)}|${pos.DataPagamento}`;
    posIndex.set(key, pos);
  }

  // Marcar POS records que foram usados como par
  const usedPosRVs = new Set<string>();

  // Corrigir MAN records usando POS pareado
  const correctedMan: GetnetResumoVendas[] = [];
  for (const man of manRecords) {
    if (!man.isBrutoDescontado) {
      correctedMan.push(man);
      continue;
    }

    const key = `${man.ValorLiquido.toFixed(2)}|${man.DataPagamento}`;
    const pos = posIndex.get(key);

    if (pos && !usedPosRVs.has(pos.NumeroRV)) {
      // Pareou: corrigir MAN com valores reais do POS
      usedPosRVs.add(pos.NumeroRV);
      correctedMan.push({
        ...man,
        ValorBruto: pos.ValorBruto,
        ValorTaxaDesconto: pos.ValorTaxaDesconto,
        isBrutoDescontado: false,
      });
    } else {
      // Sem par POS — manter MAN como está (PF sem POS disponível)
      correctedMan.push(man);
    }
  }

  // Retornar MAN corrigidos + POS não pareados (evitar duplicata)
  const posNaoUsados = posRecords.filter(r => !usedPosRVs.has(r.NumeroRV));
  return [...correctedMan, ...posNaoUsados];
}

// ============================================================================
// FUNÇÕES AUXILIARES DE PARSE
// ============================================================================

/**
 * Converte data DDMMAAAA (formato Getnet) para YYYY-MM-DD
 */
function parseDataDDMMAAAA(dataStr: string): string | null {
  try {
    const s = dataStr.trim();
    if (s.length === 8) {
      const dia = s.substring(0, 2);
      const mes = s.substring(2, 4);
      const ano = s.substring(4, 8);
      if (parseInt(dia) > 0 && parseInt(dia) <= 31 && parseInt(mes) > 0 && parseInt(mes) <= 12) {
        return `${ano}-${mes}-${dia}`;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Converte valor string para float
 * Formato Getnet: 000000000012345 (últimos 2 dígitos são centavos)
 */
function parseValor(valorStr: string): number {
  try {
    const s = valorStr.trim();
    if (!s) return 0.0;
    const valorInt = parseInt(s, 10);
    return valorInt / 100.0;
  } catch {
    return 0.0;
  }
}

/**
 * Extrai valor de campo LEFT-ALIGNED (valor nos primeiros dígitos, zeros à direita)
 * Ex: "4521000000000" -> 4521 -> R$ 45.21
 */
function parseValorLeftAligned(campo: string): number {
  try {
    const s = campo.trim();
    if (!s) return 0.0;

    let valorStr = '';
    let encontrouZeroTrailing = false;

    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c >= '0' && c <= '9') {
        if (c !== '0') {
          valorStr += c;
          encontrouZeroTrailing = false;
        } else if (!encontrouZeroTrailing && valorStr) {
          // Pode ser zero no meio do valor (ex: 4501)
          const resto = s.substring(i + 1);
          const temDigitoDepois = [...resto.substring(0, 4)].some(d => d !== '0' && d >= '0' && d <= '9');
          if (temDigitoDepois) {
            valorStr += c;
          } else {
            encontrouZeroTrailing = true;
            break;
          }
        }
        // Zeros no início - ignorar
      } else {
        break;
      }
    }

    if (!valorStr) return 0.0;
    return parseInt(valorStr, 10) / 100.0;
  } catch {
    return 0.0;
  }
}
