/**
 * wf-operacao-inter-ops
 *
 * Serviço de integração com Banco Inter.
 * Responsável por:
 * - DDA (Débito Direto Autorizado) → wf-a-pagar
 * - PIX (listagem, pagamento) → wf-extrato
 * - Boletos (listagem, pagamento) → wf-a-receber / wf-extrato
 * - Comprovantes (extração) → wf-extrato
 * - Extrato bancário → wf-extrato
 * - Saldo
 */

// Functions
import './functions/health';
import './functions/capture';
import './functions/dda';
import './functions/pix';
import './functions/boletos';
import './functions/extrato';

console.log('[mesh:inter-ops] Functions registered');
