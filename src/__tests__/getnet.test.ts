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
jest.mock('@azure/keyvault-secrets', () => ({ SecretClient: jest.fn() }));

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

import { parseConteudo, filtrarPorEstabelecimento, calcularResumoFinanceiro } from '../ops/getnet/adapters/fileHelper';
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
 * Build a Type 1 (Resumo de Vendas) line
 * Layout: [0:1] Tipo, [1:16] CodEstab, [16:18] Produto, [18:21] Bandeira,
 *          [21:30] NumRV, [30:38] DataRV, [38:46] DataPgto, [46:60] CNPJ,
 *          [60:72] QtdCV, [84:96] ValorBruto, [96:108] ValorLiquido,
 *          [120:132] ValorTarifa, [168:170] TipoPgto
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
  valorTarifa?: number;
  tipoPgto?: string;
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

  const cnpj = pad('12345678000199', 14);
  for (let i = 0; i < 14; i++) line[46 + i] = cnpj[i];

  const qtdCV = padNum(5, 12);
  for (let i = 0; i < 12; i++) line[60 + i] = qtdCV[i];

  const valorBruto = padNum(opts.valorBruto ?? 100000, 12); // R$ 1000.00
  for (let i = 0; i < 12; i++) line[84 + i] = valorBruto[i];

  const valorLiquido = padNum(opts.valorLiquido ?? 95000, 12); // R$ 950.00
  for (let i = 0; i < 12; i++) line[96 + i] = valorLiquido[i];

  const valorTarifa = padNum(opts.valorTarifa ?? 5000, 12); // R$ 50.00
  for (let i = 0; i < 12; i++) line[120 + i] = valorTarifa[i];

  const tipoPgto = pad(opts.tipoPgto || 'PF', 2);
  line[168] = tipoPgto[0]; line[169] = tipoPgto[1];

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
  const dataPgto = pad('20032026', 8);
  for (let i = 0; i < 8; i++) line[122 + i] = dataPgto[i];

  // CodigoAutorizacao [130:140]
  const codAuth = pad('AUTH123456', 10);
  for (let i = 0; i < 10; i++) line[130 + i] = codAuth[i];

  // Bandeira [140:144]
  const band = pad('VIS', 4);
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
} = {}): string {
  const line = new Array(401).fill(' ');
  line[0] = '4';

  const codEstab = pad(opts.codEstab || '000012345678901', 15);
  for (let i = 0; i < 15; i++) line[1 + i] = codEstab[i];

  // Produto [16:18]
  line[16] = 'S'; line[17] = 'M';

  // Bandeira [18:21]
  line[18] = 'V'; line[19] = 'I'; line[20] = 'S';

  // NumOperacao [21:35]
  const numOp = pad(opts.numOperacao || '00000000000001', 14);
  for (let i = 0; i < 14; i++) line[21 + i] = numOp[i];

  // DataAntecipacao [35:43]
  const dataAntec = pad('20022026', 8);
  for (let i = 0; i < 8; i++) line[35 + i] = dataAntec[i];

  // DataOriginalPagamento [43:51]
  const dataOrig = pad('25022026', 8);
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
      valorTarifa: 5000,     // R$ 50.00
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
    expect(venda.ValorTarifa).toBe(50.00);
    expect(venda.TipoPagamento).toBe('PF');
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
// TESTS - calcularResumoFinanceiro
// ============================================================================

describe('Getnet FileHelper - calcularResumoFinanceiro', () => {
  test('calculates financial summary from establishment data', () => {
    const dados: DadosEstabelecimento = {
      header: null,
      resumos_vendas: [
        {
          TipoRegistro: 1,
          CodigoEstabelecimento: 'ESTAB_A',
          Produto: 'SM',
          Bandeira: 'VIS',
          NumeroRV: '111',
          DataRV: '2026-02-19',
          DataPagamento: '2026-02-20',
          CNPJMatriz: '12345678000199',
          QuantidadeCV: 5,
          ValorBruto: 1000.00,
          ValorLiquido: 950.00,
          ValorTarifa: 50.00,
          TipoPagamento: 'PF',
        },
        {
          TipoRegistro: 1,
          CodigoEstabelecimento: 'ESTAB_A',
          Produto: 'SE',
          Bandeira: 'MAN',
          NumeroRV: '222',
          DataRV: '2026-02-19',
          DataPagamento: '2026-02-20',
          CNPJMatriz: '12345678000199',
          QuantidadeCV: 3,
          ValorBruto: 500.00,
          ValorLiquido: 480.00,
          ValorTarifa: 20.00,
          TipoPagamento: 'PV',
        },
      ],
      comprovantes_vendas: [],
      ajustes_financeiros: [
        {
          TipoRegistro: 3,
          CodigoEstabelecimento: 'ESTAB_A',
          NumeroRV: '333',
          DataAjuste: '2026-02-20',
          DataPagamento: '2026-02-22',
          SinalTransacao: '-',
          ValorAjuste: 100.00,
          MotivoAjuste: 'CHARGEBACK',
        },
      ],
      antecipacoes: [
        {
          TipoRegistro: 4,
          CodigoEstabelecimento: 'ESTAB_A',
          Produto: 'SM',
          Bandeira: 'VIS',
          NumeroOperacao: 'OP001',
          DataAntecipacao: '2026-02-20',
          DataOriginalPagamento: '2026-02-25',
          ValorBrutoAntecipacao: 50000.00,
          TaxaAntecipacao: 2500.00,
          ValorLiquidoAntecipacao: 47500.00,
        },
      ],
      negociacoes_cessao: [
        {
          TipoRegistro: 5,
          CodigoEstabelecimento: 'ESTAB_A',
          DataCessao: '2026-02-20',
          DataPagamento: '2026-02-21',
          NumeroOperacao: 'CS001',
          Indicador: 'CS',
          ValorBrutoCessao: 10000.00,
          ValorTaxaCessao: 500.00,
          ValorLiquidoCessao: 9500.00,
          LinhaRaw: '',
        },
      ],
      unidades_recebiveis: [],
      trailer: null,
    };

    const resumo = calcularResumoFinanceiro(dados);

    // Counts
    expect(resumo.quantidade_registros.resumos_vendas).toBe(2);
    expect(resumo.quantidade_registros.ajustes).toBe(1);
    expect(resumo.quantidade_registros.antecipacoes).toBe(1);
    expect(resumo.quantidade_registros.cessoes).toBe(1);

    // Financials
    expect(resumo.valores_financeiros.valor_bruto_original).toBe(1500.00); // 1000 + 500
    expect(resumo.valores_financeiros.taxa_getnet).toBe(70.00);            // 50 + 20
    expect(resumo.valores_financeiros.valor_pos_getnet).toBe(1430.00);     // 950 + 480
    expect(resumo.valores_financeiros.ajustes_total).toBe(-100.00);
    expect(resumo.valores_financeiros.antecipacoes_bruto).toBe(50000.00);
    expect(resumo.valores_financeiros.antecipacoes_liquido).toBe(47500.00);
    expect(resumo.valores_financeiros.taxa_cessao).toBe(500.00);
    expect(resumo.valores_financeiros.valor_depositado).toBe(9500.00);
  });

  test('excludes LQ (liquidated) sales from totals', () => {
    const dados: DadosEstabelecimento = {
      header: null,
      resumos_vendas: [
        {
          TipoRegistro: 1,
          CodigoEstabelecimento: 'ESTAB_A',
          Produto: 'SM',
          Bandeira: 'VIS',
          NumeroRV: '111',
          DataRV: null,
          DataPagamento: null,
          CNPJMatriz: '',
          QuantidadeCV: 1,
          ValorBruto: 1000.00,
          ValorLiquido: 950.00,
          ValorTarifa: 50.00,
          TipoPagamento: 'LQ',  // LIQUIDATED - should be excluded
        },
        {
          TipoRegistro: 1,
          CodigoEstabelecimento: 'ESTAB_A',
          Produto: 'SM',
          Bandeira: 'VIS',
          NumeroRV: '222',
          DataRV: null,
          DataPagamento: null,
          CNPJMatriz: '',
          QuantidadeCV: 1,
          ValorBruto: 500.00,
          ValorLiquido: 480.00,
          ValorTarifa: 20.00,
          TipoPagamento: 'PF',  // Normal
        },
      ],
      comprovantes_vendas: [],
      ajustes_financeiros: [],
      antecipacoes: [],
      negociacoes_cessao: [],
      unidades_recebiveis: [],
      trailer: null,
    };

    const resumo = calcularResumoFinanceiro(dados);

    // Only the non-LQ sale should be counted
    expect(resumo.valores_financeiros.valor_bruto_original).toBe(500.00);
    expect(resumo.valores_financeiros.taxa_getnet).toBe(20.00);
    expect(resumo.valores_financeiros.valor_pos_getnet).toBe(480.00);
  });

  test('only counts CS cessoes (not CL)', () => {
    const dados: DadosEstabelecimento = {
      header: null,
      resumos_vendas: [],
      comprovantes_vendas: [],
      ajustes_financeiros: [],
      antecipacoes: [],
      negociacoes_cessao: [
        {
          TipoRegistro: 5,
          CodigoEstabelecimento: 'ESTAB_A',
          DataCessao: null,
          DataPagamento: null,
          NumeroOperacao: 'CS001',
          Indicador: 'CS',
          ValorBrutoCessao: 10000.00,
          ValorTaxaCessao: 500.00,
          ValorLiquidoCessao: 9500.00,
          LinhaRaw: '',
        },
        {
          TipoRegistro: 5,
          CodigoEstabelecimento: 'ESTAB_A',
          DataCessao: null,
          DataPagamento: null,
          NumeroOperacao: 'CL001',
          Indicador: 'CL',
          ValorBrutoCessao: 20000.00,
          ValorTaxaCessao: 0,
          ValorLiquidoCessao: 20000.00,
          LinhaRaw: '',
        },
      ],
      unidades_recebiveis: [],
      trailer: null,
    };

    const resumo = calcularResumoFinanceiro(dados);

    // Only CS should be counted
    expect(resumo.valores_financeiros.taxa_cessao).toBe(500.00);
    expect(resumo.valores_financeiros.valor_depositado).toBe(9500.00);
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

  test('returns healthy when env vars are set', async () => {
    process.env.GETNET_USER = 'test-user';
    process.env.GETNET_PASS = 'test-pass';

    const handler = registeredRoutes['getnet-health'].handler;
    const result = await handler({}, {});

    expect(result.status).toBe(200);
    expect(result.jsonBody.status).toBe('healthy');
    expect(result.jsonBody.sftp).toBe('configured');
    expect(result.jsonBody.host).toBe('sftp1.getnet.com.br');
  });

  test('returns degraded when env vars missing', async () => {
    delete process.env.GETNET_USER;
    delete process.env.GETNET_PASS;

    const handler = registeredRoutes['getnet-health'].handler;
    const result = await handler({}, {});

    expect(result.status).toBe(503);
    expect(result.jsonBody.status).toBe('degraded');
    expect(result.jsonBody.sftp).toBe('not_configured');
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
        valorTarifa: 5000,
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
