/**
 * getnet-ops (integrado ao mesh)
 *
 * Serviço de integração com Getnet via SFTP.
 * Migrado de wf-financeiro (GetnetAgent + SchedulerGetnet + shared/getnet_*)
 *
 * Responsável por:
 * - Download de arquivos de conciliação via SFTP (sftp1.getnet.com.br)
 * - Parse de arquivo posicional (layout V10.1, 401 chars, 8 tipos de registro)
 * - Captura de vendas cartão (RECEBER bruto + PAGAR taxas + VENDA_CARTAO informativo)
 * - Processamento de ajustes, antecipações e cessões de recebíveis
 *
 * Tipos de registro processados:
 *   0 - Header (data, estabelecimento, CNPJ)
 *   1 - Resumo de vendas (bruto, líquido, tarifa, bandeira)
 *   2 - Comprovante individual (NSU, cartão, parcelas)
 *   3 - Ajuste financeiro (chargeback, cancelamento)
 *   4 - Antecipação de recebíveis
 *   5 - Cessão/negociação (CS/CL)
 *   6 - Unidade de recebível (UR) - apenas informativo
 *   9 - Trailer (totais)
 *
 * Rotas: /api/getnet/*
 * Env vars: GETNET_USER, GETNET_PASS
 */

// Functions
import './functions/health';
import './functions/capture';

console.log('[mesh:getnet-ops] Functions registered');
