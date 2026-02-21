/**
 * Tests for Getnet Ops Module
 *
 * Tests fileHelper (parser), client, health check, and capture handler.
 * All external dependencies (SFTP, Table Storage) are mocked.
 */

// ============================================================================
// MOCKS
// ============================================================================

jest.mock('@azure/data-tables', () => ({
  TableClient: {
    fromConnectionString: jest.fn(() => ({
      createTable: jest.fn().mockResolvedValue(undefined),
      listEntities: jest.fn(() => ({
        [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true }) }),
      })),
      getEntity: jest.fn().mockRejectedValue({ statusCode: 404 }),
      createEntity: jest.fn().mockResolvedValue(undefined),
      upsertEntity: jest.fn().mockResolvedValue(undefined),
      updateEntity: jest.fn().mockResolvedValue(undefined),
    })),
  },
}));

jest.mock('@azure/storage-queue', () => ({
  QueueServiceClient: {
    fromConnectionString: jest.fn(() => ({
      getQueueClient: jest.fn(() => ({
        getProperties: jest.fn().mockResolvedValue({ approximateMessagesCount: 0 }),
      })),
    })),
  },
}));

jest.mock('@azure/identity', () => ({ DefaultAzureCredential: jest.fn() }));
jest.mock('@azure/keyvault-secrets', () => ({
  SecretClient: jest.fn(() => ({
    getSecret: jest.fn().mockResolvedValue({ value: 'mock-pass' }),
  })),
}));

jest.mock('durable-functions', () => ({
  input: { durableClient: jest.fn(() => ({ type: 'durableClient' })) },
  getClient: jest.fn(() => ({
    startNew: jest.fn().mockResolvedValue('test-instance-id'),
    getStatus: jest.fn().mockResolvedValue(null),
  })),
  app: { orchestration: jest.fn(), activity: jest.fn(), entity: jest.fn() },
}));

jest.mock('openai', () => {
  const mock = jest.fn(() => ({
    chat: { completions: { create: jest.fn().mockResolvedValue({ choices: [{ message: { content: '{"transactions":[]}' } }] }) } },
  }));
  (mock as any).default = mock;
  return mock;
});

// Capture registered routes
const registeredRoutes: Record<string, any> = {};
jest.mock('@azure/functions', () => ({
  app: {
    http: (name: string, options: any) => {
      registeredRoutes[name] = options;
    },
    timer: jest.fn(),
  },
  HttpRequest: jest.fn(),
  InvocationContext: jest.fn(),
}));

// Mock the Getnet SFTP client module
const mockBuscarArquivoPorData = jest.fn();
const mockBuscarUltimoArquivo = jest.fn();
jest.mock('../ops/getnet/adapters/client', () => ({
  getGetnetClient: jest.fn(() => ({
    buscarArquivoPorData: mockBuscarArquivoPorData,
    buscarUltimoArquivo: mockBuscarUltimoArquivo,
  })),
  resetGetnetClient: jest.fn(),
  GetnetClient: jest.fn(),
}));

// Mock table client storage functions
jest.mock('../storage/tableClient', () => ({
  getExistingSourceIds: jest.fn().mockResolvedValue(new Set()),
  upsertTransactionsIdempotent: jest.fn().mockResolvedValue({
    created: ['tx-1'],
    updated: [],
    skipped: [],
  }),
}));

import { parseConteudo, filtrarPorEstabelecimento, parearManPos } from '../ops/getnet/adapters/fileHelper';
import type {
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
} from '../ops/getnet/adapters/types';

// ============================================================================
// HELPERS - Build positional lines
// ============================================================================

/** Pad string to given length */
function pad(s: string, len: number): string {
  return s.padEnd(len, ' ').substring(0, len);
}

/** Pad number to given length (right-aligned, zero-padded) */
function padNum(n: number, len: number): string {
  return String(n).padStart(len, '0').substring(0, len);
}

/**
 * Build a Type 0 (Header) line
 * Data = DDMMAAAA, Cod Estab at [31:46], CNPJ at [46:60]
 */
function buildHeader(opts: { data?: string; codEstab?: string; cnpj?: string } = {}): string {
  const line = '0' +
    pad(opts.data || '20022026', 8) + // DataMovimento [1:9]
    pad('1200000', 7) +               // HoraGeracao [9:16]
    pad('20022026', 8) +              // DataGeracao [16:24]
    pad('CEADM100', 7) +             // Identificador [24:31]
    pad(opts.codEstab || '000012345678901', 15) + // CodEstab [31:46]
    pad(opts.cnpj || '12345678000199', 14) +      // CNPJ [46:60]
    pad('GETNET SA', 20);             // Nome Adquirente [60:80]
  return line.padEnd(401, ' ');
}

/**
 * Build a Type 1 (Resumo de Vendas) line — V10.1 layout
 * Layout: [0:1] Tipo, [1:16] CodEstab, [16:18] Produto, [18:21] Bandeira,
 *          [21:30] NumRV, [30:38] DataRV, [38:46] DataPgto,
 *          [46:49] Banco, [49:55] Agencia, [55:66] ContaCorrente,
 *          [66:75] CVsAceitos, [75:84] CVsRejeitados,
 *          [84:96] ValorBruto, [96:108] ValorLiquido,
 *          [108:120] ValorTaxaServico, [120:132] ValorTaxaDesconto,
 *          [132:144] ValorRejeitado, [144:156] ValorCredito, [156:168] ValorEncargos,
 *          [168:170] TipoPgto, [170:172] NumeroParcela, [172:174] QuantidadeParcelas,
 *          [174:189] CodEstabCentralizador
 */
