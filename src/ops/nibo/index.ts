/**
 * nibo-ops (integrado ao mesh)
 *
 * Serviço de integração com Nibo.
 * Responsável por:
 * - Captura de contas a pagar/receber
 * - Captura de pagamentos/recebimentos realizados
 * - Sync de transações categorizadas
 *
 * Rotas: /api/nibo/*
 * Env vars: NIBO_API_KEY
 */

// Functions
import './functions/health';
import './functions/capture';
import './functions/sync';
import './functions/categories';

console.log('[mesh:nibo-ops] Functions registered');
