import {
  createTransaction,
  createClient,
  generateTenantId,
  TransactionType,
  TransactionSource,
  TransactionStatus,
  ClientSystem,
  ClientPlano,
  ClientStatus,
  CycleStatus,
} from '../types';

describe('Enums', () => {
  test('TransactionType has expected values', () => {
    expect(TransactionType.PAGAR).toBe('pagar');
    expect(TransactionType.RECEBER).toBe('receber');
    expect(TransactionType.EXTRATO).toBe('extrato');
  });

  test('TransactionStatus has pipeline statuses', () => {
    expect(TransactionStatus.NOVO).toBe('novo');
    expect(TransactionStatus.CAPTURADO).toBe('capturado');
    expect(TransactionStatus.CLASSIFICADO).toBe('classificado');
    expect(TransactionStatus.PROCESSADO).toBe('processado');
  });

  test('CycleStatus has correct states', () => {
    expect(CycleStatus.PENDING).toBe('pending');
    expect(CycleStatus.RUNNING).toBe('running');
    expect(CycleStatus.COMPLETED).toBe('completed');
    expect(CycleStatus.FAILED).toBe('failed');
  });

  test('ClientPlano has correct values', () => {
    expect(ClientPlano.ESSENCIAL).toBe('Essencial');
    expect(ClientPlano.AVANCADO).toBe('Avançado');
    expect(ClientPlano.PREMIUM).toBe('Premium');
  });
});

describe('generateTenantId', () => {
  test('creates slug from name', () => {
    expect(generateTenantId('ACME Tech')).toBe('acme-tech');
  });

  test('removes accents', () => {
    expect(generateTenantId('São Paulo Café')).toBe('sao-paulo-cafe');
  });

  test('removes special characters', () => {
    expect(generateTenantId('Empresa & Cia.')).toBe('empresa-cia');
  });

  test('truncates to 30 chars', () => {
    const long = 'A'.repeat(50);
    expect(generateTenantId(long).length).toBeLessThanOrEqual(30);
  });

  test('trims leading/trailing hyphens', () => {
    expect(generateTenantId('--test--')).toBe('test');
  });
});

describe('createTransaction', () => {
  test('creates transaction with defaults', () => {
    const tx = createTransaction(
      'client-1',
      TransactionType.PAGAR,
      TransactionSource.NIBO,
      { descricao: 'Test', valor: 100 }
    );

    expect(tx.id).toBeDefined();
    expect(tx.clientId).toBe('client-1');
    expect(tx.type).toBe('pagar');
    expect(tx.source).toBe('nibo');
    expect(tx.status).toBe(TransactionStatus.CAPTURADO);
    expect(tx.descricao).toBe('Test');
    expect(tx.valor).toBe(100);
    expect(tx.createdAt).toBeDefined();
    expect(tx.capturedAt).toBeDefined();
  });

  test('applies partial overrides', () => {
    const tx = createTransaction(
      'client-1',
      TransactionType.RECEBER,
      TransactionSource.SANTANDER,
      { descricao: 'Sale', valor: 5000, contraparte: 'Empresa X' }
    );

    expect(tx.contraparte).toBe('Empresa X');
    expect(tx.type).toBe('receber');
  });
});

describe('createClient', () => {
  test('creates client with required fields', () => {
    const client = createClient({
      nome: 'ACME Corp',
      cnpj: '12345678000199',
      email: 'acme@test.com',
      sistema: ClientSystem.NIBO,
    });

    expect(client.id).toBeDefined();
    expect(client.tenantId).toBe('acme-corp');
    expect(client.nome).toBe('ACME Corp');
    expect(client.cnpj).toBe('12345678000199');
    expect(client.email).toBe('acme@test.com');
    expect(client.sistema).toBe('nibo');
    expect(client.plano).toBe(ClientPlano.ESSENCIAL);
    expect(client.status).toBe(ClientStatus.ONBOARDING);
    expect(client.config.notificacoes.email).toBe(true);
    expect(client.config.categoriasCustomizadas).toBe(false);
  });

  test('respects custom tenantId', () => {
    const client = createClient({
      nome: 'Test',
      cnpj: '00000000000000',
      email: 'test@test.com',
      sistema: ClientSystem.OMIE,
      tenantId: 'custom-id',
    });

    expect(client.tenantId).toBe('custom-id');
  });

  test('respects custom plano', () => {
    const client = createClient({
      nome: 'Premium Corp',
      cnpj: '00000000000000',
      email: 'p@test.com',
      sistema: ClientSystem.NIBO,
      plano: ClientPlano.PREMIUM,
    });

    expect(client.plano).toBe(ClientPlano.PREMIUM);
  });

  test('merges custom config', () => {
    const client = createClient({
      nome: 'Config Corp',
      cnpj: '00000000000000',
      email: 'c@test.com',
      sistema: ClientSystem.NIBO,
      config: { banco: 'santander' },
    });

    expect(client.config.banco).toBe('santander');
    expect(client.config.notificacoes).toBeDefined();
  });
});