function buildResumoVendas(opts: {
  codEstab?: string;
  produto?: string;
  bandeira?: string;
  numRV?: string;
  dataRV?: string;     // DDMMAAAA
  dataPgto?: string;    // DDMMAAAA
  valorBruto?: number;  // in centavos
  valorLiquido?: number;
  valorTaxaDesconto?: number;
  tipoPgto?: string;
  banco?: string;
  agencia?: string;
  contaCorrente?: string;
  cvsAceitos?: number;
  cvsRejeitados?: number;
  numeroParcela?: number;
  quantidadeParcelas?: number;
} = {}): string {
  const line = new Array(401).fill(' ');
  line[0] = '1';

  const codEstab = pad(opts.codEstab || '000012345678901', 15);
  for (let i = 0; i < 15; i++) line[1 + i] = codEstab[i];

  const produto = pad(opts.produto || 'SM', 2);
  line[16] = produto[0]; line[17] = produto[1];

  const bandeira = pad(opts.bandeira || 'VIS', 3);
  for (let i = 0; i < 3; i++) line[18 + i] = bandeira[i];

  const numRV = pad(opts.numRV || '123456789', 9);
  for (let i = 0; i < 9; i++) line[21 + i] = numRV[i];

  const dataRV = pad(opts.dataRV || '19022026', 8);
  for (let i = 0; i < 8; i++) line[30 + i] = dataRV[i];

  const dataPgto = pad(opts.dataPgto || '20022026', 8);
  for (let i = 0; i < 8; i++) line[38 + i] = dataPgto[i];

  // Banco [46:49]
  const banco = pad(opts.banco || '033', 3);
  for (let i = 0; i < 3; i++) line[46 + i] = banco[i];

  // Agência [49:55]
  const agencia = pad(opts.agencia || '001234', 6);
  for (let i = 0; i < 6; i++) line[49 + i] = agencia[i];

  // ContaCorrente [55:66]
  const contaCorrente = pad(opts.contaCorrente || '00012345678', 11);
  for (let i = 0; i < 11; i++) line[55 + i] = contaCorrente[i];

  // CVs Aceitos [66:75]
  const cvsAceitos = padNum(opts.cvsAceitos ?? 1, 9);
  for (let i = 0; i < 9; i++) line[66 + i] = cvsAceitos[i];

  // CVs Rejeitados [75:84]
  const cvsRejeitados = padNum(opts.cvsRejeitados ?? 0, 9);
  for (let i = 0; i < 9; i++) line[75 + i] = cvsRejeitados[i];

  const valorBruto = padNum(opts.valorBruto ?? 100000, 12); // R$ 1000.00
  for (let i = 0; i < 12; i++) line[84 + i] = valorBruto[i];

  const valorLiquido = padNum(opts.valorLiquido ?? 95000, 12); // R$ 950.00
  for (let i = 0; i < 12; i++) line[96 + i] = valorLiquido[i];

  // ValorTaxaServico [108:120] - zero by default
  const valorTaxaServico = padNum(0, 12);
  for (let i = 0; i < 12; i++) line[108 + i] = valorTaxaServico[i];

  // ValorTaxaDesconto [120:132]
  const valorTaxaDesconto = padNum(opts.valorTaxaDesconto ?? 5000, 12); // R$ 50.00
  for (let i = 0; i < 12; i++) line[120 + i] = valorTaxaDesconto[i];

  // ValorRejeitado [132:144] - zero by default
  const valorRejeitado = padNum(0, 12);
  for (let i = 0; i < 12; i++) line[132 + i] = valorRejeitado[i];

  // ValorCredito [144:156] - zero by default
  const valorCredito = padNum(0, 12);
  for (let i = 0; i < 12; i++) line[144 + i] = valorCredito[i];

  // ValorEncargos [156:168] - zero by default
  const valorEncargos = padNum(0, 12);
  for (let i = 0; i < 12; i++) line[156 + i] = valorEncargos[i];

  const tipoPgto = pad(opts.tipoPgto || 'PF', 2);
  line[168] = tipoPgto[0]; line[169] = tipoPgto[1];

  // NumeroParcela [170:172]
  const numeroParcela = padNum(opts.numeroParcela ?? 1, 2);
  line[170] = numeroParcela[0]; line[171] = numeroParcela[1];

  // QuantidadeParcelas [172:174]
  const quantidadeParcelas = padNum(opts.quantidadeParcelas ?? 3, 2);
  line[172] = quantidadeParcelas[0]; line[173] = quantidadeParcelas[1];

  return line.join('');
}

/**
 * Build a Type 2 (Comprovante de Vendas) line
 */
function buildComprovanteVendas(opts: {
  codEstab?: string;
  numRV?: string;
  nsu?: string;
  valorTransacao?: number;
  valorParcela?: number;
  dataPagamento?: string;
  bandeira?: string;
} = {}): string {
  const line = new Array(401).fill(' ');
  line[0] = '2';

  const codEstab = pad(opts.codEstab || '000012345678901', 15);
  for (let i = 0; i < 15; i++) line[1 + i] = codEstab[i];

  const numRV = pad(opts.numRV || '123456789', 9);
  for (let i = 0; i < 9; i++) line[16 + i] = numRV[i];

  const nsu = pad(opts.nsu || '000000000001', 12);
  for (let i = 0; i < 12; i++) line[25 + i] = nsu[i];

  // DataTransacao [37:45]
  const dataTx = pad('19022026', 8);
  for (let i = 0; i < 8; i++) line[37 + i] = dataTx[i];

  // HoraTransacao [45:51]
  const horaTx = pad('143055', 6);
  for (let i = 0; i < 6; i++) line[45 + i] = horaTx[i];

  // NumeroCartao [51:70]
  const cartao = pad('1234****5678', 19);
  for (let i = 0; i < 19; i++) line[51 + i] = cartao[i];

  // ValorTransacao [70:82]
  const valorTx = padNum(opts.valorTransacao ?? 20000, 12);
  for (let i = 0; i < 12; i++) line[70 + i] = valorTx[i];

  // Parcela [106:108], TotalParcelas [108:110]
  line[106] = '0'; line[107] = '1';
  line[108] = '0'; line[109] = '3';

  // ValorParcela [110:122]
  const valorParcela = padNum(opts.valorParcela ?? 6667, 12);
  for (let i = 0; i < 12; i++) line[110 + i] = valorParcela[i];

  // DataPagamento [122:130]
  const dataPgto = pad(opts.dataPagamento || '20032026', 8);
  for (let i = 0; i < 8; i++) line[122 + i] = dataPgto[i];

  // CodigoAutorizacao [130:140]
  const codAuth = pad('AUTH123456', 10);
  for (let i = 0; i < 10; i++) line[130 + i] = codAuth[i];

  // Bandeira [140:144]
  const band = pad(opts.bandeira || 'VIS', 4);
  for (let i = 0; i < 4; i++) line[140 + i] = band[i];

  return line.join('');
}

/**
 * Build a Type 3 (Ajuste Financeiro) line
 */
function buildAjusteFinanceiro(opts: {
  codEstab?: string;
  numRV?: string;
  sinal?: string;
  valorAjuste?: number;
  motivo?: string;
} = {}): string {
  const line = new Array(401).fill(' ');
  line[0] = '3';

  const codEstab = pad(opts.codEstab || '000012345678901', 15);
  for (let i = 0; i < 15; i++) line[1 + i] = codEstab[i];

  const numRV = pad(opts.numRV || '987654321', 9);
  for (let i = 0; i < 9; i++) line[16 + i] = numRV[i];

  // DataAjuste [25:33]
  const dataAjuste = pad('20022026', 8);
  for (let i = 0; i < 8; i++) line[25 + i] = dataAjuste[i];

  // DataPagamento [33:41]
  const dataPgto = pad('22022026', 8);
  for (let i = 0; i < 8; i++) line[33 + i] = dataPgto[i];

  // Sinal [62:63]
  line[62] = opts.sinal || '-';

  // ValorAjuste [63:75]
  const valor = padNum(opts.valorAjuste ?? 1500, 12); // R$ 15.00
  for (let i = 0; i < 12; i++) line[63 + i] = valor[i];

  // MotivoAjuste [87:117]
  const motivo = pad(opts.motivo || 'CHARGEBACK VISA', 30);
  for (let i = 0; i < 30; i++) line[87 + i] = motivo[i];

  return line.join('');
}

/**
 * Build a Type 4 (Antecipacao) line
 */
function buildAntecipacao(opts: {
  codEstab?: string;
  numOperacao?: string;
  valorBruto?: number;
  taxaAntec?: number;
  valorLiquido?: number;
  dataOriginalPagamento?: string;
  bandeira?: string;
} = {}): string {
  const line = new Array(401).fill(' ');
  line[0] = '4';

  const codEstab = pad(opts.codEstab || '000012345678901', 15);
  for (let i = 0; i < 15; i++) line[1 + i] = codEstab[i];

  // Produto [16:18]
  line[16] = 'S'; line[17] = 'M';

  // Bandeira [18:21]
  const bandChars = opts.bandeira || 'VIS';
  line[18] = bandChars[0] || ' '; line[19] = bandChars[1] || ' '; line[20] = bandChars[2] || ' ';

  // NumOperacao [21:35]
  const numOp = pad(opts.numOperacao || '00000000000001', 14);
  for (let i = 0; i < 14; i++) line[21 + i] = numOp[i];

  // DataAntecipacao [35:43]
  const dataAntec = pad('20022026', 8);
  for (let i = 0; i < 8; i++) line[35 + i] = dataAntec[i];

  // DataOriginalPagamento [43:51]
  const dataOrig = pad(opts.dataOriginalPagamento || '25022026', 8);
  for (let i = 0; i < 8; i++) line[43 + i] = dataOrig[i];

  // ValorBrutoAntecipacao [51:66]
  const vBruto = padNum(opts.valorBruto ?? 5000000, 15); // R$ 50000.00
  for (let i = 0; i < 15; i++) line[51 + i] = vBruto[i];

  // TaxaAntecipacao [66:81]
  const taxa = padNum(opts.taxaAntec ?? 250000, 15); // R$ 2500.00
  for (let i = 0; i < 15; i++) line[66 + i] = taxa[i];

  // ValorLiquidoAntecipacao [81:96]
  const vLiq = padNum(opts.valorLiquido ?? 4750000, 15); // R$ 47500.00
  for (let i = 0; i < 15; i++) line[81 + i] = vLiq[i];

  return line.join('');
}

