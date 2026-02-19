// Mock data used when API is unavailable (development without backend)

export const mockDashboard = {
  kpis: {
    totalClientes: 24,
    clientesAtivos: 18,
    transacoesHoje: 347,
    transacoesMes: 8_432,
    taxaClassificacao: 94.7,
    taxaAprovacao: 87.3,
    anomaliasDetectadas: 12,
    ciclosCompletos: 156,
  },
  pipeline: {
    status: 'running',
    etapa: 'Classificação AI',
    progresso: 67,
  },
  alertas: [
    { id: '1', tipo: 'warning' as const, mensagem: 'Cliente Apex Corp com 5 transações pendentes há 3 dias', criadoEm: '2026-02-19T10:30:00Z' },
    { id: '2', tipo: 'error' as const, mensagem: 'Falha na integração Nibo para cliente TechFlow', criadoEm: '2026-02-19T09:15:00Z' },
    { id: '3', tipo: 'success' as const, mensagem: 'Ciclo diário completado com 98.5% de precisão', criadoEm: '2026-02-19T06:00:00Z' },
    { id: '4', tipo: 'info' as const, mensagem: 'Novo modelo de classificação disponível v2.4', criadoEm: '2026-02-18T14:00:00Z' },
  ],
  metricas: [
    { data: '13/02', transacoes: 280, classificadas: 265, anomalias: 8 },
    { data: '14/02', transacoes: 310, classificadas: 295, anomalias: 11 },
    { data: '15/02', transacoes: 150, classificadas: 142, anomalias: 4 },
    { data: '16/02', transacoes: 95, classificadas: 90, anomalias: 2 },
    { data: '17/02', transacoes: 340, classificadas: 320, anomalias: 15 },
    { data: '18/02', transacoes: 365, classificadas: 348, anomalias: 9 },
    { data: '19/02', transacoes: 347, classificadas: 328, anomalias: 12 },
  ],
};

export const mockClientes = [
  { id: 'c1', nome: 'Apex Corp', cnpj: '12.345.678/0001-90', sistema: 'nibo', status: 'ativo', plano: 'Premium', fontes: ['santander', 'getnet', 'nibo'], criadoEm: '2025-06-15T00:00:00Z', atualizadoEm: '2026-02-19T00:00:00Z' },
  { id: 'c2', nome: 'TechFlow Ltda', cnpj: '98.765.432/0001-10', sistema: 'omie', status: 'ativo', plano: 'Avançado', fontes: ['santander', 'ofx'], criadoEm: '2025-08-20T00:00:00Z', atualizadoEm: '2026-02-18T00:00:00Z' },
  { id: 'c3', nome: 'Inova Solutions', cnpj: '11.222.333/0001-44', sistema: 'nibo', status: 'ativo', plano: 'Essencial', fontes: ['nibo'], criadoEm: '2025-10-01T00:00:00Z', atualizadoEm: '2026-02-17T00:00:00Z' },
  { id: 'c4', nome: 'Delta Comércio', cnpj: '55.666.777/0001-88', sistema: 'omie', status: 'onboarding', plano: 'Avançado', fontes: ['santander'], criadoEm: '2026-01-10T00:00:00Z', atualizadoEm: '2026-02-19T00:00:00Z' },
  { id: 'c5', nome: 'Nexus Serviços', cnpj: '33.444.555/0001-22', sistema: 'controlle', status: 'ativo', plano: 'Premium', fontes: ['santander', 'getnet', 'ofx'], criadoEm: '2025-04-05T00:00:00Z', atualizadoEm: '2026-02-19T00:00:00Z' },
  { id: 'c6', nome: 'Vortex Digital', cnpj: '77.888.999/0001-55', sistema: 'nibo', status: 'suspenso', plano: 'Essencial', fontes: ['nibo'], criadoEm: '2025-11-20T00:00:00Z', atualizadoEm: '2026-01-15T00:00:00Z' },
];

export const mockAutorizacoes = [
  { id: 'a1', clientId: 'c1', clientName: 'Apex Corp', tipo: 'Pagamento Fornecedor', descricao: 'NF 45892 - Material de escritório', valor: 3_450.00, data: '2026-02-19', status: 'pendente', criadoEm: '2026-02-19T10:00:00Z' },
  { id: 'a2', clientId: 'c2', clientName: 'TechFlow Ltda', tipo: 'Transferência', descricao: 'Transferência para conta investimento', valor: 15_000.00, data: '2026-02-19', status: 'pendente', criadoEm: '2026-02-19T09:30:00Z' },
  { id: 'a3', clientId: 'c1', clientName: 'Apex Corp', tipo: 'Pagamento Imposto', descricao: 'DARF - IRPJ 1º trimestre', valor: 8_720.50, data: '2026-02-20', status: 'pendente', criadoEm: '2026-02-19T08:00:00Z' },
  { id: 'a4', clientId: 'c5', clientName: 'Nexus Serviços', tipo: 'Pagamento Folha', descricao: 'Folha de pagamento fevereiro/2026', valor: 45_320.00, data: '2026-02-28', status: 'pendente', criadoEm: '2026-02-18T16:00:00Z' },
  { id: 'a5', clientId: 'c3', clientName: 'Inova Solutions', tipo: 'Boleto', descricao: 'Aluguel escritório - Março', valor: 4_800.00, data: '2026-03-01', status: 'pendente', criadoEm: '2026-02-18T14:30:00Z' },
];

