/**
 * wf-operacao-controlle-ops
 *
 * Servico de integracao com Controlle (antigo Organizze).
 * Responsavel por:
 * - Captura de lancamentos (receitas/despesas)
 * - Sync de transacoes categorizadas
 * - Listagem de categorias
 */

// Functions
import './functions/health';
import './functions/capture';
import './functions/sync';
import './functions/categories';

console.log('[mesh:controlle-ops] Functions registered');