/**
 * Build a Type 5 (Negociacao/Cessao) line - CS
 */
function buildCessaoCS(opts: {
  codEstab?: string;
  numOperacao?: string;
  valorBruto?: number;
  valorTaxa?: number;
  valorLiquido?: number;
} = {}): string {
  const line = new Array(401).fill(' ');
  line[0] = '5';

  const codEstab = pad(opts.codEstab || '000012345678901', 15);
  for (let i = 0; i < 15; i++) line[1 + i] = codEstab[i];

  // DataCessao [16:24]
  const dataCessao = pad('20022026', 8);
  for (let i = 0; i < 8; i++) line[16 + i] = dataCessao[i];

  // DataPagamento [24:32]
  const dataPgto = pad('21022026', 8);
  for (let i = 0; i < 8; i++) line[24 + i] = dataPgto[i];

  // NumOperacao [32:52]
  const numOp = pad(opts.numOperacao || 'CESSAO-00001', 20);
  for (let i = 0; i < 20; i++) line[32 + i] = numOp[i];

  // Indicador CS [52:54]
  line[52] = 'C'; line[53] = 'S';

  // CS layout: [66:78] ValorBruto, [78:90] ValorTaxa, [90:102] ValorLiquido
  const vBruto = padNum(opts.valorBruto ?? 1000000, 12);
  for (let i = 0; i < 12; i++) line[66 + i] = vBruto[i];

  const vTaxa = padNum(opts.valorTaxa ?? 50000, 12);
  for (let i = 0; i < 12; i++) line[78 + i] = vTaxa[i];

  const vLiq = padNum(opts.valorLiquido ?? 950000, 12);
  for (let i = 0; i < 12; i++) line[90 + i] = vLiq[i];

  return line.join('');
}

/**
 * Build a Type 9 (Trailer) line
 */
function buildTrailer(opts: {
  totalRegistros?: number;
  valorBruto?: number;
  valorLiquido?: number;
  qtdRVs?: number;
} = {}): string {
  const line = new Array(401).fill(' ');
  line[0] = '9';

  // TotalRegistros [1:7]
  const total = padNum(opts.totalRegistros ?? 10, 6);
  for (let i = 0; i < 6; i++) line[1 + i] = total[i];

  // ValorBruto [7:25]
  const vBruto = padNum(opts.valorBruto ?? 10000000, 18);
  for (let i = 0; i < 18; i++) line[7 + i] = vBruto[i];

  // ValorLiquido [25:43]
  const vLiq = padNum(opts.valorLiquido ?? 9500000, 18);
  for (let i = 0; i < 18; i++) line[25 + i] = vLiq[i];

  // QtdRVs [43:49]
  const qtd = padNum(opts.qtdRVs ?? 5, 6);
  for (let i = 0; i < 6; i++) line[43 + i] = qtd[i];

  return line.join('');
}

// ============================================================================
// TESTS - FILE PARSER (parseConteudo)
// ============================================================================