export const mockDuvidas = [
  { id: 'd1', clientId: 'c1', clientName: 'Apex Corp', transactionId: 't1', descricao: 'PIX recebido - MARIA SILVA', valor: 2_500.00, categoriasSugeridas: [{ categoria: 'Receita de Serviços', confianca: 0.45 }, { categoria: 'Empréstimo Sócios', confianca: 0.35 }, { categoria: 'Adiantamento Cliente', confianca: 0.20 }], status: 'pendente', criadoEm: '2026-02-19T11:00:00Z' },
  { id: 'd2', clientId: 'c2', clientName: 'TechFlow Ltda', transactionId: 't2', descricao: 'TED enviada - JOHN DOE CONSULTING', valor: 12_000.00, categoriasSugeridas: [{ categoria: 'Consultoria Externa', confianca: 0.52 }, { categoria: 'Serviços de TI', confianca: 0.38 }, { categoria: 'Despesa Administrativa', confianca: 0.10 }], status: 'pendente', criadoEm: '2026-02-19T10:15:00Z' },
  { id: 'd3', clientId: 'c5', clientName: 'Nexus Serviços', transactionId: 't3', descricao: 'Débito automático - SEGURADORA XYZ', valor: 890.00, categoriasSugeridas: [{ categoria: 'Seguros', confianca: 0.60 }, { categoria: 'Despesa Financeira', confianca: 0.25 }], status: 'pendente', criadoEm: '2026-02-18T15:00:00Z' },
];

export const mockFilas = [
  { nome: 'Captura', pendentes: 12, processando: 3, concluidos: 245, erros: 1 },
  { nome: 'Classificação', pendentes: 8, processando: 5, concluidos: 232, erros: 2 },
  { nome: 'Detecção Anomalias', pendentes: 15, processando: 2, concluidos: 220, erros: 0 },
  { nome: 'Matching', pendentes: 6, processando: 4, concluidos: 218, erros: 3 },
  { nome: 'Sync ERP', pendentes: 3, processando: 1, concluidos: 210, erros: 0 },
  { nome: 'Notificações', pendentes: 2, processando: 0, concluidos: 198, erros: 0 },
];

export const mockHistorico = [
  { id: 'h1', tipo: 'aprovacao', descricao: 'Autorização #A1234 aprovada', usuario: 'admin@wf.com', clientId: 'c1', clientName: 'Apex Corp', criadoEm: '2026-02-19T11:30:00Z' },
  { id: 'h2', tipo: 'classificacao', descricao: 'Dúvida #D567 resolvida como "Consultoria Externa"', usuario: 'admin@wf.com', clientId: 'c2', clientName: 'TechFlow Ltda', criadoEm: '2026-02-19T10:45:00Z' },
  { id: 'h3', tipo: 'ciclo', descricao: 'Ciclo diário iniciado automaticamente', usuario: 'sistema', criadoEm: '2026-02-19T09:00:00Z' },
  { id: 'h4', tipo: 'cliente', descricao: 'Cliente Delta Comércio atualizado para status "onboarding"', usuario: 'admin@wf.com', clientId: 'c4', clientName: 'Delta Comércio', criadoEm: '2026-02-18T16:20:00Z' },
  { id: 'h5', tipo: 'rejeicao', descricao: 'Autorização #A1230 rejeitada - valor divergente', usuario: 'admin@wf.com', clientId: 'c3', clientName: 'Inova Solutions', criadoEm: '2026-02-18T15:00:00Z' },
  { id: 'h6', tipo: 'alerta', descricao: 'Anomalia detectada: transação duplicada R$ 5.200', usuario: 'sistema', clientId: 'c1', clientName: 'Apex Corp', criadoEm: '2026-02-18T14:30:00Z' },
  { id: 'h7', tipo: 'sync', descricao: 'Sync ERP concluído para 15 clientes', usuario: 'sistema', criadoEm: '2026-02-18T12:00:00Z' },
  { id: 'h8', tipo: 'ciclo', descricao: 'Ciclo diário completado - 98.5% precisão', usuario: 'sistema', criadoEm: '2026-02-18T11:30:00Z' },
];

export const mockMetrics = {
  classificacao: { total: 8432, precisao: 94.7, tempoMedio: 1.2 },
  anomalias: { total: 47, falsoPositivo: 8, verdadeiroPositivo: 39 },
  matching: { total: 7890, taxa: 96.2, divergencias: 156 },
  performance: [
    { hora: '06:00', latencia: 120, throughput: 45 },
    { hora: '08:00', latencia: 180, throughput: 120 },
    { hora: '10:00', latencia: 250, throughput: 180 },
    { hora: '12:00', latencia: 200, throughput: 150 },
    { hora: '14:00', latencia: 220, throughput: 160 },
    { hora: '16:00', latencia: 190, throughput: 140 },
    { hora: '18:00', latencia: 140, throughput: 80 },
  ],
};
