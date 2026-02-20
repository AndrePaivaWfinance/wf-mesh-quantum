/**
 * wf-operacao-omie-ops
 *
 * Servico de integracao com Omie ERP.
 * Responsavel por:
 * - Captura de contas a pagar/receber
 * - Sync de transacoes categorizadas
 * - Listagem de categorias
 */

// Functions
import './functions/health';
import './functions/capture';
import './functions/sync';
import './functions/categories';

console.log('[mesh:omie-ops] Functions registered');