describe('Getnet FileHelper - parseConteudo', () => {
  test('parses empty content', () => {
    const result = parseConteudo('');
    expect(result).toEqual([]);
  });

  test('skips blank lines', () => {
    const content = '\n\n  \n\n';
    const result = parseConteudo(content);
    expect(result).toEqual([]);
  });

  test('parses header (Type 0)', () => {
    const line = buildHeader({ codEstab: '000099887766554', cnpj: '11222333000144' });
    const result = parseConteudo(line);

    expect(result).toHaveLength(1);
    const header = result[0] as GetnetHeader;
    expect(header.TipoRegistro).toBe(0);
    expect(header.CodigoEstabelecimento).toBe('000099887766554');
    expect(header.CNPJ).toBe('11222333000144');
    expect(header.VersaoLayout).toBe('10.1');
  });

  test('parses resumo de vendas (Type 1)', () => {
    const line = buildResumoVendas({
      codEstab: '000012345678901',
      produto: 'SM',
      bandeira: 'VIS',
      numRV: '123456789',
      valorBruto: 100000,    // R$ 1000.00
      valorLiquido: 95000,   // R$ 950.00
      valorTaxaDesconto: 5000,     // R$ 50.00
      tipoPgto: 'PF',
    });
    const result = parseConteudo(line);

    expect(result).toHaveLength(1);
    const venda = result[0] as GetnetResumoVendas;
    expect(venda.TipoRegistro).toBe(1);
    expect(venda.CodigoEstabelecimento).toBe('000012345678901');
    expect(venda.Produto).toBe('SM');
    expect(venda.Bandeira).toBe('VIS');
    expect(venda.NumeroRV).toBe('123456789');
    expect(venda.ValorBruto).toBe(1000.00);
    expect(venda.ValorLiquido).toBe(950.00);
    expect(venda.ValorTaxaDesconto).toBe(50.00);
    expect(venda.TipoPagamento).toBe('PF');
    expect(venda.Banco).toBe('033');
    expect(venda.CVsAceitos).toBe(1);
    expect(venda.CVsRejeitados).toBe(0);
    expect(venda.NumeroParcela).toBe(1);
    expect(venda.QuantidadeParcelas).toBe(3);
    expect(venda.isBrutoDescontado).toBe(false);
  });

  test('parses comprovante de vendas (Type 2)', () => {
    const line = buildComprovanteVendas({
      numRV: '123456789',
      nsu: '000000000042',
      valorTransacao: 20000,
      valorParcela: 6667,
    });
    const result = parseConteudo(line);

    expect(result).toHaveLength(1);
    const cv = result[0] as GetnetComprovanteVendas;
    expect(cv.TipoRegistro).toBe(2);
    expect(cv.NumeroRV).toBe('123456789');
    expect(cv.NSU).toBe('000000000042');
    expect(cv.ValorTransacao).toBe(200.00);
    expect(cv.ValorParcela).toBe(66.67);
    expect(cv.Parcela).toBe('01');
    expect(cv.TotalParcelas).toBe('03');
  });

  test('parses ajuste financeiro (Type 3) with negative sign', () => {
    const line = buildAjusteFinanceiro({
      sinal: '-',
      valorAjuste: 1500,
      motivo: 'CHARGEBACK VISA',
    });
    const result = parseConteudo(line);

    expect(result).toHaveLength(1);
    const ajuste = result[0] as GetnetAjusteFinanceiro;
    expect(ajuste.TipoRegistro).toBe(3);
    expect(ajuste.SinalTransacao).toBe('-');
    expect(ajuste.ValorAjuste).toBe(15.00);
    expect(ajuste.MotivoAjuste).toBe('CHARGEBACK VISA');
  });

  test('parses ajuste financeiro (Type 3) with positive sign', () => {
    const line = buildAjusteFinanceiro({
      sinal: '+',
      valorAjuste: 3000,
      motivo: 'ESTORNO',
    });
    const result = parseConteudo(line);

    const ajuste = result[0] as GetnetAjusteFinanceiro;
    expect(ajuste.SinalTransacao).toBe('+');
    expect(ajuste.ValorAjuste).toBe(30.00);
    expect(ajuste.MotivoAjuste).toBe('ESTORNO');
  });

  test('parses antecipacao (Type 4)', () => {
    const line = buildAntecipacao({
      numOperacao: '00000000000001',
      valorBruto: 5000000,   // R$ 50000.00
      taxaAntec: 250000,     // R$ 2500.00
      valorLiquido: 4750000, // R$ 47500.00
    });
    const result = parseConteudo(line);

    expect(result).toHaveLength(1);
    const antec = result[0] as GetnetAntecipacao;
    expect(antec.TipoRegistro).toBe(4);
    expect(antec.NumeroOperacao).toBe('00000000000001');
    expect(antec.ValorBrutoAntecipacao).toBe(50000.00);
    expect(antec.TaxaAntecipacao).toBe(2500.00);
    expect(antec.ValorLiquidoAntecipacao).toBe(47500.00);
  });

  test('parses cessao CS (Type 5)', () => {
    const line = buildCessaoCS({
      numOperacao: 'CESSAO-00001',
      valorBruto: 1000000,   // R$ 10000.00
      valorTaxa: 50000,      // R$ 500.00
      valorLiquido: 950000,  // R$ 9500.00
    });
    const result = parseConteudo(line);

    expect(result).toHaveLength(1);
    const cessao = result[0] as GetnetNegociacaoCessao;
    expect(cessao.TipoRegistro).toBe(5);
    expect(cessao.Indicador).toBe('CS');
    expect(cessao.NumeroOperacao).toBe('CESSAO-00001');
    expect(cessao.ValorBrutoCessao).toBe(10000.00);
    expect(cessao.ValorTaxaCessao).toBe(500.00);
    expect(cessao.ValorLiquidoCessao).toBe(9500.00);
  });

  test('parses trailer (Type 9)', () => {
    const line = buildTrailer({
      totalRegistros: 42,
      valorBruto: 10000000,  // R$ 100000.00
      valorLiquido: 9500000, // R$ 95000.00
      qtdRVs: 15,
    });
    const result = parseConteudo(line);

    expect(result).toHaveLength(1);
    const trailer = result[0] as GetnetTrailer;
    expect(trailer.TipoRegistro).toBe(9);
    expect(trailer.TotalRegistros).toBe(42);
    expect(trailer.ValorTotalBruto).toBe(100000.00);
    expect(trailer.ValorTotalLiquido).toBe(95000.00);
    expect(trailer.QuantidadeRVs).toBe(15);
  });

  test('parses full file with multiple record types', () => {
    const content = [
      buildHeader(),
      buildResumoVendas({ numRV: '111111111' }),
      buildResumoVendas({ numRV: '222222222' }),
      buildComprovanteVendas({ numRV: '111111111' }),
      buildAjusteFinanceiro({ numRV: '333333333' }),
      buildAntecipacao({ numOperacao: 'OP0001' }),
      buildCessaoCS({ numOperacao: 'CS0001' }),
      buildTrailer({ totalRegistros: 7 }),
    ].join('\n');

    const result = parseConteudo(content);
    expect(result).toHaveLength(8);

    // Count by type
    const byType = result.reduce((acc, r) => {
      acc[r.TipoRegistro] = (acc[r.TipoRegistro] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    expect(byType[0]).toBe(1); // header
    expect(byType[1]).toBe(2); // resumos vendas
    expect(byType[2]).toBe(1); // comprovante
    expect(byType[3]).toBe(1); // ajuste
    expect(byType[4]).toBe(1); // antecipacao
    expect(byType[5]).toBe(1); // cessao
    expect(byType[9]).toBe(1); // trailer
  });

  test('handles data parsing DDMMAAAA -> YYYY-MM-DD', () => {
    const line = buildResumoVendas({
      dataRV: '15032026',    // 15/03/2026
      dataPgto: '20032026',  // 20/03/2026
    });
    const result = parseConteudo(line);
    const venda = result[0] as GetnetResumoVendas;

    expect(venda.DataRV).toBe('2026-03-15');
    expect(venda.DataPagamento).toBe('2026-03-20');
  });

  test('handles debito product (SE)', () => {
    const line = buildResumoVendas({ produto: 'SE' });
    const result = parseConteudo(line);
    const venda = result[0] as GetnetResumoVendas;
    expect(venda.Produto).toBe('SE');
  });

  test('skips unknown record types gracefully', () => {
    const unknownLine = '7' + ' '.repeat(400);
    const content = [
      buildHeader(),
      unknownLine,
      buildTrailer(),
    ].join('\n');

    const result = parseConteudo(content);
    expect(result).toHaveLength(2); // header + trailer, skips type 7
  });
});

// ============================================================================
// TESTS - filtrarPorEstabelecimento
// ============================================================================

describe('Getnet FileHelper - filtrarPorEstabelecimento', () => {
  test('filters records by establishment code', () => {
    const content = [
      buildHeader({ codEstab: 'ESTAB_A' }),
      buildResumoVendas({ codEstab: 'ESTAB_A        ', numRV: '111111111' }),
      buildResumoVendas({ codEstab: 'ESTAB_B        ', numRV: '222222222' }),
      buildComprovanteVendas({ codEstab: 'ESTAB_A        ' }),
      buildAjusteFinanceiro({ codEstab: 'ESTAB_B        ' }),
      buildTrailer(),
    ].join('\n');

    const registros = parseConteudo(content);
    const dados = filtrarPorEstabelecimento(registros, 'ESTAB_A');

    expect(dados.resumos_vendas).toHaveLength(1);
    expect(dados.resumos_vendas[0].NumeroRV).toBe('111111111');
    expect(dados.comprovantes_vendas).toHaveLength(1);
    expect(dados.ajustes_financeiros).toHaveLength(0); // ESTAB_B only
    // Header and trailer are always included
    expect(dados.header).not.toBeNull();
    expect(dados.trailer).not.toBeNull();
  });

  test('returns empty arrays when no records match', () => {
    const content = [
      buildHeader(),
      buildResumoVendas({ codEstab: 'ESTAB_X        ' }),
      buildTrailer(),
    ].join('\n');

    const registros = parseConteudo(content);
    const dados = filtrarPorEstabelecimento(registros, 'NONEXISTENT');

    expect(dados.resumos_vendas).toHaveLength(0);
    expect(dados.comprovantes_vendas).toHaveLength(0);
    expect(dados.ajustes_financeiros).toHaveLength(0);
    expect(dados.antecipacoes).toHaveLength(0);
    expect(dados.negociacoes_cessao).toHaveLength(0);
    expect(dados.unidades_recebiveis).toHaveLength(0);
  });
});

// ============================================================================
// TESTS - parearManPos (MAN/POS pairing)
// ============================================================================

describe('Getnet FileHelper - parearManPos', () => {
  test('corrects MAN bruto from paired POS record', () => {
    // MAN record: bruto = liquido (descontado), taxa = 0
    const manLine = buildResumoVendas({
      codEstab: '000012345678901',
      bandeira: 'MAN',
      numRV: '111111111',
      valorBruto: 9761,      // R$ 97.61 (descontado)
      valorLiquido: 9761,    // R$ 97.61
      valorTaxaDesconto: 0,  // 0 = MAN pattern
      dataPgto: '20022026',
      tipoPgto: 'LQ',
    });
    // POS record: real bruto + tarifa
    const posLine = buildResumoVendas({
      codEstab: '000012345678901',
      bandeira: 'POS',
      numRV: '222222222',
      valorBruto: 10000,     // R$ 100.00 (real)
      valorLiquido: 9761,    // R$ 97.61
      valorTaxaDesconto: 239, // R$ 2.39
      dataPgto: '20022026',
      tipoPgto: 'LQ',
    });

    const registros = parseConteudo([manLine, posLine].join('\n'));
    const resumos = registros.filter(r => r.TipoRegistro === 1) as GetnetResumoVendas[];

    const pareados = parearManPos(resumos);

    // Should return only the corrected MAN (POS consumed as pair)
    expect(pareados).toHaveLength(1);
    const corrected = pareados[0];
    expect(corrected.NumeroRV).toBe('111111111'); // MAN's RV
    expect(corrected.ValorBruto).toBe(100.00);    // Corrected from POS
    expect(corrected.ValorTaxaDesconto).toBe(2.39); // Corrected from POS
    expect(corrected.ValorLiquido).toBe(97.61);
    expect(corrected.isBrutoDescontado).toBe(false);
  });

  test('keeps MAN without pair marked as isBrutoDescontado', () => {
    // MAN PF record without POS pair
    const manLine = buildResumoVendas({
      bandeira: 'MAN',
      numRV: '333333333',
      valorBruto: 29373,
      valorLiquido: 29373,
      valorTaxaDesconto: 0,
      dataPgto: '15032026',
      tipoPgto: 'PF',
    });

    const registros = parseConteudo(manLine);
    const resumos = registros.filter(r => r.TipoRegistro === 1) as GetnetResumoVendas[];

    const pareados = parearManPos(resumos);

    expect(pareados).toHaveLength(1);
    expect(pareados[0].isBrutoDescontado).toBe(true);
    expect(pareados[0].ValorBruto).toBe(293.73); // Not corrected
  });

  test('non-MAN records pass through unchanged', () => {
    const posLine = buildResumoVendas({
      bandeira: 'VIS',
      numRV: '444444444',
      valorBruto: 10000,
      valorLiquido: 9761,
      valorTaxaDesconto: 239,
      tipoPgto: 'LQ',
    });

    const registros = parseConteudo(posLine);
    const resumos = registros.filter(r => r.TipoRegistro === 1) as GetnetResumoVendas[];

    const pareados = parearManPos(resumos);

    expect(pareados).toHaveLength(1);
    expect(pareados[0].ValorBruto).toBe(100.00);
    expect(pareados[0].isBrutoDescontado).toBe(false);
  });
});

// ============================================================================
// TESTS - GETNET HEALTH
// ============================================================================

describe('Getnet Health', () => {
  beforeAll(() => {
    require('../ops/getnet/functions/health');
  });

  test('health function is registered', () => {
    expect(registeredRoutes['getnet-health']).toBeDefined();
    expect(registeredRoutes['getnet-health'].methods).toContain('GET');
    expect(registeredRoutes['getnet-health'].route).toBe('getnet/health');
  });

  test('returns healthy when user env var set and KV has password', async () => {
    process.env.GETNET_USER = 'test-user';

    const handler = registeredRoutes['getnet-health'].handler;
    const result = await handler({}, {});

    expect(result.status).toBe(200);
    expect(result.jsonBody.status).toBe('healthy');
    expect(result.jsonBody.sftp).toBe('configured');
    expect(result.jsonBody.host).toBe('getsftp2.getnet.com.br');
    expect(result.jsonBody.user).toBe('ok');
    expect(result.jsonBody.password).toBe('ok (kv)');
  });

  test('returns degraded when user env var missing', async () => {
    delete process.env.GETNET_USER;

    const handler = registeredRoutes['getnet-health'].handler;
    const result = await handler({}, {});

    expect(result.status).toBe(503);
    expect(result.jsonBody.status).toBe('degraded');
    expect(result.jsonBody.sftp).toBe('not_configured');
    expect(result.jsonBody.user).toBe('missing');
  });
});

// ============================================================================
// TESTS - GETNET CAPTURE HANDLER
// ============================================================================

describe('Getnet Capture Handler', () => {
  beforeAll(() => {
    process.env.GETNET_USER = 'test-user';
    process.env.GETNET_PASS = 'test-pass';
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
    require('../ops/getnet/functions/capture');
  });

  test('capture function is registered', () => {
    expect(registeredRoutes['getnet-capture']).toBeDefined();
    expect(registeredRoutes['getnet-capture'].methods).toContain('POST');
    expect(registeredRoutes['getnet-capture'].route).toBe('getnet/capture');
  });

  test('capture returns parsed data for action=raw', async () => {
    // Build a file with multiple record types
    const fileContent = [
      buildHeader(),
      buildResumoVendas({ numRV: '111111111' }),
      buildTrailer({ totalRegistros: 2 }),
    ].join('\n');

    // Mock SFTP client response
    mockBuscarArquivoPorData.mockResolvedValueOnce({
      erro: false,
      mensagem: 'Arquivo baixado com sucesso',
      arquivo: 'getnetextr_20260220.txt',
      conteudo: fileContent,
      totalLinhas: 3,
      tamanhoBytes: fileContent.length,
    });

    const handler = registeredRoutes['getnet-capture'].handler;
    const req = {
      json: async () => ({
        clientId: 'client-1',
        cycleId: 'cycle-1',
        startDate: '2026-02-20',
        action: 'raw',
      }),
    };

    const result = await handler(req, { functionName: 'getnet-capture', invocationId: 'test' });

    expect(result.status).toBe(200);
    expect(result.jsonBody.success).toBe(true);
    expect(result.jsonBody.action).toBe('raw');
    expect(result.jsonBody.registros).toBeDefined();
    expect(result.jsonBody.registros.length).toBeGreaterThan(0);
  });

  test('capture returns 500 when SFTP fails', async () => {
    mockBuscarArquivoPorData.mockResolvedValueOnce({
      erro: true,
      mensagem: 'Connection refused',
      arquivo: null,
      conteudo: null,
    });

    const handler = registeredRoutes['getnet-capture'].handler;
    const req = {
      json: async () => ({
        clientId: 'client-1',
        cycleId: 'cycle-1',
        startDate: '2026-02-20',
      }),
    };

    const result = await handler(req, { functionName: 'getnet-capture', invocationId: 'test' });

    expect(result.status).toBe(500);
    expect(result.jsonBody.success).toBe(false);
  });

  test('capture returns 500 when file content is empty', async () => {
    // Empty string is falsy, so handler treats it as SFTP failure
    mockBuscarArquivoPorData.mockResolvedValueOnce({
      erro: false,
      mensagem: 'Empty file',
      arquivo: 'getnetextr_20260220.txt',
      conteudo: '',
      totalLinhas: 0,
    });

    const handler = registeredRoutes['getnet-capture'].handler;
    const req = {
      json: async () => ({
        clientId: 'client-1',
        cycleId: 'cycle-1',
        startDate: '2026-02-20',
      }),
    };

    const result = await handler(req, { functionName: 'getnet-capture', invocationId: 'test' });

    expect(result.status).toBe(500);
    expect(result.jsonBody.success).toBe(false);
  });

  test('capture returns 500 when file has only blank lines', async () => {
    mockBuscarArquivoPorData.mockResolvedValueOnce({
      erro: false,
      mensagem: 'OK',
      arquivo: 'getnetextr_20260220.txt',
      conteudo: '\n\n   \n\n',
      totalLinhas: 0,
    });

    const handler = registeredRoutes['getnet-capture'].handler;
    const req = {
      json: async () => ({
        clientId: 'client-1',
        cycleId: 'cycle-1',
        startDate: '2026-02-20',
      }),
    };

    const result = await handler(req, { functionName: 'getnet-capture', invocationId: 'test' });

    expect(result.status).toBe(500);
    expect(result.jsonBody.success).toBe(false);
    expect(result.jsonBody.error).toContain('0 registros');
  });

  test('capture ingests transactions for default action', async () => {
    const fileContent = [
      buildHeader(),
      buildResumoVendas({
        numRV: '111111111',
        dataRV: '19022026',
        valorBruto: 100000,
        valorTaxaDesconto: 5000,
        tipoPgto: 'PF',
      }),
      buildTrailer({ totalRegistros: 2 }),
    ].join('\n');

    mockBuscarArquivoPorData.mockResolvedValueOnce({
      erro: false,
      mensagem: 'OK',
      arquivo: 'getnetextr_20260220.txt',
      conteudo: fileContent,
      totalLinhas: 3,
      tamanhoBytes: fileContent.length,
    });

    const handler = registeredRoutes['getnet-capture'].handler;
    const req = {
      json: async () => ({
        clientId: 'client-1',
        cycleId: 'cycle-1',
        startDate: '2026-02-20',
      }),
    };

    const result = await handler(req, { functionName: 'getnet-capture', invocationId: 'test' });

    expect(result.status).toBe(200);
    expect(result.jsonBody.success).toBe(true);
    expect(result.jsonBody.source).toBe('getnet');
    expect(result.jsonBody.clientId).toBe('client-1');
    expect(result.jsonBody.cycleId).toBe('cycle-1');
    expect(result.jsonBody.transactions).toBeDefined();
    expect(result.jsonBody.durationMs).toBeDefined();
  });

  test('capture creates COMPROVANTE transactions linked to VENDA_CARTAO for traceability', async () => {
    // RV com 2 comprovantes (2 transações individuais no mesmo resumo de vendas)
    const fileContent = [
      buildHeader(),
      buildResumoVendas({
        numRV: '111111111',
        dataRV: '19022026',
        valorBruto: 40000,     // R$ 400.00
        valorLiquido: 38000,   // R$ 380.00
        valorTaxaDesconto: 2000, // R$ 20.00
        tipoPgto: 'PF',
      }),
      buildComprovanteVendas({
        numRV: '111111111',
        nsu: '000000000042',
        valorTransacao: 20000,   // R$ 200.00 (valor faturamento tx 1)
        valorParcela: 6667,      // R$ 66.67
      }),
      buildComprovanteVendas({
        numRV: '111111111',
        nsu: '000000000043',
        valorTransacao: 20000,   // R$ 200.00 (valor faturamento tx 2)
        valorParcela: 6667,
      }),
      buildTrailer({ totalRegistros: 4 }),
    ].join('\n');

    mockBuscarArquivoPorData.mockResolvedValueOnce({
      erro: false,
      mensagem: 'OK',
      arquivo: 'getnetextr_20260220.txt',
      conteudo: fileContent,
      totalLinhas: 5,
      tamanhoBytes: fileContent.length,
    });

    const handler = registeredRoutes['getnet-capture'].handler;
    const req = {
      json: async () => ({
        clientId: 'client-1',
        cycleId: 'cycle-1',
        startDate: '2026-02-20',
        action: 'listar',
      }),
    };

    const result = await handler(req, { functionName: 'getnet-capture', invocationId: 'test' });

    expect(result.status).toBe(200);
    expect(result.jsonBody.success).toBe(true);

    const txs = result.jsonBody.transactions as any[];

    // Deve ter: RECEBER + PAGAR + VENDA_CARTAO + 2x COMPROVANTE = 5
    const vendaCartao = txs.find((t: any) => t.type === 'venda_cartao');
    const comprovantes = txs.filter((t: any) => t.type === 'comprovante');

    expect(vendaCartao).toBeDefined();
    expect(comprovantes).toHaveLength(2);

    // VENDA_CARTAO enriquecida com valor de faturamento dos comprovantes
    expect(vendaCartao.metadata.valor_faturamento).toBe(400.00); // 200 + 200
    expect(vendaCartao.metadata.qtd_comprovantes).toBe(2);
    expect(vendaCartao.metadata.comprovantes).toHaveLength(2);
    expect(vendaCartao.metadata.comprovantes[0].nsu).toBe('000000000042');
    expect(vendaCartao.metadata.comprovantes[0].valor_faturamento).toBe(200.00);
    expect(vendaCartao.metadata.comprovantes[0].parcela_atual).toBe('01');
    expect(vendaCartao.metadata.comprovantes[0].total_parcelas).toBe('03');
    expect(vendaCartao.metadata.comprovantes[0].valor_parcela).toBe(66.67);

    // Taxa proporcional no resumo de comprovantes do VENDA_CARTAO
    // RV tem ValorBruto=400, Taxa=20, cada CV=200 (50% do bruto) → taxa=10 cada
    expect(vendaCartao.metadata.comprovantes[0].taxa_proporcional).toBe(10.00);
    expect(vendaCartao.metadata.comprovantes[0].valor_liquido_estimado).toBe(190.00);
    expect(vendaCartao.metadata.comprovantes[1].taxa_proporcional).toBe(10.00);
    expect(vendaCartao.metadata.comprovantes[1].valor_liquido_estimado).toBe(190.00);

    // COMPROVANTEs vinculados ao VENDA_CARTAO (rastreabilidade)
    for (const cv of comprovantes) {
      expect(cv.vinculadoA).toBe(vendaCartao.id);
      expect(cv.vinculacaoTipo).toBe('automatico');
      expect(cv.type).toBe('comprovante');
      expect(cv.valor).toBe(200.00); // ValorTransacao = valor faturamento
      expect(cv.numeroDocumento).toBeDefined(); // NSU como documento de referência
      expect(cv.metadata.parcela_atual).toBe('01');
      expect(cv.metadata.total_parcelas).toBe('03');
      expect(cv.metadata.valor_parcela).toBe(66.67);
      expect(cv.metadata.taxa_proporcional).toBe(10.00);        // taxa rateada
      expect(cv.metadata.valor_liquido_estimado).toBe(190.00);  // faturamento - taxa
      expect(cv.metadata.data_transacao).toBeDefined();
      expect(cv.metadata.data_pagamento).toBeDefined();
    }

    // Resumo inclui faturamento total dos comprovantes
    expect(result.jsonBody.resumo.vendas_faturamento).toBe(400.00);
    expect(result.jsonBody.resumo.comprovantes_total).toBe(2);
  });

  test('capture works without comprovantes (Type 2 optional)', async () => {
    // RV sem comprovantes — deve funcionar normalmente
    const fileContent = [
      buildHeader(),
      buildResumoVendas({
        numRV: '222222222',
        dataRV: '19022026',
        valorBruto: 50000,
        valorTaxaDesconto: 2500,
        tipoPgto: 'PF',
      }),
      buildTrailer({ totalRegistros: 2 }),
    ].join('\n');

    mockBuscarArquivoPorData.mockResolvedValueOnce({
      erro: false,
      mensagem: 'OK',
      arquivo: 'getnetextr_20260220.txt',
      conteudo: fileContent,
      totalLinhas: 3,
      tamanhoBytes: fileContent.length,
    });

    const handler = registeredRoutes['getnet-capture'].handler;
    const req = {
      json: async () => ({
        clientId: 'client-1',
        cycleId: 'cycle-1',
        startDate: '2026-02-20',
        action: 'listar',
      }),
    };

    const result = await handler(req, { functionName: 'getnet-capture', invocationId: 'test' });

    expect(result.status).toBe(200);
    const txs = result.jsonBody.transactions as any[];

    const vendaCartao = txs.find((t: any) => t.type === 'venda_cartao');
    const comprovantes = txs.filter((t: any) => t.type === 'comprovante');

    expect(vendaCartao).toBeDefined();
    expect(comprovantes).toHaveLength(0);

    // Sem comprovantes, valor_faturamento = ValorBruto (fallback)
    expect(vendaCartao.metadata.valor_faturamento).toBe(500.00);
    expect(vendaCartao.metadata.qtd_comprovantes).toBe(0);
  });

  test('enriches COMPROVANTEs with antecipação when same file has Type 4 matching DataPagamento', async () => {
    // Cenário: arquivo contém venda (Tipo 1), comprovantes (Tipo 2) e antecipação (Tipo 4)
    // A antecipação tem DataOriginalPagamento = DataPagamento dos comprovantes → match!
    const fileContent = [
      buildHeader(),
      buildResumoVendas({
        numRV: '111111111',
        dataRV: '19022026',
        dataPgto: '20032026',       // DataPagamento do RV
        valorBruto: 40000,          // R$ 400.00
        valorTaxaDesconto: 2000,    // R$ 20.00 taxa
        tipoPgto: 'PF',
        bandeira: 'VIS',
      }),
      buildComprovanteVendas({
        numRV: '111111111',
        nsu: '000000000042',
        valorTransacao: 20000,      // R$ 200.00
        valorParcela: 6667,
        dataPagamento: '20032026',
        bandeira: 'VIS',
      }),
      buildComprovanteVendas({
        numRV: '111111111',
        nsu: '000000000043',
        valorTransacao: 20000,      // R$ 200.00
        valorParcela: 6667,
        dataPagamento: '20032026',
        bandeira: 'VIS',
      }),
      // Antecipação com DataOriginalPagamento = 20032026 (match com comprovantes)
      buildAntecipacao({
        numOperacao: '00000000000099',
        valorBruto: 40000,          // R$ 400.00
        taxaAntec: 1000,            // R$ 10.00 taxa de antecipação
        valorLiquido: 39000,        // R$ 390.00
        dataOriginalPagamento: '20032026', // match com comprovantes!
        bandeira: 'VIS',
      }),
      buildTrailer({ totalRegistros: 5 }),
    ].join('\n');

    mockBuscarArquivoPorData.mockResolvedValueOnce({
      erro: false,
      mensagem: 'OK',
      arquivo: 'getnetextr_20260220.txt',
      conteudo: fileContent,
      totalLinhas: 6,
      tamanhoBytes: fileContent.length,
    });

    const handler = registeredRoutes['getnet-capture'].handler;
    const req = {
      json: async () => ({
        clientId: 'client-1',
        cycleId: 'cycle-1',
        startDate: '2026-02-20',
        action: 'listar',
      }),
    };

    const result = await handler(req, { functionName: 'getnet-capture', invocationId: 'test' });

    expect(result.status).toBe(200);
    const txs = result.jsonBody.transactions as any[];

    const comprovantes = txs.filter((t: any) => t.type === 'comprovante');
    expect(comprovantes).toHaveLength(2);

    // Cada comprovante deve estar enriquecido com antecipação
    // 2 CVs de R$ 200 cada (50% cada) → taxa antecipação R$ 5.00 cada (10 * 0.5)
    for (const cv of comprovantes) {
      expect(cv.metadata.antecipacao).toBeDefined();
      expect(cv.metadata.antecipacao.numero_operacao).toBe('00000000000099');
      expect(cv.metadata.antecipacao.data_original_pagamento).toBe('2026-03-20');
      expect(cv.metadata.antecipacao.taxa_antecipacao_proporcional).toBe(5.00);
      // valor_liquido_antecipado = 200 (faturamento) - 10 (taxa maquineta) - 5 (taxa antecipação) = 185
      expect(cv.metadata.antecipacao.valor_liquido_antecipado).toBe(185.00);
    }

    // VENDA_CARTAO também deve ter a antecipação propagada nos comprovantes[]
    const vendaCartao = txs.find((t: any) => t.type === 'venda_cartao');
    expect(vendaCartao).toBeDefined();
    for (const cvRef of vendaCartao.metadata.comprovantes) {
      expect(cvRef.antecipacao).toBeDefined();
      expect(cvRef.antecipacao.taxa_antecipacao_proporcional).toBe(5.00);
    }
  });

  test('traceability: all transaction types share consistent tracking numbers (RV, NSU, sourceId, vinculadoA)', async () => {
    // Cenário completo: venda + 2 comprovantes + antecipação no mesmo arquivo
    // Verifica que a CADEIA DE RASTREIO é consistente de ponta a ponta:
    //   RECEBER ←RV→ PAGAR ←RV→ VENDA_CARTAO ←id/RV→ COMPROVANTE ←DataPgto→ ANTECIPAÇÃO
    const RV = '777777777';
    const NSU_1 = '000000000077';
    const NSU_2 = '000000000078';
    const DATA_PGTO = '15032026'; // 2026-03-15
    const DATA_PGTO_ISO = '2026-03-15';
    const BANDEIRA = 'MCC';
    const COD_ESTAB = '000012345678901';
    const NUM_OP_ANTEC = '00000000000055';

    const fileContent = [
      buildHeader(),
      buildResumoVendas({
        codEstab: COD_ESTAB,
        numRV: RV,
        dataRV: '19022026',
        dataPgto: DATA_PGTO,
        valorBruto: 60000,          // R$ 600.00
        valorTaxaDesconto: 3000,    // R$ 30.00
        tipoPgto: 'PF',
        bandeira: BANDEIRA,
      }),
      buildComprovanteVendas({
        codEstab: COD_ESTAB,
        numRV: RV,
        nsu: NSU_1,
        valorTransacao: 40000,      // R$ 400.00 (2/3 do bruto)
        valorParcela: 13334,
        dataPagamento: DATA_PGTO,
        bandeira: BANDEIRA,
      }),
      buildComprovanteVendas({
        codEstab: COD_ESTAB,
        numRV: RV,
        nsu: NSU_2,
        valorTransacao: 20000,      // R$ 200.00 (1/3 do bruto)
        valorParcela: 6667,
        dataPagamento: DATA_PGTO,
        bandeira: BANDEIRA,
      }),
      buildAntecipacao({
        codEstab: COD_ESTAB,
        numOperacao: NUM_OP_ANTEC,
        valorBruto: 60000,          // R$ 600.00
        taxaAntec: 1200,            // R$ 12.00
        valorLiquido: 58800,        // R$ 588.00
        dataOriginalPagamento: DATA_PGTO,
        bandeira: BANDEIRA,
      }),
      buildTrailer({ totalRegistros: 5 }),
    ].join('\n');

    mockBuscarArquivoPorData.mockResolvedValueOnce({
      erro: false,
      mensagem: 'OK',
      arquivo: 'getnetextr_20260220.txt',
      conteudo: fileContent,
      totalLinhas: 6,
      tamanhoBytes: fileContent.length,
    });

    const handler = registeredRoutes['getnet-capture'].handler;
    const req = {
      json: async () => ({
        clientId: 'client-1',
        cycleId: 'cycle-1',
        startDate: '2026-02-20',
        action: 'listar',
      }),
    };

    const result = await handler(req, { functionName: 'getnet-capture', invocationId: 'test' });
    expect(result.status).toBe(200);

    const txs = result.jsonBody.transactions as any[];
    const receber = txs.find((t: any) => t.type === 'receber' && t.metadata.numero_rv === RV);
    const pagar = txs.find((t: any) => t.type === 'pagar' && t.metadata.numero_rv === RV);
    const vendaCartao = txs.find((t: any) => t.type === 'venda_cartao' && t.metadata.numero_rv === RV);
    const cv1 = txs.find((t: any) => t.type === 'comprovante' && t.metadata.nsu === NSU_1);
    const cv2 = txs.find((t: any) => t.type === 'comprovante' && t.metadata.nsu === NSU_2);
    const antecReceber = txs.find((t: any) => t.type === 'receber' && t.metadata.tipo_registro === 'antecipacao_receber');
    const antecPagar = txs.find((t: any) => t.type === 'pagar' && t.metadata.tipo_registro === 'antecipacao_taxa');

    // ===== 1. Todos existem =====
    expect(receber).toBeDefined();
    expect(pagar).toBeDefined();
    expect(vendaCartao).toBeDefined();
    expect(cv1).toBeDefined();
    expect(cv2).toBeDefined();
    expect(antecReceber).toBeDefined();
    expect(antecPagar).toBeDefined();

    // ===== 2. RV consistente entre RECEBER, PAGAR e VENDA_CARTAO =====
    expect(receber.metadata.numero_rv).toBe(RV);
    expect(pagar.metadata.numero_rv).toBe(RV);
    expect(vendaCartao.metadata.numero_rv).toBe(RV);

    // ===== 3. COMPROVANTEs vinculados ao VENDA_CARTAO pelo id =====
    expect(cv1.vinculadoA).toBe(vendaCartao.id);
    expect(cv2.vinculadoA).toBe(vendaCartao.id);
    expect(cv1.vinculacaoTipo).toBe('automatico');
    expect(cv2.vinculacaoTipo).toBe('automatico');

    // ===== 4. RV e NSU consistentes nos COMPROVANTEs =====
    expect(cv1.metadata.numero_rv).toBe(RV);
    expect(cv2.metadata.numero_rv).toBe(RV);
    expect(cv1.numeroDocumento).toBe(NSU_1);
    expect(cv2.numeroDocumento).toBe(NSU_2);

    // ===== 5. VENDA_CARTAO.comprovantes[] contém os mesmos NSUs =====
    const nsusNoVendaCartao = vendaCartao.metadata.comprovantes.map((c: any) => c.nsu).sort();
    expect(nsusNoVendaCartao).toEqual([NSU_1, NSU_2].sort());

    // ===== 6. DataPagamento consistente em toda a cadeia =====
    expect(receber.dataVencimento).toBe(DATA_PGTO_ISO);
    expect(pagar.dataVencimento).toBe(DATA_PGTO_ISO);
    expect(vendaCartao.dataVencimento).toBe(DATA_PGTO_ISO);
    expect(cv1.metadata.data_pagamento).toBe(DATA_PGTO_ISO);
    expect(cv2.metadata.data_pagamento).toBe(DATA_PGTO_ISO);

    // ===== 7. CodigoEstabelecimento consistente =====
    expect(cv1.metadata.codigo_estabelecimento.trim()).toBe(COD_ESTAB);
    expect(cv2.metadata.codigo_estabelecimento.trim()).toBe(COD_ESTAB);
    expect(receber.metadata.codigo_estabelecimento.trim()).toBe(COD_ESTAB);

    // ===== 8. Bandeira consistente =====
    expect(cv1.metadata.bandeira).toBe(BANDEIRA);
    expect(cv2.metadata.bandeira).toBe(BANDEIRA);
    expect(receber.metadata.bandeira).toBe(BANDEIRA);

    // ===== 9. Taxa proporcional rateada corretamente (2/3 e 1/3) =====
    // Taxa total = R$ 30.00 → cv1 (400/600 = 2/3) = R$ 20.00, cv2 (200/600 = 1/3) = R$ 10.00
    expect(cv1.metadata.taxa_proporcional).toBe(20.00);
    expect(cv2.metadata.taxa_proporcional).toBe(10.00);
    expect(cv1.metadata.valor_liquido_estimado).toBe(380.00); // 400 - 20
    expect(cv2.metadata.valor_liquido_estimado).toBe(190.00); // 200 - 10

    // ===== 10. Enriquecimento: antecipação vinculada pelo DataPagamento =====
    // Taxa antecipação = R$ 12.00 → cv1 (2/3) = R$ 8.00, cv2 (1/3) = R$ 4.00
    expect(cv1.metadata.antecipacao).toBeDefined();
    expect(cv2.metadata.antecipacao).toBeDefined();
    expect(cv1.metadata.antecipacao.numero_operacao).toBe(NUM_OP_ANTEC);
    expect(cv2.metadata.antecipacao.numero_operacao).toBe(NUM_OP_ANTEC);
    expect(cv1.metadata.antecipacao.data_original_pagamento).toBe(DATA_PGTO_ISO);
    expect(cv2.metadata.antecipacao.data_original_pagamento).toBe(DATA_PGTO_ISO);
    expect(cv1.metadata.antecipacao.taxa_antecipacao_proporcional).toBe(8.00);
    expect(cv2.metadata.antecipacao.taxa_antecipacao_proporcional).toBe(4.00);
    // valor_liquido_antecipado = faturamento - taxa_maquineta - taxa_antecipacao
    // cv1: 400 - 20 - 8 = 372, cv2: 200 - 10 - 4 = 186
    expect(cv1.metadata.antecipacao.valor_liquido_antecipado).toBe(372.00);
    expect(cv2.metadata.antecipacao.valor_liquido_antecipado).toBe(186.00);

    // ===== 11. VENDA_CARTAO.comprovantes[] também enriquecido =====
    const cvRefByNsu = new Map(vendaCartao.metadata.comprovantes.map((c: any) => [c.nsu, c]));
    const cvRef1 = cvRefByNsu.get(NSU_1) as any;
    const cvRef2 = cvRefByNsu.get(NSU_2) as any;
    expect(cvRef1.antecipacao.numero_operacao).toBe(NUM_OP_ANTEC);
    expect(cvRef2.antecipacao.numero_operacao).toBe(NUM_OP_ANTEC);
    expect(cvRef1.taxa_proporcional).toBe(20.00);
    expect(cvRef2.taxa_proporcional).toBe(10.00);

    // ===== 12. Soma das taxas rateadas = taxa total (integridade) =====
    const somaTaxaMaquineta = cv1.metadata.taxa_proporcional + cv2.metadata.taxa_proporcional;
    expect(somaTaxaMaquineta).toBe(30.00); // = ValorTaxaDesconto do RV

    const somaTaxaAntecipacao =
      cv1.metadata.antecipacao.taxa_antecipacao_proporcional +
      cv2.metadata.antecipacao.taxa_antecipacao_proporcional;
    expect(somaTaxaAntecipacao).toBe(12.00); // = TaxaAntecipacao do Tipo 4
  });
});

// ============================================================================
// TESTS - GETNET CLIENT (mocked)
// ============================================================================

describe('Getnet Client', () => {
  test('getGetnetClient is callable', () => {
    const { getGetnetClient } = require('../ops/getnet/adapters/client');
    const client = getGetnetClient();
    expect(client).toBeDefined();
    expect(client.buscarArquivoPorData).toBeDefined();
    expect(client.buscarUltimoArquivo).toBeDefined();
  });
});
